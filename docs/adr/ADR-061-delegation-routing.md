# ADR-061: Multi-Agent Delegation & Task Routing — Cedar-Style 3-Layer Authorization, OAuth OBO Scope-Narrowing

**ADR-ID:** ADR-061
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #22 requires a Supervisor → [Reservation, Housekeeping, Finance, Inventory] agent topology with "controlled task/message mechanisms". Phase B #20 requires that "an AI agent must never automatically inherit the permissions of the user who triggered it" — agent identity ≠ user identity. Stream 5 (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`) established single-agent signed-JWT identity (ADR-055), the `AgentSupervisorWorkflow` with an 8-step pipeline whose Step 2 is "task routing" (ADR-049), `AgentContract` with `capabilities` and `permissions` fields (ADR-053), and the `ToolPermission` entity (ADR-054). Stream 5 explicitly reserved the multi-agent extension for Stream 6: "Phase 2+ extends routing to multi-agent (Stream 6)".

Stream 6 research (`/home/z/my-project/phase-c-stream6-multi-agent-report.md`, §3, §4, §6) confirmed the supervisor-delegation pattern as industry consensus across four authoritative sources: Restate "Multi-Agent Orchestration" (`https://docs.restate.dev/ai/patterns/multi-agent`: "A router agent receives the request → An LLM decides which specialist to delegate to (persisted as a durable step) → The specialist agent processes the request → The router returns the result. Routing decisions, agent calls, and results are all recorded in the journal"); AWS Bedrock multi-agent collaboration ("The supervisor breaks down requests, delegates tasks, and consolidates outputs into a final response"); LangChain Subagents ("a supervisor agent coordinates specialized subagents by calling them as tools. The main agent maintains conversation context while subagents remain stateless, providing strong context isolation"); Databricks Supervisor Agent ("a multi-agent supervisor system that orchestrates agents and tools to work together").

The hard problem is **multi-hop delegation chain safety**. The AWS Cedar blog (`https://aws.amazon.com/blogs/security/enforce-least-privilege-authorization-in-multi-agent-ai-chains-using-cedar/`) calls it out explicitly: "If you're building multi-agent AI systems, you need to prevent authorization scope from silently expanding as agents delegate tasks through multi-hop chains. Without proper controls, an agent can potentially act beyond what the originating user authorized, even when role-based access control (RBAC) policies are in place. The OWASP Top 10 for Agentic Applications classifies this risk as ASI03: Identity & Privilege Abuse." Cedar's solution is a 3-layer policy model with a **hard delegation hop limit of 5** ("Whether the delegation hop count is within the hard limit of five").

The O'Reilly Radar post (`https://oreillyradar.substack.com/p/who-authorized-that-the-delegation`) states the principle crisply: "When an agent delegates a task, the subagent should receive strictly fewer permissions than the parent — never the same set, and certainly never more." WorkOS (`https://workos.com/blog/ai-agent-delegation-multi-agent-security`) frames the question: "Agent A delegates a task to Agent B. Agent B has its own permissions. Does it execute the task with Agent A's permissions, its own permissions, or some intersection?" The correct answer is the **intersection**, never the union.

OAuth 2.0 On-Behalf-Of (OBO) with **scope narrowing** (search s12: `https://medium.com/@sauravkumarsct/oauth-delegation-for-agents-o-b-o-1e75616c2033` — "Scope narrowing: The agent cannot ask for, and the IdP will not issue, scopes beyond the intersection of what the delegating party has"; IETF draft `https://www.ietf.org/archive/id/draft-li-oauth-delegated-authorization-03.html` — "The new token can narrow permissions, audience, validity period, and remaining delegation depth") provides the standards-grounded mechanism: each delegation hop issues a new, narrower token with reduced scope, reduced audience, reduced validity, and reduced remaining delegation depth. The token never expands.

The FINOS AIR Governance Framework (`https://air-governance-framework.finos.org/mitigations/mi-18_agent-authority-least-privilege-framework.html`) reinforces: "The Agent Authority Least Privilege Framework implements granular access controls ensuring agents can only access APIs, tools, and data strictly necessary for their task."

## 2. Problem

