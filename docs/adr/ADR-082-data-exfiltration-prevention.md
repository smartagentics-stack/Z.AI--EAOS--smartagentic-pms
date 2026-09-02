# ADR-082: Data Exfiltration Prevention — PII Redaction, Egress Allowlist, GDPR Article 22

**ADR-ID:** ADR-082
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Data exfiltration via LLM is **OWASP LLM02:2025 Sensitive Information Disclosure** — the #2 risk in the OWASP Top 10 for LLM Applications 2025 (s01, s05). OWASP defines it as leakage of PII via prompts, model outputs, tool-call arguments, and training-data regurgitation. Phase B B4 #29 ("Offline AI security") and B4 #30 ("Tenant isolation of PII") classify this as a "NOW" architecture contract.

GDPR Article 22 (s09, s19, `https://gdpr-info.eu/art-22-gdpr`) is the legal frame: "The data subject shall have the right not to be subject to a decision based solely on automated processing, including profiling, which produces legal [or similarly significant] effects [on the data subject]." For SmartAgentics, any AI decision with legal/similarly-significant effect on a guest (denying a reservation, flagging as fraud, sharing data with law enforcement, modifying folio balance) **cannot be solely automated** — human approval is a legal requirement, not merely a security best practice.

The Stream 8 research surveyed PII detection tools (s09): PredictionGuard (self-hosted, audit logging, HIPAA-grade); Nightfall AI ("Data redaction ... involves selectively removing or obscuring sensitive or confidential information [before sending to the model]"); Arcjet (field-level prompt and response inspection). Microsoft Presidio is the industry-standard PII detector but is Python-based and conflicts with the TypeScript-native preference. CockroachDB's multi-tenant blog (August 2026, s11) reinforces: "Prevent cross-tenant data leakage by enforcing tenant boundaries at the database layer rather than relying only on application filters."

The agent sandbox egress boundary is the second critical control. Stream 1 binds Ollama to `127.0.0.1:11434` (no cloud egress for the model); Stream 7's hub-and-spoke LAN sync restricts agent-to-agent communication. But no contract today prevents an agent tool from calling any URL/IP — an attacker who achieved code execution via prompt injection could exfiltrate guest data to an attacker-controlled endpoint.

## 2. Problem

Should SmartAgentics adopt a cloud DLP API, a Python Presidio sidecar, a TypeScript-native regex detector, or no PII redaction? Should agent egress be unrestricted, default-deny, or allowlist-based? How should GDPR Article 22 map to the agent decision taxonomy?

## 3. Options

### Option A: Cloud DLP API (Google Cloud DLP, AWS Macie)

Rejected. Violates offline-first. Hotel servers have no guaranteed internet egress.

### Option B: Microsoft Presidio as a Python sidecar (Phase 1)

Partially rejected. Presidio is industry-standard but a Python sidecar conflicts with the TypeScript-native preference. Phase 1 ships a TypeScript regex-based detector (covers ~80% of PII types); Phase 2 may add Presidio sidecar for higher accuracy on unstructured PII.

### Option C: No PII redaction (trust the model and the tenant boundary)

Rejected. LLMs regurgitate training data and may leak PII from retrieved context into output (LLM02). Tenant isolation (ADR-083) prevents cross-tenant leakage but does not prevent same-tenant PII exfiltration via model output.

### Option D: Unrestricted agent egress (trust the LAN)

Rejected. A prompt-injection attack that achieves code execution could exfiltrate guest data to any URL. Default-deny egress is mandatory for a production-safe AI PMS.

### Option E: Encryption-in-use (homomorphic encryption, confidential computing)

Rejected for Phase 1. Adds 100–1000× latency. Reserved for Phase 3+ if a high-security deployment demands it.

### Option F: 4-layer data exfiltration prevention (PII redaction in/out + egress allowlist + GDPR Art. 22 mapping)

Adopted. Combines TypeScript-native PII detection, default-deny egress, and a `decisionEffectClass` taxonomy that maps every agent decision to its GDPR Article 22 obligation.

## 4. Decision

Adopt **Option F** — the 4-layer data exfiltration prevention contract.

