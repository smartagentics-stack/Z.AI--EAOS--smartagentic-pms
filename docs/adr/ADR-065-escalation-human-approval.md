# ADR-065: Multi-Agent Escalation & Human Approval — 4-Level Taxonomy, Restate Awakeable HITL

**ADR-ID:** ADR-065
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #21 ("Human Approval") requires "synchronous (blocking) and asynchronous (notification) approval workflows" with explicit escalation rules. B4 #22 ("Multi-Agent Communication") requires escalation chains for cases the agent fleet cannot resolve autonomously. B4 #25 ("AI Failure Recovery") requires that "AI failure must never become PMS failure" — including failures that exceed the agent's authority. B4 #30 ("AI Auditability") requires every escalation to be logged for forensic reconstruction. Stream 5 established the `HumanApprovalRequest` Prisma table (per ADR-052) and the Supervisor's `requestApproval` step (per ADR-050), but deferred the multi-agent escalation chain contract to Stream 6.

Stream 6 research (`/home/z/my-project/phase-c-stream6-multi-agent-report.md`, §8, §9) confirmed the escalation-pattern consensus across industry sources:

- VDF AI (`https://vdf.ai/blog/ai-agents-enterprise-case-management-escalation`): "An agent should escalate on explicit conditions — missing evidence it cannot obtain, a confidence threshold, a policy exception, an approaching deadline."
- Agility-at-Scale: "Communication in an enterprise agent covers two distinct channels: **agent-to-human escalation**, where the agent hands off a decision it cannot or should not make autonomously."
- UiPath: "The first best practice is to define each agent's goals, boundaries, and escalation rules **before deployment**."
- LogicMonitor: "Escalation chains include stages that can contain recipients. An escalation chain must include at least one stage. Later stages of an escalation escalate higher."
- Token.security: "How to Prevent AI Agent Privilege Escalation — Learn how AI agent privilege escalation happens and how permission boundaries, identity controls and short-lived credentials contain it."

Restate's HITL primitives are first-class. Restate "Approvals with Pause & Resume" (`https://docs.restate.dev/ai/patterns/human-in-the-loop`): the canonical 5-step flow — agent creates a durable promise (`ctx.awakeable<boolean>()`) → sends the promise ID to the approver → suspends → approver resolves via HTTP API → agent resumes. Restate "Workflows as Tools" (`https://docs.restate.dev/ai/patterns/...`, p21): "human approval workflow exposed as an agent tool. The workflow creates a durable approval promise, sends a review request, and suspends until a human responds. The agent treats this like any other tool call." Restate "Signals and external events": three primitives — Signal (named, multi-resolvable), Awakeable (one-shot, generated ID), Workflow promise (one-shot, workflow-keyed) — all of which "survive retries and process restarts. When an invocation has nothing else to do while waiting, Restate can suspend it and resume it when the next result arrives."

A2A's `input-required` Task state (per ADR-060) maps directly to SmartAgentics' `PAUSE_FOR_APPROVAL` escalation level — the agent has paused pending human input. Pydantic-AI issue #3274 contributes the critical design principle: "The pattern that usually breaks the loop is treating approval as a **resume of a specific delegated call**, not as a new input to the coordinator." The Reddit r/AI_Agents caution: "Most 'human-in-the-loop' in agent frameworks is theater. The point of human in the loop isn't to be an approver. It's to review and apply feedback or alteration." — meaning the approval response is not just `true/false` but can carry **alterations**.

## 2. Problem

Should SmartAgentics adopt a binary escalation taxonomy (escalate or not), a 4-level taxonomy (AUTO / NOTIFY / PAUSE_FOR_APPROVAL / ESCALATE_TO_HUMAN), LLM-decided escalation, dynamic escalation chains, synchronous-only escalation, or no timeout on `PAUSE_FOR_APPROVAL`?

## 3. Options

### Option A: Binary escalation (escalate or not)

Rejected. Too coarse; conflates "notify the human asynchronously" with "block until the human decides". The hotel operator needs the distinction — a notification should not stop the agent; a blocking approval should.

### Option B: LLM-decided escalation (an LLM decides whether to escalate)

Rejected for triggers. Deterministic triggers are safer (the LLM may not escalate when it should, especially under pressure to "just handle it"). The LLM may decide _content_ of the escalation message, but not _whether_ to escalate. Triggers are explicit and enumerable per `AgentContract`.

### Option C: Dynamic escalation chains (chain changes at runtime based on who's available)

