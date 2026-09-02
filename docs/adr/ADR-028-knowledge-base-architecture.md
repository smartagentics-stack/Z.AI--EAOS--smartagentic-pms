# ADR-028: Knowledge Base Architecture

**ADR-ID:** ADR-028
**Status:** ACCEPTED
**Context:** 2026-08-06
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §8) classifies **Knowledge Ingestion**, **Knowledge base management**, and **Local RAG** as "Architecture Contract — NOW" capabilities (Phase B B4 items #12–#14). The existing SmartAgentics repository has **zero** knowledge-related tables in the Prisma schema (`prisma/schema.prisma` lists only `SystemConfig`, `FeatureFlag`, `Tenant`, `AuditEvent`, `SemanticCacheEntry`), and the existing `KnowledgeSource` interface (`src/lib/aios/types.ts:149-159`) is a _UI status DTO_ with no ingestion method, no retrieval method, no citation tracking, no tenant enforcement, no versioning mechanism, and no ACL — research foundational conflict FC-3.2 (Stream 3 report §11).

Phase C Stream 3 research (`/home/z/my-project/phase-c-stream3-offline-knowledge-report.md`, §2, §9) confirmed that the architecture is achievable **without inventing new technology, without breaking the SQLite + Prisma + TypeScript foundation, and without violating any license constraint**. The recommended architecture is a layered, swappable contract in the same spirit as Stream 1's `LocalLLMRuntime` and Stream 2's `EmbeddingsRuntime` / `VectorStore`:

- **Storage** = SQLite (existing, ADR-006) + four new relational tables (`KnowledgeDocument`, `KnowledgeChunk`, `KnowledgeChunkVector`, `KnowledgeCitation`) plus a `KnowledgeQuery` audit table.
- **Vector index** = sqlite-vec (Stream 2 ADR-023) virtual table, partition-keyed on `tenantId`.
- **Keyword index** = SQLite FTS5 (built-in to SQLite, ADR-006) using external-content + triggers.
- **Document model** = flat-document RAG with parent-child chunking (ADR-026) for Phase 1; knowledge-graph augmentation reserved as a Phase 2+ _additive_ extension (research §2.2).

Stream 3 consumes Stream 1's `LocalLLMRuntime` (ADR-015) and Stream 2's `EmbeddingsRuntime` (ADR-022), `VectorStore` (ADR-023), `Retriever` (ADR-024), `Reranker` (ADR-025), `Chunker` (ADR-026), and the `tenantId`/`propertyId` isolation contract (ADR-027). No foundational conflict requires rework of Streams 1 or 2 (research §11 "No foundational conflict found").

## 2. Problem

The architectural problem: **define the SmartAgentics knowledge base storage contract that (a) re-uses the existing SQLite + Prisma + TypeScript foundation with no new database process for Phase 1, (b) introduces four new relational tables — `KnowledgeDocument`, `KnowledgeChunk`, `KnowledgeChunkVector`, `KnowledgeCitation` — plus a `KnowledgeQuery` audit table, all additive (no existing table modified), (c) uses sqlite-vec (Stream 2 ADR-023) for the vector column and SQLite FTS5 (built-in) for the keyword index, with external-content + triggers to keep FTS5 in sync with chunk inserts/updates/deletes, (d) defaults to flat-document RAG for Phase 1 with knowledge-graph augmentation reserved as an additive Phase 2+ extension (`KnowledgeEntity` + `KnowledgeRelation` tables), (e) defines a hotel-specific document-type taxonomy (`SOP`, `POLICY`, `PROCEDURE`, `MANUAL`, `FAQ`, `RATE_SHEET`, `SERVICE_INFO`, `ROOM_INFO`, `CONTACT`, `TRAINING`, `COMPLIANCE`, `ANNOUNCEMENT`, `OTHER`) and department enum (`FRONT_DESK`, `HOUSEKEEPING`, `MAINTENANCE`, `FNB`, `FINANCE`, `SECURITY`, `SALES_MARKETING`, `REVENUE_MGMT`, `IT`, `HR`, `MANAGEMENT`, `ALL`), (f) stamps every chunk row with `tenantId` (mandatory, partition key per ADR-027), `propertyId` (optional), `department`, `aclRoles[]`, `docVersion`, `headerPath`, `chunkHash`, (g) replaces the UI-only `KnowledgeSource` DTO with a `KnowledgeStore` SDK interface while keeping the DTO as a _projection_ of the new contract (research FC-3.2), and (h) is owned by Stream 3 and feeds Streams 4 (Memory), 5 (Agent Runtime), 6 (Multi-Agent), 7 (Offline Sync), and 8 (Security & Governance).** This ADR is the foundational storage contract referenced by ADR-029 through ADR-037.

## 3. Options

### Option A: Knowledge-graph-first (Microsoft GraphRAG / LlamaIndex PropertyGraphIndex at the core)

Build the knowledge base as a property graph: extract entities + relations at ingest time, build community summaries, retrieve via graph traversal + vector hybrid. Research §2.2 evidence: Microsoft GraphRAG (official site) describes it as "a structured, hierarchical approach to RAG ... extracting a knowledge graph out of raw text, building a community hierarchy, generating summaries." arXiv 2603.22340 (March 2026): "Graph RAG significantly outperforms traditional embedding-based RAG in accuracy, response quality, and reasoning, especially for complex, semi-structured queries." Rejected as Phase 1 default because (1) entity-extraction + community-clustering indexing requires many LLM calls per document (high cost on local CPU), (2) the GraphRAG reference implementation is Python-only, (3) it is optimized for "holistic questions over large corpora" — a Phase 2+ use case for SmartAgentics, (4) hotel SOPs/policies are 90% single-shot factual recall where baseline vector RAG wins (research §2.2 Inference). Reserved as a research reference for Phase 2+ additive extension.

### Option B: External vector database (Qdrant / Weaviate / Milvus)

Run a dedicated vector database server alongside SQLite. Rejected for Phase 1 — adds a second database process to the Windows installer, increases operational burden, and Stream 2 ADR-023 already chose sqlite-vec as the Phase 1 vector store to keep the deployment single-process. Reserved as the Phase 3+ escalation path (ADR-023 tiered VectorStore already accommodates this).

### Option C: PostgreSQL + pgvector as the Phase 1 knowledge store

Replace SQLite with PostgreSQL. Rejected — ADR-006 chose SQLite as the local-first database; PostgreSQL is the Phase 2+ cloud-mode escalation. Migrating the Phase 1 knowledge base to Postgres would break the "no new database process" constraint and the offline Windows installer story. Reserved for Phase 2+ cloud deployments per Stream 2 ADR-023.

### Option D: Adopt LangChain.js or LlamaIndex.TS document loaders and vector-store adapters as the runtime data layer

Reuse framework-owned abstractions (Document loaders, VectorStore adapters, retrievers) instead of defining a SmartAgentics-owned `KnowledgeStore`. Rejected — research §4.3 and FC-3.x: LangChain/LlamaIndex abstractions have heavy dependency trees, frequent breaking changes, and the documented "silent OpenAI fallback" hazard (Reddit r/LocalLLaMA LlamaIndex report). SmartAgentics' RAG needs are narrow; a thin owned abstraction suffices. See ADR-037 (RAG Framework Policy) for the full framework-policy decision.

### Option E: Flat-document RAG on SQLite + FTS5 + sqlite-vec with additive tables, KG reserved Phase 2+

Add four new relational Prisma tables (`KnowledgeDocument`, `KnowledgeChunk`, `KnowledgeChunkVector`, `KnowledgeCitation`) plus `KnowledgeQuery`, a sqlite-vec virtual table for vectors, an FTS5 external-content virtual table for keywords, and treat chunks as flat rows for Phase 1. Preserve document hierarchy via parent-child chunking (ADR-026). Reserve `KnowledgeEntity` + `KnowledgeRelation` as a Phase 2+ additive extension. No existing table modified. Per research §2.2 Recommendation and §13.1 Phase 1 architecture.

## 4. Decision

Adopt **Option E**. The Knowledge Base Architecture contract is:

1. **Relational tables (Prisma, additive)** — Stream 3 adds five new models. No existing Prisma model is modified. The full schema is in research §9; the canonical subset:

   - `KnowledgeDocument` — root document record. Columns: `id`, `tenantId`, `propertyId?`, `sourcePath`, `sourceType` (UPLOAD|WATCH|BATCH|LAN|USB|EMAIL), `documentType` (enum §2.4), `department`, `title`, `language`, `currentVersion Int @default(1)`, `contentHash` (SHA-256 of normalized markdown), `rawFileHash` (SHA-256 of original file bytes), `fileSizeBytes`, `pageCount?`, `chunkCount`, `freshnessTtlDays` (default 90), `aclRoles` (JSON array), `lastVerifiedAt`, `lastIngestedAt`, `parserUsed`, `parseWarnings?`, `createdAt`, `updatedAt`, `deletedAt?`. Unique constraint `@@unique([tenantId, propertyId, sourcePath])`; indexes on `[tenantId, lastVerifiedAt]`, `[contentHash]`, `[tenantId, documentType, department]`.

   - `KnowledgeChunk` — chunk row. Columns: `id`, `tenantId` (mandatory, ADR-027), `propertyId?`, `docId`, `docVersion Int`, `department`, `aclRoles` (JSON array), `headerPath`, `chunkHash` (SHA-256 of chunk text), `parentChunkId?` (ADR-026), `chunkIndex Int`, `text`, `tokenCount Int`, `createdAt`, `deletedAt?`. Indexes on `[tenantId, propertyId, department]`, `[docId, docVersion]`, `[chunkHash]`, `[parentChunkId]`. Relation to `KnowledgeDocument`.

   - `KnowledgeChunkVector` — 1:1 vector row. Columns: `chunkId String @id`, `tenantId` (partition key for sqlite-vec pre-filter), `embedding Bytes` (768-dim float32 = 3072 bytes, nomic-embed-text v1.5 per ADR-022), `embeddingModel String`, `embeddingDim Int`, `createdAt`. Index on `[tenantId]`. Vector text is NOT stored here — `chunk_text` lives in `KnowledgeChunk.text` (external-content pattern, ADR-023).

   - `KnowledgeQuery` — query audit row. Columns: `id`, `tenantId`, `userId`, `propertyId?`, `department`, `question`, `rewrittenQuery?`, `answer`, `answerRaw` (with `<source>` tags), `retrievedChunkIds` (JSON array), `citedChunkIds` (JSON array), `confidenceScore Float`, `confidenceMethod`, `modelUsed`, `tokensIn`, `tokensOut`, `latencyMs`, `createdAt`. Indexes on `[tenantId, createdAt]`, `[userId, createdAt]`.

   - `KnowledgeCitation` — citation snapshot. Columns: `id`, `queryId`, `chunkId`, `docId`, `docVersion Int` (snapshot — stable even after doc is re-ingested), `headerPath`, `sourcePath`, `pageNumber?`, `citedAt`. Indexes on `[queryId]`, `[chunkId]`.

2. **Vector virtual table (sqlite-vec, raw SQL migration)** — Per ADR-023. The vector column is provided by sqlite-vec v0.1.6+ (partition-key aware, ADR-027):

   ```sql
   CREATE VIRTUAL TABLE KnowledgeChunk_vector USING vec0(
     chunk_id TEXT PRIMARY KEY,
     tenant_id TEXT partition key,
     embedding FLOAT[768]
   );
   ```

3. **FTS5 keyword virtual table (raw SQL migration)** — SQLite FTS5 (built-in to SQLite, ADR-006). External-content table pointing at `KnowledgeChunk.text`; triggers keep FTS5 in sync with chunk inserts/updates/deletes (per SQLite FTS5 docs verified pattern):

   ```sql
   CREATE VIRTUAL TABLE KnowledgeChunk_fts USING fts5(
     text,
     content='KnowledgeChunk',
     content_rowid='rowid',
     tokenize='porter unicode61'
   );
   -- Triggers: KnowledgeChunk_ai (AFTER INSERT), _ad (AFTER DELETE), _au (AFTER UPDATE)
   ```

   Per research §5.1, FTS5 IDF statistics are per-collection — naturally avoiding the BM25 IDF cross-tenant leakage risk that Qdrant warns about (Qdrant multitenancy docs).

4. **`KnowledgeStore` SDK interface** — `packages/sdk/src/ai/knowledge/store/KnowledgeStore.ts`. Per research §10:
   - `retrieve(query: RetrievalQuery): Promise<RetrievedChunk[]>` — retrieval (delegates to Stream 2 `Retriever` after ACL filtering).
   - `getDocument(docId)`, `getChunk(chunkId)`, `listDocuments(filter)` — read APIs.
   - `getDocumentVersions(docId)` — version history.
   - `getStaleDocuments(tenantId)` — freshness sweep (per ADR-035).
   - Reference implementation: `SqliteKnowledgeStore`.

5. **`RetrievalQuery` requires `tenantId` (no unscoped retrieval)** — Per ADR-027, every retrieval call MUST include `tenantId` + `propertyIds[]` + `departments[]` + `aclRoles[]` in the SQL `WHERE` clause. There is no unscoped retrieval path. The existing UI `KnowledgeSource` DTO becomes a _projection_ populated by reading `KnowledgeDocument` + `KnowledgeChunk` counts (research FC-3.2 resolution).

6. **Hotel document-type taxonomy** — `KnowledgeDocumentType` enum (research §2.4): `SOP`, `POLICY`, `PROCEDURE`, `MANUAL`, `FAQ`, `RATE_SHEET`, `SERVICE_INFO`, `ROOM_INFO`, `CONTACT`, `TRAINING`, `COMPLIANCE`, `ANNOUNCEMENT`, `OTHER`. Mapped from hotel-industry practice (EHL "Hotel SOPs are documented set of step-by-step instructions"; Waybook policy vs procedure vs SOP vs process distinction).

7. **Hotel department enum** — `KnowledgeDepartment` enum (research §2.4): `FRONT_DESK`, `HOUSEKEEPING`, `MAINTENANCE`, `FNB`, `FINANCE`, `SECURITY`, `SALES_MARKETING`, `REVENUE_MGMT`, `IT`, `HR`, `MANAGEMENT`, `ALL`. Confirmed by Hotelops.ai (2026): "By assigning permissions based on roles, departments, or locations, you eliminate confusion, reduce risk" — department-scoped access control is hotel-industry standard.

8. **Phase 1 = flat-document RAG only** — Chunks are stored as flat rows in `KnowledgeChunk` with parent-child relationships (ADR-026) preserving document hierarchy. KG augmentation is reserved.

9. **Phase 2+ KG augmentation (additive)** — Per research §2.2, optionally add `KnowledgeEntity` and `KnowledgeRelation` tables populated by LLM-based entity extraction at ingestion time. Retrieval becomes a hybrid: vector+BM25 first, then expand via 1-hop graph traversal (LlamaIndex "PropertyGraphIndex" pattern). This is additive — no contract change to `KnowledgeStore.retrieve()`; the KG expansion is an internal optimization.

10. **Performance budget** — Per research §4.4 and Stream 2 §11: retrieval <50 ms for 10K chunks per tenant (sqlite-vec brute-force + FTS5 BM25); end-to-end RAG latency 3–8 seconds typical (Phi-3.5-mini @ Q4_K_M ~12 tok/s on 8-core CPU). sqlite-vec brute-force slows at >100K chunks/tenant (research risk R-3.6) — migrate to LanceDB (Stream 2's secondary) at that threshold.

11. **Additive migration only** — All five tables are new (`CREATE TABLE`); no `ALTER` or `DROP` of existing Prisma models. FTS5 + sqlite-vec virtual tables are added via raw SQL migration (Prisma does not model FTS5 natively). Per research §11 FC-3.3 resolution.

## 5. Rationale

- **Re-uses the existing SQLite foundation** — ADR-006 chose SQLite as the local database; sqlite-vec (Stream 2 ADR-023) and FTS5 (built-in to SQLite) extend it without a new process. No new database server for the Windows installer (research §0 Executive Summary).
- **Four new tables match the canonical RAG data model** — Document → Chunk → Vector is the universally-agreed shape (research §3.4 ingestion pipeline; §4.1 RAG pipeline; Stream 2 §9 chunking). Citation + Query tables are the SmartAgentics additions for source attribution (ADR-032) and observability/audit.
- **External-content FTS5 + triggers** — The SQLite-recommended pattern: FTS5 indexes `KnowledgeChunk.text` without duplicating it; triggers keep the index in sync. Verified from SQLite FTS5 docs (research §9).
- **Partition-key pre-filtering on `tenantId`** — sqlite-vec v0.1.6+ (Nov 2024 metadata release) recognizes partition-key constraints and pre-filters BEFORE vector comparison (Stream 2 research §3.1, §10.1). For brute-force KNN, pre-filtering is trivially correct (no HNSW graph to break). Per ADR-027.
- **FTS5 IDF statistics are per-collection** — Naturally avoids the BM25 IDF cross-tenant leakage risk that Qdrant's multitenancy docs warn about (research §5.1). No `idf` parameter scoping needed.
- **Flat-document RAG is correct for hotel SOPs/policies** — Hotel SOPs are 90% single-shot factual recall ("What's the late check-out policy?") where baseline vector+BM25 RAG wins. KG-RAG wins only for multi-hop relationship-dense queries, which is a Phase 2+ use case (research §2.2 Inference).
- **Hotel-specific taxonomy reflects industry practice** — The `KnowledgeDocumentType` + `KnowledgeDepartment` enums match how hotel chains actually organize SOPs (by department: front desk, housekeeping, F&B, etc.) — EHL, SiteMinder, Cloudbeds, Waybook, Mews (research §2.3).
- **Additive migration protects existing schema** — No existing table modified; no breaking changes (research FC-3.3 resolution, §15 Impact on Existing Architecture).
- **`KnowledgeStore` interface replaces the UI DTO** — The existing `KnowledgeSource` DTO at `src/lib/aios/types.ts:149-159` is a UI status data class with no methods, no ACL, no version, no tenant scoping (research FC-3.2). The new `KnowledgeStore` SDK interface is the real contract; the DTO becomes a projection (research §10, §15).
- **Rejecting KG-first (Option A)** — High setup cost (entity extraction + community clustering); Python-only reference impl; optimized for holistic questions over large corpora (research §2.2, §2.5).
- **Rejecting external vector DB (Option B)** — Adds a second database process to the Windows installer; Stream 2 already chose sqlite-vec for Phase 1 (research §2.5).
- **Rejecting Postgres/pgvector for Phase 1 (Option C)** — ADR-006 chose SQLite for local-first; Postgres is the Phase 2+ cloud escalation (Stream 2 ADR-023 tiered VectorStore).
- **Rejecting framework-owned data layer (Option D)** — Heavy dependency trees, frequent breaking changes, silent-cloud-fallback risk (research §4.3, FC analysis). See ADR-037 for the full policy.
- **KG augmentation is additive Phase 2+** — `KnowledgeEntity` + `KnowledgeRelation` tables can be added without changing `KnowledgeStore.retrieve()` — the KG expansion is an internal optimization (research §2.2, §17 Phase 2+ extensions).

## 6. Consequences

**Positive**:

- Single-process Phase 1 deployment — SQLite + sqlite-vec + FTS5, no new database server.
- Five additive tables — no breaking changes to existing Prisma models; clean migration.
- Hybrid search (BM25 + vector + RRF) via Stream 2's `Retriever` is wired up by storing chunks once with both an FTS5 row and a sqlite-vec row.
- `tenantId` partition-key pre-filtering (ADR-027) makes tenant isolation trivially correct for brute-force KNN.
- Hotel-specific taxonomy (`KnowledgeDocumentType`, `KnowledgeDepartment`) reflects industry practice and enables future `MetadataFilter` by department (ADR-024).
- `KnowledgeStore` interface replaces the UI-only DTO with a real contract — the DTO becomes a projection (research FC-3.2 resolution).
- Phase 2+ KG augmentation is additive — no contract change.
- Re-uses Stream 1's `LocalLLMRuntime` and Stream 2's `EmbeddingsRuntime` / `VectorStore` / `Retriever` / `Chunker` cleanly.

**Negative / obligations**:

- Phase 1 must include the Prisma migration for 5 new tables + raw SQL migration for FTS5 + sqlite-vec virtual tables — estimated 1–2 days (research §13.3).
- FTS5 virtual table + triggers are not modeled by Prisma natively — they must be added via raw SQL migration; Prisma migrations must be ordered to run the SQL after the relational tables are created.
- sqlite-vec brute-force retrieval slows at >100K chunks/tenant (research risk R-3.6) — monitor chunk count; trigger migration to LanceDB (Stream 2's secondary) at threshold.
- `KnowledgeChunkVector` is a separate table (1:1 with `KnowledgeChunk`) — extra join on retrieval. This is the external-content pattern recommended by sqlite-vec (chunk text is NOT stored in the vector table).
- The existing `KnowledgeSource` UI DTO (`src/lib/aios/types.ts:149-159`) must be re-wired to read from the new contract — Phase E obligation.
- SQLite write-lock contention if many concurrent ingestions hit the same DB file (Phase 1 shared-collection) — mitigation: WAL mode, batch upserts; escalate to collection-per-tenant (Phase 2+ LanceDB) or database-per-tenant (compliance) for high-write deployments (research risk R-2.15).
- `KnowledgeQuery` + `KnowledgeCitation` retention policy is an open question (research §18 #3) — default 7 years for compliance-relevant docs; per-tenant configurable.
- Cross-property knowledge sharing requires `propertyId IS NULL` semantics ("all properties of this tenant") — the retrieval filter `WHERE tenantId=? AND (propertyId IS NULL OR propertyId IN (?))` must be enforced (research §5.4).

**Dependencies on other ADRs**:

- Depends on ADR-005 (Prisma) for schema management.
- Depends on ADR-006 (SQLite) for persistence, FTS5, and sqlite-vec extension loading.
- Depends on ADR-022 (Local Embeddings) — `KnowledgeChunkVector.embedding` is produced by `EmbeddingsRuntime.embed()` (nomic-embed-text-v1.5, 768-dim).
- Depends on ADR-023 (Vector Store) — `KnowledgeChunk_vector` is the sqlite-vec virtual table; partition-key contract.
- Depends on ADR-024 (Hybrid Search) — `Retriever` queries `KnowledgeChunk_fts` (BM25) + `KnowledgeChunk_vector` (vector) + RRF fusion.
- Depends on ADR-025 (Reranker) — reranks `RetrievedChunk`s in Phase 2+.
- Depends on ADR-026 (Document Chunking) — `KnowledgeChunk.parentChunkId` + parent-child retrieval; chunk-size defaults.
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` mandatory on every chunk; `propertyId` optional; partition-key pre-filtering.
- Feeds ADR-029 (Parser Stack) — `DocumentIngester` writes to `KnowledgeDocument` + `KnowledgeChunk`.
- Feeds ADR-030 (RAG Pipeline) — `KnowledgeStore.retrieve()` + `RagGenerator.generate()` consume the contract.
- Feeds ADR-031 (Knowledge Isolation) — three-layer isolation builds on this schema.
- Feeds ADR-032 (Source Attribution & Citation) — `KnowledgeCitation` table.
- Feeds ADR-033 (Confidence Scoring) — `KnowledgeQuery.confidenceScore` + `confidenceMethod`.
- Feeds ADR-034 (Versioning & Incremental Re-index) — `KnowledgeDocument.currentVersion` + `contentHash` + `KnowledgeChunk.docVersion`.
- Feeds ADR-035 (Freshness & Staleness) — `KnowledgeDocument.lastVerifiedAt` + `freshnessTtlDays`.
- Feeds ADR-036 (Offline Ingestion Channels) — `KnowledgeDocument.sourceType` (UPLOAD|WATCH|BATCH|LAN|USB|EMAIL).
- Feeds Stream 4 (Memory) — `KnowledgeStore.retrieve()` is the retrieval primitive for episodic recall.
- Feeds Stream 5 (Agent Runtime) — `RagGenerator.generate()` as a tool.
- Feeds Stream 7 (Offline Sync) — knowledge rows are tenant-scoped SQLite rows; `rawFileHash` enables sync conflict detection.
- Feeds Stream 8 (Security & Governance) — three-layer isolation is the template for all AI-BOS isolation; `KnowledgeCitation` + `AuditEvent` is the provenance foundation.
- Compatible with ADR-013 (Observability Strategy) — every retrieve operation is traced (tenant, query, retrievedChunkIds, latency).

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **sqlite-vec brute-force retrieval slows past the 50 ms budget** (>100K chunks/tenant) — migrate to LanceDB (Stream 2's secondary) per ADR-023 tier escalation; verify the `KnowledgeStore` interface survives the migration without contract change.
2. **A Phase 2+ deployment moves to PostgreSQL / pgvector** — implement the relational tables in Postgres; replace FTS5 with `tsvector` + GIN index; replace sqlite-vec with pgvector HNSW; verify the `KnowledgeStore` interface survives.
3. **A tenant demands contractual data isolation per property** — activate database-per-tenant (one SQLite file per tenant) or per-property; verify backup/migration/schema-evolution story.
4. **Knowledge-graph augmentation becomes justified** (multi-hop reasoning over relationship-dense corpora) — add `KnowledgeEntity` + `KnowledgeRelation` tables; implement hybrid retrieval (vector+BM25 first, then 1-hop graph traversal); verify the `KnowledgeStore.retrieve()` contract remains unchanged.
5. **A new hotel document type or department** becomes necessary — extend the `KnowledgeDocumentType` / `KnowledgeDepartment` enums; verify the enum extension is backward-compatible.
6. **FTS5 trigger maintenance becomes operationally painful** — evaluate SQLite's `external content` vs `contentless` FTS5 tables; consider a re-indexing workflow.
7. **`KnowledgeQuery` + `KnowledgeCitation` storage grows beyond SQLite's practical limit** (>10M rows) — define a retention + archival policy (research §18 #3); consider a separate audit database.
8. **A new vector dimension is required** (e.g., embedding model upgrade from 768-dim to 1024-dim) — run the blue-green dual-index reindex workflow per ADR-034.
9. **Cross-property knowledge sharing** becomes a primary use case — promote the `propertyId IS NULL` semantics to a first-class "tenant-level document" flag in the UI.
10. **Annually**, as part of the regular ADR review cycle.
