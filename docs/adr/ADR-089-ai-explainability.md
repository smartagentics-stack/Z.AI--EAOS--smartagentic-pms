# ADR-089: AI Explainability — DecisionRecord Contract (NOT Chain-of-Thought)

**ADR-ID:** ADR-089
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #31 ("AI explainability") is classified as **"Partial"** and explicitly specifies: "Architecture must define AI explainability with decision trees, citation/provenance, why-was-this-action-taken, auditable decision metadata (**NOT chain-of-thought**)." Stream 8 Foundational Conflict **FC-8.7** (High) flags the gap: Stream 3 specified citation-forcing RAG with `<source chunk_id="…">` tags, but did NOT specify the explainability record contract — the structured `DecisionRecord` that answers "why did the agent do X?" without exposing chain-of-thought.

The Stream 8 research (s12) is unambiguous:

- **Token.security transparency in agentic AI** (January 2026): "Agentic AI must be explainable to be trustworthy. Explore techniques for making autonomous AI decisions transparent, auditable, and [aligned with policy]."
- **Knostic AI search explainability** (June 2025): "AI search explainability makes AI-generated answers traceable and understandable, which is essential for compliance, accountability, [and trust]."
- **GDPR Article 22** (s19): the data subject has the right to obtain "human intervention," to "express his or her point of view," and to "contest the decision." This requires a human-readable explanation of why the AI reached the decision.

Stream 3 §7.3 already established citation-forcing RAG with `<source chunk_id="…">` tags, a coverage score (lightweight Ragas Faithfulness variant), and a per-chunk `KnowledgeCitation` table. The missing piece is the **consolidated `DecisionRecord` contract** that joins RAG citations, tool calls, confidence, and human oversight into a single structured record persisted to `AIAuditEvent.decisionRecord`.

