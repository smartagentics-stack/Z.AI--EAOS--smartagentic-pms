# ADR-027: Multi-Tenant Vector Isolation

**ADR-ID:** ADR-027
**Status:** ACCEPTED
**Context:** 2026-08-05
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 2 § implicit in multi-tenant architecture, File 1 §9 multi-tenant retrieval) requires tenant isolation as a cross-cutting "Architecture Contract — NOW" capability. SmartAgentics hotel PMS is multi-tenant by design: a "tenant" = a hotel chain / management company; a "property" = a single hotel. Typical scale: 1–100 properties per tenant; 1K–50K chunks per property; total 1K–5M chunks per tenant. This matches Qdrant's documented pattern for "a large number of small, similarly-sized tenants" — the canonical case for partition-by-payload (metadata filter) multi-tenancy (research §13.1, citing Qdrant multitenancy docs).

Phase C Stream 2 research (`/home/z/my-project/phase-c-stream2-embeddings-retrieval-report.md`, §13) surveyed three classical multi-tenant vector isolation strategies and concluded that no single strategy is optimal across all phases — the right answer is a **hybrid, phased strategy**:

- **Phase 1 (sqlite-vec)**: shared-collection with `tenant_id` + `property_id` as partition keys; mandatory `WHERE tenant_id = ? AND property_id = ?` pre-filter on every query.
- **Phase 2+ (LanceDB)**: collection-per-tenant (one LanceDB table per tenant) — stronger physical isolation; LanceDB's Lance format handles many tables efficiently.
- **Phase 3+ (pgvector cloud)**: tenant discriminator column + partial HNSW index per tenant (per CrunchyData recommendation); falls back to `iterative_scan` for filtered search.
- **Phase 4+ (Qdrant federated)**: partition by payload (per Qdrant docs recommendation for the hotel pattern).

Every vector-bearing ADR depends on this isolation contract: `VectorStore` (ADR-023) enforces `tenantId` as a non-optional `query()` parameter; `Retriever` (ADR-024) extracts `tenantId` from the authenticated session and refuses to execute without it; `Chunker` (ADR-026) stamps every `Chunk` and `ParentChunk` row with `tenantId` + `propertyId`. Without this ADR, a single bug in any consumer that forgets the `tenantId` filter would leak chunks across tenants — research risk R-2.9 (High severity).

## 2. Problem

The architectural problem: **define a multi-tenant vector isolation contract that (a) makes `tenantId` a non-optional parameter at every vector-bearing interface (`VectorStore.query`, `Retriever.retrieve`, `VectorStore.upsert`, `VectorStore.deleteByFilter`, `VectorStore.count`), (b) makes `tenantId` a mandatory column on every chunk-bearing Prisma model (`Chunk`, `ParentChunk`, `Document`), (c) uses sqlite-vec partition-key pre-filtering as the Phase 1 enforcement mechanism (Phase 1 shared-collection), (d) reserves collection-per-tenant (LanceDB Phase 2+) and partition-by-payload (Qdrant Phase 3+) as escalation paths for larger tenants, (e) extracts `tenantId` from the authenticated session in the `Retriever` so application code cannot bypass isolation, (f) provides unit + integration test patterns that verify cross-tenant queries return zero results, and (g) is additive to existing Prisma models (where `tenantId` already exists per the AI-BOS multi-tenant directive) or adds it as a mandatory column on new tables.** This ADR is the cross-cutting isolation contract referenced by ADR-022 through ADR-026.

## 3. Options

### Option A: Database-per-tenant (one SQLite file per tenant)

Strongest isolation (process-level / file-level). Rejected as default — operationally complex: backup, migration, schema evolution, and connection pool management per tenant. Does not scale to thousands of tenants. Reserved for compliance-driven deployments (e.g., a hotel chain requiring contractual data isolation per property) (research §13.1 "Rejected alternatives: _Database-per-tenant (one SQLite file per tenant): considered — strongest isolation but operationally complex ... Reserved for compliance-driven deployments_"). The `VectorStore` interface accommodates this via `createTenant()` (which for the database-per-tenant variant opens a new SQLite file).

### Option B: No isolation (all tenants in one collection; application enforces filter)

Rejected — too easy to forget the filter; one bug leaks data across tenants. Research §13.1: "_No isolation_ (all tenants in one collection, application enforces filter): rejected — too easy to forget the filter; one bug leaks data across tenants." Research risk R-2.9 (High severity): "Multi-tenant data leakage if `tenantId` filter forgotten."

