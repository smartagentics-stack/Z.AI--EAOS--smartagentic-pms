# ADR-067: Runaway Agent Chain Prevention — 6-Layer Defense

**ADR-ID:** ADR-067
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #25 ("AI Failure Recovery") requires that "AI failure must never become PMS failure". Phase B #41 ("Massive Department-Agent Fleet (20+) — Deferred") acknowledges that the multi-agent fleet is LATER, but the safety contract must be in place NOW (architecture-only contract per B4 #22). Stream 5 (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`) established a 5-layer single-agent failure recovery (Restate journaling → per-step retry → idempotency keys → saga compensation → graceful degradation with manual fallback, per ADR-057) and the `AIBudgetEnforcer` (per ADR-053). Stream 5's R-5.20 risk noted: "Multi-agent collaboration (Stream 6) may require changes to Supervisor contract — Stream 6 extends, doesn't rewrite."

Stream 6 research (`/home/z/my-project/phase-c-stream6-multi-agent-report.md`, §11, §12) confirmed that the "infinite loop" fear is real and widely documented. Reddit r/AI_Agents: "I've noticed that most agent frameworks give you great tools for 'acting,' but very few tools for 'restraint.' The biggest nightmare for anyone moving to agentic AI is runaway loops." arXiv `https://arxiv.org/html/2607.01641v1` "Uncovering Infinite Agentic Loops in LLM Agents": "Such bounds include **maximum turns, timeouts, retry limits, budgets, and recursion limits**. LangChain provides `max_iterations` and warns that unbounded agents are dangerous." dev.to/aws: "Hard limits are mandatory — every agent needs caps on iterations, time, and spend. 847 steps is an example of a runaway." `https://agenticthinking.ai/blog/recursion-that-cant-run-away`: "Replace depth limits with a floor. Stop capping recursion depth. Hand every sub-loop its own bar. Guard each node against livelock. Never let recursion run unbounded." machinelearningplus: "Learn why LangGraph agents loop, how recursion limits keep them in check, and three ways to build clean exit paths so your graphs never crash."

Restate's stuck-agent management primitives (per Restate observability-control docs and Restate v1.6.0 release notes) are the operator override layer:

- "Cancel: Gracefully stops an invocation, allowing compensation/cleanup logic to run."
- "Kill: Immediately terminates an invocation without cleanup."
- CLI: `restate inv cancel [INVOCATION_ID]` and `restate inv cancel --kill [INVOCATION_ID]`.
- Batch: `restate invocations cancel MyService` (cancel all running invocations for a service).
- Service configuration: "When attempts are exhausted, you can configure what Restate should do with the invocation: **Pause it**, requiring the user to manually resume it. **Kill** it."

Vercel AI SDK provides `stopWhen: [stepCountIs(10)]` (per the Restate multi-agent TypeScript example) — the iteration cap primitive at the LLM loop level.

The Anthropic SDK Python discussion #1341 contributes the multi-agent failure principle: "Our fix: **Circuit breakers at every agent boundary**. If Agent A fails, Agent B gets a 'degraded mode' signal instead of garbage input. Error recovery is 30% code and 70% architecture." Galileo AI: "You've mastered circuit breakers, retry logic, and graceful degradation — only to watch these failure recovery patterns fail with multi-agent AI." Zylos AI: "The discipline of graceful degradation addresses how agents detect, contain, and recover from these partial failures while continuing to deliver service."

Restate's failure model (per Restate error-handling docs): transient errors are auto-retried; terminal errors are not retried; **exhausted retries cause the invocation to be paused** (not killed) — "This gives you time to fix the issue, and then resume the invocation." This is critical for multi-agent: a failed specialist agent pauses (not crashes), the Supervisor can inspect, and either resume or reroute.

## 2. Problem

Should SmartAgentics adopt a single runaway-prevention mechanism (iteration cap only), kill on retry exhaustion (vs pause), no operator override, LLM-decided termination, recursion-depth as the only depth limit, or a 6-layer defense covering all six distinct failure modes?

## 3. Options

### Option A: Single mechanism (iteration cap only)

Rejected. Doesn't cover token-budget blowout, wall-clock timeout, unbounded delegation depth, cascading failure, or livelock. arXiv confirms: "Such bounds include maximum turns, timeouts, retry limits, budgets, and recursion limits" — plural.

### Option B: Kill on retry exhaustion (vs pause)

Rejected. Loses inspectability; the Supervisor cannot resume a killed invocation. Restate's pause is superior: the operator can inspect via the Restate UI Journal view, decide whether to resume (after a fix) or cancel.

