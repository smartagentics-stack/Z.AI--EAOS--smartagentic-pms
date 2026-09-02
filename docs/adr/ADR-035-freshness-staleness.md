# ADR-035: Freshness & Staleness

**ADR-ID:** ADR-035
**Status:** ACCEPTED
**Context:** 2026-08-06
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §8) classifies **Knowledge base management** as an "Architecture Contract — NOW" capability (Phase B B4 item #14), including freshness and staleness tracking. Hotel SOPs, policies, rate sheets, and announcements have wildly different update cadences: a rate sheet may change daily; an equipment manual rarely changes; a brand policy is reviewed annually. A stale SOP (e.g., post-COVID cleaning procedure) is materially dangerous — a front-desk staff member acting on an outdated SOP may violate current health regulations. Research risk R-3.8 (High likelihood / High impact): "Stale SOP leads to outdated answers (e.g., post-COVID cleaning procedure)."

Phase C Stream 3 research (`/home/z/my-project/phase-c-stream3-offline-knowledge-report.md`, §7.3) documented the freshness/staleness evidence: Atlan (2026) — "Stale embeddings can degrade RAG retrieval accuracy by up to 20%. Engineering fixes like re-indexing treat symptoms — not the ungoverned source." apxml.com — "A stale knowledge base can mislead users with outdated facts. There are two primary approaches: full re-indexing and incremental updates." Tianpan (2026) — "Alert when the percentage of retrieved chunks exceeding their freshness threshold spikes." Ragaboutit (2025) — "Production RAG requires staleness metrics as part of the standard monitoring dashboard. Define staleness operationally: the time elapsed since [last verification]." arXiv 2509.19376 (2026) — "a lightweight, domain-agnostic temporal memory layer for RAG that makes time a first-class signal throughout the retrieval pipeline."

The recommended freshness model: every `KnowledgeDocument` carries `lastVerifiedAt` and `freshnessTtlDays` (per-doc, per-document-type default). A scheduled Restate workflow (already chosen in ADR-001) runs nightly: `SELECT * FROM KnowledgeDocument WHERE lastVerifiedAt + freshnessTtlDays < now() AND deletedAt IS NULL`. For each stale doc: emit `AuditEvent` (eventType=`KNOWLEDGE_STALE`, severity=warning); surface alert in PMS UI ("Document 'Front Desk SOP v3' has not been verified in 95 days. Please review and re-ingest if outdated."). Stale docs are **flagged, not auto-removed**. The retrieval layer may optionally down-rank stale chunks (multiply `retrieval_score` by 0.8 if `days_since_verified > freshnessTtlDays`). Default freshness TTLs per document type: SOP=180, POLICY=365, PROCEDURE=90, MANUAL=730, FAQ=90, RATE_SHEET=7, SERVICE_INFO=180, ROOM_INFO=365, CONTACT=90, TRAINING=365, COMPLIANCE=365, ANNOUNCEMENT=30, OTHER=180.

## 2. Problem

The architectural problem: **define a knowledge freshness / staleness contract that (a) stamps every `KnowledgeDocument` with `lastVerifiedAt DateTime` (updated on every re-ingestion attempt, even no-op) and `freshnessTtlDays Int` (per-doc, per-document-type default), (b) runs a scheduled Restate workflow nightly that selects stale documents (`lastVerifiedAt + freshnessTtlDays < now() AND deletedAt IS NULL`) and emits `AuditEvent` (eventType=`KNOWLEDGE_STALE`, severity=warning) for each, (c) surfaces staleness alerts in the PMS UI ("Document 'X' has not been verified in N days. Please review and re-ingest if outdated.") with a "last verified" badge on each document, (d) flags stale documents but does NOT auto-remove them — the operator decides whether to re-ingest, mark as still-current, or delete, (e) optionally down-ranks stale chunks in retrieval (multiply `retrieval_score` by 0.8 if `days_since_verified > freshnessTtlDays`) — default ON, tunable per tenant, (f) defines per-document-type default TTLs (SOP=180, POLICY=365, PROCEDURE=90, MANUAL=730, FAQ=90, RATE_SHEET=7, SERVICE_INFO=180, ROOM_INFO=365, CONTACT=90, TRAINING=365, COMPLIANCE=365, ANNOUNCEMENT=30, OTHER=180), (g) allows per-document TTL override at ingestion time (e.g., a rate sheet with a known 3-day volatility), (h) re-uses the existing `AuditEvent` table for staleness events (no new audit infrastructure), (i) re-uses Restate (ADR-001) as the workflow orchestrator (no new orchestrator), (j) integrates with the `KnowledgeStore.getStaleDocuments(tenantId)` SDK method (ADR-028) for UI listing, and (k) feeds Stream 8 (Security & Governance) — staleness is a governance signal.** This ADR defines the freshness contract; the versioning + re-ingestion that updates `lastVerifiedAt` is owned by ADR-034; the ingestion channels that trigger re-ingestion are owned by ADR-036.

## 3. Options

### Option A: Auto-remove stale documents

Automatically delete (or hard-purge) documents that exceed their freshness TTL. Rejected — risks losing compliance-relevant documents that are still current but haven't been re-verified; the operator must decide. Atlan (2026): "Engineering fixes like re-indexing treat symptoms — not the ungoverned source." Staleness is a governance signal, not an auto-delete trigger. Research §7.3.2.

### Option B: Full re-indexing on staleness detection

When a document is flagged stale, automatically trigger full re-ingestion (re-parse, re-chunk, re-embed all chunks). Rejected — wasteful (ADR-034 §3 Option A); the document may not have changed (`rawFileHash` match → no work per ADR-034). Staleness detection triggers a re-verification (re-hash check), not a full re-index. Research §7.3.2, ADR-034.

### Option C: Real-time streaming staleness (Kafka-style)

Stream staleness events in real-time as documents cross their TTL threshold. Rejected for Phase 1 — overkill for hotel scale; a nightly Restate sweep is sufficient. Research §8.5 (rejected for ingestion) applies analogously.

### Option D: No staleness tracking (treat all documents as perpetually fresh)

Skip staleness tracking entirely; rely on operators to manually re-ingest when documents change. Rejected — research risk R-3.8 (High/High): "Stale SOP leads to outdated answers." Atlan (2026): "Stale embeddings can degrade RAG retrieval accuracy by up to 20%." The AI-BOS directive classifies knowledge base management (including freshness) as NOW.

### Option E: Per-document TTL + nightly Restate sweep + flag (not auto-remove) + optional retrieval down-ranking

`KnowledgeDocument.lastVerifiedAt` + `freshnessTtlDays`. Nightly Restate workflow selects stale docs; emits `AuditEvent` (`KNOWLEDGE_STALE`); surfaces UI alert + "last verified" badge. Stale docs flagged, not auto-removed. Retrieval optionally down-ranks stale chunks (0.8 multiplier, default ON, tunable per tenant). Per-document-type default TTLs. Per-document override at ingestion. Per research §7.3.

## 4. Decision

Adopt **Option E**. The Freshness & Staleness architectural contract is:

1. **`KnowledgeDocument` freshness columns** — Per ADR-028 §9 and research §7.3.2:
   - `lastVerifiedAt DateTime @default(now())` — updated on every re-ingestion attempt (even no-op when `rawFileHash` matches, per ADR-034 §3 step 2). "Verified" means "we checked the file and it hasn't changed" — not "a human reviewed it."
   - `freshnessTtlDays Int @default(90)` — per-doc TTL in days. Default 90; overridden at ingestion time per document type (§4 below) or per individual document.
   - `lastIngestedAt DateTime @default(now())` — updated on every content-changing re-ingestion (when `contentHash` changes, per ADR-034 §3 step 9).
   - Index: `@@index([tenantId, lastVerifiedAt])` — supports the nightly sweep query.

2. **Per-document-type default TTLs** — Per research §7.3.3:

   | Document Type  | Default TTL (days) | Rationale                          |
   | -------------- | ------------------ | ---------------------------------- |
   | `SOP`          | 180                | Semi-stable; reviewed twice a year |
   | `POLICY`       | 365                | Annual policy review cycle         |
   | `PROCEDURE`    | 90                 | Frequently updated                 |
   | `MANUAL`       | 730                | Equipment manuals rarely change    |
   | `FAQ`          | 90                 | Frequently updated                 |
   | `RATE_SHEET`   | 7                  | Highly volatile                    |
   | `SERVICE_INFO` | 180                | Semi-stable                        |
   | `ROOM_INFO`    | 365                | Room renovations are annual        |
   | `CONTACT`      | 90                 | Staff turnover                     |
   | `TRAINING`     | 365                | Annual training cycle              |
   | `COMPLIANCE`   | 365                | Annual regulatory cycle            |
   | `ANNOUNCEMENT` | 30                 | Time-bound by nature               |
   | `OTHER`        | 180                | Conservative default               |
   - At ingestion, `freshnessTtlDays` defaults to the per-document-type value; the `IngestRequest.freshnessTtlDays?` parameter (ADR-028 §10) allows per-document override (e.g., a rate sheet with a known 3-day volatility).

3. **Nightly Restate sweep workflow** — Per research §7.3.2 and ADR-001 (Restate already chosen):
   - Scheduled Restate workflow runs nightly (default 02:00 local time; configurable per tenant).
   - Query: `SELECT * FROM KnowledgeDocument WHERE lastVerifiedAt + freshnessTtlDays < now() AND deletedAt IS NULL`.
   - For each stale doc: emit `AuditEvent` (eventType=`KNOWLEDGE_STALE`, severity=warning, `actorId=system`, `resource=KnowledgeDocument:<id>`, `details={lastVerifiedAt, freshnessTtlDays, daysSinceVerified}`).
   - The workflow is per-tenant (thread `tenantId` per ADR-027/031) — no cross-tenant staleness queries.
   - The workflow is durable, resumable, observable via Restate.

4. **PMS UI surfaces** —
   - **"Last verified" badge** on each document in the KB management page: "Verified 12 days ago" (green), "Verified 87 days ago" (yellow, approaching TTL), "Stale — verified 95 days ago" (red, past TTL).
   - **Staleness alert banner**: "Document 'Front Desk SOP v3' has not been verified in 95 days. Please review and re-ingest if outdated." Dismissible per document (the operator marks "still current" — updates `lastVerifiedAt` without re-ingestion).
   - **Stale documents list**: `KnowledgeStore.getStaleDocuments(tenantId)` (ADR-028 §10) returns all stale documents for the tenant; the UI shows them in a dedicated "Needs review" section.
   - **Per-chunk staleness indicator** in the chat citation sidebar: "Source: Front Desk SOP v3, §3.2 (verified 95 days ago — stale)" — transparency for the user.

5. **Flag, not auto-remove** — Per research §7.3.2:
   - Stale documents are **flagged**, not auto-removed.
   - The operator decides: re-ingest (trigger re-verification per ADR-034), mark as still-current (update `lastVerifiedAt` without re-ingestion), or delete (soft-delete per ADR-034).
   - Rationale (research §7.3.2): staleness is a governance signal, not an auto-delete trigger. Atlan (2026): "Engineering fixes like re-indexing treat symptoms — not the ungoverned source."

6. **Optional retrieval down-ranking** — Per research §7.3.2 and §18 #4:
   - The `Retriever` (ADR-024) may optionally down-rank stale chunks: multiply `retrieval_score` by 0.8 if `days_since_verified > freshnessTtlDays`.
   - Default: ON (down-rank stale chunks).
   - Tunable per tenant via `FeatureFlag` (`knowledge.staleness.downrank.enabled`, default true; `knowledge.staleness.downrank.multiplier`, default 0.8).
   - The down-ranking is applied AFTER RRF fusion (ADR-024) — stale chunks may still appear in the result set, but at lower scores.
   - `RetrievedChunk.score` reflects the down-ranked score; the UI may show a "stale" badge on down-ranked chunks.
   - Open question (research §18 #4): "Should the staleness sweep down-rank stale chunks in retrieval, or only flag them?" — default: down-rank by 0.8 multiplier.

7. **`KnowledgeStore.getStaleDocuments(tenantId)` SDK method** — Per ADR-028 §10:
   - Returns all stale documents for the tenant (`lastVerifiedAt + freshnessTtlDays < now() AND deletedAt IS NULL`).
   - Used by the PMS UI "Needs review" section.
   - `tenantId` is mandatory (ADR-027/031) — no cross-tenant queries.

8. **`AuditEvent` on staleness detection** — Per research §7.3.2 and ADR-001 (existing `AuditEvent` table):
   - `eventType = KNOWLEDGE_STALE`.
   - `severity = warning`.
   - `actorId = system`.
   - `resource = KnowledgeDocument:<id>`.
   - `details` = JSON: `{lastVerifiedAt, freshnessTtlDays, daysSinceVerified, documentType, department}`.
   - Reuses the existing `AuditEvent` table — no new audit infrastructure.
   - Stream 8 (Security & Governance) may consume these events for compliance reporting ("Tenant A has 12 stale SOPs past their TTL").

9. **"Mark as still current" operator action** —
   - The PMS UI offers a "Mark as still current" button on each stale document.
   - This updates `lastVerifiedAt = now()` WITHOUT re-ingestion — the operator has reviewed the document and confirmed it is still accurate.
   - Emits `AuditEvent` (eventType=`KNOWLEDGE_VERIFIED_MANUAL`, `actorId=<user>`, `resource=KnowledgeDocument:<id>`).
   - This is the human-in-the-loop freshness governance — staleness is a prompt for review, not an automatic action.

10. **`lastVerifiedAt` vs `lastIngestedAt` distinction** —
    - `lastVerifiedAt`: updated on every re-ingestion attempt (even no-op when `rawFileHash` matches per ADR-034 §3 step 2). "Verified" = "we checked the file."
    - `lastIngestedAt`: updated on every content-changing re-ingestion (when `contentHash` changes per ADR-034 §3 step 9). "Ingested" = "we re-parsed and re-chunked."
    - Staleness uses `lastVerifiedAt` — a document is stale if it hasn't been _checked_ in TTL days, regardless of whether it changed.

11. **Restate workflow orchestration** — Per ADR-001 (Restate already chosen):
    - The nightly staleness sweep is a Restate scheduled workflow.
    - The "mark as still current" action is a Restate workflow (durable; emits `AuditEvent`).
    - No new orchestrator.

## 5. Rationale

- **Per-document TTL reflects hotel-document-practice** — Rate sheets change daily (TTL=7); equipment manuals rarely change (TTL=730); brand policies reviewed annually (TTL=365). The per-document-type defaults (research §7.3.3) match how hotel chains actually manage document review cycles.
- **Nightly Restate sweep is sufficient** — Hotel scale (1K–5M chunks per tenant) does not require real-time staleness streaming. A nightly sweep catches all documents that crossed their TTL threshold in the last 24 hours. Real-time streaming (Kafka-style) is overkill for Phase 1 (research §8.5 rejects for ingestion; analogously applies to staleness).
- **Flag, not auto-remove** — Staleness is a governance signal, not an auto-delete trigger. Atlan (2026): "Engineering fixes like re-indexing treat symptoms — not the ungoverned source." The operator decides: re-ingest, mark as still-current, or delete. Auto-removal risks losing compliance-relevant documents that are still current but haven't been re-verified (research §7.3.2).
- **Optional retrieval down-ranking (0.8 multiplier)** — Stale chunks may still be the best available answer; down-ranking (not filtering) preserves recall while signaling lower confidence. Tianpan (2026): "Alert when the percentage of retrieved chunks exceeding their freshness threshold spikes." The 0.8 multiplier is a Phase 1 default, tunable per tenant (research §7.3.2, §18 #4).
- **`lastVerifiedAt` vs `lastIngestedAt` distinction** — "Verified" (we checked the file) is the staleness signal; "Ingested" (we re-parsed and re-chunked) is the versioning signal (ADR-034). A document can be verified daily (no change) but ingested rarely (only when content changes) — staleness uses `lastVerifiedAt`.
- **Per-document override at ingestion** — A rate sheet with a known 3-day volatility gets `freshnessTtlDays=3` at ingestion, overriding the document-type default of 7. Critical for high-volatility documents (research §7.3.3).
- **`AuditEvent` (`KNOWLEDGE_STALE`) reuses existing infrastructure** — No new audit table; Stream 8 (Security & Governance) consumes the events for compliance reporting (research §7.3.2, ADR-001).
- **"Mark as still current" human-in-the-loop** — The operator can confirm a document is still accurate without re-ingestion. Emits `KNOWLEDGE_VERIFIED_MANUAL` `AuditEvent` for auditability. This is the governance action — staleness is a prompt for review, not an automatic action (research §7.3.2).
- **Restate workflow orchestration** — Nightly sweep + "mark as still current" are Restate workflows — durable, resumable, observable. No new orchestrator (ADR-001).
- **Stale embeddings degrade retrieval accuracy by up to 20%** — Atlan (2026): "Stale embeddings can degrade RAG retrieval accuracy by up to 20%." Staleness tracking is not optional — it's a correctness concern (research §7.3.1).
- **Rejecting auto-remove (Option A)** — Risks losing compliance-relevant documents; staleness is a governance signal (research §7.3.2).
- **Rejecting full re-indexing on staleness (Option B)** — Wasteful (ADR-034 §3 Option A); staleness triggers re-verification (re-hash check), not full re-index (research §7.3.2, ADR-034).
- **Rejecting real-time streaming (Option C)** — Overkill for hotel scale; nightly Restate sweep is sufficient (research §8.5).
- **Rejecting no staleness tracking (Option D)** — Risk R-3.8 (High/High): stale SOP leads to outdated answers. AI-BOS classifies freshness as NOW (research §7.3.1).

## 6. Consequences

**Positive**:

- Per-document TTL reflects hotel-document-practice — rate sheets (7d), manuals (730d), policies (365d).
- Nightly Restate sweep catches all stale documents; `AuditEvent` (`KNOWLEDGE_STALE`) provides full visibility.
- Flag-not-auto-remove preserves compliance-relevant documents; operator decides.
- Optional retrieval down-ranking (0.8 multiplier) signals lower confidence without losing recall.
- "Mark as still current" human-in-the-loop governance action with audit trail.
- `KnowledgeStore.getStaleDocuments(tenantId)` SDK method enables UI "Needs review" section.
- Per-document override at ingestion handles high-volatility documents.
- Reuses existing `AuditEvent` table and Restate orchestrator — no new infrastructure.
- Per-chunk staleness indicator in the chat citation sidebar — transparency for the user.

**Negative / obligations**:

- Phase 1 must implement the nightly Restate sweep workflow + UI staleness badges + "Mark as still current" action — estimated 2–3 days (research §13.3).
- The nightly sweep must be per-tenant (thread `tenantId` per ADR-027/031) — no cross-tenant queries.
- The retrieval down-ranking (0.8 multiplier) is default ON — may surprise users who expect stale chunks to be filtered entirely. Mitigation: UI "stale" badge; tunable per tenant via `FeatureFlag`.
- The "Mark as still current" action can be abused (operator marks everything as current to dismiss alerts) — mitigation: `AuditEvent` (`KNOWLEDGE_VERIFIED_MANUAL`) records who marked what when; Stream 8 may audit.
- `lastVerifiedAt` is updated on every re-ingestion attempt — a document that is re-ingested daily (chokidar watch on a frequently-touched file) never goes stale, even if the content hasn't changed. Mitigation: this is correct behavior (the document IS being verified daily); the staleness signal is about _verification_, not _content change_.
- Per-document-type default TTLs are Phase 1 defaults — must be tuned based on real hotel-document review cycles; per-tenant configurable.
- The staleness sweep query `WHERE lastVerifiedAt + freshnessTtlDays < now()` is a full table scan per tenant — for large corpora (>100K documents), this may be slow. Mitigation: `@@index([tenantId, lastVerifiedAt])` (ADR-028 §9); batch the scan.
- Stale chunks may still appear in retrieval results (down-ranked, not filtered) — the UI must surface the "stale" badge transparently.
- The 0.8 multiplier is a Phase 1 default — must be tuned based on real evaluation (research §18 #4 open question).
- Risk R-3.8 (High/High) — stale SOP leads to outdated answers — is mitigated but not eliminated. The operator must act on staleness alerts; the system cannot force re-ingestion.

**Dependencies on other ADRs**:

- Depends on ADR-028 (Knowledge Base Architecture) — `KnowledgeDocument.lastVerifiedAt` + `freshnessTtlDays` + `lastIngestedAt`; `@@index([tenantId, lastVerifiedAt])`; `KnowledgeStore.getStaleDocuments(tenantId)` SDK method.
- Depends on ADR-034 (Versioning & Incremental Re-index) — `lastVerifiedAt` updated on every re-ingestion attempt (even no-op); `lastIngestedAt` updated on content-changing re-ingestion.
- Depends on ADR-024 (Hybrid Search) — `Retriever` applies the 0.8 down-ranking multiplier to stale chunks.
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — nightly sweep is per-tenant; `tenantId` mandatory.
- Depends on ADR-031 (Knowledge Isolation) — staleness query threads `tenantId` + `propertyId` + `department`.
- Depends on ADR-001 (Reference Stack) — Restate workflow orchestrator; `AuditEvent` existing table.
- Depends on ADR-005 (Prisma) for schema management; ADR-006 (SQLite) for persistence.
- Feeds ADR-030 (RAG Pipeline) — `RetrievedChunk` may carry a `stale: boolean` flag; UI shows "stale" badge on citations.
- Feeds ADR-032 (Source Attribution & Citation) — citations include staleness indicator.
- Feeds Stream 8 (Security & Governance) — `KNOWLEDGE_STALE` + `KNOWLEDGE_VERIFIED_MANUAL` `AuditEvent`s are compliance signals.
- Compatible with ADR-013 (Observability Strategy) — staleness sweep operations are traced (tenantId, staleCount, sweepDurationMs).

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A stale SOP leads to an outdated answer in production** (research risk R-3.8) — root-cause analysis; tighten the TTL defaults; evaluate auto-re-ingestion (Option B) for high-risk document types (`COMPLIANCE`, `POLICY`).
2. **The nightly sweep is too slow** for large corpora (>100K documents per tenant) — batch the scan; parallelize per tenant; evaluate a real-time streaming approach (Option C).
3. **The 0.8 down-ranking multiplier proves miscalibrated** (stale chunks still dominate results) — tune the multiplier; evaluate filtering (not down-ranking) for very-stale chunks (>2× TTL).
4. **Operators abuse "Mark as still current"** (mark everything current to dismiss alerts) — add a review-approval workflow; restrict the action to specific roles; audit via Stream 8.
5. **Per-document-type default TTLs prove miscalibrated** (e.g., SOPs reviewed quarterly, not semi-annually) — tune the defaults; per-tenant configurable.
6. **A new document type** (e.g., `EMERGENCY_PROTOCOL`) is added — assign a TTL; verify the default.
7. **A compliance-driven deployment requires longer staleness tracking** (e.g., 10-year retention with staleness alerts) — extend the `AuditEvent` retention; verify the sweep query performance.
8. **Real-time staleness streaming becomes justified** (e.g., a rate-sheet-heavy deployment needs sub-day TTL) — evaluate a Kafka-style streaming approach (Option C) for high-volatility document types.
9. **The staleness sweep crosses tenant boundaries** (bug) — root-cause analysis; tighten the per-tenant scoping (ADR-027/031); add automated leak-detection tests.
10. **Annually**, as part of the regular ADR review cycle.