Rejected. Auditability risk (the chain that handles an escalation today may differ from yesterday's; investigations cannot reconstruct). Deployment-defined chains are safer.

### Option D: Synchronous-only escalation (always block)

Rejected. The NOTIFY level exists precisely for non-blocking notifications (e.g., "I upgraded the guest per your standing instruction"). Blocking on every noteworthy action would serialize human attention inappropriately.

### Option E: No timeout on `PAUSE_FOR_APPROVAL` (block forever)

Rejected. Agent holds Restate resources indefinitely; the exclusive handler is blocked; other calls queue. `ctx.sleep(timeout)` + `RestatePromise.race` provides a bounded wait with auto-escalation on timeout.

### Option F: Boolean-only approval (true/false)

Rejected. Loses human alteration capability. Per Reddit r/AI_Agents: "HITL should not be theater." The approval payload must carry alterations (e.g., "approved but with amount reduced to $X").

### Option G: Approval wait inside the agent's exclusive handler

Rejected. R-6.8.1: blocks other calls to the same agent key. Use the Workflows-as-Tools pattern (Restate p21): the approval wait happens in a separate `HumanApprovalService`, not in the agent handler.

### Option H: 4-level taxonomy with deployment-defined chains, Restate `awakeable` + `sleep` race for `PAUSE_FOR_APPROVAL`, Workflows-as-Tools isolation, alterations-capable payload

Adopted. The 4 levels (AUTO / NOTIFY / PAUSE_FOR_APPROVAL / ESCALATE_TO_HUMAN) cleanly separate "agent continues autonomously" from "agent must involve a human". `PAUSE_FOR_APPROVAL` corresponds to A2A's `input-required` state. Explicit, enumerable triggers. Deployment-defined escalation chain (hotel hierarchy: front-desk → manager → admin). Synchronous blocking via Restate `awakeable<ApprovalPayload>`; asynchronous notification via Restate one-way send. Approval workflow as a separate `HumanApprovalService` (Workflows-as-Tools pattern). Approval timeout via `RestatePromise.race` with `ctx.sleep`. Approval resumes the specific delegated call (not a fresh invocation). Approval payload carries alterations.

## 4. Decision

Adopt **Option H** — 4-level escalation taxonomy with Restate `awakeable` HITL.

### 4-level escalation taxonomy

| Level | Name                   | Behavior                                                                                               | Restate primitive                                                                                         | Phase                               |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 0     | **AUTO**               | Agent executes autonomously; no human involvement. Logged for audit.                                   | Normal `ctx.run()`                                                                                        | Phase 1                             |
| 1     | **NOTIFY**             | Agent executes autonomously; sends async notification to human (email/dashboard). Agent does NOT wait. | `ctx.serviceSendClient(HumanNotificationService, userId).notify(...)` (one-way)                           | Phase 2+ (contract-only in Phase 1) |
| 2     | **PAUSE_FOR_APPROVAL** | Agent suspends, waits for human approval, resumes on resolve. (A2A `input-required`.)                  | `ctx.awakeable<ApprovalPayload>()` + `ctx.sleep(timeout)` race via `RestatePromise.race`                  | Phase 1                             |
| 3     | **ESCALATE_TO_HUMAN**  | Agent terminates; hands off to human. No autonomous continuation.                                      | Agent returns `EscalationResult` + sends notification; Supervisor marks task `failed` or `input-required` | Phase 2+ (contract-only in Phase 1) |

### Explicit escalation triggers

Each `AgentContract` declares which triggers apply and their thresholds:

| Trigger                       | Source                                                    | Level                                   |
| ----------------------------- | --------------------------------------------------------- | --------------------------------------- |
| Confidence threshold          | `AgentContract.confidenceThreshold` (Stream 5)            | PAUSE_FOR_APPROVAL or ESCALATE_TO_HUMAN |
| Policy exception              | Deterministic policy rule violation                       | ESCALATE_TO_HUMAN                       |
| Repeated failure              | Tool invocation fails > N retries (Stream 5 retry policy) | ESCALATE_TO_HUMAN                       |
| Approaching deadline          | Task deadline within delta and agent not done             | ESCALATE_TO_HUMAN                       |
| Resource exhaustion           | Token/cost budget exceeded (Stream 5 `AIBudgetEnforcer`)  | ESCALATE_TO_HUMAN                       |
| `manualFallback` reached      | AI failure recovery exhausted (Stream 5 ADR-057)          | ESCALATE_TO_HUMAN                       |
| High-risk tool                | Tool's `riskClass = HIGH                                  | CRITICAL`(Stream 5`ToolPermission`)     | PAUSE_FOR_APPROVAL (mandatory) |
| Empty permission intersection | Per ADR-063                                               | ESCALATE_TO_HUMAN (mandatory)           |
| Unresolvable conflict         | Per ADR-064                                               | ESCALATE_TO_HUMAN (mandatory)           |

### Deployment-defined escalation chain

The chain follows the hotel organizational hierarchy (front-desk → manager → admin), configured per `AgentContract.escalationChain` (deployment-defined; not dynamic). Per LogicMonitor: "later stages of an escalation escalate higher." The chain has multiple recipients per stage (R-6.8.4: if primary is offline, notify secondary).

### `ApprovalPayload` (alterations-capable, not boolean)

```typescript
export interface ApprovalPayload {
  approved: boolean;
  alterations?: object; // e.g., { amount: 500 } for "approved but reduce to $500"
  approverUserId: string;
  approverComments?: string;
}
```

Per Reddit r/AI_Agents: "HITL should not be theater." The Supervisor validates alterations against `ToolPermission` constraints before applying (R-6.9.1).

### `HumanApprovalService` (Workflows-as-Tools pattern, isolates the wait)

A new Restate Workflow service using the Workflows-as-Tools pattern (Restate p21). The agent calls `humanApproval` as a tool; the tool internally creates the awakeable, sends the notification, and awaits. This isolates the wait from the agent's exclusive handler (solves R-6.8.1: PAUSE_FOR_APPROVAL holding the agent's exclusive handler).

