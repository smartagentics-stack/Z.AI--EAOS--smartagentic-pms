# ADR-023: Vector Store — sqlite-vec Default

**ADR-ID:** ADR-023
**Status:** ACCEPTED
**Context:** 2026-08-05
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §9, File 2 §II.5/§II.6) classifies **Local Vector Retrieval** as an "Architecture Contract — NOW" capability. Phase B B4 item #11 confirmed that the SmartAgentics SDK has NO `VectorStore` interface and no vector index in the Prisma schema. ADR-001 currently states "Vector search — Deferred (implementation)" and the Build-vs-Buy Matrix says "Vector Database — pgvector (Phase 2 only if needed)". This is Foundational Conflict FC-2.1 in the Stream 2 research report — the _implementation_ may be Phase 2, but the _architectural contract_ (interface + named implementations + PoC) must land in Phase 1.

SmartAgentics' existing stack is SQLite via Prisma (ADR-006, ADR-005). The cleanest architectural fit is therefore a vector store that lives inside the existing SQLite database — no new process, no new port, no new backup strategy, no new auth surface. Phase C Stream 2 research (`/home/z/my-project/phase-c-stream2-embeddings-retrieval-report.md`, §3) surveyed 13 vector stores and selected **sqlite-vec** (MIT/Apache-2.0 dual-licensed, pure-C, zero-dependency SQLite loadable extension) as the Phase 1 primary, **LanceDB** (Apache 2.0, Rust-core, embedded TypeScript SDK) as the Phase 2+ scale-out, and **pgvector** (PostgreSQL extension, HNSW + IVFFlat + 0.8.0 `iterative_scan`) as the cloud-mode parity implementation when SmartAgentics deploys against PostgreSQL. Qdrant is reserved for Phase 3+ federated scale-out.

The `EmbeddingsRuntime` (ADR-022) produces `number[][]`; this ADR defines where those vectors live and how they are queried. Every downstream capability (Hybrid Search ADR-024, Multi-Tenant Isolation ADR-027, Stream 3 RAG, Stream 6 Memory) depends on a stable `VectorStore` contract that hides the implementation difference between sqlite-vec / LanceDB / pgvector / Qdrant behind a single interface.

## 2. Problem

The architectural problem: **define a `VectorStore` SDK interface that (a) is the single contract for vector persistence and KNN query, (b) names sqlite-vec as the Phase 1 default implementation that plugs into the existing SQLite+Prisma database via `better-sqlite3` + a loadable extension, (c) reserves LanceDB (Phase 2+ scale-out), pgvector (Phase 2+ cloud), and Qdrant (Phase 3+ federated) as interchangeable behind-the-interface implementations, (d) supports metadata filtering with partition-key pre-filtering for tenant isolation (ADR-027), (e) supports incremental upsert/delete without full index rebuild, (f) encapsulates all vec0/sqlite-vec-specific raw SQL inside the implementation module (Prisma does not natively manage vec0 virtual tables), and (g) is additive to the existing Prisma schema (no breaking changes to existing tables).** This ADR resolves Foundational Conflict FC-2.1 by separating implementation timing (Phase 2 production rollout acceptable) from architectural contract (Phase 1 interface + PoC mandatory).

## 3. Options

### Option A: LanceDB as the Phase 1 primary vector store

Use LanceDB's embedded TypeScript SDK as the default. Rejected — (1) LanceDB is a separate storage engine using the Lance columnar format, not SQLite — adds a second data file, a second backup strategy, and a second query language (TypeScript SDK, not SQL); (2) for Phase 1 small corpus (1K–50K chunks per property), sqlite-vec's "one database" simplicity wins (research §3.3 "trade-off vs sqlite-vec: LanceDB is a _separate storage engine_"); (3) LanceDB's TypeScript SDK is newer than its Python SDK and has minor API churn between minor versions; (4) LanceDB is reserved as the Phase 2+ scale-out for when corpus exceeds sqlite-vec's brute-force ceiling (~100K chunks per tenant).

### Option B: pgvector as the Phase 1 primary vector store

Introduce PostgreSQL solely for vector search in Phase 1. Rejected — (1) SmartAgentics is SQLite-first / offline-first (ADR-001, ADR-006); introducing PostgreSQL in Phase 1 breaks the offline contract and adds DBA burden hotel IT cannot support; (2) Build-vs-Buy Matrix's "pgvector — Phase 2 only if needed" remains accurate for _implementation_; (3) pgvector is the right answer when PostgreSQL is already the chosen database (Phase 2+ cloud deployments), not for Phase 1 SQLite deployments (research §3.4).

