# ADR-069: Phase 1 Multi-Agent Scenarios — Single Agent Only; Phase 2+ Scenarios Documented

**ADR-ID:** ADR-069
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #22 ("Multi-Agent Communication") is classified **"Architecture Contract — NOW (architecture only; full sophisticated autonomy is LATER per file 2 §14)"**. Phase B #18 ("Department AI Agents — Architecture NOW") mandates "implement only Phase 1-justified agents". Phase B #26 reinforces: "Full sophisticated autonomy is later". Phase B #41 ("Massive Department-Agent Fleet (20+) — Deferred — LATER / requirements-driven") keeps the 20+ fleet out of Phase 1. Phase-1-Scope (RA-04) explicitly EXCLUDES "Multi-agent orchestration" from Phase 1.

Stream 6 identified Foundational Conflict **FC-6.1** (carry-forward from Stream 5 FC-5.2): Phase-1-Scope excludes multi-agent, but B4 #22 reclassifies multi-agent as "Architecture NOW". The resolution — same as Stream 5's recommendation — is: **architecture contract reserved now; Phase 1 ships single agent**. Stream 5 already covered FC-6.1 via the ADR-011 amendment recommendation (reclassify Supervisor/Planner/Auditor as NOW; acknowledge SDK gap). Stream 6 REINFORCES this — the multi-agent architecture contract is reserved NOW; Phase 1 ships single agent.

Stream 6 research (`/home/z/my-project/phase-c-stream6-multi-agent-report.md`, §13.3, §16) confirmed the LangChain discipline-first principle: "Many agentic tasks are best handled by a single agent with well-designed tools. You should start here — single agents are simpler to build, reason about, and debug." Phase B #18 and #41 align: implement only Phase 1-justified agents; defer the 20+ fleet. Stream 5's `ReservationAssistantAgent` (per Stream 5 §20) is the one Phase 1-justified agent for a Hotel PMS — it handles the highest-frequency, highest-value workflow (reservation creation, modification, cancellation with payment).

Stream 6 documented four realistic Phase 2+ multi-agent scenarios for a Hotel PMS, informed by hotel-industry sources (search s26, s36):

- Infor: "AI housekeeping orchestration agent. It integrates with the PMS to predict which rooms will vacate first".
- revfine.com: "AI agents in hotel housekeeping reassign rooms and reprioritize cleans".
- LinkedIn: "Guest reports a fault at reception. AI logs it, categorises it, routes it directly to the correct engineer, and updates the room status in real time".

Each scenario maps to a LangChain multi-agent pattern (Subagents / Handoffs / Router / Orchestrator-Worker) and to the SmartAgentics architecture contract (ADR-060 through ADR-068). Phase 1 ships none of these scenarios — only the single `ReservationAssistantAgent` — but the contract is in place so Phase 2+ implementation is straightforward.

## 2. Problem

Should SmartAgentics ship a Phase 1 multi-agent topology (e.g., Supervisor + Reservation + Housekeeping + Finance), ship the single `ReservationAssistantAgent` only with the multi-agent contract reserved, or defer the multi-agent contract entirely to Phase 2+?

## 3. Options

### Option A: Phase 1 multi-agent topology (Supervisor + multiple specialists)

Rejected. Premature. Phase 1's job is to prove the agent runtime (Stream 5) + the multi-agent contract (Stream 6) with one agent. Building a second specialist agent in Phase 1 without a proven runtime is premature (LangChain discipline-first: "start with single agent + good tools"). Phase B #18 mandates "implement only Phase 1-justified agents"; only `ReservationAssistantAgent` is Phase 1-justified. Phase B #41 defers the 20+ fleet.

### Option B: Single `ReservationAssistantAgent` only; multi-agent contract deferred entirely to Phase 2+

Rejected. Phase B #22 reclassifies multi-agent as "Architecture NOW". Deferring the contract entirely would mean Phase 2+ implementation requires retrofitting the SDK interfaces, Prisma tables, signed-JWT claims, and audit fields — breaking every issued token and every historical audit event. The contract must be in place from day one (per FC-6.2, FC-6.6 resolutions in ADR-063 and ADR-068).