```typescript
// Pseudocode — contract only, NOT for Phase 1 implementation
export interface HumanApprovalService {
  requestApproval(request: ApprovalRequest): Promise<ApprovalPayload>;
  notify(notification: HumanNotification): void;
}
```

### Approval timeout via `RestatePromise.race`

```typescript
const approval = ctx.awakeable<ApprovalPayload>();
// send approval.id to HumanApprovalService (which notifies the approver)
const result = await RestatePromise.race([approval.promise, ctx.sleep(timeoutSeconds)]);
if (result === TIMEOUT) {
  // auto-escalate to ESCALATE_TO_HUMAN
}
```

Default timeout: **4 hours for HIGH-risk tools, 24 hours for CRITICAL-risk tools** (configurable per `AgentContract`). NOTIFY reminder at 50% timeout; auto-escalate at 100% (R-6.8.3).

### Approval resumes the specific delegated call

Per the Pydantic-AI principle: the `awakeable` ID is bound to the `MultiAgentTask.id` + `delegationHop` that requested it. The resume carries the approval back to that exact call, not a fresh invocation. This prevents the "fresh coordinator invocation" anti-pattern that Pydantic-AI issue #3274 warns about.

### Extensions to Stream 5's `HumanApprovalRequest` table

Additive fields (separately amended by Phase D architect): `escalationLevel` (EscalationLevel enum), `approvalMode` ('sync' | 'async'), `timeoutAt`, `reminderSentAt`, `alterations` (JSON), `approverComments`. Phase 1 single-agent rows have `escalationLevel = AUTO` or `PAUSE_FOR_APPROVAL`; NOTIFY and ESCALATE_TO_HUMAN rows are Phase 2+.

### Phase 1 ships AUTO + PAUSE_FOR_APPROVAL

The two levels `ReservationAssistantAgent` needs for HIGH-risk tools (e.g., `create_reservation` with payment, `cancel_reservation` with penalty). NOTIFY and ESCALATE_TO_HUMAN are contract-only (implemented in Phase 2+).

## 5. Rationale

- **B4 #21 + B4 #22 + B4 #25 + B4 #30 satisfaction**: synchronous (blocking) and asynchronous (notification) approval workflows; explicit escalation chains; AI failure never becomes PMS failure; every escalation logged.
- **4-level taxonomy cleanly separates "agent continues" from "agent must involve human"**: AUTO and NOTIFY do not block; PAUSE_FOR_APPROVAL blocks with timeout; ESCALATE_TO_HUMAN terminates. The hotel operator gets the right semantic for each situation.
- **`PAUSE_FOR_APPROVAL` = A2A `input-required`**: aligns SmartAgentics' escalation model with the A2A Task state machine adopted in ADR-060. A future A2A interop adapter is a thin wrapper.
- **Explicit, enumerable triggers** are safer than LLM-decided escalation: the LLM may not escalate when it should; deterministic triggers always fire.
- **Deployment-defined escalation chain** matches UiPath ("define escalation rules before deployment") and LogicMonitor ("later stages escalate higher"). Auditability is preserved.
- **Restate `awakeable` + `sleep` race** is the canonical HITL pattern (Restate "Approvals with Pause & Resume"). Durable, replayable, exactly-once. No external approval system.
- **Workflows-as-Tools isolation** solves R-6.8.1: the approval wait happens in `HumanApprovalService`, not in the agent's exclusive handler. Other calls to the same agent key are not blocked.
- **Alterations-capable payload** matches the Reddit r/AI_Agents caution: HITL should enable meaningful human review and alteration, not just rubber-stamp approval. The Supervisor validates alterations before applying.
- **Approval resumes the specific delegated call** (Pydantic-AI principle): no "fresh coordinator invocation" anti-pattern; the resume is bound to the exact `MultiAgentTask.id` + `delegationHop`.
- **Phase 1 ships AUTO + PAUSE_FOR_APPROVAL**: the two levels `ReservationAssistantAgent` needs for HIGH-risk tools. NOTIFY and ESCALATE_TO_HUMAN are contract-only.
- **Restate-native**: no external approval system (ServiceNow / Jira / email-only) in Phase 1 (offline-first). Reserved as future integration via `HumanApprovalService` adapter.