### Option C: sqlite-vec as Phase 1 default, with LanceDB / pgvector / Qdrant reserved behind a `VectorStore` interface

Define a `VectorStore` interface in `packages/sdk/src/ai/vectorStore/`. Reference implementation = `SqliteVecVectorStore` using `better-sqlite3` + the sqlite-vec loadable extension. The `vec_chunks` virtual table lives in the same SQLite file as the rest of the PMS data → single backup, single transaction, single source of truth. LanceDB (`LanceDbVectorStore`), pgvector (`PgVectorVectorStore`), and Qdrant (`QdrantVectorStore`) are reserved as interchangeable implementations behind the same interface. Per research §3.1 "Decision Candidate" and §16 "Recommended Phase 1 Architecture".

## 4. Decision

Adopt **Option C**. The Vector Store architectural contract is:

1. **SDK interface** — A `VectorStore` interface in `packages/sdk/src/ai/vectorStore/`:

   ```
   VectorStore {
     upsert(id: string, vector: number[], metadata: ChunkMetadata): Promise<void>
     upsertBatch(items: VectorInsert[]): Promise<void>           // batch in one transaction
     query(vector: number[], options: QueryOptions): Promise<ScoredChunk[]>
     delete(id: string): Promise<void>
     deleteByFilter(filter: MetadataFilter): Promise<void>
     count(filter?: MetadataFilter): Promise<number>
     compact?(): Promise<void>                                    // optional; HNSW tombstone reclaim
     createTenant?(tenantId: string): Promise<void>              // optional; no-op for sqlite-vec
   }

   QueryOptions {
     k: number                              // top-K results
     filter: MetadataFilter                 // mandatory tenant_id; optional property_id + others
     tenantId: string                       // mandatory; see ADR-027
     propertyId?: string
     indexType?: 'bruteforce' | 'hnsw' | 'ivfflat'   // impl-specific default
     distanceMetric?: 'cosine' | 'l2' | 'ip'          // default: cosine
   }

   ScoredChunk {
     id: string
     score: number                          // cosine similarity [−1, 1] or distance (impl-defined)
     metadata: ChunkMetadata
   }
   ```

2. **`MetadataFilter`** (shared with ADR-024, ADR-027):

   ```
   MetadataFilter {
     tenant_id: string                      // mandatory
     property_id?: string
     document_type?: string                 // 'policy' | 'sop' | 'faq' | 'manual' | 'room_info'
     language?: string
     version?: number
     effective_date?: { gte?: string; lte?: string }
     parent_chunk_id?: string
     custom?: Record<string, string | number | boolean>
   }
   ```

3. **Reference implementation** — `SqliteVecVectorStore` in `packages/sdk/src/ai/vectorStore/sqliteVecVectorStore.ts`:
   - Opens a `better-sqlite3` connection (separate from the Prisma connection, because Prisma does not expose `loadExtension` on its internal connection in all configurations).
   - Loads sqlite-vec via `db.loadExtension('sqlite-vec.dll'|'sqlite-vec.so'|'sqlite-vec.dylib')`.
   - Encapsulates ALL vec0-specific raw SQL inside this class — application code never sees `vec0` SQL syntax.
   - Uses prepared statements for `upsert`, `query`, `delete`.

4. **Phase 1 schema** — `vec_chunks` virtual table created via Prisma migration raw SQL (`$executeRawUnsafe`):

   ```sql
   CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
     chunk_id TEXT PRIMARY KEY,
     tenant_id TEXT partition key,
     property_id TEXT partition key,
     embedding float[768] distance_metric=cosine
   );
   ```
   - `tenant_id` and `property_id` are partition keys (sqlite-vec v0.1.6+, Nov 2024 metadata release) — pre-filter before any vector comparison.
   - The `Chunk` Prisma model (regular table) holds the text, metadata, and `parentChunkId`; `vec_chunks` is joined to `Chunk` via `chunk_id`.
   - Prisma does NOT manage the vec0 virtual table natively; it is created via raw SQL in a migration.