### Option C: Single `ReservationAssistantAgent` + multi-agent contract reserved NOW (architecture-only)

Adopted. Phase 1 ships ZERO multi-agent scenarios — only the single `ReservationAssistantAgent` (per Stream 5 §20). The multi-agent architecture contract (SDK interfaces, Prisma tables, signed-JWT `DelegationContext` claims, `AIAuditEvent` multi-agent fields, `RunawayLimits`, 4-level escalation, deadlock-safe topology rules, three correlation IDs) is reserved NOW per ADR-060 through ADR-068. Phase 2+ scenarios are documented as implementation targets.

## 4. Decision

Adopt **Option C** — Phase 1 ships ZERO multi-agent scenarios; the multi-agent architecture contract is reserved NOW.

### Phase 1 ships

Exactly **one agent**: `ReservationAssistantAgent` (per Stream 5 §20), extended with:

- **`RoutingPolicy`** (per ADR-061): `deterministic` mode; always returns `ReservationAssistantAgent`. No LLM call.
- **`DelegationContext`** (per ADR-063): always `delegationDepth: 0`, `parentAgentId: null`. The signed-JWT verifier enforces it from day one.
- **`RunawayLimits`** (per ADR-067): `maxIterations=10`, `maxTokenBudget` (per Stream 5 `AIBudgetEnforcer`), `maxWallClockSeconds=300`, `maxDelegationDepth=5`, `circuitBreakerPolicy=default`, `progressDetection=true`. Layers 1–3 (iteration/budget/timeout) enforced; Layers 4–6 contract-only.
- **`HumanApprovalService` integration** (per ADR-065): HIGH-risk tools (e.g., `create_reservation` with payment, `cancel_reservation` with penalty) call `requestApproval` tool. Phase 1 ships `AUTO` + `PAUSE_FOR_APPROVAL`; `NOTIFY` and `ESCALATE_TO_HUMAN` contract-only.

The contract in place (per ADR-060 through ADR-068):

- New SDK file `packages/sdk/src/ai/collaboration.ts` with `MultiAgentChannel`, `RoutingPolicy`, `DelegationGuard`, `ConflictResolutionPolicy`, `HumanApprovalService`, `SessionContext` interfaces and supporting types (`MultiAgentTask`, `MultiAgentTaskState`, `DelegationContext`, `AgentHandoff`, `ApprovalPayload`, `EscalationLevel`, `RunawayLimits`).
- New Prisma tables `MultiAgentTask`, `AgentDelegation`, `CircuitBreakerState` — additive; Phase 1 rows are trivially single-row or empty.
- Amendments to Stream 5's `AIAuditEvent` table (additive multi-agent fields, null for Phase 1) and `HumanApprovalRequest` table (additive escalation/approval fields) — separately performed by the Phase D architect.
- Amendment to Stream 5's `AgentContract` (additive `runawayLimits` field) and signed-JWT identity (additive `DelegationContext` claim set) — separately performed by the Phase D architect.
- New Restate Workflow service `HumanApprovalService` (Workflows-as-Tools pattern) — Phase 1 implementation for HIGH-risk tool approval.
- Restate service configuration: pause on retry exhaustion (per ADR-067).
- Static-analysis verifier rule for deadlock-safe topology (per ADR-066) — contract in Phase 1; ships in Phase 2+ when the first multi-agent topology is deployed.
- Three correlation IDs (Restate invocation ID / W3C `traceparent` / application `correlationId`) all in place from day one (per ADR-068).

### Phase 2+ scenarios documented (NOT implemented in Phase 1)

Four scenarios, each mapped to a LangChain multi-agent pattern and the SmartAgentics architecture contract:

#### Scenario 1 — Front-desk routing (Phase 2)