| Layer | Defense                             | Implementation                                                                                                                                                                                                                                                                                                                            |
| ----- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1    | PII detection + redaction on input  | Before user input is sent to the model, scan for PII patterns (passport numbers, credit cards, email, phone, IBAN, national ID per locale). Redact with `[REDACTED-PII:type]` markers. Phase 1: TypeScript regex-based detector. Phase 2: optional Presidio sidecar. Redacted PII is logged in `AIAuditEvent` (with hash, not raw value). |
| D2    | PII detection + redaction on output | After model output, scan again. If PII is detected that was not in the input (i.e., the model generated PII it shouldn't have), block the output + `AIAuditEvent` `eventType=PII_LEAK_BLOCKED`.                                                                                                                                           |
| D3    | Egress allowlist                    | Agents cannot call any URL/IP not on the allowlist. Phase 1 allowlist: `127.0.0.1` (Ollama, SQLite hub), local SMTP relay, local network printer. No external internet egress from any agent tool. Phase 2+: per-tenant admin-configurable allowlist (ADR-094).                                                                           |
| D4    | GDPR Article 22 compliance          | Any AI decision classified `LEGAL_EFFECT` or `SIMILARLY_SIGNIFICANT` (per `AgentContract.decisionEffectClass`) requires HumanApproval — never solely-automated. Examples: deny reservation, flag guest as fraud, share guest data with third party, modify folio balance. ADR-087 specifies the approval workflow.                        |

### `decisionEffectClass` taxonomy (new field on `AgentContract`)

| Value                   | Definition                                                                                    | Approval required                                 |
| ----------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `NONE`                  | No effect on data subject (e.g., internal query)                                              | No                                                |
| `MINOR`                 | Convenience effect, reversible (e.g., room preference note)                                   | No                                                |
| `SIMILARLY_SIGNIFICANT` | Affects guest experience or finances, reversible with effort (e.g., reservation modification) | HIGH-risk tool approval (sync, single approver)   |
| `LEGAL_EFFECT`          | Legal or irreversible effect (e.g., folio void, fraud flag, data sharing with third party)    | CRITICAL-risk tool approval (async, dual control) |

### `PIIRedactor` interface (new in `packages/sdk/src/ai/`)

```typescript
export interface PIIRedactor {
  detectAndRedactInput(text: string, locale: string): { redacted: string; detections: PIIType[] };
  detectOutputLeak(
    output: string,
    inputPIITypes: PIIType[],
  ): { leaked: boolean; leakTypes: PIIType[] };
}
```

### Phase 1 scope

- D1/D2: TypeScript regex detector covering passport, credit card, email, phone, IBAN, national ID (per locale).
- D3: Phase 1 allowlist (local-only). Per-tenant admin UI deferred to Phase 2.
- D4: `decisionEffectClass` field on `AgentContract`; mapping reviewed by Phase 2 legal review.

## 5. Rationale

- **OWASP LLM02:2025 closure**: PII redaction on both input and output addresses the #2 LLM risk.
- **GDPR Article 22 compliance**: D4 mapping makes human approval a legal requirement, not merely a security best practice. The `DecisionRecord` (ADR-089) provides the right-to-explanation; the human-approval workflow (ADR-087) provides the right-to-human-intervention.
- **Default-deny egress** (D3) is the only production-safe posture for an offline-first AI PMS. Any URL not on the allowlist is blocked; this prevents exfiltration via prompt-injection-driven code execution.
- **TypeScript-native Phase 1** respects the Streams 1–7 architecture preference; Presidio sidecar is reserved as a Phase 2 accuracy upgrade.
- **CockroachDB principle** (s11): tenant boundary at the database layer (ADR-083) is the foundation; PII redaction is defense-in-depth on top.
- **Over-compliance is safer than under-compliance**: the GDPR right-to-explanation does not require a _technical_ explanation, only a _meaningful_ one — but the `DecisionRecord` exceeds the legal minimum.

## 6. Consequences

- New `PIIRedactor` SDK interface in `packages/sdk/src/ai/`.
- New `EgressAllowlist` Prisma table (per-tenant, admin-configurable in Phase 2).
- New `AIAuditEvent` event types: `PII_REDACTED_INPUT`, `PII_LEAK_BLOCKED_OUTPUT`, `EGRESS_BLOCKED`.
- New `decisionEffectClass` field on `AgentContract` (additive; ADR-046 amendment).
- **Risk: regex-based PII detection has false negatives** (e.g., `P 1234567 7` passport format with spaces). Mitigation: Phase 2 Presidio sidecar; Phase 1 false-negative rate is acceptable for the reference agent's limited PII surface.
- **Risk: egress allowlist may break legitimate Phase 2 use cases** (e.g., weather API for tourism recommendations). Mitigation: per-tenant admin-configurable allowlist; each addition logged as `AIAuditEvent`.
- **Risk: `decisionEffectClass` misclassification** (a tool author marks a LEGAL_EFFECT decision as MINOR). Mitigation: Phase D ADR review by Architecture Office; verifier rule (VERIFY-AI-SECURITY-02) flags any `AgentContract` without `decisionEffectClass`.
- Dependencies: Stream 5 `ToolRegistry` (egress enforcement at tool-call boundary); Stream 5 `AIAuditEvent`; ADR-087 (HumanApproval workflow); ADR-089 (DecisionRecord); ADR-094 (Agent Sandbox & Egress Control).
- Phase 1 effort: ~3 weeks (PII redactor 1 week, egress allowlist enforcement 1 week, GDPR Art. 22 mapping 1 week mostly legal review).

## 7. Review Conditions

- Review if Phase 1 false-negative rate on regex PII detection exceeds 10% — would accelerate Presidio sidecar adoption to Phase 1.
- Review if Phase 2 use cases (weather API, tourism recommendations) require external egress — would require per-tenant admin-configurable allowlist UI earlier than planned.
- Review if legal review reclassifies any `decisionEffectClass` value (e.g., reservation denial moves from SIMILARLY_SIGNIFICANT to LEGAL_EFFECT) — would adjust the per-tool approval mapping.
- Review if GDPR Article 22 enforcement guidance evolves (national supervisory authority opinions) — would extend D4 mapping.
- Review if a TypeScript-native Presidio port or equivalent becomes available — would adopt natively without the Python sidecar.
- Review if a guest exercises their right-to-explanation and the `DecisionRecord` proves insufficient — would extend ADR-089.
- Review if Phase 2+ requires cross-tenant data sharing (e.g., group reservations across sister properties) — would require a new `ConsentedDataShare` workflow with explicit guest consent logging.
