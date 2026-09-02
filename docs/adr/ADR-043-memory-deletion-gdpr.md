# ADR-043: Memory Deletion & GDPR

**ADR-ID:** ADR-043
**Status:** ACCEPTED
**Context:** 2026-09-01
**Owner:** Architecture Office

---

## 1. Context

ADR-038 (AI Memory Architecture) established the substrate. ADR-039 (Taxonomy) established that user memory is the most privacy-sensitive and most regulated type. ADR-042 (Retention & Decay) established the TTL ladder and the tax-retention legal-basis tag. Phase C Stream 4 research (`/home/z/my-project/phase-c-stream4-ai-memory-report.md`, §11) details the GDPR-compliant deletion machinery.

GDPR Article 17 (Right to Erasure) (research §11.1) is the canonical reference: "The data subject shall have the right to obtain from the controller the erasure of personal data concerning him or her without undue delay and the controller shall have the obligation to erase personal data without undue delay." GDPR Articles 15 (right of access), 16 (right to rectification), 20 (data portability), and 5 (data minimization) are companion rights that all apply directly to AI memory (research §11.1, Mem0 security blog).

The research (§11.1) documents the hard problem: "Once personal data is used to train an AI model, is deletion even possible? AI's 'Memory' is Not Like a Database. Once a model has learned from data, it's in the weights." And: "GDPR gave us the 'Right to be Forgotten' back in 2018. Seven years later, we're facing an uncomfortable truth: AI fundamentally cannot comply." The European Data Protection Board's latest guidance (research §11.1) "confirms that individuals can request deletion and other rights whenever AI processes their data."

The critical insight (research §11.3): the "AI fundamentally cannot comply" critique applies to **model weights** (data used to train a model is genuinely unrecoverable). SmartAgentics does NOT train models (per ADR-001 — local inference of pre-trained models only, no fine-tuning). Therefore, the "model weights" problem does not apply — all AI memory in SmartAgentics is in queryable storage (SQLite + sqlite-vec), not in model weights. This is a significant compliance advantage of the offline-pre-trained-model approach over a fine-tuning approach.

The cascading-delete requirement (research §11.1, design guide) is explicit: "Keep deletion actually deletable — a user-deletion request must reach the vector index entries, the system-of-record rows, and any summaries derived from that user's episodes, which is only tractable if records carry attribution linking derived memories back to their sources." This is why provenance is mandatory at write time (ADR-047) — without `provenance.sourceEventIds` backlinks, a `forgetUser(userId)` cannot find derived memories.

The sqlite-vec deletion performance (research §11.1) is the technical enabler: "sqlite-vec vec0 stores vectors in a vec0 virtual table. This is good for OLTP workloads as UPDATE / INSERT / DELETE operations are fast, and maintains fast queries with chunked internal storage." If sqlite-vec required a full index rebuild on every delete (like the deprecated sqlite-vss), cascading deletes would be infeasible at scale. The choice of sqlite-vec (Stream 2, ADR-023) pays off here.

## 2. Problem