- **Pattern**: Subagents (LangChain #1, per ADR-060).
- **Description**: A `FrontDeskAgent` (Supervisor) routes guest queries to specialists: `ReservationAgent` (booking), `FinanceAgent` (billing), `HousekeepingAgent` (room status). The Supervisor uses an LLM `RoutingPolicy` (per ADR-061, `llmRouter` mode) to classify the query's capability and dispatch.
- **Architecture touchpoints**: ADR-060 (Subagents pattern), ADR-061 (LLM `RoutingPolicy`), ADR-062 (`SessionContext` shared blackboard so specialists see guest context), ADR-063 (`DelegationContext` for Supervisor → Specialist hops), ADR-068 (multi-agent audit trail).
- **Phase 2+ agents required**: `FrontDeskAgent`, `ReservationAgent`, `FinanceAgent`, `HousekeepingAgent`.

#### Scenario 2 — Parallel check-out fan-out (Phase 2)

- **Pattern**: Parallel Agents (Restate `https://docs.restate.dev/ai/patterns/parallelization`) + Orchestrator-Worker (Restate `https://docs.restate.dev/ai/patterns/orchestrator-worker`).
- **Description**: At check-out, the Supervisor fans out in parallel to `InvoiceAgent` (generate final invoice), `HousekeepingAgent` (queue room cleanup), `InventoryAgent` (post minibar charges). Results are gathered and synthesized. Uses `MultiAgentChannel.fanOut` (per ADR-060) which maps to `RestatePromise.all` over multiple `ctx.serviceClient()` calls.
- **Architecture touchpoints**: ADR-060 (`fanOut` primitive), ADR-061 (`RoutingPolicy` with parallel dispatch), ADR-062 (`SessionContext` for cross-agent read), ADR-064 (conflict resolution if specialists disagree on check-out action), ADR-067 (circuit breakers at agent boundaries for fan-out failure containment).
- **Phase 2+ agents required**: `InvoiceAgent`, `HousekeepingAgent`, `InventoryAgent` (plus the existing `ReservationAssistantAgent` as orchestrator or a new `CheckOutAgent`).

#### Scenario 3 — Housekeeping + maintenance coordination (Phase 2)

- **Pattern**: Handoffs (LangChain #3, per ADR-060) with `SessionContext` blackboard (ADR-062).
- **Description**: Guest reports a fault at reception → `FrontDeskAgent` logs it → routes to `MaintenanceAgent` (creates work order) + `HousekeepingAgent` (updates room status to out-of-order). The handoff uses Virtual Object state storing `last_agent_name` (per ADR-061) so the next invocation resumes with the right specialist. The `SessionContext` blackboard (ADR-062) holds the fault report shared across agents.
- **Architecture touchpoints**: ADR-060 (Handoffs pattern), ADR-061 (Handoff via Virtual Object `last_agent_name` state), ADR-062 (`SessionContext` shared blackboard for fault report), ADR-065 (escalation to manager if fault is CRITICAL), ADR-068 (multi-agent audit trail for the handoff chain).
- **Phase 2+ agents required**: `FrontDeskAgent`, `MaintenanceAgent`, `HousekeepingAgent`.

#### Scenario 4 — Overbooking resolution (Phase 3)

- **Pattern**: Orchestrator-Worker + HITL (per ADR-065 `PAUSE_FOR_APPROVAL`).
- **Description**: `ReservationAgent` detects overbooking → escalates to `FrontDeskAgent` (Supervisor) → Supervisor invokes `FinanceAgent` (compensation calculation) + `ReservationAgent` (rebooking at sister property) → pauses for manager approval (`PAUSE_FOR_APPROVAL`, per ADR-065). The manager approves (with alterations, e.g., "approve rebooking but cap compensation at $X"); the Supervisor applies alterations and resumes the specific delegated call (per the Pydantic-AI principle).
- **Architecture touchpoints**: ADR-060 (Orchestrator-Worker pattern), ADR-061 (delegation chain Supervisor → Finance + Reservation), ADR-062 (`SessionContext` for overbooking state), ADR-063 (`DelegationContext` with chain hash), ADR-064 (conflict resolution if Finance and Reservation disagree on compensation), ADR-065 (`PAUSE_FOR_APPROVAL` with alterations-capable payload), ADR-067 (RunawayLimits for the overbooking chain), ADR-068 (full audit trail of the overbooking resolution).
- **Phase 3+ agents required**: `ReservationAgent`, `FrontDeskAgent`, `FinanceAgent` (all from Scenarios 1–3) + sister-property `ReservationAgent` (cross-property, AI-BOS Phase 3+).

### Phase 2+ implementation rules

- Phase 2+ agents are implemented **only when required by actual PMS workflows** (per Phase B #18 / #41). No speculative agent construction.
- Each new agent requires an `AgentContract` (per ADR-053) declaring `capabilities`, `permissions`, `allowedTools`, `maxRiskClass`, `confidenceThreshold`, `runawayLimits`, `escalationChain`, `routingPolicy`.
- Each new agent registers with the `RoutingPolicy` (per ADR-061) so the Supervisor can dispatch to it.
- Each new agent integrates with the `SessionContext` (per ADR-062) for shared blackboard access.
- Each new agent's tools are registered with the `ToolRegistry` (per ADR-054) and `ToolPermission` (per ADR-054).
- The deadlock-safe topology verifier (per ADR-066) runs in CI from Phase 2+ forward.
- Phase 2+ multi-agent integration tests (Promptfoo evals + Playwright E2E) exercise `DelegationContext` propagation, `RoutingPolicy` dispatch, `HumanApprovalService` round-trip, `RunawayLimits` enforcement, and `AIAuditEvent` multi-agent fields populated.

### Rejected for Phase 1–2

- **20+ agent fleet** (Phase B #41 deferred): rejected for Phase 1–2. Reserved for LATER / requirements-driven.
- **Cross-tenant procedure marketplace** (AI-BOS vision): reserved for Phase 3+.
- **Multi-property agent collaboration** (same chain, multiple properties): reserved for Phase 3+ (Scenario 4 partial coverage).
- **Agent-to-agent reputation / trust scoring** (Cedar L1 "trust score 1–5" reference): deferred.
- **Debate pattern** (multiple agents argue, human picks winner): deferred (per ADR-064).
- **Swarm pattern** (fully decentralized peer-to-peer): deferred (per ADR-061).

## 5. Rationale

- **FC-6.1 resolution (carry-forward from Stream 5 FC-5.2)**: Phase-1-Scope excludes multi-agent; B4 #22 reclassifies as "Architecture NOW". Resolution: architecture contract reserved NOW (per ADR-060 through ADR-068); Phase 1 ships single agent. Already covered by Stream 5's ADR-011 amendment recommendation; this ADR reinforces.
- **B4 #22 + B4 #26 + B4 #18 + B4 #41 satisfaction**: architecture contract NOW; full sophisticated autonomy LATER; implement only Phase 1-justified agents (only `ReservationAssistantAgent`); 20+ fleet deferred.
- **LangChain discipline-first principle**: "start with single agent + good tools. Single agents are simpler to build, reason about, and debug." Phase 1's job is to prove the runtime + contract with one agent.
- **Contract-first de-risks Phase 2+**: the SDK interfaces, Prisma tables, signed-JWT `DelegationContext` claims, `AIAuditEvent` multi-agent fields, `RunawayLimits`, 4-level escalation, deadlock-safe topology rules, and three correlation IDs are in place from day one. Phase 2+ implementation is straightforward — no retrofitting, no breaking changes to issued tokens or historical audit events.
- **Phase 2+ scenarios are documented and mapped to architecture touchpoints**: each scenario identifies which ADRs it exercises, so Phase 2+ implementation is contract-driven, not speculative.
- **Phase 2+ agents are requirements-driven** (per Phase B #18 / #41): no speculative agent construction. A specialist agent is built only when an actual PMS workflow requires it.
- **Phase 3+ Scenario 4 (overbooking resolution) is the most complex**: requires Orchestrator-Worker + HITL + cross-property delegation. Reserved for Phase 3+ when AI-BOS multi-property collaboration is in scope.
- **Rejected alternatives (20+ fleet, cross-tenant marketplace, multi-property, debate, swarm) are explicitly deferred** — not silently dropped. Each is mapped to a Phase 3+ reservation.
- **Phase 1 effort estimate** (per Stream 6 §16.5): 2–3 weeks of Phase E engineering for the contract + SDK interfaces + 3 Prisma tables + 1 Restate service + reference agent extension. Multi-agent runtime implementation (LLM router, second specialist agent, parallel fan-out) deferred to Phase 2+ (~4–6 weeks).

## 6. Consequences

- Phase 1 ships ZERO multi-agent scenarios. Only the single `ReservationAssistantAgent` (per Stream 5 §20), extended with the contract fields (`RoutingPolicy`, `DelegationContext`, `RunawayLimits`, `HumanApprovalService` integration).
- The contract (ADR-060 through ADR-068) is in place from day one. Phase 2+ implementation swaps in real multi-agent behavior behind stable interfaces.
- Phase 1 ships Layers 1–3 of the 6-layer runaway defense (per ADR-067); Layers 4–6 contract-only.
- Phase 1 ships `AUTO` + `PAUSE_FOR_APPROVAL` escalation levels (per ADR-065); `NOTIFY` and `ESCALATE_TO_HUMAN` contract-only.
- Phase 1 ships the deadlock-safe topology verifier rule as contract-only (per ADR-066); the rule ships in CI in Phase 2+ when the first multi-agent topology is deployed.
- **R-6.1 risk (Phase 1 ships single agent → multi-agent contract untested in production until Phase 2+)**: mitigated by integration tests with a stub second agent (e.g., a stub `HousekeepingAgent` that echoes back its delegation context) — tests verify `DelegationContext` propagation, `RoutingPolicy` dispatch, `HumanApprovalService` round-trip, `RunawayLimits` enforcement, `AIAuditEvent` multi-agent fields populated. The contract is validated even if Phase 1 deploys one agent.
- **R-6.36 risk (6-layer defense may over-engineer Phase 1 — single agent)**: mitigated by Phase 1 shipping Layers 1–3 only; Layers 4–6 contract-only.
- Dependencies: Stream 5 (`ReservationAssistantAgent` per ADR-049; `AgentContract` per ADR-053; `ToolRegistry` per ADR-054; signed-JWT identity per ADR-055; 5-layer failure recovery per ADR-057; observability stack per ADR-059); ADR-060 through ADR-068 (the multi-agent contract). **No new runtime dependencies.**
- Phase 2+ implementation is contract-driven: each new agent requires an `AgentContract`, registers with the `RoutingPolicy`, integrates with `SessionContext`, registers tools with the `ToolRegistry`, and is covered by the deadlock-safe topology verifier.
- Phase 3+ AI-BOS extensions (cross-tenant procedure marketplace, multi-property collaboration, agent-to-agent reputation, debate, swarm) build on the contract but require additional ADRs at their respective phases.

## 7. Review Conditions

- Review if Phase 2+ PMS workflow requirements emerge that require a second specialist agent (e.g., `HousekeepingAgent` for Scenario 3) — would trigger Phase 2+ implementation of the documented scenario.
- Review if Phase 1 integration tests with a stub second agent reveal contract gaps (e.g., `MultiAgentChannel.fanOut` signature insufficient) — would require extending the contract before Phase 2+ implementation.
- Review if Phase 2+ `RoutingPolicy.llmRouter` mode requires a different Ollama model than Stream 1's default — would coordinate with Stream 1 model selection policy.
- Review if Phase 2+ multi-agent Promptfoo evals reveal unexpected behavior (e.g., `DelegationContext` not propagated correctly) — would require fixing the contract or the Supervisor implementation.
- Review if Phase 3+ AI-BOS features (agent marketplace, cross-tenant procedures, multi-property collaboration) require extending the contract — would warrant new ADRs at Phase 3+.
- Review if Phase 1 `ReservationAssistantAgent` workload grows to require parallel fan-out (e.g., batch reservation processing) — would justify earlier adoption of Scenario 2 (parallel fan-out) in Phase 2.
- Review if a community hotel-PMS multi-agent standard emerges (e.g., a standardized front-desk routing schema) that should replace the SmartAgentics-owned scenarios.
- Review if Phase 2+ operator feedback indicates the deadlock-safe topology verifier rule is too strict (e.g., flags valid topologies) — would require refining the rule.
- Review if Phase 2+ HITL frequency (PAUSE_FOR_APPROVAL) is higher than expected — would justify earlier adoption of NOTIFY (asynchronous notification) in Phase 2.
- Review if Phase 3+ Scenario 4 (overbooking resolution with cross-property rebooking) requires a separate `CrossPropertyDelegationContext` extension to `DelegationContext` (per ADR-063) — would warrant a Phase 3+ ADR.
