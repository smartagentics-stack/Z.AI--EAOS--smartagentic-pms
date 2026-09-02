# ADR-080: Offline AI Security Architecture — Umbrella for AI Security & Governance

**ADR-ID:** ADR-080
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B's B4 Gap Assessment (lines 486–511 of `phase-b-report.md`) classifies B4 #29 ("Offline AI security — No — not found") as an **"Architecture Contract — NOW"** gap. The Phase C Stream 8 research (`/home/z/my-project/phase-c-stream8-security-governance-report.md`) confirmed that Streams 1–7 each closed a piece of the offline-AI-security surface — Stream 1 bound Ollama to `127.0.0.1:11434` with `OLLAMA_NO_CLOUD=1`; Stream 4 added SQLCipher opt-in; Stream 5 reserved signed-JWT agent identity and the basic `AIAuditEvent` hash chain; Stream 6 added Cedar L1/L2/L3 authorization and 7-year retention — but **no single umbrella ADR names all sub-controls, maps each to a verifier rule, and establishes the security architecture for the offline-first Windows-deployed multi-tenant PMS**.

Stream 8 Foundational Conflict **FC-8.2** (CRITICAL) flags this as the umbrella gap. The OWASP Top 10 for LLM Applications 2025 (s01) names prompt injection (LLM01), sensitive information disclosure (LLM02), supply chain (LLM03), excessive agency (LLM06), and system prompt leakage (LLM07) as the dominant AI security risks. NIST AI RMF (s03) and EU AI Act Article 12 (s15) demand auditable, tamper-evident logging for high-risk AI systems. GDPR Article 22 (s09, s19) forbids solely-automated decisions with legal or similarly-significant effect on a data subject — a legal, not merely technical, requirement that the human-approval workflow must satisfy.

SmartAgentics' hard constraints compound the difficulty: offline-first (no cloud LLM, no cloud DLP, no cloud audit SaaS); Windows deployment (single hotel server, no Kubernetes); multi-tenant isolation (every guest's data must stay in its tenant's boundary across schema, vector store, memory, context window, and prompt template); and production viability (a single prompt-injection attack or tenant-isolation bug could expose guest PII or cause financial damage). The umbrella ADR must therefore be conservative: treat the AI as high-risk until legal review determines otherwise, and apply defense-in-depth across every AI surface.

## 2. Problem

Should SmartAgentics adopt a single umbrella ADR naming all offline-AI-security sub-controls with verifier-rule mappings, or distribute the security posture across the existing ADRs without a single authoritative reference? Should the umbrella treat the PMS AI as high-risk or limited-risk under EU AI Act? Should it prescribe a Phase 1 minimum-viable security baseline or defer all controls to Phase 2+?

## 3. Options

### Option A: Distribute the security posture across Streams 1–7 ADRs (no umbrella)

Rejected. The sub-controls cross-cut Streams 1–7 — e.g., prompt injection (Stream 5 `AgentContract` + Stream 3 `KnowledgeCitation` + Stream 1 Ollama); Merkle audit (Stream 5 `AIAuditEvent` + Stream 7 HLC). Distributing without an umbrella leaves no single reference for the security architecture and no single ADR that maps each control to a verifier rule. Auditors, regulators, and engineers cannot answer "what is SmartAgentics' AI security posture?" from any one document.

### Option B: Umbrella ADR treating PMS AI as limited-risk under EU AI Act

Rejected. EU AI Act risk tiers (s15) classify systems affecting guest financials (folio adjustments, fraud flags, reservation denials) as **likely high-risk** pending legal review. A limited-risk posture would under-comply; high-risk controls applied conservatively still satisfy limited-risk obligations (defense-in-depth). Over-compliance is safer than under-compliance.

### Option C: Umbrella ADR deferring all controls to Phase 2+

Rejected. The reference `ReservationAssistantAgent` (Stream 5 §8.4) ships in Phase 1 and exercises `createReservation`, `cancelReservation`, `issueRefund` — HIGH/CRITICAL-risk tools. Shipping the agent without prompt-injection rails, tool approval gates, tamper-evident audit, and tenant-isolation invariants would expose guest PII and financial data in production. A Phase 1 minimum-viable security baseline is mandatory.

### Option D: Umbrella ADR naming 12 sub-controls, conservative high-risk posture, Phase 1 minimum-viable baseline, verifier-rule mapping

Adopted. The umbrella names the 12 sub-controls (ADR-081 through ADR-096 plus their amendments), treats PMS AI as high-risk until legal review, prescribes a 10-item Phase 1 minimum-viable-production-safe baseline, and proposes 6 verifier rules (VERIFY-AI-SECURITY-01 through 06) so the security posture is machine-enforced — a developer who adds a Tool without `riskClass` fails CI, not merely a code-review comment.

