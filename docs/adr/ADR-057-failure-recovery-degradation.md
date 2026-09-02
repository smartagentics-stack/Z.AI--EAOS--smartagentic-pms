# ADR-057: Failure Recovery & Graceful Degradation — AI Failure Must Never Become PMS Failure

**ADR-ID:** ADR-057
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #26 is the most-cited AI reliability principle in SmartAgentics: "AI failure must never become PMS failure. The PMS must continue operating even when AI fails. This is the most important offline-first principle." The directive enumerates failure modes: Model unavailable, Memory exhausted, Insufficient RAM, Invalid model, Corrupt model, Retrieval failure, Tool failure, Agent timeout, Unexpected response, Policy violation. Stream 5 research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §15) surveyed idempotency patterns in agentic tool calling (motomtech, buildmvpfast, Medium "Agents + Retries: 8 Idempotency Traps in Tools", TianPan "The Idempotency Problem in Agentic Tool Calling") and confirmed the decisive architectural principle: **"AI is a step within a deterministic workflow; the workflow (Restate) is the orchestrator; the PMS continues without AI when AI fails."** This is the inverse of "AI-native PMS" — which hospitality.today (`https://www.hospitality.today/article/why-ai-needs-to-sit-beside-your-pms-not-inside-it`) explicitly critiques: "the model is not a system of record. It is an advisory layer with a marketing budget."

Restate — already chosen in ADR-001 — ships first-class Durable Agents support explicitly designed for B4 #26: every LLM call, every tool execution, every routing decision is journaled; on crash, completed steps are replayed without duplicate cost or duplicate side effects (_no double bookings, no duplicate refunds, no duplicate emails_) and execution resumes from the first incomplete step.

## 2. Problem

How should SmartAgentics classify, retry, compensate, and gracefully degrade AI failures so that no PMS feature is ever blocked by an AI failure — without sacrificing reliability for transient errors or risking double-charges for irreversible operations?

## 3. Options

### Option A: Retry everything 3 times

Rejected: HIGH/CRITICAL tools (financial, irreversible) must not auto-retry — double-charge risk (motomtech: "Your agent times out on CreateOrder, retries, and creates two orders. Which failures are safe to retry, plus idempotency keys and compensating transactions.").

### Option B: No retry (fail-fast)

Rejected: transient Ollama errors (model loading, OOM, network blip) are common; fail-fast would make AI unreliable and would push transient failures to the manual-fallback path unnecessarily.

### Option C: AI-as-orchestrator (the AI decides what to retry)

Rejected: violates "AI failure must never become PMS failure" — if the AI's retry logic itself fails, the PMS fails. The retry policy must be deterministic code, not an LLM decision.

### Option D: Cloud AI fallback (when local AI fails, fall back to OpenAI)

Rejected for Phase 1: violates offline-first (per worklog line 7941). Deferred to Phase 2+ as opt-in per ADR-001's "Optional cloud AI fallback".

### Option E: Five-layer failure-recovery architecture

1. Restate journaling (default for every step).
2. Per-step retry policies (configurable per `AgentStep` type and `riskClass`).
3. Idempotency keys (required for HIGH/CRITICAL tools).
4. Compensation/rollback (saga pattern for multi-step operations).
5. Graceful degradation (manual fallback to the deterministic PMS feature).

## 4. Decision

Adopt **Option E** — the five-layer failure-recovery architecture.

### Layer 1: Restate journaling (default for every step)

Every LLM call, every tool call, every routing decision is journaled by Restate via `@restatedev/vercel-ai-middleware` (per ADR-049). On crash, completed steps are replayed without re-execution; execution resumes from the first incomplete step. This is the baseline guarantee: "no duplicate side effects on crash recovery" — _no double bookings, no duplicate refunds, no duplicate emails_.

### Layer 2: Per-step retry policies (configurable per `AgentStep` type)

Restate's built-in retry mechanism with `maxRetryAttempts` and exponential backoff. Defaults:

- `LLM_CALL`: 3 attempts, 1s/4s/16s backoff (transient Ollama errors).
- `TOOL_CALL` (LOW/MEDIUM risk): 3 attempts, 1s/4s/16s backoff.
- `TOOL_CALL` (HIGH/CRITICAL risk): **1 attempt only** — never auto-retry financial/irreversible operations; escalate to human on failure (motomtech).
- `ROUTING_DECISION`: 1 attempt (deterministic; no retry).
- `POLICY_CHECK`: 1 attempt (deterministic; no retry).
- `HUMAN_APPROVAL`: no retry — pause until human responds or `escalationTtl` expires.