Should SmartAgentics model delegation with sub-agent permission inheritance (union of parent and child permissions), sub-agent's own permissions only, originating-user permissions only, an unbounded delegation chain, or a Cedar-style 3-layer authorization with OAuth 2.0 OBO scope-narrowing and a hard delegation hop limit?

## 3. Options

### Option A: Permission inheritance (sub-agent inherits parent's full permissions)

Rejected. OWASP ASI03 risk. O'Reilly: "the subagent should receive strictly fewer permissions than the parent — never the same set, and certainly never more." If the sub-agent inherits the parent's permissions, every delegation hop silently expands the blast radius.

### Option B: Sub-agent uses its own permissions only (ignoring parent's narrowing)

Rejected. Loses the originating-user authorization context. Sub-agent could exceed what the user authorized, or — if the sub-agent's contract is broader than the user's role — do things the user cannot.

### Option C: Sub-agent uses originating-user permissions only

Rejected. Violates "agent identity ≠ user identity" (Phase B #20). Conflates agent identity with user identity; the Auditor (ADR-052) cannot distinguish "the user did X" from "the agent did X on behalf of the user".

### Option D: Unbounded delegation depth

Explicitly rejected. OWASP ASI03 risk. A↔B mutual delegation could recurse forever.

### Option E: Peer-to-peer swarm / bidirectional delegation (AutoGen Swarm, LangChain handoffs-only)

Rejected for Phase 1–2. Harder to audit; harder to enforce permission narrowing; doesn't match hotel organizational hierarchy (front-desk → manager → admin). Reserved for Phase 3+ AI-BOS exploration. Bidirectional delegation (A↔B both call each other) is explicitly rejected because it creates deadlock risk per ADR-066 and makes permission narrowing ambiguous in cycles.

### Option F: LLM-based routing in Phase 1

Rejected. Phase 1 has one agent; LLM routing is wasted cost and latency. Phase 2+ may adopt an LLM router behind the same `RoutingPolicy` interface.

### Option G: Cedar / OPA as runtime policy engine

Rejected for Phase 1. Cedar is a Rust library (would need a Node.js binding or external service); OPA adds operational burden. The 3-layer model is adopted conceptually; the implementation is a TypeScript `DelegationGuard` service. Reserved for Phase 3+ if `DelegationGuard` rule complexity warrants.

### Option H: Cedar-style 3-layer L1/L2/L3 authorization + OAuth 2.0 OBO scope-narrowing + hard 5-hop limit

Adopted. L1 = Stream 5's `ToolPermission` (agent → tool); L2 = NEW `DelegationGuard` (agent → agent delegation hop, capability subset, monotonic scope narrowing); L3 = Stream 5's signed-JWT user claims + `allowedDelegationDepth`. Effective sub-agent permissions = `parentAgent.permissions ∩ subAgent.registeredPermissions ∩ originatingUser.permissions`. Empty intersection → reject → escalate (per ADR-065). Hard delegation depth limit = 5 (Cedar default; configurable per `AgentContract`).

## 4. Decision

Adopt **Option H** — Cedar-style 3-layer authorization with OAuth 2.0 OBO scope-narrowing and a hard 5-hop delegation depth limit.

### `RoutingPolicy` interface (generalizes Stream 5 Supervisor Step 2)

Stream 5's `AgentSupervisorWorkflow` Step 2 "task routing" is generalized from a deterministic lookup to a `RoutingPolicy` interface:

```typescript
export interface RoutingPolicy {
  mode: 'deterministic' | 'llmRouter' | 'hybrid';
  route(task: MultiAgentTask, context: RoutingContext): Promise<RoutingDecision>;
}
```

- **Phase 1**: `deterministic` mode — always returns `ReservationAssistantAgent`. No LLM call.
- **Phase 2+**: `llmRouter` mode — small/fast Ollama model classifies the task's capability and maps to a specialist agent via the tenant's department configuration; router decision cached by task-type.
- **Phase 2+**: `hybrid` mode — LLM router with confidence threshold; below threshold falls back to deterministic rules or escalates to human (per ADR-065).

Backward-compatible: deterministic is a valid `RoutingPolicy` implementation.

### Routing dimensions (Phase 2+)

| Dimension                     | Source                                                               | Phase    |
| ----------------------------- | -------------------------------------------------------------------- | -------- |
| Capability classification     | `AgentContract.capabilities` field                                   | Phase 2+ |
| Department routing            | `Department` entity (Phase B #31) → `Department → AgentContract` map | Phase 2+ |
| Availability routing          | Restate keyed Virtual Object single-writer                           | Phase 3+ |
| Load balancing (key sharding) | `agentType:tenantId:shard-N` keys                                    | Phase 3+ |

Model-tier load balancing (small model for easy queries, large model for complex disputes) is out of scope for Stream 6 — it is a Stream 1 / Stream 5 concern (model selection policy).

### Cedar-style 3-layer authorization at every delegation hop

- **L1 (agent-to-tool)**: Stream 5's `ToolPermission` (per ADR-054) — unchanged. Three-way intersection: `User.roles ⊇ Tool.requiredRoles` AND `AgentContract.allowedTools ∋ toolId` AND `AgentContract.maxRiskClass ≥ Tool.riskClass` AND `ToolPermission(toolId, agentId) ∈ {ALLOW, ALLOW_WITH_APPROVAL}`.
- **L2 (agent-to-agent delegation)**: NEW `DelegationGuard` service — checks (a) `delegationDepth < allowedDelegationDepth` (hard limit 5); (b) `requestedCapability ⊆ targetAgent.registeredCapabilities`; (c) `scopeNarrowing` is monotonically narrowing. Pure function (no I/O); sub-millisecond.
- **L3 (originating-user authorization)**: Stream 5's signed-JWT user claims (`role`, `mfaVerified`, `sessionId`) + NEW `allowedDelegationDepth` claim.

### OAuth 2.0 OBO scope-narrowing

Each delegation hop issues a new signed JWT with monotonically narrowing scope. The sub-agent's effective permissions are:

```
effective = parentAgent.permissions ∩ subAgent.registeredPermissions ∩ originatingUser.permissions
```

If the intersection is empty, the delegation is **rejected** (never silent failure) and the Supervisor escalates to a human per ADR-065 (escalation trigger: "empty permission intersection"). The token never expands; the audience, validity, and remaining delegation depth are also reduced at each hop.

### Hard delegation depth limit

Hard limit = **5 hops** (Cedar default; SmartAgentics hotel workflows are depth-2 max — Supervisor → Specialist). Configurable per `AgentContract` for future AI-BOS scenarios requiring deeper chains.

### Handoff pattern (Phase 2+)

LangChain's Handoff pattern (pattern #3) is adopted as the Phase 2+ stateful-routing mechanism: a Virtual Object stores `last_agent_name` per session (per Restate OpenAI Agents example: `ctx.set("last_agent_name", result.last_agent.name)`) so the next invocation resumes with the same specialist. Phase 1 does not use handoffs (single agent).

### `AgentDelegation` Prisma table (new, additive)

One row per delegation hop: `id`, `multiAgentTaskId` (FK), `parentAgentId`, `childAgentId`, `delegationDepth`, `scopeNarrowing` (JSON), `invocationId` (Restate), `correlationId`, `delegatedAt`, `resolvedAt`, `outcome`. Cross-referenced to `MultiAgentTask` (correlation root) and `AIAuditEvent` (per ADR-068).

## 5. Rationale

- **B4 #22 + B4 #20 satisfaction**: delegation chains with controlled scope-narrowing; agent identity ≠ user identity preserved at every hop.
- **OWASP ASI03 mitigation**: hard 5-hop limit + scope-narrowing intersection prevents silent privilege escalation through multi-hop chains.
- **Cedar 3-layer model is the right architecture** because it cleanly separates the three authorization questions that arise in any delegation chain (agent-to-tool, agent-to-agent, originating-user). Stream 5's `ToolPermission` already covers L1; L2/L3 are additive.
- **OAuth 2.0 OBO scope-narrowing is the standards-grounded mechanism**: each hop produces a token that is more constrained, narrowed in scope, bound to a specific audience, and reduced in remaining delegation depth (IETF draft + Auth0 AAP profile + Medium OBO guide).
- **Intersection (not union)** matches industry consensus: O'Reilly, WorkOS, Okta, FINOS AIR all converge on "strictly fewer permissions than the parent".
- **`RoutingPolicy` interface is stable across phases**: Phase 1 deterministic, Phase 2+ LLM router, Phase 2+ hybrid — all behind the same interface. Supervisor contract unchanged.
- **Handoff pattern reserved for Phase 2+**: Phase 1 has no multi-turn stateful routing (single agent); the contract reserves it.
- **Cedar/OPA rejected for Phase 1** because the TypeScript `DelegationGuard` is sufficient for the rule complexity of Phase 1–2 (depth-2 hotel workflows). Cedar/OPA reserved for Phase 3+ if `DelegationGuard` rules exceed ~50 distinct policies or require dynamic updates.
- **Phase 1 ships the contract** (`RoutingPolicy` deterministic, `DelegationContext` always `delegationDepth: 0`, `DelegationGuard` trivially passes for depth-0) — no second specialist agent built.

## 6. Consequences

- New SDK interface `RoutingPolicy` and `DelegationGuard` in `packages/sdk/src/ai/collaboration.ts` (additive).
- New Prisma table `AgentDelegation` (one row per hop) — additive.
- Stream 5's `AgentSupervisorWorkflow` Step 2 "task routing" is generalized to `RoutingPolicy` (backward-compatible; deterministic is valid).
- Stream 5's signed JWT agent identity (ADR-055) is amended (separately) to add the `DelegationContext` claim set per ADR-063.
- Stream 5's `AgentContract` is amended to declare `runawayLimits.maxDelegationDepth` (per ADR-067) and an `escalationChain` (per ADR-065).
- **R-6.6.1 risk (empty intersection silently breaks workflows)** is mitigated by mandatory escalation (never silent failure).
- **R-6.6.2 risk (JWT bloat)** is mitigated by `delegationChainHash` (SHA-256 of the chain) in the JWT; the full chain is persisted in `AgentDelegation`.
- **R-6.4.1 risk (LLM router latency/cost)** is mitigated by small/fast Ollama router model + decision caching by task-type.
- **R-6.4.2 risk (`Department` entity not yet in schema — Phase B #31)**: Phase D must introduce `Department`; coordination with Stream 7 (Offline Sync & Data Architecture). Phase 1 single-agent routing uses a hardcoded capability→agent map if `Department` is deferred.
- Dependencies: ADR-049 (`AgentSupervisorWorkflow`); ADR-053 (`AgentContract`); ADR-054 (`ToolPermission`); ADR-055 (signed-JWT agent identity, amended by ADR-063); Phase B #31 `Department` entity (Phase 2+ dependency). **No new runtime dependencies.**
- Phase 2+ may adopt Cedar or OPA as a `DelegationGuard` implementation if policy complexity warrants (FC-6.2 review condition).

## 7. Review Conditions

- Review if Phase 2+ `DelegationGuard` rule complexity exceeds ~50 distinct policies or requires dynamic updates — would justify adopting Cedar or OPA as the policy engine.
- Review if the hard 5-hop delegation depth limit proves too low for AI-BOS scenarios (e.g., chain-wide → property → department → specialist → sub-specialist) — would require per-`AgentContract` tuning.
- Review if `Department` entity (Phase B #31) is deferred past Phase 2 — would force Phase 2 routing to use a hardcoded capability→agent map.
- Review if a Phase 3+ peer-to-peer swarm requirement emerges (cross-tenant procedure marketplace, decentralized debate) — would relax the Supervisor-mediated hierarchy constraint.
- Review if an LLM-router misrouting rate exceeds the confidence threshold in production — would require adding hybrid mode fallback rules.
- Review if a community agent-delegation standard emerges (e.g., a standardized `DelegationContext` claim set) that should replace the SmartAgentics-owned schema.
- Review if a PMS feature requires an agent to act with elevated privileges beyond its contract (admin debugging session) — would require a separate `MANAGER_OVERRIDE` flow with its own audit semantics.
