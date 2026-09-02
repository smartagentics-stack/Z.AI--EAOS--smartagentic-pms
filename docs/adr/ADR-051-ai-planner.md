# ADR-051: AI Planner — Restate Virtual Object (Plan-and-Execute)

**ADR-ID:** ADR-051
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #16 ("AI Planner") is classified "Architecture Contract — NOW" with the explicit constraint: "Planning does NOT automatically mean execution — critical hotel actions remain subject to policy + human approval." Stream 5 research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §11) surveyed planner architectures and identified two dominant patterns: **Plan-and-Execute** (the planner produces a persisted DAG of steps; execution is a separate, monitored phase) and **ReAct** (planning and execution interleave in a single LLM loop). Authoritative sources (JumpCloud, Telus Digital, Outcome School, IBM) describe Plan-and-Execute as separating "Task Decomposition to break a large goal into a sorted list of milestones. The planner does not interact with [execution]." For a PMS where every action must be auditable and either reversible or human-approved, Plan-and-Execute is the correct pattern.

B4 #16's separation of planning from execution mirrors ADR-058's deterministic-core boundary: the Plan is a reviewable artifact; the Supervisor (ADR-050) executes it step-by-step; HIGH/CRITICAL steps trigger human approval via the Supervisor's `requestApproval` step.

## 2. Problem

Should the AI Planner use the ReAct pattern (interleaved planning + execution), the Plan-and-Execute pattern (separate phases), or a fully deterministic planner (no LLM)?

## 3. Options

### Option A: ReAct pattern (interleave planning and execution in one LLM loop)

Rejected for PMS use. ReAct merges planning and execution prompts into one loop, "allowing the prompt to think one step at a time" (Telus Digital). Appropriate for low-stakes agents (e.g., a coding assistant) but not for hotel operations: every action must be auditable and either reversible or approved; the Plan must be a reviewable artifact _before_ execution begins. ReAct is retained as the _single-step_ execution pattern for Phase 1's `ReservationAssistantAgent` (no planner needed — one or two tool calls per request).

### Option B: LLM-only planning (no DAG persistence)

Rejected: the Plan must be persisted as a Prisma entity so it can be reviewed, approved, audited, and resumed after crashes. The Plan is the durable artifact; the LLM call is just one step in creating it. Without persistence, plan review and resumption are impossible.

### Option C: Fully deterministic planning (no LLM)

Rejected: some guest requests ("handle the group booking cancellation for the conference next week") are too open-ended for a deterministic planner. The LLM produces a candidate plan; the human reviews it; the Supervisor (ADR-050) executes it.

### Option D: Plan-and-Execute as a Restate Virtual Object keyed by `(tenantId, planId)`

The Planner takes a Goal (natural language + structured metadata), produces a Plan (JSON DAG of `PlanStep`s with dependencies), persists the Plan as a Prisma `Plan` entity with `PlanStep` children, and submits each Task to the Supervisor — **but execution is gated by human approval for any Task with `riskClass >= HIGH`**. Plan and execution are separate phases; the Planner is keyed per-tenant.

## 4. Decision

Adopt **Option D** — implement the AI Planner as a Restate Virtual Object named `PlannerService` (`packages/ai/src/planner/planner.service.ts`), keyed by `(tenantId, planId)`.

Handlers:

1. **`createPlan(goal: { description, requestedBy: UserContext, constraints? }) → Plan`** — calls Ollama (Stream 1) with a planning prompt that produces a JSON DAG of `PlanStep` objects; validates every `PlanStep` against the `ToolRegistry` (ADR-054) and the `AgentContract` (ADR-053) before persisting; invalid steps are returned to the LLM for re-planning (max 3 retries); persists to Prisma `Plan` + `PlanStep`.
2. **`getPlan(planId) → Plan`** — read.
3. **`submitPlanForApproval(planId) → ApprovalRequest`** — if any `PlanStep` has `riskClass >= HIGH`, submit the Plan to the `HumanApproval` workflow (B4 #21) for manager review.
4. **`executePlan(planId) → ExecutionResult`** — for each `PlanStep` in dependency order: call `supervisor.runTask({ taskId, agentId: step.assignedAgent, input: step.input, requestedBy })`; collect results; on step failure, transition Plan to `PARTIALLY_COMPLETED` and write an `EscalationRequest`.
5. **`cancelPlan(planId)`** — soft-delete; running steps are NOT cancelled (they complete via their own Restate Workflow); pending steps are marked `CANCELLED`.

Prisma entities:

- `Plan`: `{ id, tenantId, propertyId, goal, status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'EXECUTING' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | 'CANCELLED', createdBy, createdAt, approvedBy?, approvedAt?, planVersion, parentPlanId? }`.
- `PlanStep`: `{ id, planId, stepNumber, description, assignedAgent, input, dependsOn: PlanStep[], riskClass, status: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED', result?, agentSessionId?, startedAt?, completedAt? }`.

## 5. Rationale

- **Separation of planning from execution** (B4 #16) is the decisive design choice. The Plan is a reviewable, persistable, auditable artifact; execution is monitored step-by-step by the Supervisor (ADR-050).
- **Auditability**: every Plan and PlanStep is a Prisma row; divergence between the LLM-produced plan and the executed plan is persisted as a `PlanStep` status change with `divergenceReason`. The original Plan is never mutated, only its step statuses.
- **Durability via Restate**: a multi-step plan ("verify reservation → check cancellation policy → compute refund → issue refund → notify guest → update housekeeping → log audit") may run for hours or days. Restate timers sleep the workflow when waiting for external events; crash recovery resumes from the first incomplete step.
- **Human-in-the-loop by construction**: HIGH/CRITICAL `PlanStep`s trigger human approval via the Supervisor's `requestApproval` step — the Planner does not bypass ADR-058's deterministic-core boundary.
- **Per-tenant isolation**: the `(tenantId, planId)` key gives every plan a per-tenant Restate Virtual Object; cross-tenant plan access is impossible by keying.
- **Phase-1 deferrable**: Phase 1's `ReservationAssistantAgent` is single-step (ReAct-style, no planner needed). The `PlannerInterface` SDK contract is _reserved_ in Phase 1; the implementation ships in Phase 2 when the first multi-step agent is built. This matches the architecture-contract-now / implementation-incremental pattern from prior streams.

## 6. Consequences

- SmartAgentics must implement and maintain `PlannerService` and the `PlannerInterface` SDK contract in `packages/sdk/src/ai/agent.ts`.
- Two new Prisma tables (`Plan`, `PlanStep`) — additive.
- **Plan quality risk**: the LLM may produce invalid plans (non-existent tool, circular dependency). Mitigation: validation against `ToolRegistry` and `AgentContract` before persisting; up to 3 re-planning retries.
- **Plan drift risk**: executed plans may diverge from the LLM-produced plan (step failure, user cancellation). Mitigation: every divergence is persisted with `divergenceReason`; the original Plan is immutable.
- Phase 1 ships the `PlannerInterface` SDK contract only — no implementation. The `ReservationAssistantAgent` uses ReAct-style single-step execution (no planner).
- Dependencies: Ollama (Stream 1) for the planning LLM call; Prisma `Plan` + `PlanStep` tables; Supervisor (ADR-050) for execution; `HumanApproval` workflow (B4 #21); Stream 4 `MemoryStore` for plan-related working memory.
- Reclassifies AI Planner from ADR-011 "Future Vision" to "Architecture Contract — NOW" (FC-5.2).
- Future AI-BOS capabilities (Future Vision 35d dynamic no-code agent builder, 35g AI Trainer) build on this contract.

## 7. Review Conditions

- Review if Phase 2 multi-step agents demonstrate that ReAct-with-safeguards outperforms Plan-and-Execute for specific use cases (would justify a hybrid mode).
- Review if Plan complexity justifies a richer DAG editor UI (e.g., a no-code plan builder) ahead of the LLM-only path.
- Review if `@restatedev/xstate` (per ADR-049 Phase 2+) should be adopted for plan-state-machine modeling once Phase 2 ships its first multi-step agent.
- Review if a community Plan interchange format emerges (e.g., a standardized Plan DAG schema) that should replace the SmartAgentics-owned `Plan`/`PlanStep` Prisma entities.