### Layer 3: Idempotency keys (required for HIGH/CRITICAL tools)

Every HIGH/CRITICAL tool call carries an idempotency key derived from `(sessionId, stepNumber, toolName, argsHash)`. The tool's handler checks a new `ToolInvocation` Prisma table for an existing successful invocation with the same key; if found, returns the cached result instead of re-executing. This is the standard pattern for payment/refund tools (buildmvpfast).

### Layer 4: Compensation/rollback (saga pattern)

For multi-step operations where one step fails after another has committed, the Supervisor (ADR-050) executes a compensation function. Example: agent calls `createReservation` (succeeds) → calls `chargePayment` (fails) → Supervisor calls `cancelReservation` (compensation). Compensation functions are declared on the `Tool` entity (ADR-054) via `compensationToolId?: ToolId`. For `sideEffects: 'IRREVERSIBLE'` tools, `compensationToolId = null` — the Supervisor's saga pattern handles this by ordering: irreversible tools are called _last_, after all reversible tools succeed (TianPan: "saga patterns, idempotency keys, [dedup tables solve it]").

### Layer 5: Graceful degradation (the "AI failure must never become PMS failure" guarantee)

When all retry/compensation approaches fail, the Supervisor:

1. Writes a `FAILED` `AgentSession` row (ADR-056) with the error.
2. Writes an `AIAuditEvent` with `severity='CRITICAL'` (ADR-052).
3. Returns a structured error to the PMS UI: `{ status: 'AI_FAILED', message: 'The AI assistant could not complete this task. Please complete it manually.', manualFallback: 'reservation_form' }`.
4. The PMS UI surfaces the manual fallback (e.g., the traditional reservation form); the user completes the task manually.
5. The PMS continues operating normally — no PMS feature is blocked by AI failure.

### `AIFailureRecoveryPolicy` SDK interface (`packages/sdk/src/ai/agent.ts`)

```typescript
export interface AIFailureRecoveryPolicy {
  classifyFailure(
    error: unknown,
  ): 'TRANSIENT' | 'PERMANENT' | 'POLICY_VIOLATION' | 'TIMEOUT' | 'OUT_OF_RESOURCES';
  getRetryPolicy(stepType: AgentStepType, riskClass: RiskClass): RetryPolicy;
  getCompensation(toolId: string): string | null;
  getManualFallback(agentId: string, taskType: string): ManualFallback;
}

export type ManualFallback = {
  uiRoute: string; // e.g., '/reservations/cancel'
  message: string;
  prefillData?: unknown; // AI draft work preserved and pre-filled into the manual form
};
```

### Contractual manual fallback

- Every `AgentContract` (ADR-053) declares `manualFallback: ManualFallback` — the deterministic PMS feature that replaces the AI agent when AI fails.
- The PMS UI's "AI assistant" widget has a permanent, visible **"Complete manually"** button that bypasses the AI and uses the deterministic flow. This is not a fallback for emergencies — it is a _first-class_ alternative path that is always available.

### Three-tier operation classification (cross-reference to ADR-058)

- **DETERMINISTIC-CORE** operations (reservations, billing, check-in/out, payment processing) — AI may _suggest_ (draft a reservation, recommend a refund amount) but cannot _commit_ without human approval. The deterministic flow is the _primary_ path. The PMS continues operating normally if all AI is removed.
- **AI-AUGMENTED** operations (guest messaging, search, classification, summarization) — AI is the _preferred_ path; the deterministic fallback (canned responses, keyword search, manual routing) is the _guaranteed_ path.
- **AI-ONLY** operations (natural-language chat, RAG-based policy Q&A) — no deterministic equivalent; on failure, return a friendly "AI unavailable" message; no PMS feature depends on them.

## 5. Rationale