5. **Tiered implementation strategy** (per research §3.1, "Impact on future AI-BOS"):
   - **Tier 1 (Phase 1)**: `SqliteVecVectorStore` — single hotel, <100K chunks/tenant, brute-force, in-process. **Default.**
   - **Tier 2 (Phase 2+)**: `LanceDbVectorStore` — single hotel, >100K chunks/tenant, ANN (IVF/PQ/HNSW), in-process but separate Lance storage file.
   - **Tier 3 (Phase 2+ cloud)**: `PgVectorVectorStore` — multi-property cloud, shared PostgreSQL cluster, HNSW + IVFFlat + `iterative_scan = strict`.
   - **Tier 4 (Phase 3+ federated)**: `QdrantVectorStore` — multi-region, federated, filterable HNSW (the gold standard for filter-heavy multi-tenant workloads).
   - The `VectorStore` interface is identical across all four tiers; only the implementation class changes. Application code is unchanged when migrating tiers.

6. **Index type** — Phase 1 sqlite-vec: `'bruteforce'` only (no ANN index yet — sqlite-vec issue #172 confirms brute-force only as of v0.1.x). Phase 2+ LanceDB / pgvector: `'hnsw'` default with `M=16`, `ef_construction=200`, `ef_search=64` (LanceDB / pgvector defaults). The `indexType` parameter is reserved in the Phase 1 interface but only `'bruteforce'` is implemented.

7. **Distance metric** — Default `'cosine'` (matches Nomic v1.5's normalized embeddings). `'l2'` (Euclidean) and `'ip'` (inner product) reserved for future models that do not L2-normalize.

8. **Incremental indexing** — `upsert` / `delete` / `deleteByFilter` are O(1) row operations in sqlite-vec (no index rebuild). For Phase 2+ HNSW implementations, deletes use tombstoning with periodic `compact()` when tombstone ratio exceeds 10% (per research §12.1). The `compact()` method is optional in the interface — sqlite-vec throws `UnsupportedError`; LanceDB/pgvector implement it.

9. **Concurrent write contention** — SQLite WAL mode (standard production config) handles concurrent reads + 1 writer. Embedding ingestion (writes to `vec_chunks`) and PMS transactions (writes to bookings/guests) share the same writer lock. Mitigation: `synchronous=NORMAL`, batch `upsertBatch` to 100 chunks per transaction. For high-write multi-property deployments, ADR-027's collection-per-tenant (separate SQLite files) is the escalation path.

10. **Backup** — `vec_chunks` and `fts_chunks` (ADR-024) virtual tables live in the same SQLite file as the Prisma-managed tables. A single `.backup` of `pms.db` captures everything. **This is a major operational simplification vs LanceDB (separate Lance files) or Qdrant (separate server).**

11. **VectorStore is additive to the existing Prisma schema** — No existing tables are modified. The migration is `CREATE VIRTUAL TABLE` (raw SQL), no `ALTER` or `DROP` of existing Prisma models. The `Chunk` model gains a `tenantId` column (mandatory, per ADR-027) and `parentChunkId` (per ADR-026) — these are additive columns on a new table, not modifications to existing tables.

## 5. Rationale

- **sqlite-vec is SQLite** — SmartAgentics already uses SQLite via Prisma (ADR-005, ADR-006). Adding vector search means loading ONE extension into the existing SQLite connection: no new database process, no new port, no new backup strategy, no new auth surface, no new replication story (research §3.1 "Inference").
- **Pure C, zero dependencies, MIT/Apache-2.0 dual-licensed** — Single `.dll`/`.so`/`.dylib` file (~500 KB). Pre-built Windows binary available from GitHub Releases — hotel IT does not need to compile anything. Most permissive license possible (research §3.1).
- **In-process with Next.js** — No inter-process communication latency. Vectors live in the same SQLite file as the rest of the PMS data → single backup, single transaction, single source of truth (research §3.1).
- **Brute-force is sufficient for Phase 1 corpus sizes** — For 1K–50K chunks per property, brute-force KNN on 768-dim vectors completes in <10 ms on commodity CPUs. Alex Garcia (sqlite-vec author) quotes: "I can still get reasonable performance for 100's of thousands of vectors." The 100K-chunks/tenant threshold is the trigger to migrate to LanceDB (Tier 2) (research §3.1, §11.1).
- **Partition-key pre-filtering** — sqlite-vec v0.1.6+ (Nov 2024 metadata release) supports partition-key pre-filtering: `WHERE tenant_id = ? AND property_id = ?` is applied BEFORE the KNN scan. This is the architectural foundation for ADR-027 multi-tenant isolation (research §3.1, §10.1).
- **LanceDB reserved as the escape hatch** — For >100K chunks/tenant, sqlite-vec brute-force exceeds ~100 ms query latency. LanceDB's IVF/PQ/HNSW ANN indexes scale to millions of vectors per table. Native TypeScript embedded SDK (rare among vector databases — Continue.dev chose LanceDB for exactly this reason). Apache 2.0 (research §3.3).
- **pgvector reserved for cloud deployments** — When SmartAgentics deploys against PostgreSQL (Phase 2+ cloud), pgvector is the only vector store that lives natively inside Postgres — hybrid SQL+vector queries, transactional consistency with the rest of the schema, mature backup/replication. The 0.8.0 `iterative_scan` release (Nov 2024) materially improved filtered search recall — the historical pgvector weakness is now substantially addressed (research §3.4).
- **Qdrant reserved for Phase 3+ federated** — Qdrant's filterable HNSW is the gold standard for filter-heavy multi-tenant workloads. Its multi-tenant docs explicitly recommend "partition by payload" for "a large number of small, similarly-sized tenants" — which is exactly the hotel PMS pattern (research §3.7).
- **Rejecting LanceDB-primary (Option A)** — adds a second storage engine in Phase 1; overkill for small corpus; SDK churn risk.
- **Rejecting pgvector-primary (Option B)** — requires PostgreSQL in Phase 1; breaks offline-first; violates ADR-001/ADR-006.
- **Rejecting sqlite-vss** — deprecated; Alex Garcia explicitly calls sqlite-vec the successor; built on FAISS (C++ dependency, harder Windows deployment) (research §3.2).
- **Rejecting ChromaDB / Milvus Lite** — Python-first / Python-only; weaker TypeScript story (research §3.6, §3.8).
- **Rejecting DuckDB VSS** — DuckDB is OLAP, not transactional; experimental extension (research §3.9).
- **Rejecting Turso/libSQL** — fork commitment; cloud-tied; Phase 3+ option for embedded-replica cloud sync (research §3.10).
- **Rejecting FAISS** — in-memory library, no persistence, no metadata, no SQL — would require building a vector database (research §3.11).
- **Rejecting Weaviate** — server-first; less-mature embedded mode (Linux only); BSD-3 vs Qdrant's Apache 2.0 (research §3.12).
- **Encapsulating raw SQL** — Prisma does not natively understand vec0 virtual tables; all `vec0` SQL is encapsulated inside `SqliteVecVectorStore`. Application code programs against the `VectorStore` interface only — never sees `vec0` syntax. This isolates application code from sqlite-vec's pre-v1 SQL-syntax drift (research §3.1 risk: "Pre-v1 status: sqlite-vec README explicitly says 'pre-v1, so expect breaking changes.' Mitigation: pin to specific minor version; the VectorStore interface isolates application code from SQL-syntax drift").
- **Tiered strategy with single interface** — The `VectorStore` interface is the same across all four tiers; only the implementation class changes. Migration from sqlite-vec → LanceDB → pgvector → Qdrant is a behind-the-interface swap (research §3.1 "Impact on future AI-BOS").

## 6. Consequences

**Positive**:

- Single contract for vector persistence + KNN query — every downstream consumer (Hybrid Retriever ADR-024, Stream 3 RAG, Stream 6 Memory) programs against `VectorStore`, not against sqlite-vec/LanceDB/pgvector-specific SQL or SDKs.
- sqlite-vec plugs into the existing SQLite database — single backup, single transaction, single source of truth. Zero new processes / ports / backup strategies in Phase 1.
- Tiered scale-out path (sqlite-vec → LanceDB → pgvector → Qdrant) is reserved without Phase 1 commitment — application code is unchanged when migrating tiers.
- Partition-key pre-filtering is the architectural foundation for ADR-027 multi-tenant isolation.
- Additive to existing Prisma schema — no breaking changes; low migration cost.
- Resolves Foundational Conflict FC-2.1 (separates implementation timing from architectural contract).

**Negative / obligations**:

- Phase 1 must include the `VectorStore` interface + `SqliteVecVectorStore` implementation + Prisma migration creating `vec_chunks` + Windows binary load test — estimated 3–5 days of Phase E + Phase 1 engineering (research §3.1 "Impact on Phase 1").
- sqlite-vec is pre-v1 — breaking changes possible. Mitigation: pin to specific minor version (e.g., v0.1.x); `VectorStore` interface isolates application code.
- sqlite-vec is brute-force only (no ANN) — performance ceiling ~100K vectors/tenant before queries exceed 100 ms. Mitigation: monitor corpus size per tenant; auto-migrate to LanceDB at threshold (Phase 2+ operational runbook).
- Prisma does not natively manage vec0 virtual tables — `vec_chunks` DDL must use `$executeRawUnsafe`; future Prisma migrations must use `CREATE VIRTUAL TABLE IF NOT EXISTS` to survive schema resets.
- Windows binary loading — Phase 1 PoC MUST validate that `sqlite-vec.dll` loads correctly on Windows 10/11 via `better-sqlite3`. Fallback to LanceDB if blocking (research risk R-2.4).
- sqlite-vec partition keys limited to ~3 columns — reserve `tenant_id` + `property_id`; other metadata (document_type, language, version) becomes regular `WHERE` clauses (post-filter on the KNN result set) (research risk R-2.13).
- Concurrent multi-tenant embedding ingestion contention on SQLite's write lock — mitigation: WAL mode, batch `upsertBatch` (100 chunks/transaction), collection-per-tenant for high-write deployments (research risk R-2.15).
- LanceDB / pgvector / Qdrant implementations are Phase 2+ — interface reservation only in Phase 1; concrete implementations land as their respective phases arrive.
- Embedding model upgrade requires re-embedding entire corpus — store `embedding_model_id` + `embedding_version` + `dim` per `vec_chunks` row; re-embed on model change; batch background job (research risk R-2.14).

**Dependencies on other ADRs**:

- Depends on ADR-005 (Prisma) for schema management of `Chunk` and `Document` tables.
- Depends on ADR-006 (SQLite) for the underlying database engine.
- Depends on ADR-022 (Local Embeddings) — `EmbeddingsRuntime.embed()` output is the input to `VectorStore.upsert()`.
- Depends on ADR-021 (Model Registry) — `embedding_model_id` references a `Model` row pinned by SHA256.
- Depends on ADR-018 (Model Versioning) — `embedding_version` per ADR-018 vocabulary.
- Feeds ADR-024 (Hybrid Search) — `VectorStore.query()` is the semantic half of hybrid retrieval.
- Feeds ADR-027 (Multi-Tenant Vector Isolation) — partition keys + mandatory `tenantId` enforce isolation.
- Compatible with ADR-013 (Observability Strategy) — `query()` calls are traced (k, filter, latency, result count).
- ADR-001 should be amended separately to distinguish "Vector search — implementation deferred" from "Vector search — architectural contract NOW" (research §14 FC-2.1 recommended change #1).
- Build-vs-Buy Matrix should be amended separately to clarify: "Vector Database — implementation deferred to Phase 2 (sqlite-vec for Phase 1 PoC; LanceDB for Phase 2 scale-out; pgvector for cloud deployments); architectural contract NOW."

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **sqlite-vec releases v1.0** — re-evaluate pinning; v1.0 may add ANN index (research sqlite-vec issue #25), changing the brute-force ceiling calculation.
2. **A hotel tenant's corpus exceeds 100K chunks** — trigger migration to LanceDB (Tier 2); validate the behind-the-interface swap is operationally clean.
3. **sqlite-vec adds ANN index support** (HNSW or IVFFlat) — re-evaluate whether LanceDB (Tier 2) is still needed or whether sqlite-vec can scale to 1M+ vectors.
4. **SmartAgentics deploys against PostgreSQL** (Phase 2+ cloud) — implement `PgVectorVectorStore`; validate `iterative_scan = strict` recall; evaluate ParadeDB pg_search for BM25 (research §3.5, AGPL-3.0 license risk).
5. **sqlite-vec partition-key limit becomes binding** (e.g., a third isolation dimension is needed) — re-evaluate the partition-key schema or migrate to LanceDB's per-tenant tables.
6. **Windows binary loading fails in Phase 1 PoC** — fallback to LanceDB as Phase 1 primary (would require an ADR amendment).
7. **Concurrent write contention becomes painful** on shared SQLite — implement collection-per-tenant (ADR-027 escalation) or migrate to LanceDB.
8. **A new vector store** (e.g., a future Turso/libSQL vector native, or a future DuckDB VSS stable release) becomes relevant — extend the implementation roster behind the same interface.
9. **Re-embedding on model upgrade** becomes operationally painful — define a re-embedding runbook and retention policy for old vectors.
10. **Annually**, as part of the regular ADR review cycle.
