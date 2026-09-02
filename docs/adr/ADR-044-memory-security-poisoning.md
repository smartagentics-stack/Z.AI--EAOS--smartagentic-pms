# ADR-044: Memory Security & Poisoning Defense

**ADR-ID:** ADR-044
**Status:** ACCEPTED
**Context:** 2026-09-01
**Owner:** Architecture Office

---

## 1. Context

ADR-038 (AI Memory Architecture) established that memory is both high-value data AND a control plane. ADR-040 (Storage & Encryption) established SQLCipher encryption at rest and the SHA-256 `contentHash` integrity check. ADR-041 (Permissions & Isolation) established the four-dimensional scope model and Prisma middleware enforcement. ADR-042 (Retention & Decay) established the reinforcement-on-confirmation mechanism. Phase C Stream 4 research (`/home/z/my-project/phase-c-stream4-ai-memory-report.md`, §12) details the 6-layer defense-in-depth posture against memory poisoning.

The Microsoft SFI (Secure Future Initiative) guidance (research §12.1) reframes the threat model: "Memory gives AI agents the ability to retain and recall information across interactions to influence future behavior. This persistence delivers personalization and agentic coherence as agents build durable knowledge that strengthens their performance over time. This is the feeling of 'learning.' However, persistent memory doesn't just store information, it acts as a configuration layer for the AI system. A memory created today can influence tool selection, refusal behavior, and reasoning later, often outside the original context, session, or application." And critically: "**Persistence fundamentally changes the threat model: attackers no longer need to succeed in a single prompt. By influencing memory, they can shape behavior gradually over time, exploiting the temporal gap between exposure and execution.**" And: "Transient threats become persistent: A single compromised interaction can silently shape all future behavior long after the original session ends. Hallucinations become persisted hallucinations; cross-prompt injection (XPIA) becomes continuous XPIA with automatic exfiltration or overrides of system instructions."

The documented attack success rates are terrifying (research §12.1):

- **MINJA (Memory Injection Attack, Dong et al. 2025)**: "attackers can poison an agent's long-term memory through regular queries, no special privileges needed, hitting over 95% injection success rate and 70% attack success rate. No elevated privileges. No API access. No direct writes to the memory store."
- **AgentPoison (Chen et al., NeurIPS 2024)**: "poisons the knowledge base or memory store directly with optimized trigger tokens... across three agent types (autonomous driving, knowledge-intensive QA, and healthcare EHR agents), AgentPoison achieved an average attack success rate above 80%."
- **MemoryGraft (Srivastava & He 2025)**: "doesn't inject explicit malicious instructions. Instead, the attacker plants fabricated 'successful experiences' into the agent's long-term memory. These look like normal records of past tasks the agent completed."
- **A-MemGuard defense framework (2025)**: "even advanced LLM-based detectors miss 66% of poisoned memory entries."
- **OWASP Agentic AI Top 10**: lists Memory and Context Poisoning as ASI06, noting that "memory poisoning corrupts an agent's long-term memory, causing consistently flawed decisions over time."
- **Palo Alto Networks Unit 42 proof-of-concept**: "indirect prompt injection planted malicious instructions into an agent's memory through a compromised webpage. Those instructions survived session restarts and got incorporated into the agent's orchestration prompts in later conversations, silently exfiltrating conversation history. The session ended. The attack didn't."

The defenses (research §12.1) require a layered approach: "input sanitization, memory isolation per user/session, cryptographic integrity checks, Mem0's memory expiration, and continuous monitoring." The OWASP AI Agent Security Cheat Sheet lays out five specific controls: "sanitize data before storage, isolate memory between users and sessions, set expiration and size limits, audit for sensitive data before persistence, and use cryptographic integrity checks for long-term memory."

The research (§12.1) also documents the secrets-in-LLM-context hazard: "Research shows secrets stored in LLM context have a 78% chance of eventual exposure through prompt injection, hallucination, or logging failures." This means secrets must never enter memory — period. The write gate's secret detection is non-negotiable.

## 2. Problem

