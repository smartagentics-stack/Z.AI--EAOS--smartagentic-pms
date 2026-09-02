# ADR-066: Restate Multi-Agent Topology & Deadlock Safety — Verifier Rule

**ADR-ID:** ADR-066
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #22 requires multi-agent collaboration. Stream 6 ADR-060 adopts Restate-native communication patterns, ADR-062 adopts the `SessionContextService` Virtual Object for shared context, and ADR-061 adopts the `RoutingPolicy` for delegation. Each Restate Virtual Object has an **exclusive-handler** concurrency model: "Only one write handler runs at a time per key, preventing race conditions" (per Restate sessions docs). This is a safety feature for single-writer semantics (per ADR-062) — but it creates a **deadlock risk** for bidirectional request-response calls between two keyed agents.

Stream 6 identified Foundational Conflict **FC-6.5**: Restate's service-communication docs (`https://docs.restate.dev/develop/ts/service-communication`) explicitly warn: "Request-response calls between exclusive handlers of Virtual Objects may lead to deadlocks: **Cross deadlock**: A → B and B → A (same keys). **Cycle deadlock**: A → B → C → A. Use the UI or CLI to cancel and unblock deadlocked invocations." If SmartAgentics' Phase 2+ multi-agent topology uses bidirectional request-response between two keyed agents on the same key, deadlocks will occur.

The deadlock arises because:

- Agent A (keyed by `tenantId:agentTypeA:instance`) holds its exclusive handler.
- Agent A makes a request-response call to Agent B (keyed by `tenantId:agentTypeB:instance`) and blocks waiting for B's response.
- Agent B's exclusive handler is held by a different in-flight call — possibly one that is itself waiting on A.
- Neither A nor B can make progress; both invocations are stuck.

Restate provides operator tools to recover from deadlocks once they occur:

- `restate inv cancel [INVOCATION_ID]` — graceful cancel (allows compensation/cleanup).
- `restate inv cancel --kill [INVOCATION_ID]` — immediate kill (no cleanup).
- `restate invocations cancel MyService` — batch cancel all running invocations for a service (per Restate v1.6.0 release notes).

But prevention is preferable to recovery. This ADR codifies the **deadlock-safe topology rules** and a **static-analysis verifier rule** that flags violations before deployment.

## 2. Problem

Should SmartAgentics allow any Phase 2+ multi-agent topology (and rely on operator `restate inv cancel --kill` to recover from deadlocks), ban cross-agent request-response entirely (force one-way sends only), adopt deadlock-safe topology rules with a static-analysis verifier, or adopt a different runtime substrate that doesn't have exclusive-handler semantics?

## 3. Options

### Option A: Allow any topology; rely on operator recovery

Rejected. Deadlocks are silent (no error, just stuck invocations); they hold Restate resources indefinitely; they may not be noticed until a tenant reports "my agent is hung". Recovery requires operator intervention (per the Restate warning: "Use the UI or CLI to cancel and unblock deadlocked invocations"). This is unacceptable for a production Hotel PMS.

### Option B: Ban cross-agent request-response; force one-way sends only

