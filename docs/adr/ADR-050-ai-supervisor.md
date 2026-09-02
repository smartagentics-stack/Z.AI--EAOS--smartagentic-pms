# ADR-050: AI Supervisor — Restate Workflow (8-Step Orchestration)

**ADR-ID:** ADR-050
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #15 ("AI Supervisor") is classified "Architecture Contract — NOW". The Supervisor is the single orchestrator for every AI action in SmartAgentics — every PMS feature that needs AI calls `supervisor.runTask({ taskId, agentId, input, requestedBy })`; no PMS code calls an agent directly. Stream 5 research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §10) confirmed the Supervisor is a _pattern_ (per AWS Bedrock multi-agent docs, Databricks Supervisor Agent docs, Restate "Multi-Agent Orchestration" docs), not a library.

LangChain itself deprecated `langgraph-supervisor` ("we now recommend using the supervisor pattern directly via tools rather than this library for most use cases"). The supervisor's responsibilities (B4 #15: agent authorization, task routing, execution monitoring, policy enforcement, escalation, failure handling, human approval, resource control, tool authorization) map cleanly onto Restate Workflow steps, with each step journaled for durability and auditability.

## 2. Problem

How should SmartAgentics implement the AI Supervisor — as an LLM-driven router, a blocking gatekeeper, a separate process, or a Restate Workflow with explicit journal steps?

## 3. Options

### Option A: Supervisor-as-LLM (an LLM decides which agent handles the task)

Rejected for Phase 1: only one agent exists (`ReservationAssistantAgent`), so routing is a deterministic lookup. An LLM router adds latency, cost, and a non-deterministic failure mode to a critical-path decision. Deferred to Phase 2+ multi-agent (Stream 6), where it may be adopted as a _conditional_ step behind a deterministic fallback.

### Option B: Supervisor-as-blocking-gatekeeper (every tool call routed through the Supervisor for approval)

Rejected: makes the Supervisor a single bottleneck and conflates pre-execution policy (Supervisor) with post-execution observation (Auditor, ADR-052). The Supervisor blocks only on HIGH/CRITICAL tool calls via Vercel AI SDK's `toolApproval`; the Auditor observes all events asynchronously.

### Option C: Supervisor-as-separate-process

Rejected: the Supervisor is a Restate Workflow running inside the existing Restate Server process per ADR-001. A separate process would duplicate deployment, lifecycle, and durability concerns.

### Option D: Supervisor-as-Restate-Workflow with 8 explicit journal steps

Each responsibility maps to a Restate Workflow step. Input: `{ taskId, agentId, input, requestedBy: { userId, role, tenantId, propertyId, sessionId } }`. Output: `{ status: 'COMPLETED' | 'PAUSED_FOR_APPROVAL' | 'ESCALATED' | 'FAILED', result?, approvalRequestId?, escalationReason? }`. Steps (each a journal entry): (1) `authorize`, (2) `buildToolset`, (3) `checkBudget`, (4) `dispatch`, (5) `monitor`, (6) `finalize`, (7) conditional `requestApproval`, (8) conditional `escalate`.

## 4. Decision

Adopt **Option D** — implement the AI Supervisor as a Restate Workflow named `AgentSupervisorWorkflow` (`packages/ai/src/supervisor/supervisor.workflow.ts`).

The 8 steps:

