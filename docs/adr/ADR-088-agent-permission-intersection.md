# ADR-088: Agent Permission Intersection — Closes OWASP ASI03

**ADR-ID:** ADR-088
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #19 ("Agent permissions") is classified as **"No"** — Stream 5 reserved signed-JWT agent identity (ADR-049) and Stream 6 added 3-layer Cedar authorization (ADR-057) covering _agent identity_ and _delegation narrowing_. Neither specifies the **agent-permission-vs-user-permission duality**: an agent's effective permission must be the intersection of multiple sources, computed at tool-call time — not session-start time, because delegation chains narrow scope hop-by-hop.

The Stream 8 research (s10) names the threat explicitly:

- **AWS Cedar multi-agent least-privilege blog** (Stream 6 p09): "If you're building multi-agent AI systems, you need to prevent authorization scope from silently expanding as agents delegate tasks through multi-hop chains. Without proper controls, an agent can potentially act beyond what the originating user authorized, even when role-based access control (RBAC) policies are in place. The OWASP Top 10 for Agentic Applications classifies this risk as **ASI03: Identity & Privilege Abuse**."
- **O'Reilly Radar delegation post** (Stream 6): "When an agent delegates a task, the subagent should receive strictly fewer permissions than the parent — never the same set, and certainly never [more]."
- **WorkOS agent delegation** (Stream 6): "Agent A delegates a task to Agent B. Agent B has its own permissions. Does it execute the task with Agent A's permissions, its own permissions, [or some intersection]?" — correct answer: **intersection**.
- **LinkedIn multi-tenant AI architecture** (Stream 5): "Identity, permissions and tenant boundaries must be enforced at the data, credential and tool layers, propagated through every agent."
- **Sweet Security privilege-abuse research** (August 2026): "Privilege Abuse in AI agents is a runtime identity risk: valid credentials become dangerous when an agent's current task, tool chain, or [context expands beyond original authorization]."

The intersection must be computed **at tool-call time**, not at session start, because: (a) delegation chains (Stream 6) narrow scope hop-by-hop — a sub-agent's effective scope is narrower than its parent's; (b) the originating user may be replaced mid-session (e.g., a front-desk agent hands off to a manager) — the signed JWT is re-issued with new claims.

## 2. Problem

Should SmartAgentics adopt session-start permission snapshot, trust the agent to self-report its permissions, static per-role tool allowlist, or at-call-time intersection computation? Should the intersection include delegation narrowing?

## 3. Options

### Option A: Session-start permission snapshot (compute once, never re-check)

Rejected. Vulnerable to mid-session delegation narrowing (a sub-agent may have narrower scope than the snapshot suggests). Also vulnerable to mid-session user-role change (front-desk promoted to manager mid-session — the snapshot would still reflect front-desk scope).

### Option B: Trusting the agent to self-report its permissions

Rejected. OWASP ASI03 (s10) explicitly calls this out as Identity & Privilege Abuse. An agent that self-reports its permissions can claim more than it has — a compromised or injected agent could escalate.

### Option C: Static per-role tool allowlist (no intersection computation)

Partially rejected. Useful as a baseline (the `AgentContract.capabilities[]`), but insufficient because it doesn't account for delegation narrowing or per-user permission differences within a role. A user with `front_desk` role and a user with `front_desk_lead` role have different effective scopes despite sharing the role.

### Option D: At-call-time intersection of (agent capabilities + user JWT + tool roles + delegation narrowing)

Adopted. The Supervisor computes the intersection for every tool call. Pre-computed when the signed JWT is issued; recomputed only when a delegation hop occurs.

## 4. Decision

Adopt **Option D** — the Agent Permission Intersection Model.

### Effective permission formula

An agent's **effective permission** for any given tool call = **intersection of**:

1. **Agent's registered capabilities** (from `AgentContract.capabilities[]`) — what the agent is _designed_ to do.
2. **Originating user's permissions** (from signed JWT `userClaims.permissions[]`) — what the human is allowed to do.
3. **Tool's required roles** (from `ToolPermission.requiredRoles[]`) — what roles are allowed to call this tool.
4. **Delegation-narrowed scope** (from Stream 6 `DelegationContext.scopeNarrowing[]`) — for sub-agents, the parent's narrowed scope.

```typescript
// Pseudocode — computed at tool-call time by the Supervisor
function computeEffectivePermission(
  agentContract: AgentContract,
  userJwt: SignedJWT,
  toolPermission: ToolPermission,
  delegationContext?: DelegationContext,
): EffectivePermission {
  const agentCaps = new Set(agentContract.capabilities);
  const userPerms = new Set(userJwt.claims.permissions);
  const toolRoles = new Set(toolPermission.requiredRoles);

  // Intersection 1: agent capabilities ∩ user permissions
  let effective = intersection(agentCaps, userPerms);

  // Intersection 2: ∩ tool required roles
  effective = intersection(effective, toolRoles);

  // Intersection 3: ∩ delegation-narrowed scope (if sub-agent)
  if (delegationContext?.scopeNarrowing) {
    effective = intersection(effective, new Set(delegationContext.scopeNarrowing));
  }

  return { allowed: effective.size > 0, scopes: effective };
}
```

### When the intersection is computed

