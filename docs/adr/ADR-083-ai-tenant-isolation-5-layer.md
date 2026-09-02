# ADR-083: AI Tenant Isolation — 5-Layer Defense-in-Depth

**ADR-ID:** ADR-083
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #30 ("Tenant isolation") is classified as **"Partial"** — Streams 2/3/4 enforce `tenantId` at the schema layer, vector partition, and ACL layer, but no layer enforces **context-window isolation**. Stream 8 Foundational Conflict **FC-8.9** (High) flags this gap: nothing currently prevents an agent session for tenant A from receiving retrieved chunks or memory belonging to tenant B if a future bug in the retrieval SQL omits the `WHERE tenantId = ?` clause.

The Stream 8 research (s11) is unambiguous across multiple authoritative sources:

- **CockroachDB multi-tenant AI blog** (August 2026): "Prevent cross-tenant data leakage by enforcing tenant boundaries at the database layer rather than relying only on application filters."
- **Burn-After-Use mechanism for enterprise LLM** (arXiv): presents a Secure Multi-Tenant Architecture (SMTA) combined with a Burn-After-Use (BAU) mechanism.
- **Truto multi-tenant RAG isolation** (May 2026): "Secure multi-tenant RAG requires deterministic data isolation at the vector database layer using namespaces and JWTs. Relying on LLMs for access [control is unsafe]."
- **BeyondScale multi-tenant LLM security** (April 2026): "Vector database isolation prevents cross-tenant retrieval. But once documents land in a context window, [the LLM may leak across sessions if context is not isolated]."
- **Tianpan cross-tenant data leakage** (April 2026): "Vector databases are the layer most directly implicated in RAG-based leakage, and also the layer where the gap between 'isolated' and 'actually isolated' [is widest]."

Each AI surface is a distinct leakage vector: the model context window, the vector store, the knowledge chunks, the memory records, and the agent sessions. Streams 2/3/4 closed 3 of 5 layers; Stream 8 closes the remaining 2 and adds the missing **invariant verification layer** that detects a retrieval bug even when application filters fail.

## 2. Problem

Should SmartAgentics rely on the existing 3-layer isolation (schema + vector partition + ACL), add cryptographic per-tenant keys, fine-tune models per tenant, or add the two missing layers (context-window invariant + prompt-template isolation)? Should the invariant be a runtime check or a static verifier rule?

## 3. Options

### Option A: Rely on the existing 3-layer isolation (no new layers)

Rejected. BeyondScale's research (s11) explicitly warns that "once documents land in a context window, the LLM may leak across sessions if context is not isolated." A retrieval SQL bug that omits `WHERE tenantId = ?` is undetectable today.

### Option B: Per-tenant fine-tuned models

Rejected for Phase 1. Cost prohibitive. Phase 3+ may explore LoRA adapters per tenant.

### Option C: Cryptographic tenant separation (encrypt each tenant's data with a separate key)

Partially adopted. Stream 4's SQLCipher uses a per-deployment key. Per-tenant keys (Stream 4 Phase 2+ option) provide cryptographic isolation; this ADR reserves per-tenant keys as the Phase 2+ strong-isolation option.

### Option D: Per-tenant LLM-based access control (ask the LLM to enforce tenant boundaries)

Rejected. Truto's research (s11) is explicit: "Relying on LLMs for access [control is unsafe]." Access control must be deterministic, not LLM-decided.

### Option E: 5-layer defense-in-depth (existing 3 + context-window invariant + prompt-template isolation)

Adopted. Adds the two missing layers and an invariant that is both a runtime check (post-retrieval) and a verifier rule (schema constraint).

## 4. Decision

Adopt **Option E** — the 5-layer AI tenant isolation defense-in-depth.

