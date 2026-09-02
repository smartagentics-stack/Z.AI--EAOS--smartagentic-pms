# ADR-042: Memory Retention & Decay

**ADR-ID:** ADR-042
**Status:** ACCEPTED
**Context:** 2026-09-01
**Owner:** Architecture Office

---

## 1. Context

ADR-038 (AI Memory Architecture) and ADR-040 (Storage) established that every `MemoryRecord` and `MemoryEvent` carries lifecycle fields (`expiresAt`, `retentionExpiresAt`, `retentionPolicy`, `halfLifeDays`, `lastConfirmedAt`, `timesRetrieved`, `timesRetrievedAndConfirmed`, `importance`, `deletedAt`). ADR-039 (Taxonomy) established the 7-category contract where each category has a different lifecycle. Phase C Stream 4 research (`/home/z/my-project/phase-c-stream4-ai-memory-report.md`, §10) details the retention and decay machinery that makes memory forget gracefully — "Forgetting is a feature" (research §21 design principle #3).

The research (§10.1) cites the design guide's TTL ladder: "Raw working-memory snapshots, intermediate tool outputs — Session-scoped; gone at session end. Raw episodes (transcripts, event logs) — Short TTL (days to a few months), driven by debugging and compliance needs. Episode summaries — Medium TTL; cheaper to keep than raw, still ages. Semantic facts — No fixed TTL; governed by staleness checks and supersession. Preferences — No TTL; revised by supersession when the user changes them. Procedures — Never TTL'd; versioned and deprecated explicitly."

The research (§10.1) also cites the Ebbinghaus forgetting curve (Murre & Dros, PMC4492928, 2015): "We replicated the experiment that yielded the famous forgetting curve describing forgetting over intervals ranging from 20 minutes to 31 days." And the design guide's usage-based decay formula: `effective_score = similarity * recency_factor * reinforcement * confidence` where `recency_factor = 0.5^(age_days/half_life_days)`. The key insight: "Decay the score, not the data — a low effective score demotes a record in retrieval ranking, and only sustained irrelevance (score below threshold for a long period, never retrieved) queues it for archival. This keeps decay reversible."

The subtle but critical distinction (research §10.1, design guide): "Reinforce on confirmation, not on retrieval alone: a record that gets retrieved and then contradicted by the session should have its confidence cut, not its recency refreshed. Touching `last_confirmed_at` only when the memory proved correct turns ordinary agent operation into a continuous, free validation signal."

Hotel/tax retention context (research §10.1): "Financial and accounting records — invoices, payment records and tax documentation are typically retained for 5 to 7 years, as required by tax law." This creates a tension with GDPR Art 17 (right to erasure) that is resolved by legal-basis tagging (`retentionPolicy='TAX_7Y'`) per GDPR Art 17(3)(b) "legal obligation" exemption — detailed in ADR-043.

## 2. Problem

The architectural problem: **define the memory retention and decay contract that (a) adopts a tiered TTL ladder — working=session, conversational=session (raw turns already in MemoryEvent), episodic raw events=180d, episodic summaries=365d, semantic=no-TTL (staleness+supersession), user=no-TTL (supersession), agent=no-TTL (supersession), procedural playbooks=never (versioned), procedural candidates=90d (auto-archive if not promoted), MemoryAccessLog=7y (audit) — configurable per tenant via `SystemConfig` but only by admin; (b) adopts Ebbinghaus-style decay scoring at retrieval time (NOT at storage time) — `effectiveScore = similarityScore * recencyFactor * reinforcement * confidence` where `recencyFactor = 0.5^(ageDays/halfLifeDays)`; half-life defaults episodic=30d, semantic=180d, user=365d, agent=90d, configurable per record; (c) applies "decay the score, not the data" — a low score demotes in retrieval ranking; the record is NOT deleted; records with `effectiveScore < 0.1` for 90 consecutive days are queued for archival (Phase 2+); (d) reinforces on confirmation (not retrieval alone) — `lastConfirmedAt` bumped only when a retrieved memory proved correct (the session used it and did not contradict it); `timesRetrievedAndConfirmed` increments only on confirmed retrieval; if the session contradicts the memory, `confidence` is cut by 0.2 (configurable) and `lastConfirmedAt` is NOT bumped — this prevents the "popularity contest" failure mode where wrong but frequently-retrieved records dominate; (e) adopts composite importance scoring — `importance = 0.4 * confidence + 0.3 * recencyFactor + 0.2 * reinforcement + 0.1 * sourceWeight` where sourceWeight: USER_STATED=1.0, ADMIN_DECLARED=0.9, EXTRACTED=0.6, INFERRED=0.4, SYSTEM=0.3 — used for retention priority, retrieval ranking, and the procedural promotion pipeline (ADR-045); (f) ships a nightly Restate retention sweep that hard-deletes `MemoryEvent` rows where `retentionExpiresAt < now` AND `retentionPolicy != 'TAX_7Y'`, hard-deletes `MemoryRecord` rows where `expiresAt < now`, archives low-importance records (Phase 2+), auto-archives procedural candidates older than 90d, deletes `MemoryAccessLog` rows older than 7y, and emits `AuditEvent` for all deletions; (g) applies the tax-retention legal-basis tag (`retentionPolicy='TAX_7Y'`) at write time based on event type (invoice events auto-tagged), exempts those events from the 180-day TTL, and applies a "soft-block" on GDPR erasure (anonymize userId, retain content for tax audit, exclude from agent retrieval) per GDPR Art 17(3)(b) — detailed in ADR-043; (h) reserves archival (Phase 2+) — archived records moved to a separate `MemoryArchive` table (compressed JSON) or a separate SQLite file per tenant, restorable for incident response; Phase 1 ships the TTL sweep (hard-delete); Phase 2+ ships archival (soft-archive then hard-delete after additional period); (i) makes the asymmetry deliberate — TTLs apply hardest to the bulky, low-density layers (raw events); the distilled layers (semantic, user, procedural) are governed by smarter mechanisms (staleness, supersession, versioning); (j) makes forgetting reversible where possible — decay is reversible (a low-scoring record can be reinforced by later confirmation); deletion is not; and (k) feeds ADR-043 (Deletion & GDPR) — the TTL sweep and the tax-retention tag are the substrate for GDPR Art 17 compliance.** This ADR is the retention companion to ADR-038; it is the Stream 4 analog of Stream 3's ADR-035 (Freshness & Staleness).

## 3. Options

### Option A: No TTL (remember everything forever)

Store all memory indefinitely; no automated deletion. **Rejected** — research §10.5: "Forgetting nothing" is listed as a Common Pitfall. Storage grows unbounded; retrieval returns mostly noise; compliance constraints violated (GDPR Art 5 data minimization; tax-retention legal-basis requirements). The design guide is explicit that raw episodic data should always carry a TTL.

### Option B: TTL on everything (including semantic facts and user preferences)

Apply a fixed TTL to every memory record regardless of type. **Rejected** — research §10.5: "Expiring the extracted fact because a calendar said so is arbitrary" (design guide). Semantic facts need staleness checks + supersession, not TTL — a fact like "guest prefers high-floor rooms" should not expire because 365 days passed; it should be superseded when the user states a new preference. User preferences same. Procedural playbooks same (versioned, deprecated explicitly, never TTL'd).

### Option C: Delete on decay (instead of demoting score)

When `effectiveScore` drops below a threshold, delete the record. **Rejected** — research §10.5: decay becomes irreversible; a record that was temporarily irrelevant (e.g., seasonal preference — "guest prefers poolside in summer") is permanently lost. "Decay the score, not the data" is the consensus. Reversibility matters: a low-scoring record can be reinforced by later confirmation.

### Option D: Reinforce on retrieval (instead of confirmation)

Bump `lastConfirmedAt` and increment `timesRetrievedAndConfirmed` every time a record is retrieved, regardless of whether the session used it correctly. **Rejected** — research §10.5: "Popularity contest" failure mode — wrong but frequently-retrieved records dominate. A MemoryGraft attack (research §12.1) that plants a fabricated "successful experience" would be reinforced by every retrieval. Reinforcement on confirmation is the correct signal — the session must use the memory AND not contradict it.

### Option E: Manual retention policies (admin sets per-record TTL)

Admin reviews each memory record and sets a custom TTL. **Rejected** — research §10.5: doesn't scale; admin can't review millions of records. Default ladder + per-tenant config is the right granularity. Admin intervention is reserved for edge cases (legal-hold on a specific user's memory during an investigation).

### Option F: Tiered TTL ladder + Ebbinghaus decay scoring (at retrieval time, decay the SCORE not the data) + reinforcement on confirmation + composite importance scoring + nightly Restate retention sweep + tax-retention legal-basis tag + Phase 2+ archival reserved

Tiered TTL ladder per memory type (working=session, episodic=180d, summaries=365d, semantic/user/agent=no-TTL, procedural=never, access-logs=7y). Ebbinghaus decay scoring at retrieval time. Reinforcement on confirmation (not retrieval alone). Composite importance scoring. Nightly Restate retention sweep. Tax-retention legal-basis tag (`retentionPolicy='TAX_7Y'`) exempts invoice/tax events from TTL. Archival reserved for Phase 2+. Per research §10.

## 4. Decision

Adopt **Option F**. The Memory Retention & Decay architectural contract is:

1. **Tiered TTL ladder** (research §10.2) — default per memory type, configurable per tenant via `SystemConfig` (admin-only):

   | Memory type                                                 | Default TTL                                         | Notes                                                                                                         |
   | ----------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
   | Working (`type='WORKING'`, `scope='SESSION'`)               | End of session                                      | Deleted at session end (or promoted to episodic if consequential)                                             |
   | Conversational (`type='CONVERSATIONAL'`, `scope='SESSION'`) | End of session (raw turns already in `MemoryEvent`) | The summary may be promoted to `UserMemory`                                                                   |
   | Episodic raw events (`MemoryEvent`)                         | 180 days                                            | Configurable; tax-tagged events (`retentionPolicy='TAX_7Y'`) exempt — 7-year retention on tax-law legal basis |
   | Episodic summaries (extracted from events)                  | 365 days                                            | Medium TTL; cheaper to keep than raw                                                                          |
   | Semantic facts (`type='SEMANTIC'`)                          | No TTL                                              | Governed by staleness checks + supersession                                                                   |
   | User preferences (`type='USER'`)                            | No TTL                                              | Revised by supersession when user changes them; deleted on GDPR Art 17 request                                |
   | Agent learned patterns (`type='AGENT'`)                     | No TTL                                              | Revised by supersession; deleted when agent is decommissioned                                                 |
   | Procedural playbooks (files)                                | Never                                               | Versioned and deprecated explicitly, never TTL'd                                                              |
   | Procedural candidates (files)                               | 90 days                                             | Auto-archive if not promoted                                                                                  |
   | Memory access logs (`MemoryAccessLog`)                      | 7 years                                             | Audit retention (legal basis: legitimate interest for security/incident response)                             |

2. **Ebbinghaus decay scoring at retrieval time** (research §10.2) — applied at retrieval, NOT at storage:

   ```typescript
   effectiveScore(record, similarityScore, now) {
     const ageDays = (now - record.lastConfirmedAt) / (1000 * 60 * 60 * 24);
     const recencyFactor = Math.pow(0.5, ageDays / record.halfLifeDays);
     const reinforcement = Math.min(1.0, 0.6 + 0.1 * record.timesRetrievedAndConfirmed);
     return similarityScore * recencyFactor * reinforcement * record.confidence;
   }
   ```
   - `halfLifeDays` defaults: episodic=30, semantic=180, user=365, agent=90 (configurable per record).
   - "Decay the score, not the data" — a low score demotes in retrieval ranking; the record is NOT deleted.
   - Records with `effectiveScore < 0.1` for 90 consecutive days are queued for archival (Phase 2+; Phase 1 just logs them).

3. **Reinforcement on confirmation** (research §10.2; not retrieval alone):
   - `lastConfirmedAt` is bumped only when a retrieved memory proved correct (the session used it and did not contradict it).
   - `timesRetrievedAndConfirmed` increments only on confirmed retrieval.
   - If the session contradicts the memory, `confidence` is cut by 0.2 (configurable) and `lastConfirmedAt` is NOT bumped.
   - This turns ordinary agent operation into a continuous, free validation signal (per the design guide) and prevents the "popularity contest" failure mode (research §10.5 Option D rejection).
   - This is also the MemoryGraft defense (research §12.2): a grafted "successful experience" that doesn't match real outcomes has its confidence cut.

4. **Composite importance scoring** (research §10.2) — stored on each `MemoryRecord`:
   - `importance = 0.4 * confidence + 0.3 * recencyFactor + 0.2 * reinforcement + 0.1 * sourceWeight`
   - `sourceWeight`: USER_STATED=1.0, ADMIN_DECLARED=0.9, EXTRACTED=0.6, INFERRED=0.4, SYSTEM=0.3
   - Used for: retention priority (when storage budget is tight, low-importance records archived first), retrieval ranking (boost high-importance in ties), and the procedural promotion pipeline (ADR-045 — high-importance episodic patterns are candidate procedures).

5. **Nightly Restate retention sweep** (research §10.2) — runs nightly per tenant:
   1. Hard-delete `MemoryEvent` rows where `retentionExpiresAt < now` AND `retentionPolicy != 'TAX_7Y'`.
   2. Hard-delete `MemoryRecord` rows where `expiresAt < now` (only records with explicit `expiresAt`; most don't have one).
   3. Archive `MemoryRecord` rows where `effectiveScore < 0.1` for 90 consecutive days (Phase 2+ — Phase 1 just logs them).
   4. Auto-archive procedural candidates older than 90 days (move to `procedures/archive/{tenantId}/`).
   5. Emit `AuditEvent` for all deletions (per ADR-047).
   6. Update `MemoryAccessLog` retention (delete logs older than 7 years).

6. **Tax-retention legal-basis tag** (`retentionPolicy='TAX_7Y'`) (research §10.2, §4.2):
   - Applied at write time based on event type — invoice events (`INVOICE_GENERATED`, payment processing, refund issuance, tax reporting) auto-tagged `retentionPolicy='TAX_7Y'`.
   - Exempts those events from the 180-day TTL — 7-year retention on tax-law legal basis (GDPR Art 17(3)(b) "legal obligation" exemption).
   - Admin can override (rare; legal review required — research Open Question #5).
   - On GDPR Art 17 erasure request, tax-retention events are NOT deleted; instead, they are "soft-blocked" — the `userId` field is anonymized to a one-way hash, the content is retained for tax audit, but the record is no longer retrievable into agent context (detailed in ADR-043).

7. **Archival reserved for Phase 2+** (research §10.2):
   - Archived records moved to a separate `MemoryArchive` table (compressed JSON) or a separate SQLite file per tenant.
   - Restorable for incident response.
   - Phase 1 ships the TTL sweep (hard-delete); Phase 2+ ships archival (soft-archive then hard-delete after additional period).
   - 30-day grace-period reconstruction from `MemoryAccessLog` (deleted records can be reconstructed from logs within 30 days) — Phase 2+ (research R-10.1 mitigation).

8. **Deliberate asymmetry** (research §10.3) — TTLs apply hardest to the bulky, low-density layers (raw events: 180d); the distilled layers (semantic, user, procedural) are governed by smarter mechanisms (staleness checks, supersession, versioning). "The asymmetry is deliberate."

9. **Reversibility where possible** (research §10.3) — decay is reversible (a low-scoring record can be reinforced by later confirmation); deletion is not. This matches how human memory works (forgotten but not gone, until truly pruned). The 30-day soft-delete grace period (ADR-043) is the deletion-side reversibility.

## 5. Rationale

- **The TTL ladder is the cheapest forgetting mechanism** — research §10.3: "the one with the least excuse for absence." Raw episodic data should always carry a TTL. The design guide is explicit. GDPR Art 5 data minimization requires it.
- **Ebbinghaus decay scoring is grounded in 140+ years of cognitive psychology** — research §10.1: Murre & Dros (PMC4492928, 2015) replicated the forgetting curve; "Ebbinghaus demonstrated that memory follows a predictable exponential decay: roughly 50% of new information is lost within the first hour after learning." The `recency_factor = 0.5^(age_days/half_life_days)` formula is simple, implementable, and grounded in the literature. Also cited: "Self-evolving Agents with reflective and memory-augmented abilities. We introduce a memory optimization mechanism based on the Ebbinghaus forgetting curve" (arXiv:2409.00872).
- **"Decay the score, not the data" is the consensus** — research §10.1, §10.5: a low-scoring record can be reinforced by later confirmation; deletion is permanent. This matches how human memory works. The FadeMem architecture (research §10.1) "retains more of what matters while using 45% less storage" via "dual layers, importance scoring, decay-based forgetting."
- **Reinforcement on confirmation is the subtle but critical distinction** — research §10.1, §10.5: "a record that gets retrieved and then contradicted by the session should have its confidence cut, not its recency refreshed." This prevents the "popularity contest" failure mode and is the MemoryGraft defense (a grafted "successful experience" that doesn't match real outcomes has its confidence cut).
- **Hotel tax retention is a legal obligation overriding GDPR Art 17** — research §10.1, §4.3: "Financial and accounting records — invoices, payment records and tax documentation are typically retained for 5 to 7 years, as required by tax law." GDPR Art 17(3)(b) explicitly allows retention for legal obligations. The `retentionPolicy='TAX_7Y'` tag is the mechanism; the soft-block (anonymize userId, retain content, exclude from retrieval) is the compromise. "A 7 year retention policy is not a GDPR rule. It usually comes from other legal or regulatory requirements such as tax, accounting, employment" (research §10.1).
- **The asymmetry is deliberate** — research §10.3: TTLs apply hardest to bulky low-density layers (raw events); distilled layers (semantic/user/procedural) are governed by smarter mechanisms. "Expiring the extracted fact because a calendar said so is arbitrary" (design guide).
- **Composite importance scoring serves three purposes** — research §10.2: retention priority (low-importance archived first), retrieval ranking (boost high-importance in ties), procedural promotion (high-importance episodic patterns are candidate procedures). The `sourceWeight` dimension encodes that USER_STATED facts are more trustworthy than INFERRED facts.
- **Nightly Restate sweep is the operational mechanism** — research §10.2: the existing Restate infrastructure (ADR-008, ADR-030) runs the sweep nightly per tenant; emits `AuditEvent` for all deletions (ADR-047); the sweep is idempotent and crash-safe (Restate durable workflows).
- **Rejecting no-TTL (Option A)** — research §10.5: storage grows unbounded; retrieval returns noise; compliance violated.
- **Rejecting TTL-on-everything (Option B)** — research §10.5: arbitrary for distilled layers; staleness+supersession is the right mechanism for semantic/user/procedural.
- **Rejecting delete-on-decay (Option C)** — research §10.5: irreversible; seasonal preferences lost.
- **Rejecting reinforce-on-retrieval (Option D)** — research §10.5: popularity contest; MemoryGraft attack vector.
- **Rejecting manual retention (Option E)** — research §10.5: doesn't scale.

## 6. Consequences

**Positive**:

- Memory forgets gracefully — TTL ladder + Ebbinghaus decay + importance scoring. "Forgetting is a feature" (research §21 design principle #3).
- Storage stays bounded — raw events TTL'd at 180d; access logs at 7y; distilled layers governed by staleness/supersession (not bulk).
- Retrieval ranking reflects recency + reinforcement + confidence — not just similarity. Wrong-but-frequently-retrieved records are demoted (MemoryGraft defense).
- Tax-retention legal-basis tag resolves the GDPR Art 17 vs tax-law tension — invoice/tax events retained 7y on tax-law legal basis, soft-blocked from agent retrieval.
- Nightly Restate sweep is automated, idempotent, crash-safe, and audited (emits `AuditEvent`).
- Importance scoring feeds the procedural promotion pipeline (ADR-045) — high-importance episodic patterns become candidate procedures.
- Reversibility where possible — decay is reversible; 30-day soft-delete grace period (ADR-043) is the deletion-side reversibility.
- Phase 2+ archival reserved — restorable for incident response.

**Negative / obligations**:

- TTL misconfiguration can delete data that should have been retained — research R-10.1 (Medium): mitigation = conservative defaults, admin-only config, `AuditEvent` on all deletions, 30-day grace-period reconstruction from logs (Phase 2+).
- Decay-scoring half-life values may be wrong for hotel domain — research R-10.2 (Low): mitigation = configurable per record; defaults from design guide; Promptfoo-style eval on retrieval quality over time.
- Tax-retention tag may be misapplied — research R-10.3 (Medium): mitigation = auto-tag at write time based on event type; admin override; legal review in Phase D (Open Question #5).
- The nightly Restate sweep must be maintained — a bug in the sweep could mass-delete or mass-retain. Integration tests required; dry-run mode for config changes.
- The `effectiveScore` computation at retrieval time adds CPU overhead per retrieval — at hotel scale (1M records per tenant, topK=50 retrieved), this is ~50 multiplications per retrieval; negligible.
- The `lastConfirmedAt` / `timesRetrievedAndConfirmed` update on confirmation requires the consolidation workflow (§4 of report) to detect contradictions — this is a non-trivial LLM call per session; Phase 1 ships a heuristic (keyword contradiction), Phase 2+ ships LLM-based contradiction detection.
- Phase 2+ archival adds a `MemoryArchive` table or per-tenant archive SQLite file — operational complexity; restorability tested.
- The tax-retention soft-block on GDPR erasure requires the extraction prompt to redact PII before storing — if PII is in the content, the soft-block fails to fully anonymize (research R-11.2). Mitigation = periodic PII-pattern scan (Phase 2+).

**Dependencies on other ADRs**:

- Depends on ADR-008 (Event-Driven) — Restate durable workflows for nightly sweep.
- Depends on ADR-030 (RAG Pipeline) — Restate workflow pattern; consolidation workflow.
- Depends on ADR-033 (Confidence Scoring) — `confidence` field on every `MemoryRecord`; `CoverageConfidence` reused.
- Depends on ADR-035 (Freshness & Staleness) — staleness-check pattern (0.8 multiplier) reused for semantic facts.
- Depends on ADR-038 (AI Memory Architecture) — the lifecycle fields on `MemoryRecord`/`MemoryEvent`.
- Depends on ADR-039 (Memory Taxonomy) — the per-type TTL defaults.
- Depends on ADR-040 (Storage & Encryption) — the `expiresAt`/`retentionExpiresAt`/`retentionPolicy`/`halfLifeDays`/`lastConfirmedAt`/`timesRetrievedAndConfirmed`/`importance` fields.
- Feeds ADR-043 (Deletion & GDPR) — the TTL sweep and tax-retention tag are the substrate for GDPR Art 17 compliance; the 30-day soft-delete grace period is the deletion-side reversibility.
- Feeds ADR-044 (Security & Poisoning) — the reinforcement-on-confirmation mechanism is the MemoryGraft defense; the importance scoring feeds the write-gate trust scoring.
- Feeds ADR-045 (Procedural Memory Promotion) — high-importance episodic patterns are candidate procedures; the 90-day candidate auto-archive prevents candidate proliferation (research R-6.2).
- Feeds ADR-047 (Provenance & Audit) — the `AuditEvent` on all deletions; the 7-year `MemoryAccessLog` retention.
- Feeds Stream 8 (Security & Governance) — the retention sweep is a compliance surface; the tax-retention legal-basis tag is an audit surface.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A TTL misconfiguration deletes data that should have been retained** — root-cause the config error; verify the 30-day grace-period reconstruction (Phase 2+) would have recovered it; tighten the admin-only config validation.
2. **Decay-scoring half-life values are found to be wrong for hotel domain** (retrieval quality degrades over time) — evaluate per-record half-life tuning via ML (Phase 2+); verify the Promptfoo-style eval catches the regression.
3. **A tax-retention tag is misapplied** (invoice event TTL'd, or non-tax event tax-retained) — root-cause the auto-tag logic; verify the admin override; legal review (Open Question #5).
4. **A MemoryGraft-style attack is detected** (a grafted "successful experience" dominating retrieval) — verify the reinforcement-on-confirmation mechanism cut its confidence; verify the consolidation workflow detected the contradiction; consider Phase 2+ anomaly detection acceleration.
5. **The nightly Restate sweep fails or runs too slowly** — root-cause the workflow; verify idempotency; consider partitioning the sweep by tenant or by memory type.
6. **Phase 2+ archival is needed** (storage budget tight; low-importance records accumulating) — evaluate the `MemoryArchive` table vs per-tenant archive SQLite file; verify restorability; benchmark the archival sweep.
7. **A new memory type is added** (e.g., a new industry pack beyond hotels) — verify the TTL ladder accommodates the new type; verify the half-life defaults are appropriate; verify the importance-scoring sourceWeight enum accommodates new source kinds.
8. **A legal-hold is needed** (e.g., a specific user's memory must be retained beyond TTL during an investigation) — verify the admin override mechanism; verify the legal-hold tag exempts the record from the sweep; verify the `AuditEvent` records the legal-hold.
9. **The consolidation workflow's contradiction-detection heuristic (Phase 1) is insufficient** — evaluate Phase 2+ LLM-based contradiction detection; benchmark the LLM call overhead per session.
10. **Annually**, as part of the regular ADR review cycle.
