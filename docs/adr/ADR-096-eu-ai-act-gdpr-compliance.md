# ADR-096: EU AI Act + GDPR Compliance — Article 12 Logging, Article 22 Right-to-Explanation, 7-Year Retention

**ADR-ID:** ADR-096
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #29 ("Offline AI security"), B4 #24 ("AI audit"), and B4 #31 ("AI explainability") all carry compliance obligations under the **EU AI Act** (entered into force August 2024; phased application 2025–2027) and the **GDPR** (Article 22 specifically). The Stream 8 research (s15, s09, s19) established the compliance frame:

- **EU AI Act Article 12** (s15, `https://predictionguard.com/blog/eu-ai-act-compliance-audit-log-what-regulators-expect-and-how-to-document-it`): "High-risk AI systems must maintain continuous, automatically generated logs for a minimum of six months." Truescreen (s15): "Deployers of high-risk AI systems must retain automatically generated logs for a minimum of six months from the date each log is created, per [Article 12]."
- **EU AI Act Annex IV** (s15): technical documentation requirements for high-risk AI systems.
- **EU AI Act risk tiers** (s15): prohibited / high-risk / limited-risk / minimal-risk. A hotel PMS with AI that affects guest financials (folio adjustments, fraud flags, reservation denials) is **likely high-risk** (pending legal review).
- **GDPR Article 22** (s09, s19, `https://gdpr-info.eu/art-22-gdpr`): "The data subject shall have the right not to be subject to a decision based solely on automated processing, including profiling, which produces legal [or similarly significant] effects [on the data subject]." The data subject has the right to obtain "human intervention," to "express his or her point of view," and to "contest the decision."
- **GDPR Articles 15-22**: data subject rights (access, rectification, erasure, restriction, portability, objection, automated decision-making).

SmartAgentics' existing PMS handles GDPR Articles 15-22 for guest data; Stream 8 extends to AI-generated data about a guest (e.g., AI-generated guest-preference notes in Stream 4 memory). The compliance posture must be conservative: treat the PMS AI as high-risk until legal review determines otherwise; apply defense-in-depth so the controls still satisfy limited-risk obligations if downgraded.

## 2. Problem

Should SmartAgentics treat the PMS AI as high-risk, limited-risk, or minimal-risk under EU AI Act? What retention period satisfies Article 12? How does GDPR Article 22 map to the agent decision taxonomy? How are data subject rights (Articles 15-22) extended to AI-generated data?

## 3. Options

### Option A: Treat PMS AI as minimal-risk (no compliance obligations)

Rejected. A hotel PMS with AI that affects guest financials (folio adjustments, fraud flags, reservation denials) is likely high-risk pending legal review. Minimal-risk would under-comply.

### Option B: Treat PMS AI as limited-risk (transparency-only obligations)

Rejected as the default. Limited-risk requires only transparency obligations; high-risk requires Article 12 logging + Annex IV documentation. A conservative posture treats as high-risk until legal review; if downgraded, the controls still apply (defense-in-depth).

### Option C: Treat PMS AI as high-risk (Article 12 + Annex IV + GDPR Art. 22)

Adopted as the default. Conservative; over-compliance is safer than under-compliance. If Phase 2 legal review downgrades to limited-risk, the controls still apply.

### Option D: 6-month retention (EU AI Act Article 12 minimum)

Rejected. Stream 6 ADR-062 already established 7-year retention — exceeds the 6-month minimum; aligned with financial-record retention norms. Adopting the 6-month minimum would under-comply with SmartAgentics' own retention policy.

### Option E: Solely-automated decisions allowed for SIMILARLY_SIGNIFICANT effects (with human review post-hoc)

Rejected. GDPR Article 22 forbids solely-automated decisions with legal/similarly-significant effect. Human approval must be **before** the decision takes effect, not post-hoc. ADR-087 specifies the approval workflow.

### Option F: Conservative high-risk posture + 7-year retention + GDPR Art. 22 pre-decision human approval + data subject rights extended to AI-generated data

Adopted. The compliance posture contract.

## 4. Decision

Adopt **Option F** — the conservative AI compliance posture.

### 1. Risk tier: high-risk (conservative default)

SmartAgentics hotel PMS AI is **treated as high-risk** under EU AI Act until legal review determines otherwise. The controls still apply if legal review downgrades the tier — defense-in-depth is tier-agnostic.

### 2. Article 12 logging (ADR-084, ADR-085)

