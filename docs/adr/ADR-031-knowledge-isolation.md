# ADR-031: Knowledge Isolation

**ADR-ID:** ADR-031
**Status:** ACCEPTED
**Context:** 2026-08-06
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §9, File 2 § implicit in multi-tenant architecture) requires multi-tenant knowledge isolation as a cross-cutting "Architecture Contract — NOW" capability (Phase B B4 items #19, #20 — multi-tenant knowledge isolation + department-level access). SmartAgentics hotel PMS is multi-tenant by design: a "tenant" = a hotel management company; a "property" = a single hotel; a "department" = front desk, housekeeping, F&B, maintenance, finance, security, etc. Typical scale: 1–100 properties per tenant; 1K–50K chunks per property; total 1K–5M chunks per tenant.

ADR-027 (Multi-Tenant Vector Isolation, Stream 2) established the **two-axis** isolation contract: `tenantId` mandatory + `propertyId` optional on every chunk; sqlite-vec partition-key pre-filtering on `tenantId`. Stream 3 extends this to a **four-axis** isolation contract by adding `department` and `aclRoles[]` — the hotel-industry standard (Hotelops.ai 2026: "By assigning permissions based on roles, departments, or locations, you eliminate confusion, reduce risk, and keep your operations both efficient and secure"; Mews Flexkeeping defines user roles by "responsibilities of different roles within your property").

Phase C Stream 3 research (`/home/z/my-project/phase-c-stream3-offline-knowledge-report.md`, §5) surveyed multi-tenant RAG patterns (Pinecone, Truto, The Nile, AWS Bedrock, Redis, Qdrant) and metadata-filtering-for-ACL patterns (AWS Bedrock, AWS Verified Permissions, Truto document-level RBAC, DataAIHub, Databricks, OpenAI community). The recommended architecture is **three-layer defense-in-depth isolation**:

1. **Schema layer**: `tenantId` column `NOT NULL` on every `KnowledgeChunk` row; Prisma middleware enforces tenant scope on every query.
2. **Vector layer**: sqlite-vec partition key on `tenantId` for pre-filtering (Phase 1, single-DB-per-deployment) OR collection-per-tenant (separate SQLite file per tenant — reserved for the strong-isolation cloud-mode deployment, Phase 2+, ADR-027).
3. **Retrieval layer**: every retrieval call MUST include `tenantId` + `propertyId` + `department` + `aclRoles[]` in the SQL `WHERE` clause. There is no unscoped retrieval path.

Plus an **authorization layer** (application-layer RBAC check before retrieval: resolve user → roles → ACL filter) and an **audit layer** (every retrieval generates an `AuditEvent` row with `actorId`, `resource`, `result`).

Critical detail (research §5.1): Qdrant multitenancy docs warn that "payload-based partitioning alone doesn't isolate IDF statistics. By default, all tenants share the same shard-wide term frequencies. Use the `idf` search parameter to scope statistics to a single tenant." In sqlite-vec + FTS5 this is naturally avoided because each FTS5 table is per-collection — IDF statistics are scoped to the table, not the shard.

## 2. Problem

The architectural problem: **define a four-axis knowledge isolation contract that (a) extends ADR-027's `tenantId` (mandatory) + `propertyId` (optional) two-axis contract with `department` (enum, mandatory — `ALL` for cross-department) and `aclRoles[]` (JSON array of role IDs, mandatory) on every `KnowledgeChunk` row, (b) enforces isolation at three layers for defense-in-depth — schema (Prisma middleware), vector (sqlite-vec partition key on `tenantId`), retrieval (SQL `WHERE` clause on every retrieval call) — plus an authorization layer (application-layer RBAC check before retrieval) and an audit layer (`AuditEvent` row on every retrieval), (c) makes `tenantId` + `propertyIds[]` + `departments[]` + `aclRoles[]` non-optional parameters on every `KnowledgeStore.retrieve()` and `Retriever.retrieve()` call (no unscoped retrieval path), (d) extracts `tenantId` + `propertyIds` + `departments` + `aclRoles` from the authenticated session (Auth.js per ADR-001) — application code cannot bypass isolation, (e) supports `propertyId IS NULL` semantics for tenant-level documents (corporate policy applies to all properties — research §5.4), (f) supports `department = 'ALL'` semantics for cross-department documents (research §5.5), (g) provides unit + integration + negative test patterns that verify cross-tenant, cross-property, and cross-department queries return zero results (research risk R-3.9), (h) re-uses the existing `AuditEvent` table for every retrieval event, (i) reserves encryption-per-tenant and separate-vector-DB-per-tenant as Phase 3+ compliance escalations, and (j) feeds Stream 8 (Security & Governance) as the template for all AI-BOS isolation.** This ADR is the Stream 3 extension of ADR-027 (Stream 2); it adds `department` + `aclRoles` to the isolation contract.

## 3. Options

### Option A: Encryption-per-tenant (cryptographic isolation)

Encrypt each tenant's chunks with a per-tenant key; decrypt only on retrieval for that tenant. Research §5.7: rejected for Phase 1 — key management complexity exceeds benefit at this scale. Reserved for Phase 3+ if a customer demands cryptographic isolation. Truto (2026) describes "cryptographically or logically separating customer data" as the practice — cryptographic isolation is the strongest form but operationally heavy.

### Option B: Separate vector DB per tenant (database-per-tenant, one SQLite file per tenant)

Strongest physical isolation. ADR-027 reserved this as a Phase 2+ compliance escalation. Research §5.7: rejected for Phase 1 — operational overhead of N databases (backup, migration, schema evolution, connection pool management per tenant). Reserved as Phase 2+ option for tenants that demand it (Stream 2's "collection-per-tenant" pattern with LanceDB or one SQLite file per tenant).

### Option C: Post-filtering only (no pre-filtering, no partition key)

Run unscoped KNN, then filter the top-K results by `tenantId` + `propertyId` + `department` + `aclRoles`. Research §5.7: rejected — performance and correctness issues. DataAIHub (2026): "Always pre-filter when your vector database supports it. Pre-filtering is faster, returns consistent result counts." Post-filtering may return zero results after filtering if top-K is too small (the relevant chunks were filtered out before reaching top-K).

### Option D: Metadata filtering only (no schema enforcement, no partition key)

Rely on application-layer metadata filtering at retrieval time; no `tenantId NOT NULL` schema constraint; no sqlite-vec partition key. Research §5.2 evidence (AWS Bedrock, OpenAI community): "Most of the vector DBs does not offer any row level security to RAG data, the only way that I know is to do metadata filtering." Rejected as the _only_ layer — too easy to forget the filter; one bug leaks data across tenants (research risk R-3.9, ADR-027 Option B). Metadata filtering is the retrieval-layer mechanism in the three-layer defense-in-depth, not a standalone solution.

### Option E: Three-layer defense-in-depth (schema + vector partition key + retrieval SQL WHERE) + authorization + audit

Schema layer: `tenantId NOT NULL` on every chunk; Prisma middleware enforces tenant scope. Vector layer: sqlite-vec partition key on `tenantId` for pre-filtering (Phase 1). Retrieval layer: SQL `WHERE tenantId=? AND (propertyId IS NULL OR propertyId IN (?)) AND (department='ALL' OR department IN (?)) AND aclRoles_overlap(?)` on EVERY retrieval call. Authorization layer: application-layer RBAC check before retrieval (resolve user → roles → ACL filter). Audit layer: `AuditEvent` row on every retrieval. Per research §5.3 Three-layer isolation and §5.5 Department-level access control.

## 4. Decision

Adopt **Option E**. The Knowledge Isolation architectural contract is:

1. **Four-axis isolation on every `KnowledgeChunk` row** — Per ADR-028 §9 Prisma schema and research §5.6:
   - `tenantId String` — mandatory, NOT NULL, partition key for sqlite-vec pre-filtering (ADR-027).
   - `propertyId String?` — optional. NULL = "all properties of this tenant" (corporate policy). Non-null = property-specific (research §5.4).
   - `department String` — mandatory, enum (`FRONT_DESK`, `HOUSEKEEPING`, `MAINTENANCE`, `FNB`, `FINANCE`, `SECURITY`, `SALES_MARKETING`, `REVENUE_MGMT`, `IT`, `HR`, `MANAGEMENT`, `ALL`). `ALL` = cross-department (research §5.5).
   - `aclRoles String` — mandatory, JSON array of role IDs that may read this chunk (e.g., `["front_desk_supervisor", "gm"]`). Document-level default; chunks may override (research §5.6).
   - Indexes: `@@index([tenantId, propertyId, department])` on `KnowledgeChunk`.

2. **Layer 1 — Schema enforcement** —
   - `tenantId` is `NOT NULL` on `KnowledgeChunk`, `KnowledgeDocument`, `KnowledgeChunkVector`, `KnowledgeQuery`, `KnowledgeCitation` (ADR-028).
   - Prisma middleware enforces tenant scope on every query — a query without `tenantId` in the `WHERE` clause is rejected (or auto-scoped from the session).
   - The `KnowledgeStore` SDK interface (ADR-028) requires `tenantId` on every method (`retrieve`, `getDocument`, `listDocuments`, `getStaleDocuments`).

3. **Layer 2 — Vector partition-key pre-filtering** —
   - `KnowledgeChunk_vector` (sqlite-vec virtual table, ADR-028) declares `tenant_id TEXT partition key` (ADR-027).
   - sqlite-vec v0.1.6+ recognizes constraints on partition keys and pre-filters rows BEFORE any vector comparison (Stream 2 research §3.1, §10.1).
   - Every `Retriever.retrieve()` call compiles to: `WHERE tenant_id = ?` (partition key pre-filter) + KNN scan over the filtered subset + additional `AND` clauses for `propertyId` / `department` / `aclRoles` (post-filter on the small KNN result set).
   - The `KnowledgeChunk_fts` FTS5 virtual table mirrors this: `tenant_id` is an `UNINDEXED` column used in `WHERE` filtering (per ADR-027 §3).
   - **FTS5 IDF statistics are per-table** — naturally avoids the BM25 IDF cross-tenant leakage risk that Qdrant warns about (research §5.1, Qdrant multitenancy docs).

4. **Layer 3 — Retrieval SQL `WHERE` clause** — Every `KnowledgeStore.retrieve()` and `Retriever.retrieve()` call MUST include:

   ```sql
   WHERE tenantId = ?
     AND (propertyId IS NULL OR propertyId IN (?))      -- property scope
     AND (department = 'ALL' OR department IN (?))       -- department scope
     AND aclRoles_overlap(?, aclRoles)                   -- ACL: user's roles ∩ chunk's aclRoles
   ```
   - **No unscoped retrieval path.** A retrieval call without `tenantId` is a TypeScript type error (ADR-027 §1) and a runtime `TenantIdRequiredError`.
   - `propertyId IS NULL OR propertyId IN (?)` — corporate-policy documents (NULL `propertyId`) are retrievable by any property of the tenant; property-specific documents only by their property (research §5.4).
   - `department = 'ALL' OR department IN (?)` — cross-department documents (`department = 'ALL'`) are retrievable by any department; department-specific documents only by their department (research §5.5).
   - `aclRoles_overlap(?)` — the user's roles (from the authenticated session) must intersect the chunk's `aclRoles[]` JSON array. Implementation: a SQLite JSON function (e.g., `EXISTS (SELECT 1 FROM json_each(chunk.aclRoles) WHERE value IN (user_roles))`).

5. **Authorization layer (application-layer RBAC)** —
   - Before retrieval, the application resolves the authenticated user → roles → ACL filter.
   - Auth.js (per ADR-001) provides the user → roles mapping.
   - The `Retriever` extracts `tenantId` + `propertyIds` + `departments` + `aclRoles` from the authenticated session (ADR-027 §4) — application code does NOT pass these manually; the `Retriever` fills them from the session. This is defense-in-depth: even if a developer forgets a filter in a caller, the `Retriever` fills it from the session.
   - For system-level operations (background re-embedding jobs, admin tooling), a privileged `SystemContext` may set `tenantId` explicitly — these code paths are audited and restricted to admin roles (ADR-027 §4).

6. **Audit layer (`AuditEvent`)** —
   - Every retrieval generates an `AuditEvent` row (existing table, ADR-001) with `actorId` (user), `resource` (`KnowledgeChunk`), `result` (success/denied), `tenantId`, `propertyId`, `department`, `queryText`, `retrievedChunkIds[]`, `latencyMs`.
   - Cross-tenant access attempts (a user from tenant A attempting to retrieve tenant B's chunks) are security events — the `Retriever` rejects them at the partition-key pre-filter; the `AuditEvent` records the denial.
   - Research §5.3 Audit row: "Every retrieval generates an `AuditEvent` row with `actorId`, `resource`, `result`."

7. **`propertyId IS NULL` semantics (tenant-level documents)** —
   - A `KnowledgeDocument` with `propertyId IS NULL` is a tenant-level document (e.g., corporate-wide brand policy) — retrievable by any property of the tenant.
   - Retrieval filter: `WHERE tenantId=? AND (propertyId IS NULL OR propertyId IN (user's accessible property IDs))` (research §5.4).
   - This enables cross-property knowledge sharing within a tenant without a separate "shared" collection.

8. **`department = 'ALL'` semantics (cross-department documents)** —
   - A `KnowledgeChunk` with `department = 'ALL'` is a cross-department document (e.g., emergency evacuation procedures) — retrievable by any department.
   - Retrieval filter: `WHERE department = 'ALL' OR department IN (user's departments)` (research §5.5).
   - The PMS UI shows the user only documents their roles permit; the AI assistant applies the same filter at retrieval time. The two layers are defense-in-depth — a UI bug cannot leak data the retrieval layer refuses to return (research §5.5).

9. **`aclRoles[]` JSON array** —
   - Every chunk carries an `aclRoles` JSON array of role IDs (e.g., `["front_desk_supervisor", "gm"]`).
   - Document-level default (set at ingestion from the `IngestRequest.aclRoles` parameter, ADR-028 §10); chunks may override (e.g., a "Management Only" section within an otherwise general SOP).
   - Retrieval filter: the user's roles (from the session) must intersect the chunk's `aclRoles[]`.
   - Implementation: SQLite JSON function — `EXISTS (SELECT 1 FROM json_each(chunk.aclRoles) WHERE value IN (user_roles))`.

10. **Test patterns (mandatory in Phase 1 PoC)** —
    - **Unit test**: every `KnowledgeStore.retrieve()` and `Retriever.retrieve()` method signature requires `tenantId` (TypeScript compile-time check per ADR-027).
    - **Integration test — cross-tenant**: ingest 10 chunks for tenant A and 10 for tenant B; query as tenant A; assert zero tenant B chunks returned (research §13.4 success criteria).
    - **Integration test — cross-property**: ingest chunks for property P1 and P2 of tenant A; query as a user with access only to P1; assert zero P2 chunks returned.
    - **Integration test — cross-department**: ingest chunks for `FRONT_DESK` and `FINANCE`; query as a `FRONT_DESK` user; assert zero `FINANCE` chunks returned (research §13.4).
    - **Negative test**: attempt `KnowledgeStore.retrieve()` without `tenantId` — assert the implementation throws `TenantIdRequiredError` (ADR-027).
    - **Filter-leakage test**: attempt `KnowledgeStore.delete({ document_type: 'policy' })` without `tenantId` — assert the implementation throws `TenantIdRequiredError` (prevents accidental cross-tenant deletes, ADR-027).
    - **promptfoo red-team "data leakage" plugin** — research risk R-3.9 mitigation: add the promptfoo data-leakage red-team test to CI.

11. **Rejected escalations (reserved for Phase 3+)** —
    - **Encryption-per-tenant** (Option A): reserved for Phase 3+ if a customer demands cryptographic isolation (research §5.7).
    - **Separate vector DB per tenant** (Option B): reserved for Phase 2+ compliance escalation per ADR-027 (collection-per-tenant with LanceDB or one SQLite file per tenant).

## 5. Rationale

- **Four-axis isolation matches the hotel-industry standard** — Hotelops.ai (2026): "By assigning permissions based on roles, departments, or locations, you eliminate confusion, reduce risk, and keep your operations both efficient and secure." Mews Flexkeeping defines user roles by "responsibilities of different roles within your property." `tenantId` (tenant) + `propertyId` (location) + `department` (department) + `aclRoles` (role) is the hotel-industry-standard four-axis isolation (research §2.3, §5.5).
- **Three-layer defense-in-depth is the standard multi-tenant RAG pattern** — Schema (NOT NULL + Prisma middleware) + Vector (partition key pre-filter) + Retrieval (SQL WHERE) is the canonical pattern across Pinecone, Truto, The Nile, AWS Bedrock, Redis, Qdrant (research §5.1). No single layer is sufficient — defense-in-depth means a bug in one layer is caught by another.
- **Authorization + audit layers add defense-in-depth** — Application-layer RBAC check before retrieval (resolve user → roles → ACL filter) is the AWS Verified Permissions pattern (research §5.2). `AuditEvent` on every retrieval is the auditability foundation (research §5.3).
- **`Retriever` extracts isolation context from the authenticated session** — Application code cannot bypass isolation because it does not supply `tenantId` / `propertyIds` / `departments` / `aclRoles` — the `Retriever` fills them from the session (ADR-027 §4). This is defense-in-depth: even if a developer forgets a filter in a caller, the `Retriever` fills it from the session.
- **FTS5 IDF statistics are per-table** — Naturally avoids the BM25 IDF cross-tenant leakage risk that Qdrant warns about (research §5.1, Qdrant multitenancy docs). No `idf` parameter scoping needed in sqlite-vec + FTS5.
- **`propertyId IS NULL` semantics enable tenant-level documents** — Corporate-wide brand policies apply to all properties; `propertyId IS NULL` is the natural representation. Retrieval filter `WHERE propertyId IS NULL OR propertyId IN (?)` enables cross-property knowledge sharing within a tenant without a separate "shared" collection (research §5.4).
- **`department = 'ALL'` semantics enable cross-department documents** — Emergency evacuation procedures apply to all departments; `department = 'ALL'` is the natural representation. The retrieval filter `WHERE department = 'ALL' OR department IN (?)` enables cross-department knowledge sharing (research §5.5).
- **`aclRoles[]` JSON array enables document-level RBAC** — Truto (2026): "Document-level RBAC ensures an AI agent only retrieves and processes document chunks the requesting user is authorized to see." Chunks may override the document-level default (e.g., a "Management Only" section) (research §5.2, §5.6).
- **Metadata filtering is the de facto pattern** — OpenAI community (2024): "Most of the vector DBs does not offer any row level security to RAG data, the only way that I know is to do metadata filtering." AWS Bedrock (2024): "Metadata filtering in knowledge bases enables access control for your data." Databricks (2025): "By combining the flexibility of vector search with robust metadata-based access control." DataAIHub (2026): "Always pre-filter when your vector database supports it." (research §5.2).
- **Rejecting encryption-per-tenant (Option A)** — Key management complexity exceeds benefit at Phase 1 scale; reserved for Phase 3+ compliance (research §5.7).
- **Rejecting separate vector DB per tenant (Option B)** — Operational overhead of N databases; reserved for Phase 2+ compliance escalation per ADR-027 (research §5.7).
- **Rejecting post-filtering only (Option C)** — Performance and correctness issues; DataAIHub confirms pre-filtering is faster and returns consistent result counts (research §5.7).
- **Rejecting metadata filtering only (Option D)** — Too easy to forget the filter; one bug leaks data across tenants (research risk R-3.9, ADR-027 Option B). Metadata filtering is the retrieval-layer mechanism in the three-layer defense-in-depth, not a standalone solution.
- **Test patterns verify isolation in Phase 1 PoC** — Cross-tenant, cross-property, cross-department integration tests + negative test + filter-leakage test + promptfoo data-leakage red-team test (research §13.4, risk R-3.9 mitigation).

## 6. Consequences

**Positive**:

- Four-axis isolation (`tenantId` + `propertyId` + `department` + `aclRoles`) matches hotel-industry standard — defense-in-depth at three layers + authorization + audit.
- `Retriever` extracts isolation context from the authenticated session — application code cannot bypass isolation.
- FTS5 IDF statistics are per-table — naturally avoids BM25 IDF cross-tenant leakage (no `idf` parameter scoping needed).
- `propertyId IS NULL` + `department = 'ALL'` semantics enable tenant-level and cross-department documents without separate "shared" collections.
- `aclRoles[]` JSON array enables document-level RBAC with per-chunk overrides.
- `AuditEvent` on every retrieval provides full auditability — cross-tenant access attempts are security events.
- Mandatory test patterns (cross-tenant, cross-property, cross-department, negative, filter-leakage, promptfoo) verify isolation in Phase 1 PoC.
- Resolves research risk R-3.9 (Critical severity) at the architectural level.

**Negative / obligations**:

- Phase 1 must include the integration test suite (ingest tenant A + tenant B + property P1 + P2 + `FRONT_DESK` + `FINANCE`; query as various users; assert zero leakage) — estimated 1–2 days on top of the `KnowledgeStore` PoC (research §13.3, §13.4).
- Every vector-bearing consumer (Stream 3 `DocumentIngester` + `RagGenerator`, Stream 5 Agent Runtime, Stream 6 Memory) MUST thread `tenantId` + `propertyIds` + `departments` + `aclRoles` through every call — this is an obligation on downstream streams, not optional.
- The `Retriever` must be wired to the authenticated session (Auth.js middleware per ADR-001) — Stream 8 (AI Security) owns the session-context plumbing; Stream 3 defines the contract.
- sqlite-vec partition-key limit (~3 columns, ADR-027 §6) constrains the partition-key schema — only `tenant_id` is a partition key; `property_id` / `department` / `aclRoles` become regular `WHERE` clauses (post-filter on KNN result). For very large tenants (>100K chunks), post-filtering on `property_id` / `department` may be slow — mitigation: monitor filter selectivity; escalate to collection-per-tenant (Phase 2+) or database-per-tenant (compliance) (research §10.1 risk, ADR-027 §6).
- `aclRoles[]` JSON array overlap check via SQLite JSON functions adds query complexity — performance tested in Phase 1; if slow, promote `aclRoles` to a separate `KnowledgeChunkAclRole` join table with an index.
- `AuditEvent` volume may be high (one row per retrieval) — mitigation: batch insert; retention policy; consider a separate audit database at scale.
- Concurrent multi-tenant embedding ingestion contention on SQLite's write lock (Phase 1 shared-collection) — mitigation: WAL mode, batch upserts, collection-per-tenant (Phase 2+) or database-per-tenant for high-write deployments (research risk R-2.15, ADR-027 §6).
- The PMS UI must enforce the same isolation (show user only documents their roles permit) — UI obligation; defense-in-depth means a UI bug cannot leak data the retrieval layer refuses to return (research §5.5).

**Dependencies on other ADRs**:

- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` mandatory + `propertyId` optional; sqlite-vec partition-key pre-filtering; `Retriever` extracts `tenantId` from authenticated session; `SystemContext` privileged operations.
- Depends on ADR-028 (Knowledge Base Architecture) — `tenantId` NOT NULL on `KnowledgeChunk` / `KnowledgeDocument` / `KnowledgeChunkVector` / `KnowledgeQuery` / `KnowledgeCitation`; `@@index([tenantId, propertyId, department])`; `KnowledgeStore` SDK interface requires `tenantId` on every method.
- Depends on ADR-024 (Hybrid Search) — `Retriever.retrieve()` enforces the four-axis `WHERE` clause; `tenant_id` UNINDEXED column on `KnowledgeChunk_fts`.
- Depends on ADR-023 (Vector Store) — `tenant_id` partition key on `KnowledgeChunk_vector`.
- Depends on ADR-001 (Reference Stack) — Auth.js session context; `AuditEvent` existing table.
- Feeds ADR-030 (RAG Pipeline) — `RagGenerator` threads `tenantId` + `propertyIds` + `departments` + `aclRoles` through every retrieval call.
- Feeds ADR-032 (Source Attribution & Citation) — `KnowledgeCitation` rows are tenant-scoped.
- Feeds ADR-034 (Versioning & Incremental Re-index) — re-ingestion preserves `tenantId` / `propertyId` / `department` / `aclRoles`.
- Feeds Stream 4 (Memory) — per-tenant memory isolation follows the same pattern.
- Feeds Stream 5 (Agent Runtime) — agent retrieval calls thread `tenantId` + `propertyIds` + `departments` + `aclRoles`.
- Feeds Stream 6 (Memory) — per-tenant memory vectors.
- Feeds Stream 8 (Security & Governance) — three-layer isolation is the template for all AI-BOS isolation; `AuditEvent` is the audit trail; `SystemContext` privileged operations are an audit surface.
- Compatible with ADR-013 (Observability Strategy) — every retrieval operation logs `tenantId` + `propertyId` + `department` + `aclRoles` for audit; cross-tenant access attempts are security events.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A cross-tenant / cross-property / cross-department data leak is detected in production** (research risk R-3.9, Critical severity) — root-cause analysis; tighten the interface (e.g., remove `SystemContext` escape hatch if abused); add automated leak-detection tests.
2. **A tenant's corpus exceeds sqlite-vec shared-collection performance envelope** (>100K chunks/tenant or `property_id` / `department` filter selectivity >90%) — migrate that tenant to collection-per-tenant (Phase 2+ LanceDB) or database-per-tenant (compliance escalation).
3. **`aclRoles[]` JSON array overlap check is too slow** (>20 ms per query) — promote `aclRoles` to a separate `KnowledgeChunkAclRole` join table with an index.
4. **A compliance-driven deployment requires cryptographic isolation** — activate encryption-per-tenant (Option A); validate key management story.
5. **SmartAgentics deploys against PostgreSQL / pgvector** (Phase 2+ cloud) — implement the four-axis isolation in Postgres; verify Row-Level Security as an alternative to application-layer filtering.
6. **`AuditEvent` volume becomes operationally painful** (>1M rows/day) — define a retention + archival policy; consider a separate audit database.
7. **A new isolation dimension is needed** (e.g., per-property encryption, per-department quotas) — extend the four-axis contract; verify the sqlite-vec partition-key limit (~3 columns) is not binding.
8. **`SystemContext` privileged operations become an audit burden** — define a formal privileged-operations API, restrict to admin roles, add automated audit-trail review.
9. **Cross-tenant knowledge sharing with explicit consent** becomes a use case — extend the retrieval filter to support opt-in cross-tenant queries with audit trail.
10. **Annually**, as part of the regular ADR review cycle.