The critical design constraint (per Phase B B4 #31) is that chain-of-thought is **never** persisted: it is unreliable per Anthropic's own research, leaks reasoning that attackers can exploit, and bloats the audit table 10–100×. Only the structured decision record — the _what_, _why_ (citations), _confidence_, and _human oversight_ — is persisted.

## 2. Problem

Should SmartAgentics persist chain-of-thought, use SHAP/LIME feature attribution, use LLM-generated post-hoc explanations, or adopt a structured `DecisionRecord` contract? What fields does the contract carry?

## 3. Options

### Option A: Persist chain-of-thought (the model's internal reasoning trace)

Rejected per Phase B B4 #31 explicit instruction. Chain-of-thought is unreliable per Anthropic research (the model's stated reasoning may not match its actual decision process), leaks reasoning attackers can exploit (a prompt-injection attacker who sees the reasoning can adapt), and bloats the audit table 10–100×.

### Option B: SHAP / LIME feature attribution

Partially rejected. These are ML-model explainability techniques designed for tabular models; they don't apply cleanly to LLM tool-use decisions. Reserved for Phase 3+ if a specific regulator demands feature-level attribution.

### Option C: LLM-generated natural-language explanation post-hoc

Partially rejected. Useful as a UI convenience (an LLM can summarize the `DecisionRecord` for display), but the structured `DecisionRecord` is the authoritative source. The LLM-generated summary is never the audit record itself — it can hallucinate.

### Option D: Structured `DecisionRecord` contract (what + why + confidence + oversight; NOT chain-of-thought)

Adopted. The contract joins RAG citations, tool calls, confidence, and human oversight into a single machine-readable + human-readable record persisted to `AIAuditEvent.decisionRecord`.

## 4. Decision

Adopt **Option D** — the `DecisionRecord` contract.

### `DecisionRecord` interface (new in `packages/sdk/src/ai/explainability.ts`)

```typescript
interface DecisionRecord {
  // What the agent was asked to do
  goal: string; // natural-language summary
  goalCanonical: string; // e.g., "RESERVATION_CREATE"

  // What the agent knew
  retrievedKnowledgeChunkIds: string[]; // Stream 3 chunk IDs
  retrievedMemoryRecordIds: string[]; // Stream 4 memory IDs
  retrievedBusinessData: {
    // Stream 5 tool call results
    toolId: string;
    resultSummary: string; // natural-language summary
    resultRef: string; // pointer to full result in cold storage
  }[];

  // What the agent did
  toolCalls: {
    toolId: string;
    args: Record<string, unknown>; // zod-validated
    riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    resultSummary: string;
    approvalRequestId?: string; // if HIGH/CRITICAL
  }[];

  // Why the agent did it (citations)
  citations: {
    chunkId: string;
    docId: string;
    docVersion: number;
    sectionHeader: string;
    pageNumber?: number;
    relevanceScore: number; // RRF rank
    quotedText: string; // the specific text that supported the claim
  }[];

  // Confidence
  confidenceScore: number; // 0.0 - 1.0, Stream 3 coverage score
  confidenceFactors: {
    retrievalScore: number;
    coverageScore: number;
    selfReportedLogprob?: number;
  };

  // Alternatives considered (if any)
  alternativesConsidered?: {
    description: string;
    rejectedBecause: string;
  }[];

  // Human oversight
  humanApprovalRequested: boolean;
  humanApprovalDecision?: 'APPROVED' | 'REJECTED' | 'TIMEOUT' | 'OVERRIDDEN';
  humanApproverId?: string;
  humanOverrideReason?: string; // if the human overrode the agent's recommendation

  // NOT included: chain-of-thought, model internal reasoning trace
}
```

### What is explicitly NOT in `DecisionRecord`

- The model's chain-of-thought reasoning trace (unreliable per Anthropic research; leaks reasoning attackers can exploit; bloats the audit table 10–100×).
- The raw model output text (only structured tool calls + citations are persisted; raw text may go to cold storage if retention policy demands, but not in the hot queryable `DecisionRecord`).
- The full prompt template (only a `promptHash` is in `AIAuditEvent`; the prompt template itself is in `AgentContract` for join-based retrieval).

### Why-was-this-action-taken query

A hotel GM asks "Why did the AI cancel this reservation?" The system joins `AIAuditEvent` (where `toolCalls[].toolId = 'cancelReservation'` and `toolCalls[].args.reservationId = X`) and renders the `DecisionRecord` as a human-readable explanation: "The agent was asked to cancel reservation X. It retrieved SOP-001 §4.2 (cancellation policy) and the guest's folio (which showed a $200 penalty per policy). It called `cancelReservation` with riskClass=HIGH. Manager Y approved at 14:32. Confidence: 0.87."

### Decision tree rendering

For complex multi-step agent decisions (Plan-and-Execute, Stream 5 §7), the `DecisionRecord` includes the plan DAG (from `PlannerService`) and each task's `DecisionRecord` is a child node. The UI renders this as an expandable tree.

### UI view

New UI view `/audit/decision/[eventId]` renders the `DecisionRecord` as a human-readable explanation. The raw JSON is also available for forensic / regulator export.

### Phase 1 scope

- `DecisionRecord` TypeScript interface.
- `AIAuditEvent.decisionRecord` JSON column (ADR-046 amendment).
- UI view `/audit/decision/[eventId]`.
- The reference `ReservationAssistantAgent` populates `DecisionRecord` end-to-end.

## 5. Rationale

- **FC-8.7 closure**: the structured `DecisionRecord` answers "why did the agent do X?" without exposing chain-of-thought.
- **Phase B B4 #31 satisfaction**: auditable decision metadata (citations, provenance, why-was-this-action-taken) — NOT chain-of-thought.
- **GDPR Article 22 right-to-explanation** (s19): the `DecisionRecord` provides a meaningful (exceeds the legal minimum) explanation; the human-approval workflow (ADR-087) provides the right-to-human-intervention; the `HUMAN_APPROVAL_REJECTED` audit event provides the right-to-contest.
- **Token.security principle** (s12): "Agentic AI must be explainable to be trustworthy" — the `DecisionRecord` makes every AI decision transparent and auditable.
- **Knostic principle** (s12): "AI search explainability makes AI-generated answers traceable" — the `citations[]` field provides traceability to source documents.
- **Stream 3 reuse**: `citations[]` consumes Stream 3's `KnowledgeCitation` table; `retrievedKnowledgeChunkIds[]` consumes Stream 3's `KnowledgeChunk`.
- **Stream 4 reuse**: `retrievedMemoryRecordIds[]` consumes Stream 4's `MemoryRecord`.
- **Decision tree rendering** supports complex multi-step Plan-and-Execute decisions — the UI shows the plan DAG and each task's child `DecisionRecord`.
- **LLM-generated post-hoc summary** is allowed as a UI convenience but never as the authoritative record — the structured `DecisionRecord` is authoritative; the LLM summary can hallucinate.

## 6. Consequences

- New `DecisionRecord` TypeScript interface in `packages/sdk/src/ai/explainability.ts`.
- New `AIAuditEvent.decisionRecord` JSON column (ADR-046 amendment, additive).
- New UI view `/audit/decision/[eventId]`.
- New `AIAuditEvent` event type: `DECISION_MADE` (with `decisionRecord`), `DECISION_OVERRIDDEN_BY_HUMAN`.
- **Risk: `DecisionRecord` JSON can grow large (10KB+ for complex multi-tool decisions).** Mitigation: cold-storage reference for `retrievedBusinessData[].resultRef` and `citations[].quotedText` (truncate `quotedText` to 500 chars in hot storage; full text in `KnowledgeChunk`).
- **Risk: the "alternatives considered" field is only populated if the agent explicitly evaluates alternatives.** Many agent designs (e.g., a single-tool-call agent) don't naturally produce alternatives. Mitigation: field is optional; the `PlannerService` (Stream 5 §7) populates it for multi-step plans.
- **Risk: an LLM-generated post-hoc summary hallucinates** (the summary says the agent considered X when the `DecisionRecord` doesn't show it). Mitigation: the UI renders the structured `DecisionRecord` as authoritative; the LLM summary is clearly labeled as a convenience and never the audit record.
- **Risk: a regulator demands feature-level attribution** (SHAP/LIME). Mitigation: reserved for Phase 3+ if a specific regulator demands it; the `DecisionRecord` covers the LLM tool-use case.
- Dependencies: Stream 3 `KnowledgeCitation`; Stream 4 memory records; Stream 5 `AIAuditEvent`, tool calls; Stream 5 `HumanApprovalRequest`; ADR-087 (human approval decision field).
- Phase 1 effort: ~2 weeks of Phase E engineering. The reference `ReservationAssistantAgent` populates `DecisionRecord` end-to-end. The UI view is the dominant cost.

## 7. Review Conditions

- Review if Phase 2+ telemetry shows `DecisionRecord` JSON consistently exceeds 50KB — would require more aggressive cold-storage offloading.
- Review if a regulator demands feature-level attribution (SHAP/LIME) — would add a Phase 3+ extension.
- Review if the LLM-generated post-hoc summary proves more useful than the structured record for non-technical users — would invest in summary-quality tuning while keeping the structured record authoritative.
- Review if Phase 2+ multi-agent decisions produce `DecisionRecord` trees too deep to render (Stream 6 limits delegation to 5 hops) — would require a tree-pruning UI.
- Review if GDPR Article 22 right-to-explanation enforcement guidance evolves to demand a specific explanation format — would add a regulator-export adapter.
- Review if `citations[].quotedText` truncation to 500 chars proves too aggressive for legal evidence — would increase the limit or move to per-tenant configuration.
- Review if a community explainability standard emerges (e.g., a standardized `DecisionRecord` schema) that should replace the SmartAgentics-owned contract.