- **B4 #26 is the most-cited AI reliability principle in SmartAgentics** — this ADR is its operational encoding.
- **Five layers, each with a distinct role**: Layer 1 (journaling) handles crashes; Layer 2 (retries) handles transient errors; Layer 3 (idempotency) handles HIGH/CRITICAL retries safely; Layer 4 (compensation) handles multi-step failures; Layer 5 (manual fallback) is the ultimate guarantee.
- **HIGH/CRITICAL tools never auto-retry**: prevents the canonical "agent times out on CreateOrder, retries, creates two orders" failure (motomtech). One attempt; escalate on failure.
- **Idempotency keys are the standard for payments/refunds** (buildmvpfast) — adopted as the contract for every HIGH/CRITICAL tool, not just payment tools.
- **Saga compensation handles multi-step failures**: `compensationToolId` on the `Tool` entity (ADR-054) makes compensation a declared property of each tool, not an ad-hoc decision.
- **Manual fallback is contractual, not emergency-only**: every `AgentContract` declares its `manualFallback`. The "Complete manually" button is always visible — users always have the deterministic path.
- **AI never decides what to retry**: the retry policy is deterministic code (`AIFailureRecoveryPolicy`), not an LLM decision. If the AI's retry logic itself failed, the PMS would fail (B4 #26 violation).
- **hospitality.today alignment**: "the model is not a system of record. It is an advisory layer with a marketing budget." SmartAgentics' deterministic flows (reservations, billing, check-in/out) remain the _system of record_; AI is the _advisory layer_.
- **Restate journaling is the foundation**: without journaling, crash recovery would re-execute tools — double charges, double emails, double bookings. The journal is what makes "no duplicate side effects on crash recovery" possible.

## 6. Consequences

- One new Prisma table (`ToolInvocation`) for idempotency.
- The `AIFailureRecoveryPolicy` SDK interface is added to `packages/sdk/src/ai/agent.ts`.
- The existing PMS UI features (reservation form, billing form, check-in screen) are the manual fallbacks — no new UI work; the "Complete manually" button is added to the AI assistant widget.
- Every `AgentContract` (ADR-053) must declare `manualFallback` — the contract is rejected at the `authorize` step (ADR-050) if missing.
- **Compensation complexity**: some operations have no clean compensation (e.g., "send confirmation email" — once sent, can't unsend). Mitigation: `sideEffects: 'IRREVERSIBLE'` tools declare `compensationToolId: null`; the Supervisor's saga pattern orders irreversible tools _last_, after all reversible tools succeed.
- **Manual-fallback UX risk**: if the manual fallback is poorly designed, users will resent AI failures. Mitigation: the manual fallback is the _existing_ deterministic PMS feature (no new UI); the AI's draft work is preserved and pre-filled into the manual form when possible.
- **Auditability of failures**: a failed AI action must still produce an audit trail. Every failure writes an `AIAuditEvent` with `severity='ERROR'` or `'CRITICAL'` before returning the manual fallback.
- Phase 1 ships the five-layer architecture + the `manualFallback` for the `ReservationAssistantAgent` (the existing reservation form). Phase 1's Promptfoo evals include failure-mode tests (model unavailable, tool failure, timeout).
- Dependencies: Restate retry mechanism; Prisma `ToolInvocation` table; `AIFailureRecoveryPolicy` interface; existing PMS UI routes for manual fallbacks; ADR-058 (deterministic-core boundary, which encodes the three-tier classification).
- This is the AI-BOS "AI Failure Recovery" capability (B4 #26). Every AI-BOS agent must declare its `manualFallback`.

## 7. Review Conditions

- Review if Phase 2+ cloud AI fallback (per ADR-001 "Optional cloud AI fallback") becomes a sixth layer — would amend this ADR with a Layer 4.5 (cloud fallback before manual fallback).
- Review if `compensationToolId` proves insufficient for non-trivial sagas (e.g., 10-step workflows with branching compensation) — would justify a dedicated saga-orchestration ADR.
- Review if the HIGH/CRITICAL "1 attempt only" rule proves too strict in practice (e.g., for tools that fail transiently at scale) — would justify a per-tool override on `Tool.maxRetryAttempts`.
- Review if the `escalationTtl` (default 24h) proves wrong for production escalation workflows.
- Review if a community AI failure-recovery standard emerges (e.g., a standardized `ManualFallback` interchange schema) that should replace the SmartAgentics-owned type.
- Review if the verifier rule from ADR-058 flags any Layer 5 manual-fallback path that itself contains an LLM call (which would be a B4 #26 violation in the fallback).