| Layer | Defense                                                                                                                                                                                               | Owner               | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------ |
| T1    | Schema: `tenantId NOT NULL` on every mutable row + Prisma middleware enforces tenant filter                                                                                                           | Stream 2/3/4        | CLOSED |
| T2    | Vector partition: sqlite-vec partition key on `tenantId`; Phase 2+ collection-per-tenant                                                                                                              | Stream 2            | CLOSED |
| T3    | ACL: 4-dimensional scope (tenantId, propertyId, departmentId, userId/agentId); Cedar-style L1/L2/L3                                                                                                   | Stream 4 + Stream 6 | CLOSED |
| T4    | **Context-window invariant** (NEW): post-retrieval check that every retrieved chunk's `tenantId == session.tenantId`; violation → log + abort + `AIAuditEvent` `eventType=TENANT_ISOLATION_VIOLATION` | Stream 8            | NEW    |
| T5    | **Prompt-template isolation** (NEW): per-tenant prompt templates stored in `AgentContract.tenantId`; system prompt is never concatenated across tenants; per-tenant `AgentContract` row               | Stream 8            | NEW    |

### T4 — Context-window invariant check

```typescript
// Pseudocode — runs after Retriever.retrieve() returns chunks
async function enforceTenantInvariant(
  session: AgentSession,
  retrievedChunks: KnowledgeChunk[],
): Promise<void> {
  for (const chunk of retrievedChunks) {
    if (chunk.tenantId !== session.tenantId) {
      await auditor.log({
        eventType: 'TENANT_ISOLATION_VIOLATION',
        tenantId: session.tenantId,
        details: { violatedChunkId: chunk.id, violatedChunkTenantId: chunk.tenantId },
      });
      throw new TenantIsolationViolationError(session.tenantId, chunk.tenantId);
    }
  }
}
```

The `AIAuditEvent.retrievedChunks[]` field (ADR-085) is cross-checked against the session's `tenantId` by the Auditor for after-the-fact invariant verification.

### T5 — Prompt-template isolation

- `AgentContract.tenantId` is NOT NULL.
- A default tenant `0` exists for shared contracts (read-only reference).
- Every tenant has its own `AgentContract` row, even if the contract content is identical to the default.
- The system prompt is fetched as `WHERE tenantId = ? AND agentType = ?` — never across tenants.

### Phase 1 scope

- T4 invariant check: ~80 lines of code in `Retriever` (Stream 2 interface).
- T5: schema constraint (`AgentContract.tenantId NOT NULL`) + migration script. ADR-046 amendment makes `tenantId` NOT NULL (Stream 5 added it as nullable).

## 5. Rationale

- **FC-8.9 closure**: the missing context-window invariant layer is added; a retrieval bug that omits `WHERE tenantId = ?` is now detectable at runtime and aborts before any cross-tenant content reaches the model.
- **CockroachDB principle** (s11): tenant boundaries at the database layer (T1–T3) are the foundation; T4 is defense-in-depth on top.
- **BeyondScale warning** (s11) directly addressed: "once documents land in a context window, the LLM may leak" — T4 prevents cross-tenant content from ever reaching the context window.
- **Truto principle** (s11): deterministic isolation, not LLM-decided — T4/T5 are deterministic SQL/constraint checks.
- **Prompt-template isolation** (T5) closes a subtle vector: if a single shared `AgentContract` row served all tenants, a per-tenant customization (e.g., hotel-brand-specific phrasing) would leak across tenants.
- **B4 #30 closure**: Phase B classified tenant isolation as "Partial"; Stream 8 closes to "Architecture Contract — NOW satisfied."
- **T4 cost is negligible**: ~5ms per retrieval (one extra SQL `SELECT tenantId FROM KnowledgeChunk WHERE chunkId IN (?)`).

## 6. Consequences