The architectural problem: **define the memory deletion and GDPR compliance contract that (a) supports GDPR Art 15 (Right of access) via `exportUserMemory(userId)` — returns all `MemoryRecord` and `MemoryEvent` rows where `userId=?` as JSON, including provenance, timestamps, confidence; (b) supports GDPR Art 16 (Right to rectification) via `updateMemory(recordId, newContent)` — creates a supersession chain (the old content is preserved in the chain for audit but excluded from retrieval); (c) supports GDPR Art 17 (Right to erasure) via `forgetUser(userId)` — cascading delete with 30-day grace period; (d) supports GDPR Art 20 (Data portability) via `exportUserMemory(userId)` — same as Art 15, JSON format, machine-readable; (e) supports GDPR Art 5 (Data minimization) at the write gate — PII redaction (ADR-039 §7), RBAC (ADR-041), TTL (ADR-042); (f) implements `forgetUser(userId)` as a cascading delete: identify source episodes → identify derived memories (via `provenance.sourceEventIds` intersection) → identify `MemoryAccessLog` entries → identify procedural candidates promoted from this user's episodes → soft-delete (30-day grace) → hard-delete (sqlite-vec fast DELETE + FTS5 + relational + `MemoryAccessLog`); (g) applies the tax-retention exception — `MemoryEvent` rows tagged `retentionPolicy='TAX_7Y'` are NOT deleted; instead, they are "soft-blocked" (the `userId` field is anonymized to a one-way hash, the content is retained for tax audit, but the record is no longer retrievable into agent context) per GDPR Art 17(3)(b) "legal obligation" exemption; (h) ships a 30-day grace period — soft-delete (`deletedAt = now()`) excludes from retrieval but allows recovery from accidental deletion or fraudulent requests; after 30 days, hard-delete via a nightly Restate sweep; (i) prohibits agent-initiated deletion of user memory — agents do NOT have `memory:delete` permission for any scope other than their own `AGENT_PRIVATE` memory; deletion of user memory is user-initiated or admin-initiated only; (j) supports bulk deletion via PMS admin UI — "delete all memory for users who haven't been active in 365 days" (configurable); this is the "bulk deletion" control Microsoft SFI requires; (k) returns a `DeletionReport` from `forgetUser(userId)` listing all deleted record IDs, counts by type, tax-retained count, and a verification query (`SELECT COUNT(*) FROM MemoryRecord WHERE userId=? AND deletedAt IS NULL` returns 0) — the audit evidence that deletion succeeded; (l) handles procedural playbooks promoted from a deleted user's episodes — validated playbooks are independent of their source (they were validated by replay/repetition/review, not by the source user); provenance link is severed but the playbook remains; admin is notified for re-review; (m) leverages the "no model training" architectural decision (ADR-001) — all AI memory is in queryable storage, not in model weights; the "machine unlearning" problem does not apply; and (n) feeds Stream 8 (Security & Governance) — GDPR Art 17 compliance is non-negotiable for EU deployment of AI-BOS; the cascading-delete pattern is the universal erasure machinery.** This ADR is the deletion/GDPR companion to ADR-038; it is the Stream 4 analog of Stream 3's ADR-034 (Versioning & Incremental Re-index) in that both deal with destructive operations on the storage substrate.

## 3. Options

### Option A: Immediate hard-delete (no grace period)

On `forgetUser(userId)`, immediately hard-delete all records. **Rejected** — research §11.5: too dangerous — accidental deletions and fraudulent requests are unrecoverable. 30-day grace is the industry standard. GDPR's "without undue delay" is satisfied by 30 days (the standard interpretation).

### Option B: No tax-retention exception

Delete all records on `forgetUser(userId)`, including invoice/tax events. **Rejected** — research §11.5: violates tax law (5–7 year retention of invoice/financial records). GDPR Art 17(3)(b) explicitly allows legal-obligation exemptions. The soft-block (anonymize userId, retain content for tax audit, exclude from retrieval) is the compromise: data exists for the legal purpose but is not used for AI personalization.

### Option C: Anonymize instead of delete (replace userId with hash, keep all data)

On `forgetUser(userId)`, anonymize the `userId` field (one-way hash) but retain all content. **Rejected** — research §11.5: insufficient for GDPR Art 17 — anonymization is not erasure. Acceptable ONLY for tax-retention-exception events (where there is a separate legal basis). For all other events, the user has the right to actual erasure.

### Option D: Delete from relational but leave in vector store

Delete the `MemoryRecord` rows but leave the `vec0_memrecord` vectors. **Rejected** — research §11.5, design guide: "Keep deletion actually deletable — a user-deletion request must reach the vector index entries, the system-of-record rows, and any summaries derived from that user's episodes." Partial deletion is a compliance failure. The vector store would return orphaned vectors (or worse, vectors that match queries but have no relational record).

### Option E: Model weight "unlearning" (machine unlearning to remove a user's influence from a fine-tuned model)

Apply machine-unlearning techniques to remove the user's data influence from the model weights. **Rejected** — research §11.5, §11.3: SmartAgentics does not fine-tune models (ADR-001). All memory is in queryable storage. The "unlearning" problem does not apply. (This option is listed for completeness; it would be the only option if SmartAgentics fine-tuned on user data — which it does not.)

### Option F: No deletion API (manual SQL by admin on request)