The `AIAuditEvent` table + RFC 6962 Merkle Tree + 7-year retention satisfies Article 12. A regulator-export format (JSON-LD per a future regulator schema) is reserved for Phase 2 (needs legal review of the exact format).

### 3. GDPR Article 22 mapping (ADR-082, ADR-087, ADR-089)

Any AI decision with `decisionEffectClass = LEGAL_EFFECT` or `SIMILARLY_SIGNIFICANT` (per `AgentContract.decisionEffectClass`, ADR-082) requires HumanApproval — **never solely-automated**:

- The `DecisionRecord` (ADR-089) provides the **right-to-explanation**.
- The human-approval workflow (ADR-087) provides the **right-to-human-intervention**.
- The `HUMAN_APPROVAL_REJECTED` audit event provides the **right-to-contest**.

### 4. `decisionEffectClass` taxonomy (per ADR-082, repeated here for compliance reference)

| Value                   | Definition                                                   | GDPR Art. 22 obligation                             | Approval required                                 |
| ----------------------- | ------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------- |
| `NONE`                  | No effect on data subject                                    | None                                                | No                                                |
| `MINOR`                 | Convenience effect, reversible                               | None                                                | No                                                |
| `SIMILARLY_SIGNIFICANT` | Affects guest experience or finances, reversible with effort | Right-to-explanation + human intervention           | HIGH-risk tool approval (sync, single approver)   |
| `LEGAL_EFFECT`          | Legal or irreversible effect                                 | Right-to-explanation + human intervention + contest | CRITICAL-risk tool approval (async, dual control) |

### 5. Data subject rights (GDPR Articles 15-22) extended to AI-generated data

SmartAgentics' existing PMS handles these for guest data; Stream 8 extends to AI-generated data about a guest (e.g., AI-generated guest-preference notes in Stream 4 memory):

- **Article 15 (Access)**: a guest can request all AI-generated data about them. The system queries `AIAuditEvent` (where `decisionRecord.retrievedBusinessData` references the guest) + `MemoryRecord` (Stream 4) + `KnowledgeChunk` (Stream 3, if the guest is mentioned).
- **Article 16 (Rectification)**: a guest can correct AI-generated data (e.g., an AI-generated preference note is wrong). The system updates `MemoryRecord` + logs the rectification in `AIAuditEvent`.
- **Article 17 (Erasure / right-to-be-forgotten)**: propagates to `KnowledgeChunk` (if the guest is mentioned), `MemoryRecord` (Stream 4), with **`AIAuditEvent` exemption** under GDPR Article 17(3)(e) "for the establishment, exercise or defense of legal claims" — retained for 7 years.
- **Article 20 (Portability)**: a guest can export AI-generated data about them in a machine-readable format (JSON).
- **Article 22 (Automated decision-making)**: see §3 above.

### 6. `RightToErasureRequest` Restate workflow (new)

Handles propagation across `KnowledgeChunk`, `MemoryRecord`, with `AIAuditEvent` exemption. Phase 1 ships the contract; Phase 2 ships the impl (needs legal review of the exact propagation rules).

### 7. Regulator-export format (Phase 2, reserved)

A JSON-LD export format per a future regulator schema (pending legal review). The `AIAuditEvent` table + Merkle Tree provide the raw data; the export adapter formats it for regulator consumption.

### Phase 1 scope

- `decisionEffectClass` field on `AgentContract` (per ADR-082).
- Right-to-erasure workflow contract (impl in Phase 2).
- 7-year retention already established (Stream 6 ADR-062).
- Article 12 logging already established (ADR-084, ADR-085).
- GDPR Article 22 mapping already established (ADR-082, ADR-087, ADR-089).

## 5. Rationale

- **EU AI Act Article 12 satisfaction** (s15): "continuous, automatically generated logs" + 7-year retention (Stream 6 ADR-062) exceeds the 6-month minimum.
- **GDPR Article 22 satisfaction** (s09, s19): `LEGAL_EFFECT` and `SIMILARLY_SIGNIFICANT` decisions require pre-decision human approval — never solely-automated.
- **Conservative high-risk posture** is safer than under-compliance; if legal review downgrades to limited-risk, the controls still apply (defense-in-depth).
- **7-year retention** exceeds the Article 12 minimum (6 months) and aligns with financial-record retention norms (Stream 6 ADR-062).
- **Right-to-explanation** (GDPR Art. 22) provided by the `DecisionRecord` (ADR-089) — a meaningful (exceeds legal minimum) explanation.
- **Right-to-human-intervention** (GDPR Art. 22) provided by the human-approval workflow (ADR-087).
- **Right-to-contest** (GDPR Art. 22) provided by the `HUMAN_APPROVAL_REJECTED` audit event — the guest can contest via the human approver.
- **Data subject rights extended to AI-generated data** — GDPR Articles 15-22 apply to AI-generated data about a guest, not just traditional PMS data.
- **`AIAuditEvent` exemption from erasure** under GDPR Article 17(3)(e) — audit events are retained for 7 years for legal defense; this is a recognized GDPR exemption.
- **Over-compliance is safer than under-compliance**: the GDPR right-to-explanation does not require a _technical_ explanation, only a _meaningful_ one — but the `DecisionRecord` exceeds the legal minimum.