## 6. Consequences

- New Restate Workflow service `HumanApprovalService` (Workflows-as-Tools pattern).
- New SDK interface `HumanApprovalService` in `packages/sdk/src/ai/collaboration.ts` (additive).
- Stream 5's `HumanApprovalRequest` table is **amended** (separately, by the Phase D architect) to add `escalationLevel`, `approvalMode`, `timeoutAt`, `reminderSentAt`, `alterations`, `approverComments`.
- Stream 5's `AgentSupervisorWorkflow` Step 7 "requestApproval" is extended to delegate to `HumanApprovalService` (Workflows-as-Tools) and to support all 4 levels.
- **R-6.8.1 risk (PAUSE_FOR_APPROVAL holds exclusive handler)**: mitigated by `HumanApprovalService` isolation (Workflows-as-Tools).
- **R-6.8.2 risk (approval timeout too short → spurious ESCALATE_TO_HUMAN)**: mitigated by configurable timeout (default 4h HIGH, 24h CRITICAL).
- **R-6.8.3 risk (approval timeout too long → user forgets → stale task)**: mitigated by NOTIFY reminder at 50% timeout; auto-escalate at 100%.
- **R-6.8.4 risk (escalation chain points to offline user)**: mitigated by multiple recipients per stage; secondary if primary offline.
- **R-6.9.1 risk (approval payload alterations invalid)**: mitigated by Supervisor validation against `ToolPermission` constraints before applying.
- **R-6.9.2 risk (`HumanApprovalService` single point of failure)**: mitigated by Restate journaling of all approval calls; on crash, recovery replays.
- **R-6.9.3 risk (approver offline → approval never resolves)**: mitigated by timeout + escalation chain.
- **R-6.9.4 risk (multiple concurrent approvals for same task)**: mitigated by `awakeable` being one-shot; second resolve is rejected by Restate.
- Dependencies: ADR-050 (Supervisor); ADR-052 (`HumanApprovalRequest` table); ADR-054 (`ToolPermission.riskClass`); ADR-060 (A2A `input-required` state mapping); ADR-063 (empty-permission-intersection trigger); ADR-064 (unresolvable-conflict trigger); Restate `awakeable` + `RestatePromise.race` + `ctx.sleep` (in tree). **No new runtime dependencies.**
- Future AI-BOS governance workflows (dual-control for CRITICAL tools, manager override chains, batch approval queues) build on `HumanApprovalService`. Cross-tenant approval delegation (tenant A's admin approves tenant B's exception under a mutual-governance agreement) is a Phase 3+ extension.

## 7. Review Conditions

- Review if Phase 2+ HITL frequency is higher than expected (e.g., every HIGH-risk tool requires approval) — would justify adding a batch approval queue to `HumanApprovalService`.
- Review if the default 4-hour (HIGH) / 24-hour (CRITICAL) approval timeout proves wrong for hotel shifts (8 hours) — would require per-`AgentContract` tuning.
- Review if Phase 3+ AI-BOS requires dual-control for CRITICAL tools (two approvers required) — would extend `ApprovalPayload` with a second approver field.
- Review if a community HITL standard emerges (e.g., a standardized approval-payload schema) that should replace the SmartAgentics-owned `ApprovalPayload`.
- Review if a PMS feature requires external approval system integration (ServiceNow / Jira for IT-change approvals) — would add an adapter implementing `HumanApprovalService`.
- Review if the Supervisor's alteration-validation logic misses constraint types not anticipated in Phase 1 — would extend the validation rule set.
- Review if Phase 2+ multi-agent escalation chains require a `MultiAgentEscalation` table distinct from `HumanApprovalRequest` (to track which agent in a chain triggered the escalation) — would add a new audit table.
- Review if the NOTIFY level is used in Phase 2+ for low-risk-but-noteworthy actions and proves too noisy — would justify batching or filtering notifications per user.