Admin runs manual SQL to delete a user's memory on request. **Rejected** — research §11.5: doesn't scale; error-prone; no audit trail; violates "without undue delay" (admin may take weeks). A programmatic `forgetUser(userId)` API with a 30-day grace + audit is the right mechanism.

### Option G: GDPR Art 15/16/17/20 first-class operations + cascading delete via provenance backlinks + 30-day soft-delete grace + tax-retention soft-block + `DeletionReport` + bulk deletion + no-agent-delete + no-model-training advantage

`exportUserMemory(userId)` (Art 15/20), `updateMemory(recordId, newContent)` (Art 16 via supersession), `forgetUser(userId)` (Art 17 cascading delete with 30-day grace), write-gate minimization (Art 5). Cascading delete reaches relational + sqlite-vec + FTS5 + `MemoryAccessLog` + procedural candidates. Tax-retention legal-basis tag → soft-block. `DeletionReport` for audit evidence. Bulk deletion via admin UI. No agent-initiated user-memory deletion. No model training → no "machine unlearning" problem. Per research §11.

## 4. Decision

Adopt **Option G**. The Memory Deletion & GDPR architectural contract is:

1. **GDPR rights supported** (research §11.2) — all via PMS UI + API:
   - **Art 15 (Right of access)**: `exportUserMemory(userId)` returns all `MemoryRecord` and `MemoryEvent` rows where `userId=?` (or `agentId` for agent-data-access requests), as JSON. Includes provenance, timestamps, confidence.
   - **Art 16 (Right to rectification)**: `updateMemory(recordId, newContent)` updates a memory record (creates a supersession chain — the old content is preserved in the chain for audit, but excluded from retrieval per the `WHERE supersedes IS NULL` filter in ADR-041).
   - **Art 17 (Right to erasure)**: `forgetUser(userId)` cascading delete (see below).
   - **Art 20 (Data portability)**: `exportUserMemory(userId)` (same as Art 15) — JSON format, machine-readable.
   - **Art 5 (Data minimization)**: enforced at the write gate (PII redaction per ADR-039 §7; RBAC per ADR-041; TTL per ADR-042).

2. **`forgetUser(userId)` cascading delete** (research §11.2):
   1. Identify all `MemoryEvent` rows where `userId=?` → these are the source episodes.
   2. Identify all `MemoryRecord` rows where `userId=?` OR `provenance.sourceEventIds` intersects the source episodes → these are derived memories (extracted facts, preferences, summaries).
   3. Identify all `MemoryAccessLog` rows where `targetUserId=?` → these are access records (retained per audit policy; see step 6).
   4. Identify all procedural candidates promoted from this user's episodes (`provenance.promotedFrom` intersects source episodes) → flag for re-review (the candidate may need to be withdrawn; validated playbooks are NOT auto-deleted because they have been validated independently of the source user — but the provenance link is severed).
   5. **Soft-delete** (30-day grace period): set `deletedAt = now()` on all identified rows; exclude from retrieval (`WHERE deletedAt IS NULL`); emit `AuditEvent` (`type=MEMORY_SOFT_DELETE`, `userId`, `recordCount`).
   6. **Hard-delete** (after 30 days): `DELETE FROM MemoryEvent WHERE userId=? AND deletedAt < now() - 30 days`; `DELETE FROM MemoryRecord WHERE userId=? AND deletedAt < now() - 30 days`; delete corresponding rows from `vec0_memrecord` (sqlite-vec, fast per the verified evidence); delete corresponding rows from `memrecord_fts` (FTS5); delete corresponding rows from `MemoryAccessLog` where `targetUserId=?` (audit log entries that reference the user are also deleted — the user is forgotten, including from access logs — EXCEPT where retained on a different legal basis such as tax or security incident investigation).
   7. **Tax-retention exception**: `MemoryEvent` rows tagged `retentionPolicy='TAX_7Y'` are NOT deleted; instead, they are "soft-blocked" — the `userId` field is anonymized to a one-way hash, the content is retained for tax audit, but the record is no longer retrievable into agent context (a "soft block" — the data exists for tax audit but is not used for personalization). This is the GDPR Art 17(3)(b) "legal obligation" exemption.
   8. **Audit**: emit `AuditEvent` (`type=MEMORY_HARD_DELETE`, `userId`, `recordCount`, `taxRetainedCount`).