## 4. Decision

Adopt **Option D** — the umbrella offline-AI-security architecture.

### 12 sub-controls (each owned by a supporting ADR)

| #   | Sub-control                                                  | Supporting ADR | Phase 1 ships       |
| --- | ------------------------------------------------------------ | -------------- | ------------------- |
| 1   | Prompt injection defense (6-layer)                           | ADR-081        | Full impl           |
| 2   | Data exfiltration prevention (PII + egress + GDPR Art. 22)   | ADR-082        | Full impl           |
| 3   | Tenant isolation (5-layer defense-in-depth)                  | ADR-083        | Full impl           |
| 4   | Tamper-evident audit (RFC 6962 Merkle Tree + WORM)           | ADR-084        | Full impl           |
| 5   | AI audit event catalog (what-to-log taxonomy)                | ADR-085        | Contract            |
| 6   | Tool risk 4-class rubric (Low/Medium/High/Critical)          | ADR-086        | Full impl           |
| 7   | Human approval workflow (sync HIGH, async dual CRITICAL)     | ADR-087        | Full impl           |
| 8   | Agent permission intersection (OWASP ASI03)                  | ADR-088        | Full impl           |
| 9   | AI explainability (DecisionRecord, NOT chain-of-thought)     | ADR-089        | Full impl           |
| 10  | Red-team & eval pipeline (Promptfoo CI + nightly drift)      | ADR-090        | Partial (CI only)   |
| 11  | AI observability (OTel GenAI; Langfuse deferred)             | ADR-091        | Partial (OTel only) |
| 12  | Model trust (Sigstore signing + SLSA provenance)             | ADR-092        | Full impl           |
| 13  | Model isolation (Ollama low-priv Windows service + firewall) | ADR-093        | Full impl           |
| 14  | Agent sandbox & egress control (allowlist)                   | ADR-094        | Full impl           |
| 15  | AI configuration & policy                                    | ADR-095        | Contract            |
| 16  | EU AI Act + GDPR compliance posture                          | ADR-096        | Partial (contract)  |

### Conservative risk posture

SmartAgentics hotel PMS AI is **treated as high-risk** under EU AI Act until legal review determines otherwise. The controls still apply if legal review downgrades the tier — defense-in-depth is tier-agnostic.

### Phase 1 minimum-viable-production-safe baseline (10 controls)

1. Model isolation — Ollama as Windows service under low-priv account, `127.0.0.1`-only, firewall egress block (ADR-093).
2. Model signing verification — Ollama loads only Sigstore-signed GGUFs (ADR-092).
3. Prompt injection input rail — Llama Prompt Guard 2 (86M) classifies every input (ADR-081 L2).
4. Prompt injection output rail — Llama Guard 4 (12B) classifies every output (ADR-081 L3).
5. Tool risk classification — 4-class rubric applied to all ~15 Phase 1 tools (ADR-086).
6. Human approval workflow — Restate Pause & Resume for HIGH/CRITICAL; sync UI for HIGH, async dual-control for CRITICAL (ADR-087).
7. Tamper-evident audit — `AIAuditEvent` with RFC 6962 Merkle Tree + nightly `AuditMerkleRoot` publication (ADR-084).
8. Tenant isolation invariant — post-retrieval check that `retrievedChunks[].tenantId == session.tenantId` (ADR-083 T4).
9. Explainability record — every agent decision writes `DecisionRecord` JSON column (ADR-089).
10. Self-hosted Langfuse — optional Phase 1, recommended Phase 2; OTel GenAI instrumentation is Phase 1 mandatory (ADR-091).

### Verifier rule mapping (proposed for Phase D)

| Rule ID               | Sub-control                                                                                                                                                            | Severity |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| VERIFY-AI-SECURITY-01 | Every `Tool` must have `riskClass`, `sideEffectClass`, `approvalPolicy`, `approvalTimeout`, `waitingPeriod` non-null                                                   | ERROR    |
| VERIFY-AI-SECURITY-02 | Every `AgentContract` must have `tenantId NOT NULL`, `decisionEffectClass`, non-empty `capabilities[]`, `promptTemplateHash`                                           | ERROR    |
| VERIFY-AI-SECURITY-03 | Every `AIAuditEvent` must have `prevHash`, `rowHash`, `merkleLeafIndex`, `merkleRootHash`, `promptHash`, `decisionRecord`                                              | ERROR    |
| VERIFY-AI-SECURITY-04 | `AuditMerkleRoot` table must have `AFTER UPDATE OR DELETE` trigger (or Prisma middleware) raising `ABORT`                                                              | ERROR    |
| VERIFY-AI-SECURITY-05 | Every AI-retrieval Prisma model (`KnowledgeChunk`, `MemoryRecord`, `Reservation`, `Guest`, `Invoice`) must have `tenantId NOT NULL` + index on `(tenantId, updatedAt)` | ERROR    |
| VERIFY-AI-SECURITY-06 | `packages/sdk/src/ai/` must export the 12 Stream 8 interfaces                                                                                                          | ERROR    |