### Option C: Hybrid phased strategy — partition-key pre-filter (Phase 1 sqlite-vec) → collection-per-tenant (Phase 2+ LanceDB) → partition-by-payload (Phase 3+ Qdrant)

Adopt the strategy that matches the tiered `VectorStore` (ADR-023): each tier uses the multi-tenant strategy appropriate to its scale and isolation properties. The `tenantId` parameter is non-optional at the interface level across all tiers — the implementation translates it to the tier-appropriate enforcement (partition key, separate table, payload filter). Per research §13.1 "Recommendation: Adopt a hybrid multi-tenant strategy for SmartAgentics".

### Option D: Collection-per-tenant in Phase 1 (one sqlite-vec virtual table per tenant)

Stronger isolation than shared-collection. Rejected for Phase 1 — sqlite-vec virtual tables do not have a clean "create per tenant" lifecycle; DDL per tenant is operationally awkward; brute-force KNN across many small tables is less efficient than one table with partition-key pre-filter. Reserved for Phase 2+ LanceDB (where Lance format handles many tables efficiently) and for the compliance-driven database-per-tenant escalation (Option A).

## 4. Decision

Adopt **Option C**. The Multi-Tenant Vector Isolation architectural contract is:

1. **`tenantId` is non-optional at every vector-bearing interface** —
   - `VectorStore.query(vector, options)` — `options.tenantId` is a required parameter (per ADR-023 `QueryOptions`).
   - `VectorStore.upsert(id, vector, metadata)` — `metadata.tenantId` is required (per ADR-023 `ChunkMetadata`).
   - `VectorStore.upsertBatch(items)` — every item's `metadata.tenantId` is required; the implementation MUST reject a batch with mixed or missing `tenantId`.
   - `VectorStore.deleteByFilter(filter)` — `filter.tenantId` is required (per ADR-023 `MetadataFilter`); the implementation MUST refuse a filter without `tenantId` (to prevent accidental cross-tenant deletes).
   - `VectorStore.count(filter)` — `filter.tenantId` is required.
   - `Retriever.retrieve(query, options)` — `options.tenantId` is required (per ADR-024 `RetrievalOptions`).
   - The TypeScript signatures enforce this at compile time — a bug that forgets `tenantId` is a type error, not a runtime data leak.

2. **`tenantId` is a mandatory column on every chunk-bearing Prisma model** —
   - `Chunk.tenantId String` (mandatory, no default).
   - `ParentChunk.tenantId String` (mandatory, no default).
   - `Document.tenantId String` (mandatory, no default — verify against existing Prisma schema in Stream 3; if `Document` already has `tenantId` per AI-BOS multi-tenant directive, no change).
   - `propertyId String?` is optional (null for tenant-level documents like brand-wide policies; non-null for property-specific documents).
   - Both `tenantId` and `propertyId` are indexed: `@@index([tenantId, propertyId])` on `Chunk`, `ParentChunk`, `Document`.

3. **Phase 1 sqlite-vec: shared-collection with partition-key pre-filtering** —
   - The `vec_chunks` virtual table (ADR-023) declares `tenant_id TEXT partition key` and `property_id TEXT partition key`.
   - sqlite-vec v0.1.6+ (Nov 2024 metadata release) recognizes constraints on partition keys and pre-filters rows BEFORE any vector comparison (research §3.1, §10.1).
   - Every `VectorStore.query()` call compiles to: `WHERE tenant_id = ? AND property_id = ?` (partition key pre-filter) + KNN scan over the filtered subset + additional `AND` clauses for non-partition metadata (post-filter on the small KNN result set).
   - The `fts_chunks` virtual table (ADR-024) mirrors this: `tenant_id` and `property_id` are `UNINDEXED` columns used in `WHERE` filtering.