Rejected. Too restrictive. Request-response is the natural pattern for `Supervisor → Specialist` delegation (the Supervisor needs the specialist's response to synthesize a final answer). One-way sends are appropriate for back-channels (notifications, status updates) but not for synchronous delegation.

### Option C: Adopt a different runtime substrate (Temporal / Dapr actors / Erlang)

Rejected. Restate is already chosen (ADR-007) and reaffirmed by Stream 5; replacing it for deadlock-avoidance alone is disproportionate. Restate's exclusive-handler model is a safety feature for single-writer state; the deadlock risk is manageable with topology rules.

### Option D: Use only non-exclusive handlers for all cross-agent calls

Rejected for writes. Non-exclusive handlers allow concurrent writes → race conditions → corrupt state. Single-writer (exclusive) semantics for writes is required (per ADR-062). The deadlock-safe topology uses **non-exclusive handlers for reads only** and exclusive handlers for writes.

### Option E: Deadlock-safe topology rules + static-analysis verifier

Adopted. Five topology rules + a static-analysis verifier rule that flags violations before deployment. Operator `restate inv cancel` / `--kill` / batch `restate invocations cancel MyService` as the recovery safety valve.

## 4. Decision

Adopt **Option E** — deadlock-safe topology rules + static-analysis verifier.

### Topology rules

**Rule 1 — One Virtual Object per agent per tenant.**
Each agent is a Restate Virtual Object keyed by `tenantId:agentType:agentInstance`. Examples:

- `tenant-42:reservation-agent:default`
- `tenant-42:housekeeping-agent:default`
- `tenant-42:finance-agent:default`

Single-instance-per-agent-per-tenant is sufficient for Phase 1–2 (per ADR-061: load balancing is deferred to Phase 3+).

**Rule 2 — Shared (non-exclusive) handlers for read-only cross-agent calls.**
Read-only cross-agent calls (e.g., "what is the current reservation status for room 101?") use shared handlers. Concurrent reads don't block; no deadlock risk. This aligns with ADR-062's `SessionContext` shared read handlers.

**Rule 3 — Exclusive (write) handlers for state mutations.**
State mutations (e.g., "append a fact to the session blackboard") use exclusive handlers, serialized per key. This preserves single-writer semantics (per ADR-062).

**Rule 4 — No bidirectional request-response between two keyed agents on the same key.**
If Agent A and Agent B both have keyed Virtual Objects and A makes a request-response call to B (and blocks waiting for the response), then B must **not** make a request-response call back to A on the same key during the same delegation chain. Use **one-way sends** (`ctx.serviceSendClient`) for back-channels (notifications, status updates, async callbacks). The Supervisor-mediated hierarchy (ADR-061) is structurally deadlock-safe because the Supervisor is the only node that calls specialists; specialists do not call each other or the Supervisor synchronously.

**Rule 5 — No cycles (A → B → C → A).**
A delegation chain must not form a cycle. The hard 5-hop delegation depth limit (per ADR-063) bounds the chain length, but cycles within 5 hops are still possible (A → B → C → A is only 3 hops). The `DelegationContext.delegationChainHash` (per ADR-063) makes cycles detectable at the `DelegationGuard` (per ADR-061): if a target agent ID already appears in the chain, the delegation is rejected with `AIAuditEvent.eventType = 'DELEGATION_CYCLE_DETECTED'`.

### Static-analysis verifier rule

A static-analysis verifier rule flags **bidirectional exclusive-handler request-response** between two Virtual Object types in the SmartAgentics codebase. The rule:

```
For every pair (ServiceA, ServiceB) of Restate Virtual Object services:
  For every handler HA in ServiceA marked 'exclusive':
    For every handler HB in ServiceB marked 'exclusive':
      If HA's body contains a ctx.serviceClient(ServiceB).<HB> call (request-response):
        If HB's body contains a ctx.serviceClient(ServiceA).<HA> call (request-response):
          FLAG: bidirectional exclusive-handler request-response between ServiceA and ServiceB → deadlock risk.
          SUGGEST: use ctx.serviceSendClient (one-way) for one of the directions.
```

The verifier runs in CI (per ADR-013 observability and the existing CI pipeline). A flagged violation fails the build.

**Phase 1 scope**: the verifier rule is **contract-only** in Phase 1 (no multi-agent topology exists to verify). The rule ships in Phase 2+ when the first multi-agent topology is deployed. This is the §18 Open Question #7 recommendation: "Phase 2+ (Phase 1 has no multi-agent topology to verify)".

### Recovery (operator safety valve)

If a deadlock slips past the verifier (e.g., a runtime-only path the static analysis missed), the operator uses:

- `restate inv cancel [INVOCATION_ID]` — graceful cancel (allows compensation/cleanup logic to run, per ADR-067 saga compensation).
- `restate inv cancel --kill [INVOCATION_ID]` — immediate kill (no cleanup; use only if graceful cancel fails).
- `restate invocations cancel MyService` — batch cancel all running invocations for a misbehaving agent service (Restate v1.6.0+).

The operator dashboard is the Restate UI at `http://localhost:9070` (per ADR-059 Surface 1): inspect paused/deadlocked invocations via the Journal view; cancel/kill via the UI or CLI.

### Restate service configuration

Per ADR-067 §12: on retry exhaustion, Restate is configured to **pause** (not kill) the invocation by default — gives operators time to inspect and decide. Kill is manual-only.

## 5. Rationale

- **FC-6.5 resolution**: documents the deadlock-safe topology and the verifier rule that prevents bidirectional exclusive-handler request-response between two Virtual Object types. The contract is in place for Phase 2+.
- **Prevention is preferable to recovery**: deadlocks are silent (no error, just stuck invocations); they hold Restate resources indefinitely. The verifier rule catches the most common deadlock pattern (bidirectional exclusive-handler request-response) before deployment.
- **Five topology rules cover the realistic Phase 2+ scenarios**:
  - Rule 1 (one VO per agent per tenant) — clean addressing.
  - Rules 2 & 3 (shared reads, exclusive writes) — match ADR-062 single-writer semantics.
  - Rule 4 (no bidirectional request-response) — eliminates the Restate-documented cross deadlock.
  - Rule 5 (no cycles) — eliminates the Restate-documented cycle deadlock; detectable at the `DelegationGuard` via `delegationChainHash`.
- **Supervisor-mediated hierarchy is structurally deadlock-safe** (per ADR-061): the Supervisor is the only node that calls specialists synchronously; specialists do not call each other or the Supervisor synchronously. This matches the LangChain Subagents pattern (Phase 1 default).
- **One-way sends for back-channels**: notifications, status updates, and async callbacks use `ctx.serviceSendClient` (one-way), never blocking the sender. This is the sanctioned back-channel pattern.
- **Operator recovery is the safety valve**: `restate inv cancel` / `--kill` / batch `restate invocations cancel MyService` are the manual override when automatic defenses fail. The Restate UI provides inspection.
- **Restate's pause-on-retry-exhaustion** (per ADR-067) means stuck invocations are inspectable, not lost — operators can decide whether to resume or cancel.
- **No new runtime dependency**: the verifier is a static-analysis tool (e.g., a TypeScript AST walker) added to CI; it does not run in production.
- **Phase 1 contract-only**: the verifier rule ships in Phase 2+ when the first multi-agent topology is deployed. Phase 1 has no multi-agent topology to verify.

## 6. Consequences

- New static-analysis verifier rule added to CI (Phase 2+; contract in Phase 1).
- New `AIAuditEvent.eventType = 'DELEGATION_CYCLE_DETECTED'` value (additive enum value).
- The `DelegationGuard` (per ADR-061) extends its L2 check to detect cycles via `delegationChainHash`.
- Restate service configuration: pause on retry exhaustion (per ADR-067).
- Operator runbook: documented `restate inv cancel` / `--kill` / batch-cancel procedures for stuck invocations.
- **R-6.2.1 risk (Restate exclusive-handler deadlock risk for bidirectional cross-agent request-response — FC-6.5)**: mitigated by Rules 4 & 5 + verifier rule + operator recovery.
- **R-6.11.1 risk (circuit breaker stuck open — per ADR-067)**: distinct from deadlock; circuit breakers contain _failures_, not deadlocks.
- **R-6.31 risk (paused invocations accumulate → storage growth — per ADR-067)**: mitigated by Restate retention policy + dashboard alerting on paused-invocation count.
- Dependencies: ADR-007 (Restate); ADR-060 (Restate-native communication); ADR-061 (`RoutingPolicy` Supervisor-mediated hierarchy, `DelegationGuard`); ADR-062 (`SessionContextService` shared/exclusive handlers); ADR-063 (`delegationChainHash` for cycle detection); ADR-059 (Restate UI inspection surface). **No new runtime dependencies.**
- Phase 3+ may add key-sharding (load balancing per ADR-061) — would extend Rule 1's key structure to `tenantId:agentType:shard-N` and may require additional topology rules for cross-shard calls.

## 7. Review Conditions

- Review if Phase 2+ multi-agent topologies expose deadlock patterns not covered by Rules 1–5 (e.g., three-agent cycles through a shared `SessionContext` write) — would extend the verifier rule.
- Review if the verifier rule produces false positives (e.g., flags a topology that is actually deadlock-safe due to non-overlapping keys) — would require refining the rule to consider key disjointness.
- Review if a Phase 3+ load-balancing (key sharding) requirement introduces cross-shard bidirectional calls — would require additional topology rules.
- Review if Restate adds a native deadlock-detection mechanism (e.g., automatic cancel of deadlocked invocations) — would relax the verifier rule.
- Review if a community multi-agent topology standard emerges (e.g., a standardized actor-model deadlock-prevention pattern) that should replace the SmartAgentics-owned rules.
- Review if a Phase 3+ peer-to-peer swarm pattern (per ADR-061 reserved) requires a different deadlock-prevention strategy (e.g., optimistic concurrency with retry) — would require a new ADR.
- Review if operator recovery (`restate inv cancel --kill`) is used frequently in production — would indicate the verifier rule is insufficient and needs strengthening.
- Review if a PMS feature requires bidirectional request-response between two specific agents (e.g., FrontDesk and Finance both need to query each other synchronously) — would require a topology exception with explicit risk acceptance and a one-way-send alternative documented.