1. **`authorize`** — load `AgentContract` by `agentId`; verify `status = ACTIVE`; verify `tenantId` of the request matches `AgentContract.tenantId` (no cross-tenant agents); verify the calling user's role is permitted to invoke this agent.
2. **`buildToolset`** — construct the agent's tool list as `AgentContract.allowedTools ∩ ToolRegistry.byRiskClass(agent.maxRiskClass)`. The agent may only call tools its contract permits AND that are within its risk-class ceiling. Load tool definitions from the `ToolRegistry` (ADR-054).
3. **`checkBudget`** — verify the tenant token budget; reject with `429 Too Many Requests` if exhausted.
4. **`dispatch`** — invoke the agent handler as a sub-invocation; the Supervisor is the parent Restate Workflow, the Agent is a child Restate service.
5. **`monitor`** — wait for completion or timeout (default 5 min, configurable per `AgentContract.maxDurationMs`); escalate if exceeded.
6. **`finalize`** — write `AgentStep` records to Prisma; write `AIAuditEvent` records (the Auditor reads these); return result.
7. **`requestApproval`** _(conditional)_ — when the agent pauses for a HIGH/CRITICAL tool call, write a `HumanApprovalRequest`, pause via `ctx.sleep`, resume on approval/rejection/timeout.
8. **`escalate`** _(conditional)_ — on agent failure/timeout, write a `HumanApprovalRequest` for a manager role, pause, resume on manager action. If no manager responds within `escalationTtl` (default 24h), the task is `FAILED` and the PMS continues operating normally.

The Supervisor does NOT block tool calls in real time (the Auditor's role, ADR-052); it enforces _pre-execution_ policy by constraining the tool list in the `AgentContract` (ADR-053) and the `buildToolset` intersection.

## 5. Rationale

- **Single choke point for auditability**: every `AIAuditEvent` (ADR-052) originates from a Supervisor step; the Auditor reads from the Restate journal (authoritative) and the Prisma `AgentStep` table (queryable), never from the Supervisor's self-reported state.
- **Per-tenant enforcement at the right layer**: authorization (step 1) and budget (step 3) execute before any LLM call, enforcing tenant boundaries and per-tenant token budgets (per `https://vamshidhar-pandrapagada.medium.com/how-to-deploy-multi-tenant-ai-agent-infrastructure-t`).
- **HITL via Restate Pause & Resume**: Vercel AI SDK's `toolApproval` for HIGH/CRITICAL tool calls maps directly to Restate's documented "Approvals with Pause & Resume" pattern — no custom coordination logic.
- **Idempotent step writes**: each step is a Restate journal entry; on crash, completed steps are replayed without re-execution (no duplicate charges, no duplicate emails).
- **Failure isolation**: when the Supervisor itself is permanently broken, the PMS continues operating without AI per ADR-057 ("AI failure must never become PMS failure").
- **Performance**: journal entries are sub-millisecond on local Restate; the overhead is dominated by LLM call latency anyway.
- **Phase-1 simplicity**: with one agent, the `dispatch` step is a deterministic lookup; Phase 2+ extends routing to multi-agent (Stream 6) without changing the Supervisor contract.

## 6. Consequences

- SmartAgentics must implement and maintain `AgentSupervisorWorkflow` and the `SupervisorInterface` SDK contract in `packages/sdk/src/ai/agent.ts`.
- Every AI action carries Supervisor overhead (~1 Restate journal entry per step). Acceptable given sub-millisecond local journal writes.
- Phase 1 ships the Supervisor with Phase-1 routing (deterministic — one agent). Phase 2+ extends routing to multi-agent (Stream 6).
- Dependencies: Restate TypeScript SDK (per ADR-001); Prisma `AgentContract` (ADR-053), `AgentSession`/`AgentStep` (ADR-056), `HumanApprovalRequest` tables; Stream 4 `MemoryStore`; Stream 3 `RAGPipeline`.
- The Supervisor is the only legitimate entry point for AI in the PMS — verifier rules (ADR-058) flag any direct agent invocation outside the Supervisor.
- Reclassifies AI Supervisor from ADR-011 "Future Vision" to "Architecture Contract — NOW" (FC-5.2).

## 7. Review Conditions

- Review if Phase 2+ multi-agent routing (Stream 6) requires an LLM-based router that materially changes the `dispatch` step's contract.
- Review if the Supervisor becomes a measurable latency bottleneck in production telemetry (would justify parallel dispatch for independent sub-tasks).
- Review if a future Restate release provides a built-in supervisor primitive that deprecates the custom workflow.
- Review if `HumanApprovalRequest` workflows (B4 #21) require their own ADR with semantics beyond what the Supervisor's `requestApproval`/`escalate` steps encode.