### Cross-cutting invariants

- Every AI decision is logged to `AIAuditEvent` with a `DecisionRecord` (ADR-089).
- Every `AIAuditEvent` row is part of a Merkle Tree whose root is published to WORM `AuditMerkleRoot` (ADR-084).
- Every HIGH-risk tool call blocks on Restate `awakeable`; every CRITICAL-risk tool call requires dual-control (ADR-087).
- Every agent effective permission is the intersection of agent capabilities, user JWT, tool roles, and delegation scope, computed at call time (ADR-088).
- No agent egresses any URL not on the allowlist (ADR-094).

## 5. Rationale

- **FC-8.2 closure**: a single umbrella ADR names all sub-controls and maps each to a verifier rule; auditors, regulators, and engineers have one authoritative reference.
- **Conservative high-risk posture** matches EU AI Act Article 12 expectations (s15) and defense-in-depth norms; over-compliance is safer than under-compliance.
- **Phase 1 minimum-viable baseline** ensures the reference `ReservationAssistantAgent` is safe to demo to a real hotel; no HIGH/CRITICAL tool call is shipped without an approval gate.
- **Verifier-rule mapping** makes the posture machine-enforced: a developer who omits `riskClass` or `tenantId` fails CI, not merely code review.
- **Offline-first respected**: every sub-control is implementable without cloud LLM, cloud DLP, or cloud audit SaaS.
- **Cross-cuts Streams 1–7 cleanly**: the umbrella consumes Stream 1 (Ollama binding), Stream 2 (vector partition), Stream 3 (`KnowledgeCitation`), Stream 4 (SQLCipher), Stream 5 (`AIAuditEvent`, `AgentContract`), Stream 6 (Cedar, 7-year retention), Stream 7 (HLC, idempotency) without rework.

## 6. Consequences

- 17 new ADRs (ADR-080 through ADR-096) established; 6 amendments to ADR-001, ADR-011, ADR-013, ADR-046, ADR-048, ADR-049 (performed separately by the Phase D architect).
- 12 new SDK interfaces in `packages/sdk/src/ai/` (extending the existing 5 to 17 total).
- 3 new Prisma tables (`AuditMerkleRoot`, `OtelSpan`, `DriftEvaluationResult`); 3 amendments to existing tables (`AIAuditEvent`, `Tool`, `AgentContract`); all additive.
- 5 new Restate services (`PromptGuardService`, `OutputGuardService`, `ApprovalWorkflowService`, `AuditMerkleVerifierWorkflow`, `DriftEvaluationWorkflow`).
- Windows installer gains: Ollama service account, firewall rules, Llama Prompt Guard 2 (~170MB), Llama Guard 4 (~6GB Q4), Sigstore verifier.
- **Phase 1 effort**: ~31 weeks of Phase E engineering, parallelizable across 2–3 engineers to ~12–15 calendar weeks.
- Dependencies: Streams 1–7 contracts (no rework); `@opentelemetry/api` (Apache 2.0); `@noble/ed25519` (MIT); `sigstore/model-transparency` CLI (MIT); Langfuse Docker image (MIT, Phase 2); Promptfoo CLI (MIT).
- No foundational conflict requires rework of Streams 1–7; all amendments are additive.

## 7. Review Conditions

- Review if legal review downgrades the PMS AI tier from high-risk to limited-risk — would relax Article 12 documentation obligations but not the security controls.
- Review if Phase 1 telemetry shows the 6GB Llama Guard 4 model is too heavy for hotel-server disk budgets — would require a smaller output-rail model or move L3 to Phase 2.
- Review if the 10-item Phase 1 baseline proves insufficient to demo the reference agent safely to a real hotel — would add controls (e.g., break-glass override UI) earlier than planned.
- Review if a community standard for AI security architecture emerges (e.g., NIST AI RMF profile, OWASP Agentic Applications Top 10 stabilization) that should replace the SmartAgentics-owned umbrella.
- Review if Phase 2+ requires cloud AI fallback — would extend the umbrella with cloud-provider trust model and egress encryption sub-controls.
- Review if any verifier rule (VERIFY-AI-SECURITY-01 through 06) proves too strict and blocks legitimate Phase 2 features — would tune the rule severity.
- Review if the EU AI Act phased application (2025–2027) introduces obligations not anticipated in §4 — would extend ADR-096.