## 6. Consequences

- New `decisionEffectClass` field on `AgentContract` (per ADR-082, additive).
- New `RightToErasureRequest` Restate workflow (Phase 2 impl).
- New `AIAuditEvent` event types: `RIGHT_TO_ERASURE_REQUESTED`, `RIGHT_TO_ERASURE_COMPLETED`, `RIGHT_TO_ERASURE_EXEMPT_AUDIT_EVENT`.
- Phase 2 legal review of: (a) the exact `decisionEffectClass` values; (b) the regulator-export format; (c) the right-to-erasure propagation rules.
- **Risk: EU AI Act enforcement is new** (Aug 2024 entry into force; phased application 2025–2027). SmartAgentics may be subject to obligations that are not yet final. Mitigation: conservative posture (treat as high-risk); monitor regulatory developments; Phase 2 legal review.
- **Risk: GDPR right-to-explanation does not require a _technical_ explanation, only a _meaningful_ one.** The `DecisionRecord` may be more than legally required. Mitigation: over-compliance is safer than under-compliance.
- **Risk: `decisionEffectClass` misclassification** (a tool author marks a LEGAL_EFFECT decision as MINOR). Mitigation: Phase D ADR review by Architecture Office; verifier rule VERIFY-AI-SECURITY-02 flags `AgentContract` without `decisionEffectClass`.
- **Risk: right-to-erasure propagation misses a surface** (e.g., a future AI-generated data store not in the propagation rules). Mitigation: Phase 2 legal review enumerates all AI-generated data surfaces; the `RightToErasureRequest` workflow is extensible.
- **Risk: `AIAuditEvent` exemption from erasure is challenged by a data subject.** Mitigation: GDPR Article 17(3)(e) is a recognized exemption; the `RIGHT_TO_ERASURE_EXEMPT_AUDIT_EVENT` audit event documents the exemption decision.
- **Risk: regulator demands a specific export format not yet defined.** Mitigation: Phase 2 legal review defines the format; the export adapter is additive.
- Dependencies: ADR-082 (`decisionEffectClass`); ADR-084 (Article 12 logging); ADR-085 (audit event catalog); ADR-087 (human approval = right-to-human-intervention); ADR-089 (DecisionRecord = right-to-explanation); Stream 6 ADR-062 (7-year retention); Stream 4 `MemoryRecord` (right-to-erasure propagation); Stream 3 `KnowledgeChunk` (right-to-erasure propagation).
- Phase 1 effort: ~1 week (`decisionEffectClass` field on `AgentContract`; right-to-erasure workflow contract; impl in Phase 2).

## 7. Review Conditions

- Review if Phase 2 legal review downgrades the PMS AI tier from high-risk to limited-risk — would relax Article 12 documentation obligations but not the security controls.
- Review if Phase 2 legal review reclassifies any `decisionEffectClass` value (e.g., reservation denial moves from SIMILARLY_SIGNIFICANT to LEGAL_EFFECT) — would adjust the per-tool approval mapping.
- Review if EU AI Act phased application (2025–2027) introduces obligations not anticipated in §4 — would extend this ADR.
- Review if a data subject exercises their right-to-erasure and the `RightToErasureRequest` workflow proves insufficient — would extend the propagation rules.
- Review if a regulator demands a specific export format — would activate the Phase 2 regulator-export adapter.
- Review if GDPR Article 22 enforcement guidance evolves (national supervisory authority opinions) — would extend the `decisionEffectClass` mapping.
- Review if a community AI compliance standard emerges (e.g., NIST AI RMF compliance profile, EU AI Act standardized technical documentation template) that should replace the SmartAgentics-owned posture.
- Review if Phase 3+ requires cross-border data transfer compliance (e.g., a multi-national hotel chain) — would add GDPR Chapter V transfer mechanisms.