The architectural problem: **define the memory security and poisoning defense contract that (a) adopts a 6-layer defense-in-depth posture — the minimum viable given documented attack success rates (MINJA 95%, AgentPoison 80%+, A-MemGuard misses 66%); single-layer defenses are insufficient; (b) Layer 1 = write gate (input sanitization + PII redaction + secret blocking + injection-pattern detection + dedup) — every memory write passes through `shouldRemember(candidate)` that rejects secrets, rejects non-durable/non-attributable candidates, redacts PII, quarantines injection-suspicious content, and consolidates duplicates; (c) Layer 2 = scoped storage with isolation (per ADR-041) — per-user/agent/tenant/session scoping at SQL WHERE clause; sqlite-vec partition key on tenantId; no cross-scope retrieval path; (d) Layer 3 = access control / RBAC on all memory operations (per ADR-041) — every read/write/delete authorized via `MemoryPermission` enum; agent identity via signed JWT (Stream 5 contract reserved); (e) Layer 4 = trust-scored retrieval + cryptographic integrity checks — composite `trustScore = 0.4 * confidence + 0.3 * recencyFactor + 0.2 * sourceWeight + 0.1 * (1 - anomalyScore)`; SHA-256 `contentHash` on every `MemoryRecord`, recomputed and verified on retrieval, mismatch → quarantine + alert (NOT auto-delete); `anomalyScore` deferred to Phase 2+; (f) Layer 5 = output validation (Phase 2+) — after the agent generates a response using retrieved memories, validate the output for sensitive data leakage, unexpected behavioral patterns, safety guardrail compliance; Phase 1 ships the logging (output is logged with the memory IDs that influenced it); (g) Layer 6 = continuous monitoring — `MemoryAccessLog` records every memory operation (create/read/update/delete/export/promote) with identity, timestamp, source, provenance, target record ID; 7-year retention; nightly Restate workflow runs anomaly detection on write patterns (Phase 2+); forensic memory snapshots for rollback (Phase 2+); (h) maps specific poisoning attacks to defense layers — MINJA (query-based injection) → Layer 1 + Layer 4 + Layer 2 (a poisoned entry written by User A cannot be retrieved for User B); AgentPoison (knowledge-base backdoor) → Layer 1 + Layer 4 (integrity checks) + provenance (suspicious provenance detected); MemoryGraft (experience grafting) → Layer 4 (trust scoring) + ADR-042 reinforcement-on-confirmation (a grafted "successful experience" that doesn't match real outcomes has its confidence cut) + Phase 2+ anomaly detection; (i) makes SQLCipher encryption at rest (per ADR-040) part of the defense — opt-in Phase 1, mandatory Phase 2+ for PII tenants; per-tenant key derivation; (j) makes the write gate's secret detection non-negotiable — regex for API keys (AWS/GCP/Azure patterns), payment data (PAN, CVV), government IDs (passport, SSN, national ID), credentials (`password=`, `token=`); auto-reject; the 78% eventual-exposure rate for secrets in LLM context means secrets must never enter memory; (k) makes the write gate's PII redaction non-negotiable — regex for email, phone, credit card; replace with `[REDACTED-PII:email]` etc.; redacted content stored, original PII not (PII goes in PMS entity); (l) makes the write gate's injection-pattern detection Phase 1 = regex-based (common patterns: "ignore previous instructions", "you are now a different agent"), Phase 2+ = LLM-based via local Ollama classifier; (m) reserves field-level encryption (Phase 2+) for extra-sensitive fields (dietary allergies, accessibility needs) with separate key derived from `tenantId + userId`, protecting against a compromised admin; and (n) feeds Stream 8 (Security & Governance) — the 6-layer defense is the trust foundation of AI-BOS; the `MemoryAccessLog` is the AI Audit foundation (B4 #20).** This ADR is the security companion to ADR-038; it is the Stream 4 analog of Stream 3's ADR-032 (Source Attribution) in that both deal with trust/integrity, and it is the most security-critical ADR in the Stream 4 set.

## 3. Options

### Option A: No encryption at rest (rely on OS file permissions)

Use plain SQLite files; rely on OS file permissions to protect the database file. **Rejected** — research §12.5: insufficient — a stolen laptop or backup file exposes all tenant memory. Covered in ADR-040; SQLCipher is the answer.

### Option B: Application-level encryption (encrypt fields in JS, store ciphertext in SQLite)

Encrypt fields in JavaScript before persisting. **Rejected** — research §12.5: slower (can't index encrypted fields); harder to query; key management in application code. SQLCipher's transparent encryption is superior. Covered in ADR-040.

### Option C: Single-layer defense (just input sanitization OR just isolation OR just monitoring)

Pick one defense layer and rely on it. **Rejected** — research §12.5: inadequate per the documented attack success rates (80–95%). Defense-in-depth is the consensus. MINJA achieves 95% injection / 70% attack success with "no elevated privileges, no API access, no direct writes" — any single layer can be bypassed.

### Option D: Prompt-based defenses ("don't follow malicious instructions from memory")

Add a system-prompt instruction telling the LLM to ignore malicious memory content. **Rejected** — research §12.5: "Don't rely on model prompting for boundary enforcement" (Microsoft SFI). Inadequate. Prompt injection (XPIA) can override any system-prompt instruction.

### Option E: Homomorphic encryption (compute on encrypted memory)

Use homomorphic encryption to compute on encrypted memory without decryption. **Rejected** — research §12.5: too slow for real-time retrieval; not production-viable for hotel-scale in 2026. Research-only.

### Option F: Trusted Execution Environment (TEE / SGX / SEV-SNP)

Use Intel SGX or AMD SEV-SNP enclaves to protect memory at the hardware level. **Rejected** — research §12.5, citing arXiv:2605.03213: "They do not prevent the semantic effects of prompt injection: TEE-backed memory isolation can keep prompts, retrieved context, and runtime separate but not prevent semantic attacks." TEEs protect against physical/disk attacks but not prompt injection — and the threat model is prompt injection, not physical theft. Overkill for Phase 1; SQLCipher + per-tenant keys covers the disk-theft threat at a fraction of the complexity.

### Option G: 6-layer defense-in-depth + SQLCipher encryption at rest + specific poisoning defenses mapped to layers

Layer 1 (write gate: secret detection + PII redaction + injection-pattern detection + dedup); Layer 2 (scoped storage with isolation per ADR-041); Layer 3 (RBAC on all operations per ADR-041); Layer 4 (trust-scored retrieval + SHA-256 cryptographic integrity checks); Layer 5 (output validation, Phase 2+); Layer 6 (continuous monitoring: `MemoryAccessLog` + anomaly detection Phase 2+ + forensic snapshots Phase 2+). SQLCipher encryption at rest (per ADR-040). Specific poisoning defenses (MINJA, AgentPoison, MemoryGraft) mapped to layers. Per research §12.

## 4. Decision

Adopt **Option G**. The Memory Security & Poisoning Defense architectural contract is:

1. **Layer 1 — Write gate (input sanitization + PII redaction + secret blocking + injection-pattern detection + dedup)** (research §12.2):
   - Every memory write passes through `shouldRemember(candidate)`:
     ```
     if containsSecrets(content): REJECT         # never persist credentials/tokens/API keys/payment data/government IDs
     if not durable(candidate): REJECT            # session-scoped detail
     if not attributable(candidate): REJECT       # no source episode
     if containsPII(content): redactOrReject      # PII goes in PMS entity, not memory
     if containsInjectionPattern(content): QUARANTINE  # prompt-injection-suspicious
     existing = findSimilar(candidate, threshold=0.92)
     if existing: CONSOLIDATE(existing)           # update/supersede, don't duplicate
     return ACCEPT(confidence=estimateConfidence(candidate))
     ```
   - **Secret detection**: regex for API keys (AWS/GCP/Azure patterns), payment data (PAN, CVV), government IDs (passport, SSN, national ID), credentials (`password=`, `token=`). Auto-reject. Non-negotiable — the 78% eventual-exposure rate for secrets in LLM context (research §12.1) means secrets must never enter memory.
   - **PII redaction**: regex for email, phone, credit card; replace with `[REDACTED-PII:email]` etc. The redacted content is stored; the original PII is not (PII goes in PMS entity). This is the Microsoft SFI rule: "Block from memory: Credentials, API keys, payment data, government IDs."
   - **Injection pattern detection** (Phase 1 = regex, Phase 2+ = LLM-based): Phase 1 ships regex-based detection of common patterns ("ignore previous instructions", "you are now a different agent", "forget all previous rules", etc.); Phase 2+ ships LLM-based detection via local Ollama classifier (per ADR-048 — no cloud LLM dependency).

2. **Layer 2 — Scoped storage with isolation** (per ADR-041):
   - Per-user, per-agent, per-tenant, per-session scoping enforced at SQL WHERE clause.
   - sqlite-vec partition key on `tenantId` (per Stream 2 ADR-027 pattern).
   - No cross-scope retrieval path exists.

3. **Layer 3 — Access control (RBAC on all memory operations)** (per ADR-041):
   - Every read/write/delete is authorized via `MemoryPermission` enum.
   - Agent identity via signed JWT (Stream 5 contract reserved from Phase 1).

4. **Layer 4 — Trust-scored retrieval + cryptographic integrity checks** (research §12.2):
   - At retrieval time, apply composite trust scoring: `trustScore = 0.4 * confidence + 0.3 * recencyFactor + 0.2 * sourceWeight + 0.1 * (1 - anomalyScore)`.
   - `anomalyScore` (Phase 2+): ML-based anomaly detection on memory write patterns (an agent suddenly writing many entries → potential poisoning). Phase 1 ships the first three factors; `anomalyScore` deferred to Phase 2+.
   - **Cryptographic integrity checks**: every `MemoryRecord` has a `contentHash` (SHA-256 of content + provenance + timestamps). On retrieval, recompute and verify; mismatch indicates tampering → quarantine + alert. This is the OWASP "cryptographic integrity checks for long-term memory" control. On every write, recompute and store. Nightly Restate workflow recomputes hashes for all records; mismatches flagged in `MemoryAccessLog` and admin UI.

5. **Layer 5 — Output validation** (Phase 2+) (research §12.2):
   - After the agent generates a response using retrieved memories, validate the output for sensitive data leakage (regex for PII that shouldn't be there), unexpected behavioral patterns, and safety guardrail compliance.
   - Phase 1 ships the logging (output is logged with the memory IDs that influenced it); Phase 2+ ships the validation.

6. **Layer 6 — Continuous monitoring (audit + anomaly detection)** (research §12.2; detailed in ADR-047):
   - `MemoryAccessLog` records every memory operation (CREATE/READ/UPDATE/DELETE/EXPORT/PROMOTE) with identity, timestamp, source, provenance, target record ID. Retained 7 years.
   - Nightly Restate workflow runs anomaly detection on write patterns (an agent writing many entries in a short time → potential poisoning; a user retrieving many other users' memories → potential data exfiltration). Phase 1 ships the logging; Phase 2+ ships the anomaly detection.
   - **Forensic memory snapshots** (Phase 2+): periodic snapshots of memory state for rollback (if poisoning detected at time T, restore to known-good state at T-1day).

7. **SQLCipher encryption at rest** (per ADR-040):
   - AES-256-CBC, per-tenant key derived from master key via HKDF, master key in OS keychain.
   - Phase 1: opt-in (default off for dev; default on for production).
   - Phase 2+: mandatory for any tenant with PII in memory (which is all tenants).

8. **Memory poisoning defenses mapped to specific attacks** (research §12.2):
   - **MINJA (query-based injection, 95% injection / 70% attack success)**: defense = Layer 1 (write gate, input sanitization + injection-pattern detection) + Layer 4 (trust-scored retrieval, low-trust entries down-ranked) + Layer 2 (per-user isolation, a poisoned entry written by User A cannot be retrieved for User B).
   - **AgentPoison (knowledge-base backdoor, 80%+ across domains)**: defense = Layer 1 (write gate) + Layer 4 (cryptographic integrity checks — a backdoored entry has a tampered `contentHash`) + provenance (every entry traces to source; suspicious provenance detected — e.g., an entry written by a user with no prior history of similar entries).
   - **MemoryGraft (experience grafting)**: defense = Layer 4 (trust-scored retrieval) + ADR-042 reinforcement-on-confirmation (a grafted "successful experience" that doesn't match real outcomes has its confidence cut by 0.2 per contradiction; `lastConfirmedAt` not bumped). Phase 2+ adds anomaly detection (Layer 6).
   - **Sleeper memory poisoning (arXiv:2605.15338)**: defense = Layer 1 (write gate, injection-pattern detection) + Layer 4 (integrity checks) + Layer 6 (anomaly detection on write patterns, Phase 2+).
   - **Governance Decay (arXiv:2606.22528, context compaction silently erases safety)**: defense = ADR-039 §2 working-memory compaction (never compact the `task` block; only the `scratchpad`); preservation-contract template for compaction prompts.

9. **Phase 1 ships** (research §12.9): write gate (secret detection + PII redaction + regex injection-pattern detection + dedup) + scoped storage + RBAC + trust-scored retrieval + cryptographic integrity checks + `MemoryAccessLog` + SQLCipher (optional, default on for production) + per-tenant key derivation. Estimated effort: 2 weeks of Phase E (the largest single area — security is non-negotiable).

10. **Phase 2+ defers** (research §12.9): LLM-based injection detection (local Ollama classifier); output validation (Layer 5); anomaly detection (Layer 6 ML); forensic snapshots + rollback; field-level encryption for sensitive fields; per-tenant SQLite files for high-security tenants; TEE/SGX evaluation (only if the threat model shifts to physical theft).

11. **Memory is both data AND a control plane** (research §12.3; Microsoft SFI) — "Treat AI memory as both high-value data and a control plane. Because memory stores sensitive user information and simultaneously drives agent behavior, it requires the governance rigor of both a data protection system and an execution control system." The 6-layer defense-in-depth is the minimum viable posture given this dual nature.

## 5. Rationale

- **Memory is both high-value data AND a control plane** — research §12.1, §12.3 (Microsoft SFI): a memory compromise is therefore worse than a database compromise — it's a persistent behavior-shaping attack. "Persistence fundamentally changes the threat model: attackers no longer need to succeed in a single prompt. By influencing memory, they can shape behavior gradually over time."
- **The documented attack success rates are terrifying** — research §12.1: MINJA 95% injection / 70% attack success with "no elevated privileges, no API access, no direct writes"; AgentPoison 80%+ across domains; A-MemGuard misses 66% of poisoned entries. **Single-layer defenses are insufficient.** The 6-layer defense-in-depth is the minimum viable posture.
- **The 78% eventual-exposure rate for secrets in LLM context** — research §12.1 (rafter.so): secrets must never enter memory — period. The write gate's secret detection is non-negotiable.
- **SQLCipher is the offline-first encryption solution** — research §12.2, §12.3: drop-in SQLite fork, AES-256-CBC, Apache-2.0-compatible, no new database process, no Python runtime, no cloud KMS. Fits SmartAgentics' stack perfectly. The only cost is key management discipline (master key in OS keychain, per-tenant key derivation via HKDF). See ADR-040 for full rationale.
- **Per-tenant SQLite files (Stream 2's collection-per-tenant pattern) is the strongest isolation** — research §12.3: a compromised tenant's database file is useless for attacking other tenants. Phase 2+ option for high-security tenants (chains, luxury brands).
- **The "no model training" architectural decision is a security advantage** — research §12.3, ADR-001: there are no model weights to extract via membership-inference attacks. All AI state is in encrypted SQLite. This complements the GDPR compliance advantage (ADR-043).
- **Cryptographic integrity checks (SHA-256 `contentHash`) are the OWASP control** — research §12.1, §12.2 Layer 4: "OWASP AI Agent Security Cheat Sheet lays out five specific controls: sanitize data before storage, isolate memory between users and sessions, set expiration and size limits, audit for sensitive data before persistence, and use cryptographic integrity checks for long-term memory." The `contentHash` on every `MemoryRecord` is the integrity check; tampering is detected on retrieval and by the nightly integrity sweep.
- **Reinforcement on confirmation is the MemoryGraft defense** — research §12.2, ADR-042: a grafted "successful experience" that doesn't match real outcomes has its confidence cut by 0.2 per contradiction; `lastConfirmedAt` not bumped. This is the subtle-but-critical defense against experience grafting.
- **Specific attacks mapped to specific layers** — research §12.2: MINJA → Layer 1 + Layer 4 + Layer 2; AgentPoison → Layer 1 + Layer 4 + provenance; MemoryGraft → Layer 4 + ADR-042; Sleeper → Layer 1 + Layer 4 + Layer 6; Governance Decay → ADR-039 §2 compaction rules.
- **Rejecting no-encryption (Option A)** and **application-level encryption (Option B)** — research §12.5: covered in ADR-040; SQLCipher wins.
- **Rejecting single-layer defense (Option C)** — research §12.5: inadequate per attack success rates.
- **Rejecting prompt-based defenses (Option D)** — research §12.5: "Don't rely on model prompting for boundary enforcement" (Microsoft SFI).
- **Rejecting homomorphic encryption (Option E)** — research §12.5: too slow; research-only.
- **Rejecting TEE/SGX (Option F)** — research §12.5, arXiv:2605.03213: doesn't prevent semantic prompt injection; overkill for the disk-theft threat model.

## 6. Consequences

**Positive**:

- 6-layer defense-in-depth is the minimum viable posture against documented memory-poisoning attacks (MINJA 95%, AgentPoison 80%+, MemoryGraft, Sleeper, Governance Decay).
- Write gate (Layer 1) prevents secrets and PII from entering memory — the 78% eventual-exposure hazard mitigated.
- Per-user/agent/tenant/session isolation (Layer 2) prevents cross-scope poisoning retrieval (MINJA defense).
- RBAC (Layer 3) enforces least privilege on every memory operation.
- Trust-scored retrieval + cryptographic integrity checks (Layer 4) detect tampering and down-rank low-trust entries (AgentPoison + MemoryGraft defense).
- `MemoryAccessLog` (Layer 6) records every memory operation for incident response and AI Audit (B4 #20).
- SQLCipher encryption at rest protects against stolen laptop/backup.
- Specific poisoning defenses mapped to specific layers — clear incident-response playbooks.
- Feeds Stream 8 (Security & Governance) — the 6-layer defense is the trust foundation of AI-BOS; `MemoryAccessLog` is the AI Audit foundation.

**Negative / obligations**:

- Write gate false positives (legitimate memory rejected as "injection-suspicious") — research R-12.1 (High): Phase 1 ships conservative regex (high-precision, lower-recall); Phase 2+ ships LLM-based detection with tuning; quarantined entries are reviewable by admin (not auto-deleted).
- SQLCipher key loss (tenant key lost → tenant data unrecoverable) — research R-12.2 (High): master key backed up in OS keychain with recovery flow; per-tenant keys derived from master (no separate per-tenant key storage); documented key-rotation procedure; backup of encrypted database file + master key together.
- Cryptographic integrity check false positive (legitimate record modified by bug, flagged as tampering) — research R-12.3 (Medium): `contentHash` recomputed on every write; false positives investigated via `MemoryAccessLog`; quarantine + admin review (not auto-delete).
- SQLCipher performance overhead — research R-12.4 (Medium): 5–15% per Zetetic benchmarks; acceptable for hotel-scale; benchmark in Phase E.
- Phase 1 misses sophisticated poisoning (anomaly detection is Phase 2+) — research R-12.5 (High): Layer 1 + Layer 2 + Layer 4 catch most Phase 1 attacks; `MemoryAccessLog` enables post-hoc incident response; Phase 2+ anomaly detection closes the gap.
- The write gate's regex-based injection-pattern detection will have false negatives (sophisticated injections not in the regex) — Phase 2+ LLM-based detection mitigates; quarantined entries are reviewable.
- The `MemoryAccessLog` volume at 7-year retention is significant — a busy hotel property with 10 AI agents could generate 100K+ operations/day; archival/rotation strategy needed (Phase 2+).
- The 6-layer defense adds latency to every memory operation (write gate + integrity check + access log) — acceptable for hotel-scale; benchmark required.
- The Phase 2+ LLM-based injection detection requires a local Ollama classifier — adds latency to every write; benchmark required.

**Dependencies on other ADRs**:

- Depends on ADR-001 (Reference Stack) — offline-first principle; local-inference-only (no fine-tuning — the security advantage).
- Depends on ADR-013 (Observability Strategy) — every memory operation traced; nightly integrity-check workflow traced.
- Depends on ADR-015 (Local AI Runtime) — Ollama for Phase 2+ LLM-based injection detection.
- Depends on ADR-023 (Vector Store) — sqlite-vec partition key (Layer 2).
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` partition key.
- Depends on ADR-030 (RAG Pipeline) — Restate workflow pattern; nightly integrity-check workflow.
- Depends on ADR-038 (AI Memory Architecture) — the `MemoryStore` interface and storage substrate.
- Depends on ADR-039 (Memory Taxonomy) — the per-type write-gate rules (e.g., procedural memory's validation gate is the ultimate write gate).
- Depends on ADR-040 (Storage & Encryption) — SQLCipher encryption at rest; SHA-256 `contentHash` integrity check.
- Depends on ADR-041 (Permissions & Isolation) — Layer 2 (scoped storage) + Layer 3 (RBAC).
- Depends on ADR-042 (Retention & Decay) — reinforcement-on-confirmation (MemoryGraft defense); `MemoryAccessLog` 7-year retention.
- Depends on ADR-047 (Provenance & Audit) — `MemoryAccessLog` (Layer 6); provenance on every entry (AgentPoison defense).
- Depends on ADR-048 (Memory Framework Policy) — no-cloud-LLM-fail-closed guarantee; Phase 2+ LLM-based injection detection runs locally via Ollama.
- Feeds ADR-043 (Deletion & GDPR) — cascading delete reaches encrypted stores; integrity checks verify deletion.
- Feeds ADR-045 (Procedural Memory Promotion) — the validation gate is the procedural-memory-specific Layer 1.
- Feeds ADR-046 (Operations API) — the `WriteGate` + `IntegrityChecker` interfaces.
- Feeds Stream 5 (Agent Runtime) — agent identity (signed JWT) for Layer 3; agent behavioral baselines for Phase 2+ anomaly detection.
- Feeds Stream 8 (Security & Governance) — the 6-layer defense is the trust foundation; `MemoryAccessLog` is the AI Audit foundation; red-team testing of memory poisoning attacks.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A memory-poisoning attack is detected in production** (MINJA/AgentPoison/MemoryGraft/Sleeper incident) — root-cause which layer failed or was bypassed; tighten the gap; verify the `MemoryAccessLog` enables reconstruction; consider Phase 2+ anomaly-detection acceleration; publish an incident-response playbook.
2. **A write-gate false-positive incident occurs** (legitimate memory rejected as "injection-suspicious") — root-cause the regex over-match; tune the regex; consider Phase 2+ LLM-based detection acceleration; verify the quarantine-review path.
3. **A SQLCipher key-loss incident occurs** (tenant key unrecoverable) — root-cause the key-management failure; verify the OS keychain backup/recovery flow; consider key-escrow with legal review; document the data-loss outcome.
4. **A `contentHash` mismatch is detected** (tampering or bug) — root-cause; verify the nightly integrity-check workflow flagged it; verify the quarantine + admin-review path (not auto-delete); verify the `MemoryAccessLog` reconstruction.
5. **A Phase 2+ anomaly-detection demand emerges** (write-pattern anomalies detected manually) — evaluate the ML-based anomaly-detection model; benchmark the nightly sweep; verify the forensic-snapshot rollback mechanism.
6. **A new memory-poisoning attack is published** (beyond MINJA/AgentPoison/MemoryGraft/Sleeper) — evaluate the new attack against the 6-layer defense; tighten the gap; update the incident-response playbook.
7. **The 78% eventual-exposure rate for secrets is verified in production** (a secret leaked from memory) — root-cause the write-gate secret-detection failure; tighten the regex; verify the periodic secret-scan (Phase 2+).
8. **A field-level-encryption demand emerges** (a tenant requires per-user-key encryption for accessibility/dietary data) — evaluate the Phase 2+ field-level encryption contract; verify the per-user key derivation and key-management discipline.
9. **Stream 8 (Security & Governance) red-team testing reveals a gap** — tighten the specific layer; update the integration tests; consider accelerating a Phase 2+ defense.
10. **Annually**, as part of the regular ADR review cycle, AND on any new OWASP Agentic AI Top 10 release.