### Option C: No operator override (fully automatic)

Rejected. Some failures require human judgment (e.g., a specialist agent that consistently misroutes may need a contract update, not just a retry). Restate cancel/kill is the safety valve when automatic defenses fail.

### Option D: LLM-decided termination (an LLM decides when to stop)

Rejected. The LLM may not stop when it should (especially if it's "enjoying" the task or stuck in a self-reinforcing loop). Hard limits are safer. The LLM may decide _content_ of the termination message, but not _whether_ to terminate.

### Option E: Recursion depth as the only depth limit

Rejected. Per `agenticthinking.ai`: "Replace depth limits with a floor." Depth alone doesn't catch wide loops (a 2-deep chain that iterates 1000 times) or livelock (A→B→A→B without progress). Delegation depth limit + iteration cap + progress detection together.

### Option F: 6-layer defense covering all six failure modes

Adopted. Each layer addresses a distinct failure mode. No single mechanism is sufficient. Restate pause-on-retry-exhaustion as default; kill is manual-only. `AgentContract.runawayLimits` declares all six limits. Operator override via `restate inv cancel` / `--kill` / batch `restate invocations cancel MyService`.

## 4. Decision

Adopt **Option F** — 6-layer runaway prevention.

### The six failure modes and their defenses

| #   | Failure mode                                                            | Defense                                                                                                                                                                                      | Layer            |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | Infinite LLM loop (agent calls tools forever, never converges)          | Iteration cap: Vercel AI SDK `stopWhen: [stepCountIs(N)]`. Default N=10 (per Restate multi-agent example). Configurable per `AgentContract.maxIterations`.                                   | LLM loop level   |
| 2   | Token/cost budget blowout (agent consumes unbounded tokens)             | Token/cost budget cap: Stream 5's `AIBudgetEnforcer` with hard cap. Agent terminates when budget exhausted.                                                                                  | Budget level     |
| 3   | Wall-clock timeout (agent runs for hours)                               | Wall-clock timeout: `ctx.serviceClient(...).orTimeout({ seconds: N })` per agent call + overall `MultiAgentTask.deadline`. Agent terminates when deadline exceeded.                          | Time level       |
| 4   | Unbounded delegation depth (Agent A → B → C → ... → ∞)                  | Delegation depth limit: hard 5-hop limit (per ADR-063, Cedar L2).                                                                                                                            | Delegation level |
| 5   | Cascading failure (one agent's failure triggers retry storms in others) | Circuit breakers at agent boundaries (NEW Layer 6 failure recovery, extends Stream 5's 5-layer). Failed specialist marked "degraded" for cooldown; Supervisor decides retry/reroute/degrade. | Boundary level   |
| 6   | Livelock (agents oscillate without progress — A→B→A→B...)               | Progress detection (state must change between iterations) + Restate cancel/kill for stuck invocations.                                                                                       | Progress level   |

### `RunawayLimits` field on `AgentContract`

```typescript
export interface RunawayLimits {
  maxIterations: number; // default 10
  maxTokenBudget: number; // from Stream 5 AIBudgetEnforcer
  maxWallClockSeconds: number; // per-invocation timeout
  maxDelegationDepth: number; // default 5 (Cedar)
  circuitBreakerPolicy: CircuitBreakerPolicy; // per Layer 6
  progressDetection: boolean; // default true
}
```

Stream 5's `AgentContract` (per ADR-053) is amended (separately, by the Phase D architect) to add a `runawayLimits: RunawayLimits` field.

### Layer 6: Circuit breakers at agent boundaries (extends Stream 5's 5-layer failure recovery)

Stream 5's 5-layer failure recovery (Restate journaling → per-step retry → idempotency keys → saga compensation → graceful degradation with manual fallback, per ADR-057) is **per-agent**. Stream 6 extends it to **multi-agent** with Layer 6:

- **Layer 1**: Restate journaling (Stream 5).
- **Layer 2**: per-step retry policies (Stream 5).
- **Layer 3**: idempotency keys for HIGH/CRITICAL tools (Stream 5).
- **Layer 4**: saga compensation/rollback (Stream 5).
- **Layer 5**: graceful degradation with manual fallback (Stream 5).
- **Layer 6 (NEW)**: circuit breakers at agent boundaries.

When Agent A's call to Agent B fails (transient or terminal), the Supervisor:

1. Catches the failure (Restate journals the failed call).
2. Opens the circuit breaker for Agent B (B is marked "degraded" for a cooldown period — configurable per `CircuitBreakerPolicy`, default 5 minutes).
3. Decides: retry B (after cooldown), reroute to a different specialist (Phase 2+), or degrade gracefully (manual fallback per Stream 5 Layer 5).
4. If all recovery exhausted → escalate to human per ADR-065.

The `CircuitBreakerState` Prisma table (new, additive) tracks one row per `(tenantId, agentId)`: `state` (`closed` | `open` | `half_open`), `lastFailureAt`, `failureCount`, `cooldownUntil`. Cooldown auto-closes the breaker (R-6.30 mitigation).

### Restate "pause on retry exhaustion" as default

Restate service configuration: on retry exhaustion, **pause** (not kill) by default. This gives operators time to inspect (via the Restate UI Journal view at `http://localhost:9070`, per ADR-059 Surface 1) and decide whether to resume (after a fix) or cancel. Kill is manual-only (`restate inv cancel --kill`).

### Progress detection (Layer 6)

The agent must make state progress between iterations — else livelock is suspected. The progress detector checks `SessionContext` mutation (per ADR-062), not LLM output (R-6.34: tunable; checks state change, not LLM verbosity). If no progress is detected across `maxIterations / 2` iterations, the Supervisor cancels the invocation and escalates per ADR-065 (escalation trigger: "livelock detected").

### Operator override (safety valve)

- `restate inv cancel [INVOCATION_ID]` — graceful cancel (allows Layer 4 saga compensation to run).
- `restate inv cancel --kill [INVOCATION_ID]` — immediate kill (no cleanup; use only if graceful cancel fails).
- `restate invocations cancel MyService` — batch cancel all running invocations for a misbehaving agent service (Restate v1.6.0+).

The operator dashboard (Restate UI at `http://localhost:9070`) shows paused/stuck invocations; the runbook documents the cancel/kill procedures (per ADR-066).

### Phase 1 ships Layers 1–3; Layers 4–6 contract-only

- **Phase 1 ships**: iteration cap (Layer 1), token/cost budget cap (Layer 2 — Stream 5 `AIBudgetEnforcer`), wall-clock timeout (Layer 3 — `orTimeout` + `MultiAgentTask.deadline`). These three are sufficient for single-agent Phase 1.
- **Phase 1 contract-only**: delegation depth limit (Layer 4 — `DelegationContext` always `delegationDepth: 0` for single-agent, per ADR-063), circuit breakers (Layer 5 — `CircuitBreakerState` table exists but is trivially always-closed for single-agent), progress detection + Restate cancel/kill (Layer 6 — operator runbook documented; progress detection logic implemented but trivially passes for single-agent).

This matches the §12.9 recommendation: "Phase 1 ships Layers 1–3 (iteration/budget/timeout); Layers 4–6 contract-only."

## 5. Rationale

- **B4 #25 satisfaction**: "AI failure must never become PMS failure." The 6-layer defense covers all six distinct runaway failure modes; no single mechanism is sufficient.
- **Industry consensus on hard limits**: arXiv "maximum turns, timeouts, retry limits, budgets, and recursion limits"; dev.to "Hard limits are mandatory — every agent needs caps on iterations, time, and spend"; machinelearningplus "recursion limits keep them in check".
- **`agenticthinking.ai` principle** — "Replace depth limits with a floor. Stop capping recursion depth. Hand every sub-loop its own bar. Guard each node against livelock" — directly informs the 6-layer design: delegation depth limit + iteration cap + progress detection together, not depth alone.
- **Anthropic SDK discussion #1341 principle** — "Circuit breakers at every agent boundary" — directly informs Layer 6.
- **Restate pause-on-retry-exhaustion is superior to kill**: a paused invocation is inspectable via the Restate UI Journal view; the Supervisor can decide whether to resume (after a fix) or cancel. A killed invocation is gone.
- **Operator override is the safety valve**: when all automatic defenses fail (e.g., a misbehaving third-party agent in Phase 3+ AI-BOS marketplace), `restate inv cancel` / `--kill` / batch `restate invocations cancel MyService` are the manual override.
- **`RunawayLimits` field on `AgentContract`** makes all six limits explicit and per-contract — a HIGH-risk agent (e.g., `FinanceAgent` handling refunds) can have tighter limits than a LOW-risk agent (e.g., `HousekeepingAgent` updating room status).
- **Phase 1 ships Layers 1–3**: sufficient for single-agent. Layers 4–6 are contract-only — the interfaces and tables are in place for Phase 2+ multi-agent.
- **Layer 6 extends Stream 5's 5-layer failure recovery** (per ADR-057) without rewriting it — additive.
- **No new runtime dependency**: Vercel AI SDK `stopWhen`/`stepCountIs`, Stream 5 `AIBudgetEnforcer`, Restate `orTimeout`/cancel/kill/service-config are all already in tree from Stream 5.
- **Galileo AI caution** — "circuit breakers, retry logic, and graceful degradation — only to watch these failure recovery patterns fail with multi-agent AI" — directly informs the layered design: single-agent patterns fail in multi-agent; the 6-layer defense is the multi-agent extension.

## 6. Consequences

- Stream 5's `AgentContract` (per ADR-053) is **amended** (separately, by the Phase D architect) to add `runawayLimits: RunawayLimits`.
- Stream 5's `AIFailureRecoveryPolicy` (per ADR-057) is extended with `circuitBreakerPolicy` field (Layer 6).
- New Prisma table `CircuitBreakerState` (one row per `(tenantId, agentId)`) — additive.
- Stream 5's `AgentSupervisorWorkflow` Step 6 "monitor" is extended to enforce Layers 1, 3, 5, 6 (iteration cap, timeout, circuit breakers, progress detection) and to track circuit breaker state per specialist agent.
- Restate service configuration: set to "pause on retry exhaustion" (default); kill is manual.
- Operator runbook: documented `restate inv cancel` / `--kill` / batch-cancel procedures (per ADR-066).
- **R-6.30 risk (circuit breaker stuck open → specialist permanently unavailable)**: mitigated by cooldown timer auto-closing the breaker; Supervisor can manually reset.
- **R-6.31 risk (paused invocations accumulate → storage growth)**: mitigated by Restate retention policy + dashboard alerting on paused-invocation count.
- **R-6.32 risk (Layer 6 circuit breaker untested in Phase 1 — single agent)**: mitigated by integration tests with stub second agent + forced failure.
- **R-6.33 risk (iteration cap too low → legitimate tasks fail)**: mitigated by configurable per `AgentContract`; default 10 is generous for hotel tasks.
- **R-6.34 risk (progress detection false-positive)**: mitigated by checking `SessionContext` mutation, not LLM output; tunable.
- **R-6.35 risk (operator forgets to kill paused invocations)**: mitigated by Restate retention policy + dashboard alerting.
- **R-6.36 risk (6 layers may over-engineer Phase 1 — single agent)**: mitigated by Phase 1 shipping Layers 1–3 only; Layers 4–6 contract-only.
- Dependencies: ADR-053 (`AgentContract`); ADR-057 (Stream 5 5-layer failure recovery); ADR-053 (Stream 5 `AIBudgetEnforcer`); ADR-063 (delegation depth limit); ADR-065 (escalation on exhausted recovery); ADR-066 (deadlock-safe topology + operator recovery); Vercel AI SDK `stopWhen`/`stepCountIs`; Restate `orTimeout`/cancel/kill/service-config (all in tree). **No new runtime dependencies.**
- Phase 3+ AI-BOS agent marketplace reliability depends on Layer 6 circuit breakers (a third-party agent failing should not cascade). Cross-tenant circuit breakers (tenant A's heavy usage doesn't trip tenant B's breaker) build on this contract.

## 7. Review Conditions

- Review if Phase 2+ multi-agent workflows trigger Layer 6 circuit breakers more frequently than expected — would justify tuning `CircuitBreakerPolicy` cooldown and failure thresholds.
- Review if the default iteration cap (10) proves too low for legitimate hotel workflows (e.g., complex dispute resolution requiring 15+ tool calls) — would justify per-`AgentContract` tuning.
- Review if progress detection produces false positives (agent makes progress but detector doesn't recognize the state change) — would require extending the detector to recognize more state-change patterns.
- Review if Restate adds a native livelock-detection mechanism — would relax the Layer 6 progress-detection requirement.
- Review if Phase 3+ AI-BOS agent marketplace requires per-tenant circuit breaker isolation (tenant A's failing third-party agent doesn't trip tenant B's breaker) — would extend `CircuitBreakerState` with tenant-scoped cooldowns.
- Review if a community agent-safety standard emerges (e.g., a standardized `RunawayLimits` schema or a circuit-breaker spec) that should replace the SmartAgentics-owned model.
- Review if a PMS feature requires an agent to exceed its `RunawayLimits` (e.g., a long-running background report generation) — would require a separate `LONG_RUNNING_TASK` flow with its own limits and audit semantics.
- Review if Restate's pause-on-retry-exhaustion produces excessive paused-invocation storage growth in production — would require tightening the retention policy.
- Review if the operator runbook (cancel/kill procedures) is invoked frequently — would indicate the automatic defenses are insufficient and need strengthening.