4. **`Retriever` extracts `tenantId` from the authenticated session** —
   - Application code does NOT pass `tenantId` manually to `Retriever.retrieve()`. The `Retriever` extracts it from the request context (authenticated user's session, set by Auth.js middleware per ADR-001).
   - This prevents application code from accidentally querying another tenant's data — the `tenantId` flows from the session, not from caller-supplied arguments.
   - For system-level operations (e.g., background re-embedding jobs, admin tooling), a privileged `SystemContext` may set `tenantId` explicitly — these code paths are audited and restricted to admin roles.

5. **Phase 2+ LanceDB: collection-per-tenant** —
   - One LanceDB table per tenant (e.g., `chunks_tenant_<tenantId>`). Tenant isolation is physical (separate Lance files).
   - `VectorStore.createTenant(tenantId)` creates a new LanceDB table. `VectorStore.query()` routes to the tenant's table.
   - Trade-off: stronger isolation + per-tenant tuning (e.g., per-tenant HNSW `M`/`ef_construction`); operational complexity of managing many tables (research §13.1).
   - Migration from Phase 1 shared-collection to Phase 2 collection-per-tenant is a behind-the-interface data migration — `VectorStore` interface unchanged.

6. **Phase 3+ pgvector: tenant discriminator + partial HNSW index per tenant** —
   - Shared `vec_chunks` table with `tenant_id` column; one partial HNSW index per tenant: `CREATE INDEX ON vec_chunks USING hnsw (embedding vector_cosine_ops) WHERE tenant_id = '<tenantId>'` (per CrunchyData recommendation, research §13.1).
   - Falls back to `iterative_scan = strict` (pgvector 0.8.0+) for filtered search recall (research §3.4, §10.1).
   - Trade-off: shared table simplifies schema management; partial indexes per tenant scale to thousands of tenants; pgvector's filtered-search recall is weaker than Qdrant's filterable HNSW (research §3.4).

7. **Phase 4+ Qdrant: partition by payload** —
   - Qdrant's multi-tenant docs explicitly recommend "partition by payload filters points by a payload field that identifies the tenant. This is efficient for a large number of small, similarly-sized tenants" — exactly the hotel pattern (research §13.1, §3.7).
   - `VectorStore.query()` compiles to a Qdrant payload filter: `{ must: [{ key: "tenant_id", match: { value: tenantId } }, ...] }`.
   - Qdrant's filterable HNSW is the gold standard for filter-heavy multi-tenant workloads (research §3.7).

8. **Cross-tenant embedding leakage is NOT a risk** — The embedding model (ADR-022) is shared across tenants — the model itself doesn't "know" tenant. This is fine: embeddings are non-reversible in practice (you cannot reconstruct the source text from a 768-dim Nomic embedding). The _vectors_ must be isolated at the storage layer (this ADR); the _model_ is shared. (Research §13.1 risk: "Cross-tenant embedding leakage: Embedding model is shared across tenants — the model itself doesn't 'know' tenant. This is fine (embeddings are non-reversible in practice), but the _vectors_ must be isolated at the storage layer. Mitigation: VectorStore enforces tenant_id on every row.")

9. **`createTenant()` API** — `VectorStore.createTenant(tenantId)` provisions tenant-scoped storage:
   - sqlite-vec (Phase 1): no-op — partition keys are dynamic; no DDL required.
   - LanceDB (Phase 2+): creates a new LanceDB table `chunks_tenant_<tenantId>`.
   - pgvector (Phase 3+): creates a new partial HNSW index for the tenant.
   - Qdrant (Phase 4+): creates a new collection or relies on payload partitioning (no explicit creation needed).
   - Database-per-tenant (compliance escalation, Option A): opens a new SQLite file `tenant_<tenantId>.db`.

10. **Test patterns (mandatory in Phase 1 PoC)** —
    - **Unit test**: every `VectorStore` method signature requires `tenantId` (TypeScript compile-time check).
    - **Integration test**: ingest 10 chunks for tenant A and 10 for tenant B; query as tenant A; assert zero tenant B chunks returned. Repeat for `Retriever.retrieve()`.
    - **Negative test**: attempt `VectorStore.query()` without `tenantId` — assert the implementation throws `TenantIdRequiredError`.
    - **Filter-leakage test**: attempt `VectorStore.deleteByFilter({ document_type: 'policy' })` without `tenantId` — assert the implementation throws `TenantIdRequiredError` (prevents accidental cross-tenant deletes).
    - Research §13.1 "Impact on Phase 1: Phase 1 PoC must validate tenant isolation: ingest chunks for tenant A and tenant B; query as tenant A; verify zero tenant B chunks returned. Estimated effort: 0.5 day on top of VectorStore PoC."

11. **`propertyId` is optional but recommended** — `propertyId` enables property-level isolation within a tenant (e.g., "query only chunks for Hotel Boston, not Hotel NYC, even though both belong to the same chain"). The `Retriever.retrieve()` accepts an optional `propertyId`; when null, the query spans all properties of the tenant (useful for brand-wide policy queries).

## 5. Rationale

- **`tenantId` non-optional at the interface** — Compile-time enforcement is stronger than runtime checks. A bug that forgets `tenantId` is a TypeScript type error, not a runtime data leak. Research §13.1: "Tenant leakage: A bug in the `Retriever` that forgets to pass `tenantId` to `VectorStore.query()` would leak data. Mitigation: `tenantId` is a non-optional parameter at the interface level; unit tests verify no query can execute without it; integration tests verify cross-tenant queries return zero results."
- **`Retriever` extracts `tenantId` from session** — Application code cannot bypass isolation because it does not supply `tenantId` — the `Retriever` does, from the authenticated session. This is defense-in-depth: even if a developer forgets `tenantId` in a caller, the `Retriever` fills it from the session.
- **sqlite-vec partition-key pre-filtering is the right Phase 1 mechanism** — sqlite-vec v0.1.6+ (Nov 2024 metadata release) recognizes constraints on partition keys and pre-filters BEFORE any vector comparison (research §3.1, §10.1). For brute-force KNN, pre-filtering is trivially correct (no HNSW graph to break). The hotel pattern (1K–5M chunks per tenant, 1–100 properties per tenant) is well within sqlite-vec's partition-key performance envelope.
- **Hybrid phased strategy matches the tiered `VectorStore`** — Each tier (sqlite-vec → LanceDB → pgvector → Qdrant) uses the multi-tenant strategy appropriate to its scale and isolation properties. The `tenantId` parameter is identical across tiers — only the implementation translates it (partition key, separate table, partial index, payload filter). Application code is unchanged when migrating tiers (research §13.1 "Recommendation: Adopt a hybrid multi-tenant strategy").
- **Collection-per-tenant (Phase 2+ LanceDB)** — Stronger physical isolation when tenant corpora grow large. LanceDB's Lance format handles many tables efficiently (research §13.1).
- **Partition-by-payload (Phase 4+ Qdrant)** — Qdrant's filterable HNSW is the gold standard for filter-heavy multi-tenant workloads. Qdrant's docs explicitly recommend this pattern for "a large number of small, similarly-sized tenants" — the hotel pattern (research §3.7, §13.1).
- **Rejecting database-per-tenant as default (Option A)** — Strongest isolation but operationally complex; does not scale to thousands of tenants. Reserved for compliance-driven deployments (research §13.1).
- **Rejecting no isolation (Option B)** — Too easy to forget the filter; one bug leaks data across tenants (research §13.1, risk R-2.9).
- **Rejecting collection-per-tenant in Phase 1 sqlite-vec (Option D)** — sqlite-vec virtual tables do not have a clean per-tenant lifecycle; DDL per tenant is awkward; brute-force across many small tables is less efficient than one table with partition-key pre-filter. Reserved for Phase 2+ LanceDB.
- **Cross-tenant embedding leakage is NOT a risk** — Embeddings are non-reversible; the shared model is fine. Vectors must be isolated at storage (this ADR), not at the model (ADR-022) (research §13.1).
- **`propertyId` optional** — Enables property-level isolation within a tenant (Hotel Boston vs. Hotel NYC). Null for brand-wide policies. Matches the AI-BOS multi-tenant + multi-property directive.

## 6. Consequences

**Positive**:

- Compile-time enforcement of `tenantId` on every vector-bearing interface — a bug that forgets `tenantId` is a TypeScript type error, not a runtime data leak.
- `Retriever` extracts `tenantId` from the authenticated session — application code cannot bypass isolation.
- sqlite-vec partition-key pre-filtering is trivially correct for brute-force KNN (no HNSW graph to break) — clean Phase 1 enforcement.
- Hybrid phased strategy matches the tiered `VectorStore` (ADR-023) — application code unchanged when migrating tiers.
- Mandatory test patterns (unit, integration, negative, filter-leakage) verify isolation in Phase 1 PoC.
- `propertyId` optional enables property-level isolation within a tenant.
- Resolves research risk R-2.9 (High severity) at the architectural level.

**Negative / obligations**:

- Phase 1 must include the integration test suite (ingest tenant A + tenant B, query A, assert zero B) — estimated 0.5 day on top of the `VectorStore` PoC (research §13.1 "Impact on Phase 1").
- Every vector-bearing consumer (Stream 3 `DocumentIngester` + `RAGPipeline`, Stream 5 Agent Runtime, Stream 6 Memory) MUST thread `tenantId` through every call — this is an obligation on downstream streams, not optional.
- The `Retriever` must be wired to the authenticated session (Auth.js middleware per ADR-001) — Stream 8 (AI Security) owns the session-context plumbing; Stream 2 defines the contract.
- sqlite-vec partition-key limit (~3 columns) constrains the partition-key schema — only `tenant_id` + `property_id` are partition keys; other metadata (document_type, language, version) becomes regular `WHERE` clauses (post-filter on KNN result) (research risk R-2.13).
- Filter selectivity on shared-collection (Phase 1) — if a filter excludes >90% of vectors, even pre-filtering may be slow (sqlite-vec must scan all matching vectors). Mitigation: monitor filter selectivity; escalate to collection-per-tenant (Phase 2+) or database-per-tenant (compliance) for extreme cases (research §10.1 risk).
- Migration from Phase 1 shared-collection to Phase 2 collection-per-tenant is a behind-the-interface data migration — `VectorStore` interface unchanged, but a one-time data migration job is required.
- Tenant onboarding must call `VectorStore.createTenant(tenantId)` — for sqlite-vec this is a no-op (partition keys are dynamic); for LanceDB/pgvector this creates a new table/index. The onboarding wizard must invoke this.
- `SystemContext` privileged operations (background re-embedding, admin tooling) that explicitly set `tenantId` are an audit surface — must be restricted to admin roles and logged (research §13.1).
- Concurrent multi-tenant embedding ingestion contention on SQLite's write lock (Phase 1 shared-collection) — mitigation: WAL mode, batch upserts, collection-per-tenant (Phase 2+) or database-per-tenant for high-write deployments (research risk R-2.15).

**Dependencies on other ADRs**:

- Depends on ADR-023 (Vector Store) — `tenantId` non-optional on `query()`, `upsert()`, `upsertBatch()`, `deleteByFilter()`, `count()`; `tenant_id` + `property_id` partition keys on `vec_chunks`.
- Depends on ADR-024 (Hybrid Search) — `tenantId` non-optional on `Retriever.retrieve()`; `Retriever` extracts `tenantId` from authenticated session; `tenant_id` + `property_id` UNINDEXED columns on `fts_chunks`.
- Depends on ADR-026 (Document Chunking) — `tenantId` mandatory on `Chunk` and `ParentChunk`; `propertyId` optional.
- Depends on ADR-005 (Prisma) for schema management.
- Depends on ADR-006 (SQLite) for sqlite-vec partition-key support (v0.1.6+).
- Depends on ADR-001 (Reference Stack) for Auth.js session context.
- Feeds Stream 8 (AI Security & Governance) — `SystemContext` privileged operations, audit trail, tenant onboarding authorization.
- Feeds Stream 3 (RAG) — `DocumentIngester` and `RAGPipeline` thread `tenantId` through every call.
- Feeds Stream 5 (Agent Runtime) — agent retrieval calls thread `tenantId`.
- Feeds Stream 6 (Memory) — per-tenant memory vectors.
- Compatible with ADR-013 (Observability Strategy) — every vector operation logs `tenantId` for audit; cross-tenant access attempts are security events.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A cross-tenant data leak is detected in production** (research risk R-2.9) — root-cause analysis; tighten the interface (e.g., remove `SystemContext` escape hatch if abused); add automated leak-detection tests.
2. **A tenant's corpus exceeds sqlite-vec shared-collection performance envelope** (>100K chunks/tenant or filter selectivity >90%) — migrate that tenant to collection-per-tenant (Phase 2+ LanceDB) or database-per-tenant (compliance escalation).
3. **SmartAgentics deploys against PostgreSQL** (Phase 2+ cloud) — implement `PgVectorVectorStore` with partial HNSW index per tenant; validate `iterative_scan = strict` recall.
4. **A compliance-driven deployment requires contractual data isolation per property** — activate database-per-tenant (one SQLite file per tenant or per property); validate backup/migration/schema-evolution story.
5. **sqlite-vec partition-key limit (~3 columns) becomes binding** (e.g., a third isolation dimension is needed) — re-evaluate the partition-key schema or migrate to LanceDB's per-tenant tables.
6. **`SystemContext` privileged operations become an audit burden** — define a formal privileged-operations API, restrict to admin roles, add automated audit-trail review.
7. **Tenant onboarding volume becomes high** (>100 tenants/day) — automate `createTenant()`; evaluate batch-onboarding.
8. **A new multi-tenant pattern** (e.g., cross-tenant knowledge sharing with explicit consent) becomes relevant — extend the `MetadataFilter` to support opt-in cross-tenant queries with audit trail.
9. **Stream 8 (AI Security & Governance) specifies tenant onboarding authorization** — finalize the `createTenant()` authorization model and audit trail.
10. **Annually**, as part of the regular ADR review cycle.