- New `enforceTenantInvariant` check in `Retriever` (Stream 2 interface).
- `AgentContract.tenantId` NOT NULL constraint (ADR-046 amendment, additive).
- New `AIAuditEvent` event type: `TENANT_ISOLATION_VIOLATION`.
- New `AIAuditEvent.retrievedChunks[]` field (ADR-085) for after-the-fact invariant verification.
- **Risk: T4 invariant check adds ~5ms per retrieval.** Negligible — acceptable for hotel PMS交互.
- **Risk: T5 requires every tenant to have its own `AgentContract` row.** Mitigation: default tenant `0` for shared contracts; a tenant onboarding script copies the default contract for new tenants.
- **Risk: a future retrieval surface (e.g., memory recall, Stream 4) bypasses `Retriever` and skips T4.** Mitigation: the Auditor's after-the-fact check verifies `AIAuditEvent.retrievedChunks[]` against `session.tenantId`; any bypass is detected post-hoc.
- Dependencies: Streams 2/3/4 (layers T1/T2/T3); Stream 5 `AgentContract` (T5 prompt template storage); Stream 5 `AIAuditEvent` (T4 violation logging); Stream 6 multi-agent fields.
- Phase 1 effort: ~1 week (T4 invariant check ~80 lines; T5 schema constraint + migration script).

## 7. Review Conditions

- Review if T4 invariant fires in production (i.e., a real cross-tenant retrieval bug exists) — would indicate a T1/T2/T3 failure that requires root-cause analysis.
- Review if Phase 2+ per-tenant cryptographic keys (Stream 4 option) are demanded by an enterprise customer — would add a T6 layer.
- Review if a future retrieval surface (e.g., agentic web search, Phase 3+) requires extending T4 — would generalize the invariant to all data sources.
- Review if T5 prompt-template isolation proves too rigid (e.g., a hotel chain wants shared brand-level prompts across tenant properties) — would add a `parentTenantId` concept for inherited contracts.
- Review if Phase 2+ multi-tenant vector store (collection-per-tenant) is implemented — would relax T4 since the partition itself prevents cross-tenant retrieval, but T4 remains as defense-in-depth.
- Review if a regulator demands proof of tenant isolation — the `AIAuditEvent.retrievedChunks[]` field provides the audit evidence.
- Review if the default tenant `0` shared-contract pattern proves unsafe (e.g., a tenant inadvertently modifies tenant 0's contract) — would remove the default tenant and require explicit per-tenant contracts.

---

## Amendment 1 — 2026-09-02 — Phase D Revision (Domain-Neutral Architecture)

**Amendment Authority:** Phase D Revision — Domain-Neutral Architecture (per Senior Engineer Directive)

### Changes

1. **T3 (ACL layer) expanded**: Original T3 enforces `tenantId` via SQL WHERE. Amended to also enforce `domainId` as secondary isolation axis. Authorization now uses both Cedar policies (attribute-based, already adopted) AND OpenFGA relationships (relationship-based, per ADR-099). T3 = "Cedar policies + OpenFGA relationships + SQL WHERE on (tenantId, domainId)."

2. **T4 (context-window invariant) expanded**: Original T4 checks `chunk.tenantId ∈ session.tenantId`. Amended to also check `chunk.domainId ∈ session.authorizedDomains`. An agent scoped to PMS domain cannot access knowledge chunks from a School domain, even within the same tenant.

3. **T5 (prompt-template isolation) expanded**: Original T5 isolates prompt templates per-tenant. Amended to also isolate per-domain: `AgentContract.domainId` determines which domain's context is injected into the system prompt. An agent with `domainId: "pms"` receives only PMS entity definitions, never School or Government definitions.

### Rationale

Phase D Revision research (FC-DN-16, HIGH severity) identified that ADR-083's 5-layer isolation is tenant-only. The domain-neutral architecture introduces `domainId` as a second isolation axis — an agent scoped to the PMS domain must not access data, knowledge, memory, or context from other domains (School, Government, etc.) within the same tenant. This amendment extends T3/T4/T5 to enforce per-domain isolation without weakening the existing per-tenant isolation.

### References

- ADR-099: Fine-Grained Authorization (OpenFGA + Cedar + 5-Way Permission Intersection)
- ADR-103: Domain-to-AI Context (Schema-to-Prompt Compiler)
- FC-DN-16: Foundational conflict resolved