- **Pre-computed** when the signed JWT is issued (the JWT carries an `effectivePermissions` claim).
- **Recomputed** only when a delegation hop occurs (Stream 6 `DelegationContext` changes).
- **Re-verified** at every tool call (the Supervisor checks the current `effectivePermissions` claim against the tool's required roles).

### Signed JWT extension (ADR-049 amendment, additive)

- `effectivePermissions` claim (computed-at-call-time, per tool).
- `toolCallCounters` claim (for rate-limit accounting per ADR-094).

### `PermissionResolver` Restate Virtual Object

Keyed by `(tenantId, agentId, sessionId)`. Caches the intersection; invalidates on delegation hop or JWT re-issue.

### Permission cache invalidation

- Signed JWT has a 15-minute TTL; on expiry, the new JWT reflects the new role.
- If a user's role changes mid-session (e.g., promoted from `front_desk` to `manager`), the cached intersection is stale until the JWT expires.
- For immediate invalidation (e.g., user revoked), a `PermissionRevoked` event invalidates the cache.

### Phase 1 scope

- Full impl of the intersection computation.
- The reference `ReservationAssistantAgent` exercises this end-to-end (front-desk user with `reservation.write` permission delegates to the agent, which can call `createReservation` because the intersection includes it).

## 5. Rationale

- **OWASP ASI03 closure** (s10): the intersection model prevents identity & privilege abuse — an agent cannot act beyond what the originating user authorized, even when role-based access control is in place.
- **O'Reilly Radar principle**: "the subagent should receive strictly fewer permissions than the parent" — the intersection (with delegation narrowing) guarantees this. A sub-agent's effective scope ⊆ parent's effective scope ⊆ originating user's permissions.
- **WorkOS question answered** (Stream 6): intersection, not max-of — prevents privilege escalation via delegation.
- **At-call-time computation** is safer than session-start snapshot — handles delegation narrowing and mid-session role changes.
- **Pre-computed when JWT issued** keeps the hot-path cost O(1) — the recomputation happens only on delegation hop (rare).
- **Signed JWT TTL = 15 minutes** bounds staleness — a role change propagates within 15 minutes without explicit invalidation.
- **LinkedIn principle** (Stream 5): "Identity, permissions and tenant boundaries must be enforced at the data, credential and tool layers, propagated through every agent" — the intersection model enforces this at the tool layer.
- **Sweet Security warning** (s10): "valid credentials become dangerous when an agent's current task expands beyond original authorization" — the intersection with `AgentContract.capabilities[]` bounds the agent to its designed task, not its credentials' max scope.

## 6. Consequences

- ADR-049 amendment extends signed JWT claims (`effectivePermissions`, `toolCallCounters`).
- New `PermissionResolver` Restate Virtual Object keyed by `(tenantId, agentId, sessionId)`.
- New `AIAuditEvent` event type: `PERMISSION_DENIED` (when intersection is empty).
- **Risk: the intersection computation is on the hot path (every tool call). Must be O(1) or O(small).** Mitigation: pre-compute when JWT issued; recompute only on delegation hop.
- **Risk: permission cache invalidation staleness** — if a user's role changes mid-session, the cached intersection is stale until JWT expires. Mitigation: 15-minute JWT TTL; explicit `PermissionRevoked` event for immediate invalidation.
- **Risk: `AgentContract.capabilities[]` is too broad** — an agent designed for reservation management may have `reservation.write` in its capabilities, but a specific user delegating to it may not have that permission. Mitigation: the intersection with `userJwt.claims.permissions[]` ensures the agent cannot exceed the user's scope.
- **Risk: delegation narrowing is omitted by a parent agent** — a sub-agent would inherit the parent's full scope, violating O'Reilly Radar's "strictly fewer permissions." Mitigation: Stream 6 ADR-063 (`Permission Narrowing`) already makes scope narrowing mandatory; verifier rule (VERIFY-AI-SECURITY-02) flags `AgentContract` without `capabilities[]`.
- **Risk: tool author omits `requiredRoles[]`.** Mitigation: verifier rule VERIFY-AI-SECURITY-01 flags `Tool` without `riskClass` and the per-tool `requiredRoles[]` is enforced by the same rule.
- Dependencies: Stream 5 signed-JWT identity (ADR-049); Stream 6 `DelegationContext` (ADR-057); Stream 5 `ToolPermission` (ADR-048); Stream 5 `AgentContract`; Stream 6 ADR-063 (Permission Narrowing).
- Phase 1 effort: ~2 weeks of Phase E engineering. The reference `ReservationAssistantAgent` exercises this end-to-end.

## 7. Review Conditions

- Review if Phase 1 telemetry shows `PERMISSION_DENIED` fires frequently — would indicate either a too-restrictive `AgentContract.capabilities[]` or a too-narrow user JWT scope.
- Review if 15-minute JWT TTL proves too long for permission revocation (e.g., a terminated employee retains access for 15 minutes) — would shorten TTL or require explicit `PermissionRevoked` event for immediate invalidation.
- Review if the intersection computation hot-path cost exceeds O(1) under real workloads — would require caching strategy tuning.
- Review if a community standard for agent permission intersection emerges (e.g., OWASP Agentic Applications ASI03 mitigation pattern) that should replace the SmartAgentics-owned model.
- Review if Phase 3+ requires attribute-based access control (ABAC) beyond the current RBAC + delegation narrowing — would extend the intersection to include attributes.
- Review if Phase 2+ multi-tenant delegation (tenant A's agent delegates to tenant B's agent under a mutual-governance agreement) is needed — would require a cross-tenant permission resolver.
- Review if a regulator demands proof of permission enforcement — the `AIAuditEvent` `PERMISSION_DENIED` events + the signed JWT `effectivePermissions` claim provide the audit evidence.