3. **30-day grace period** (research §11.2) — the soft-delete window allows recovery from accidental deletion (user clicked "Forget Everything" then changed their mind) and allows incident response (if the deletion request was fraudulent — e.g., a compromised account). During the grace period, the data is excluded from retrieval but still restorable. The privacy policy documents "we delete within 30 days of your request" (which satisfies GDPR's "without undue delay" — 30 days is the standard interpretation).

4. **Agent-initiated deletion prohibited for user memory** (research §11.2) — agents do NOT have `memory:delete` permission for any scope other than their own `AGENT_PRIVATE` memory (and even then, only within their own `agentId`). Deletion of user memory is a user-initiated or admin-initiated action only. This prevents a compromised agent from mass-deleting user memory.

5. **Bulk deletion** (research §11.2) — PMS admin UI supports bulk operations: "delete all memory for users who haven't been active in 365 days" (configurable). This is the "bulk deletion" control Microsoft SFI requires.

6. **sqlite-vec deletion performance** (research §11.2) — verified that sqlite-vec's UPDATE/INSERT/DELETE is fast (OLTP-optimized, chunked internal storage). Cascading deletes of vector rows are feasible at hotel scale (a typical user has 10–100 memory records; a bulk delete of 10K users = 100K–1M vector deletions, completing in seconds on SQLite).

7. **`DeletionReport` verification** (research §11.2) — `forgetUser(userId)` returns a `DeletionReport` listing all deleted record IDs, counts by type, tax-retained count, and a verification query (`SELECT COUNT(*) FROM MemoryRecord WHERE userId=? AND deletedAt IS NULL` returns 0). This is the audit evidence that deletion succeeded.

8. **Procedural playbooks from deleted users** (research §11.2, R-11.4) — validated playbooks are independent of their source (they were validated by replay/repetition/review, not by the source user); provenance link is severed but the playbook remains; admin is notified for re-review. The rationale: a playbook that has been independently validated has its own standing; deleting it because the source user requested erasure would be over-deletion (the playbook is no longer personal data of the source user — it is a validated procedure owned by the tenant).

9. **No model training = no "machine unlearning" problem** (research §11.3) — ADR-001 mandates local inference of pre-trained models only, no fine-tuning. All AI memory is in queryable storage (SQLite + sqlite-vec), not in model weights. The "AI fundamentally cannot comply with GDPR Art 17" critique (which applies to data baked into model weights) does NOT apply to SmartAgentics. This is a strategic compliance advantage over competitors who fine-tune on user data.

10. **Nightly Restate hard-delete sweep** (research §11.8) — a Restate workflow runs nightly, processes records where `deletedAt < now() - 30 days`, and performs the hard-delete (step 6 above). The sweep is idempotent and crash-safe (Restate durable workflows). Emits `AuditEvent` for all hard-deletes.

## 5. Rationale

- **GDPR Art 17 is the hardest AI compliance problem** — research §11.3: AI memory is not like a database row — it's derived, embedded, summarized, and propagated. The literature is unanimous that "AI fundamentally cannot comply" if deletion is treated as an afterthought. The only tractable approach is **attribution linking derived memories back to their sources** (the design guide's rule), so a delete request can cascade. This is why provenance is mandatory at write time (ADR-047).
- **The 30-day grace period is a production-necessity compromise** — research §11.3: pure immediate hard-delete is too dangerous (accidental deletions, fraudulent requests). The grace period must be documented in the privacy policy as "we delete within 30 days of your request" (which satisfies GDPR's "without undue delay" — 30 days is the standard interpretation).
- **The tax-retention exception is the legal-basis tagging mechanism** — research §11.3, ADR-042: GDPR Art 17(3)(b) explicitly allows retention for legal obligations — tax law requires 5–7 years. The "soft-block" (anonymize userId, retain content for tax audit, exclude from agent retrieval) is the compromise: the data exists for the legal purpose but is not used for AI personalization.
- **The "no model training" architectural decision is a strategic compliance advantage** — research §11.3, §11.5: SmartAgentics does not fine-tune models (ADR-001). All AI memory is in queryable storage. The "machine unlearning" problem does not apply. Competitors who fine-tune on user data face the genuinely-hard "machine unlearning" problem; SmartAgentics does not.
- **sqlite-vec's fast DELETE is the technical enabler** — research §11.3: if sqlite-vec required a full index rebuild on every delete (like the deprecated sqlite-vss), cascading deletes would be infeasible at scale. The choice of sqlite-vec (Stream 2) pays off here.
- **Cascading delete reaches all derived artifacts** — research §11.1, design guide: "Keep deletion actually deletable — a user-deletion request must reach the vector index entries, the system-of-record rows, and any summaries derived from that user's episodes." Partial deletion (relational but not vector, or vector but not FTS5) is a compliance failure.
- **Agent-initiated deletion prohibition prevents mass-deletion attacks** — research §11.2: a compromised agent should not be able to mass-delete user memory. Deletion is user-initiated or admin-initiated only.
- **`DeletionReport` is the audit evidence** — research §11.2: the verification query (`SELECT COUNT(*) FROM MemoryRecord WHERE userId=? AND deletedAt IS NULL` returns 0) is the proof that deletion succeeded. This is what a GDPR auditor asks for.
- **Procedural playbooks are independent of their source** — research §11.4, R-11.4: a validated playbook has its own standing; deleting it because the source user requested erasure would be over-deletion. The provenance link is severed; admin is notified for re-review.
- **Rejecting immediate hard-delete (Option A)** — research §11.5: accidental deletions and fraudulent requests are unrecoverable.
- **Rejecting no-tax-retention-exception (Option B)** — research §11.5: violates tax law.
- **Rejecting anonymize-only (Option C)** — research §11.5: anonymization is not erasure per GDPR Art 17.
- **Rejecting relational-only delete (Option D)** — research §11.5: partial deletion is a compliance failure.
- **Rejecting machine unlearning (Option E)** — research §11.5, §11.3: SmartAgentics does not fine-tune; the problem does not apply.
- **Rejecting no-deletion-API (Option F)** — research §11.5: doesn't scale; no audit trail; violates "without undue delay."

## 6. Consequences

**Positive**:

- GDPR Art 15/16/17/20 are first-class operations — non-negotiable for EU deployment of AI-BOS.
- Cascading delete reaches relational + sqlite-vec + FTS5 + `MemoryAccessLog` + procedural candidates — full erasure, not partial.
- 30-day grace period allows recovery from accidental deletion and fraudulent requests.
- Tax-retention legal-basis tag + soft-block resolves the GDPR Art 17 vs tax-law tension.
- `DeletionReport` with verification query is the audit evidence.
- "No model training" means the "AI cannot forget" critique does not apply — a strategic compliance advantage.
- Bulk deletion via admin UI satisfies Microsoft SFI's "bulk deletion" control.
- No-agent-delete rule prevents mass-deletion attacks.
- Feeds Stream 8 (Security & Governance) — GDPR Art 17 compliance is the trust foundation for EU deployment.

**Negative / obligations**:

- Cascading delete depends on mandatory provenance at write time (ADR-047) — if a derived memory was written without `provenance.sourceEventIds` backlinks, `forgetUser(userId)` cannot find it (research R-11.1, High severity). Mitigation: Prisma middleware rejects writes without `provenance`; integration test that verifies `forgetUser` deletes all records findable by `SELECT * FROM MemoryRecord WHERE content LIKE '%<user-identifiable-info>%'` (fuzzy check).
- Tax-retention soft-block may fail to fully anonymize if PII is in the content (research R-11.2, Medium). Mitigation: extraction prompt redacts PII at write time (ADR-039 §7); periodic PII-pattern scan (Phase 2+); legal review.
- sqlite-vec DELETE performance may degrade at very large scale (research R-11.3, Low). Mitigation: verified fast at hotel scale (10K–1M vectors per tenant); Phase 2+ may add batched deletion for very large bulk operations.
- Procedural playbooks from deleted users raise a re-review question (research R-11.4, Medium) — admin must re-review whether the playbook is still valid without the source user's evidence. Mitigation: validation is independent of source; provenance link is severed; admin notified.
- The 30-day grace period means data is not immediately erased — the privacy policy must document this; some users may demand immediate erasure (admin override available but discouraged).
- The nightly Restate hard-delete sweep must be maintained — a bug could mass-delete or fail to delete. Integration tests required.
- The `DeletionReport` verification query must return 0 — if it doesn't, the cascading delete missed something; root-cause analysis required.
- Bulk deletion can be slow at scale (10K users × 100 records each = 1M deletions) — the sweep runs nightly; bulk-delete requests are queued.
- The "no model training" advantage must be preserved — if a future ADR proposes fine-tuning on user data, the GDPR Art 17 compliance advantage is lost; this ADR must be re-reviewed.

**Dependencies on other ADRs**:

- Depends on ADR-001 (Reference Stack) — local-inference-only (no fine-tuning) is the compliance advantage.
- Depends on ADR-008 (Event-Driven) — Restate durable workflows for nightly hard-delete sweep.
- Depends on ADR-023 (Vector Store) — sqlite-vec fast DELETE.
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` partition key on `vec0_memrecord` (deletion scoped per tenant).
- Depends on ADR-030 (RAG Pipeline) — Restate workflow pattern.
- Depends on ADR-038 (AI Memory Architecture) — the `MemoryStore` interface; `forgetUser`/`exportUserMemory`/`updateMemory` methods.
- Depends on ADR-039 (Memory Taxonomy) — user memory's PII redaction at the write gate (Art 5 minimization).
- Depends on ADR-040 (Storage & Encryption) — the `deletedAt` soft-delete column; sqlite-vec + FTS5 dual-write.
- Depends on ADR-041 (Permissions & Isolation) — `memory:delete:own`/`memory:delete:admin` permissions; no-agent-delete rule.
- Depends on ADR-042 (Retention & Decay) — `retentionPolicy='TAX_7Y'` tag; `deletedAt` field; nightly sweep pattern.
- Depends on ADR-045 (Procedural Memory Promotion) — procedural candidates promoted from deleted users' episodes; validated playbooks are independent of source.
- Depends on ADR-047 (Provenance & Audit) — mandatory `provenance.sourceEventIds` at write time; `AuditEvent` on all deletions.
- Feeds ADR-046 (Operations API) — the `forgetUser`/`exportUserMemory`/`updateMemory` SDK methods.
- Feeds Stream 8 (Security & Governance) — GDPR Art 17 compliance is the EU-deployment trust foundation; the cascading-delete pattern is the universal erasure machinery for AI-BOS.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A `forgetUser(userId)` cascading delete misses a derived memory** (integration test or production incident) — root-cause the missing `provenance.sourceEventIds` link; tighten the write-gate provenance requirement (ADR-047); verify the fuzzy `LIKE` integration test catches the regression.
2. **A GDPR Art 17 erasure request is delayed beyond 30 days** — root-cause the nightly sweep failure; verify the Restate workflow is running; consider priority-queue for erasure requests.
3. **A tax-retention soft-block fails to fully anonymize** (PII in content of a tax-retained event) — root-cause the extraction-prompt PII redaction failure; tighten the periodic PII-pattern scan (Phase 2+); legal review.
4. **A procedural playbook from a deleted user is found to be invalid** (the source user's evidence was the only validation) — root-cause the validation-gate failure (ADR-045); verify the admin re-review notification was sent; consider withdrawing the playbook.
5. **A future ADR proposes fine-tuning on user data** — re-review this ADR's "no model training" compliance advantage; the "machine unlearning" problem would then apply; this ADR's decision may need to be superseded.
6. **A bulk-deletion request is too slow** (10K+ users) — evaluate batched deletion; verify the nightly sweep throughput; consider parallelizing by tenant.
7. **A new legal-basis tag is needed** (e.g., `HIPAA_6Y` for healthcare, `SOX_7Y` for financial) — verify the `retentionPolicy` field accommodates new tags; verify the soft-block mechanism generalizes; legal review.
8. **A `DeletionReport` verification query returns non-zero** — root-cause the missed records; verify the cascading-delete logic; consider the fuzzy `LIKE` check as a backup.
9. **An agent-initiated deletion attempt is detected** (an agent tries to call `forgetUser` on a user) — root-cause the RBAC failure (ADR-041); verify the `memory:delete` permission is not granted to agents for user scope; verify the `MemoryAccessLog` caught the attempt.
10. **Annually**, as part of the regular ADR review cycle, AND on any change to GDPR Article 17 interpretation by the European Data Protection Board.
