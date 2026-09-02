# ADR-063: Permission Narrowing — DelegationContext Signed-JWT Claims

**ADR-ID:** ADR-063
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #19 ("ToolPermission — User Permissions ≠ Agent Permissions ≠ Tool Permissions") and B4 #20 ("an AI agent must never automatically inherit the permissions of the user who triggered it") establish that agent identity is distinct from user identity. Stream 5 (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md` §13) fulfilled the single-agent case via ADR-055 — signed-JWT agent identity with three-way permission intersection (`User.roles ⊇ Tool.requiredRoles` AND `AgentContract.allowedTools ∋ toolId` AND `ToolPermission(toolId, agentId) ∈ {ALLOW, ALLOW_WITH_APPROVAL}`), with claims `{ agentId, agentContractVersion, tenantId, propertyId, sessionId, actorUserId, requestedByRole, invokedAt, expiresAt }` signed by the Supervisor at the `dispatch` step.

Stream 5's ADR-055 explicitly reserved the multi-agent extension: "Review if Stream 6 multi-agent collaboration requires _agent-to-agent_ identity propagation (an agent invoking another agent) — would extend the JWT to carry a chain of agent identities." Stream 5's R-5.20 risk stated: "Multi-agent collaboration (Stream 6) may require changes to Supervisor contract — LOW — `AgentRuntime`/`SupervisorInterface` are designed with multi-agent in mind (task routing step); Stream 6 extends, doesn't rewrite".

Stream 6 identified Foundational Conflict **FC-6.2**: Stream 5's ADR-055 defines single-agent signed-JWT identity but does NOT define **multi-agent delegation chain claims** (`delegationDepth`, `parentAgentId`, `originatingUserId`, `scopeNarrowing`, `allowedDelegationDepth`, `delegationChainHash`). Without these, multi-hop delegation cannot be authorized or audited. Retrofitting them later would break every issued token. The contract must be in place from day one — even though Phase 1 ships single-agent (depth-0) tokens — so that historical audit events can be reconstructed and the signed-JWT verifier is uniform across phases.

Stream 6 research (`/home/z/my-project/phase-c-stream6-multi-agent-report.md`, §6) confirmed the principle across industry sources: O'Reilly Radar ("the subagent should receive strictly fewer permissions than the parent — never the same set, and certainly never more"); Okta (`https://www.okta.com/identity-101/how-to-implement-least-privilege-for-ai-agents`: "AI agents should typically be treated as first-class identities rather than as extensions of the human users who triggered them"); FINOS AIR Governance Framework ("granular access controls ensuring agents can only access APIs, tools, and data strictly necessary for their task"). The Cedar 3-layer model (L1 agent-to-tool, L2 agent-to-agent delegation hop + capability-subset, L3 originating-user authorization) and OAuth 2.0 OBO scope-narrowing are adopted in ADR-061. This ADR codifies the **JWT claim set** that makes L2 and L3 enforceable and auditable at every delegation hop.

The OAuth 2.0 OBO pattern (search s12, multiple sources) provides the standards-grounded mechanism: each delegation hop issues a new, narrower token with reduced scope, reduced audience, reduced validity, and reduced remaining delegation depth (IETF draft `https://www.ietf.org/archive/id/draft-li-oauth-delegated-authorization-03.html`; Auth0 AAP profile `https://community.auth0.com/t/aap-an-oauth-2-0-authorization-profile-for-autonomous-ai-agents-extending-jwt-with-capabilities-delegation-and-oversight/197062`; Medium OBO guide `https://medium.com/@sauravkumarsct/oauth-delegation-for-agents-o-b-o-1e75616c2033`). The token never expands.

## 2. Problem

Should SmartAgentics extend Stream 5's signed-JWT agent identity (ADR-055) with a `DelegationContext` claim set, model delegation context as a separate sidecar token, embed the full delegation chain in the JWT, use ambient context (no explicit claim set), or rely on Cedar/OPA runtime policy evaluation without JWT claims?

## 3. Options

### Option A: Separate sidecar token (delegation context in a second JWT)

Rejected. Two tokens to verify on every tool call doubles verification overhead and breaks the "one verifiable identity per agent invocation" simplicity. The Auditor (ADR-052) would have to correlate two tokens per audit event.

### Option B: Full delegation chain embedded in the JWT

Rejected. JWT grows linearly with delegation depth → token size bloat (R-6.6.2). A 5-hop chain could push the JWT past typical header size limits. The `delegationChainHash` (SHA-256) is the compact representation; the full chain is persisted in the `AgentDelegation` Prisma table (per ADR-061).

### Option C: Ambient permission context (no explicit `DelegationContext` claim set)

Rejected. Cannot audit; cannot enforce narrowing; cannot reconstruct the chain from the token alone. The signed-JWT verifier needs the chain claims in the token to make a tamper-evident decision.

### Option D: Cedar / OPA runtime policy evaluation without JWT claims

Rejected for Phase 1. Cedar is a Rust library (Node.js binding or external service required); OPA adds operational burden. The `DelegationContext` claim set in the signed JWT is sufficient for Phase 1–2 rule complexity. Reserved for Phase 3+ as a `DelegationGuard` implementation (per ADR-061).

### Option E: Sub-agent uses originating-user permissions only (no chain claims)

Rejected. Violates "agent identity ≠ user identity" (Phase B #20). Conflates agent identity with user identity; the sub-agent could do things the user cannot but the agent's role permits, or vice versa. The chain must propagate.

### Option F: Extend ADR-055 signed JWT with `DelegationContext` claim set

Adopted. The signed JWT gains a single additive `delegationContext` claim containing `{ delegationDepth, parentAgentId, originatingUserId, originatingUserRole, originatingUserMfaVerified, scopeNarrowing, allowedDelegationDepth, delegationChainHash }`. Phase 1 single-agent tokens have `delegationDepth: 0`, `parentAgentId: null` — backward-compatible. The verifier is uniform across phases.

## 4. Decision

Adopt **Option F** — extend Stream 5's signed-JWT agent identity (ADR-055) with a `DelegationContext` claim set.

### `DelegationContext` claim set (additive to ADR-055)

```typescript
export interface DelegationContext {
  delegationDepth: number; // 0 = root agent invoked directly by human
  parentAgentId: string | null; // null for root
  originatingUserId: string; // the human who started the chain
  originatingUserRole: UserRole; // admin/manager/front-desk/etc.
  originatingUserMfaVerified: boolean; // MFA state at chain origin
  scopeNarrowing: string[]; // remaining permission scopes (monotonically narrowing)
  allowedDelegationDepth: number; // hard limit for this chain (default 5, Cedar)
  delegationChainHash: string; // SHA-256 of full chain (compact representation)
}
```

### JWT structure (extends ADR-055)

```typescript
// ADR-055 claims (unchanged)
interface AgentIdentityClaims {
  agentId: string;
  agentContractVersion: string;
  tenantId: string;
  propertyId: string;
  sessionId: string;
  actorUserId: string;
  requestedByRole: UserRole;
  invokedAt: number;
  expiresAt: number;
}

// ADR-063 additive claim (new)
interface AgentIdentityJWT extends AgentIdentityClaims {
  delegationContext: DelegationContext;
}
```

Phase 1 single-agent tokens have `delegationContext.delegationDepth = 0` and `parentAgentId = null` — backward-compatible with ADR-055 verifiers that ignore unknown claims.

### Issuance & propagation

- **Issuer**: the Supervisor (ADR-050) at the `dispatch` step. For delegation hops, the delegating agent's Supervisor-side invocation mints a new signed JWT for the sub-agent with monotonically narrowed `scopeNarrowing` and decremented `allowedDelegationDepth`. Signing key: SmartAgentics-local secret per ADR-010 (unchanged from ADR-055).
- **Expiry**: `expiresAt = invokedAt + AgentContract.maxDurationMs + 60s` (unchanged from ADR-055 — the grace period for audit writes after timeout applies equally to delegation chains).
- **Propagation**: the JWT is passed as the `agentIdentity` field in every Vercel AI SDK tool-execution context (`prepareStep` injects it). Every tool handler receives and verifies it (unchanged from ADR-055).
- **Verification**: every tool handler verifies the JWT signature, expiry, **and** the `DelegationContext` (via the `DelegationGuard` per ADR-061) before executing. Failure is logged as `AIAuditEvent.eventType = 'PERMISSION_DENIED'` with `severity = 'WARN'` and the full `DelegationContext` for forensic reconstruction.

### Scope-narrowing rule (per ADR-061)

Sub-agent effective permissions = `parentAgent.permissions ∩ subAgent.registeredPermissions ∩ originatingUser.permissions`. The `scopeNarrowing` array in the JWT carries the **remaining** scopes (monotonically narrowing at each hop). If the intersection is empty, the delegation is **rejected** (never silent failure) and the Supervisor escalates to a human per ADR-065 (escalation trigger: "empty permission intersection").

### `delegationChainHash` (SHA-256)

The full delegation chain (parent → child → grandchild → ...) is persisted in the `AgentDelegation` Prisma table (per ADR-061). The JWT carries only the SHA-256 hash of the chain — keeping the JWT compact while enabling:

- **Tamper-evidence**: any modification to the chain (e.g., inserting a rogue hop) changes the hash, breaking the JWT signature.
- **Audit reconstruction**: the Auditor (ADR-052) joins `AgentDelegation` rows by `correlationId` and verifies the chain hash against the JWT.
- **Compact propagation**: the JWT stays well under typical header size limits even for 5-hop chains.

### `allowedDelegationDepth` claim

Hard limit = **5** (Cedar default; SmartAgentics hotel workflows are depth-2 max — Supervisor → Specialist). Configurable per `AgentContract` for future AI-BOS scenarios requiring deeper chains. Enforced by the `DelegationGuard` (per ADR-061, L2 check: `delegationDepth < allowedDelegationDepth`).

## 5. Rationale

- **FC-6.2 resolution**: extends ADR-055's signed-JWT agent identity with the multi-agent delegation chain claims. The contract is in place from day one — even though Phase 1 ships depth-0 tokens — so that the verifier is uniform across phases and historical audit events are reconstructable.
- **B4 #19 + B4 #20 satisfaction**: User Permissions ≠ Agent Permissions ≠ Tool Permissions, and agent identity ≠ user identity, are preserved at every delegation hop. The sub-agent never inherits the parent's full permissions; the sub-agent never acts as the originating user.
- **OWASP ASI03 mitigation**: the `delegationDepth` claim bounds the chain at 5 hops; the `scopeNarrowing` claim enforces monotonic narrowing; the `delegationChainHash` makes the chain tamper-evident.
- **OAuth 2.0 OBO alignment**: each delegation hop mints a new, narrower JWT (reduced scope, reduced audience, reduced validity, reduced remaining delegation depth) — exactly the IETF draft + Auth0 AAP + Medium OBO pattern.
- **`delegationChainHash` keeps the JWT compact**: a 5-hop chain adds a single SHA-256 hash to the JWT (32 bytes), not a linear chain of agent IDs. The full chain lives in `AgentDelegation` (per ADR-061).
- **Cedar / OPA rejected for Phase 1** (R-6.6.5): the TypeScript `DelegationGuard` (per ADR-061) is sufficient for Phase 1–2 rule complexity. Cedar/OPA reserved for Phase 3+ as a `DelegationGuard` implementation.
- **Backward-compatible with ADR-055**: Phase 1 single-agent tokens have `delegationDepth: 0`, `parentAgentId: null`. ADR-055 verifiers that ignore unknown claims continue to work; verifiers updated for ADR-063 enforce the `DelegationContext` from day one.
- **Auditable by chain**: the Auditor (ADR-052) can answer "which agent acting on behalf of which user, through which delegation chain, called tool T at time T'?" without ambiguity. The `AIAuditEvent` table (extended per ADR-068) records the full `DelegationContext` for every tool call.
- **Tamper-evidence**: a signed JWT with `delegationChainHash` cannot be forged by the agent's own code (the LLM cannot re-sign a JWT to escalate privileges or to extend the chain). The signing key is held by the Supervisor and the SmartAgentics config layer (ADR-010), not by the agent.
- **Expiry bounds blast radius**: a stolen or leaked JWT expires after `maxDurationMs + 60s` (unchanged from ADR-055); long-lived delegation chains are impossible by construction.

## 6. Consequences

- Stream 5's signed-JWT agent identity (ADR-055) is **amended** (separately, by the Phase D architect) to add the `DelegationContext` claim set. The amendment is additive: Phase 1 single-agent tokens have `delegationDepth: 0`, `parentAgentId: null`.
- New SDK interface `DelegationContext` in `packages/sdk/src/ai/collaboration.ts` (additive).
- The Supervisor's `signAgentIdentity` helper (per ADR-055) is extended to mint delegation-hop JWTs with narrowed `scopeNarrowing` and decremented `allowedDelegationDepth`.
- Every tool handler's `verifyAgentIdentity` helper (per ADR-055) is extended to verify the `DelegationContext` via the `DelegationGuard` (per ADR-061).
- The `AIAuditEvent` table (per ADR-059) is **amended** (separately, by the Phase D architect) to add nullable multi-agent delegation fields (`delegatingAgentId`, `delegationHop`, `parentInvocationId`, `originatingUserId`, `originatingUserRole`, `multiAgentTaskId`) per ADR-068 — FC-6.6 resolution.
- **R-6.6.1 risk (empty intersection silently breaks workflows)**: mitigated by mandatory escalation (never silent failure) per ADR-065.
- **R-6.6.2 risk (JWT bloat)**: mitigated by `delegationChainHash` (SHA-256, 32 bytes) instead of full chain in JWT.
- **R-6.6.3 risk (`DelegationGuard` performance bottleneck)**: mitigated by pure-function check (no I/O); sub-millisecond.
- **R-6.6.4 risk (Phase 1 has no delegation → contract untested in production)**: mitigated by integration tests exercising `DelegationContext` with a stub 2-hop chain in Phase E.
- **R-6.6.5 risk (future Cedar/OPA may require `DelegationGuard` rewrite)**: mitigated by the `DelegationGuard` interface (per ADR-061); Cedar/OPA can implement it without touching agent code.
- Dependencies: ADR-055 (signed-JWT agent identity, amended); ADR-061 (`DelegationGuard`, `AgentDelegation` table); ADR-054 (`ToolPermission`); ADR-053 (`AgentContract.capabilities` and `permissions`); ADR-010 (signing-key management). **No new runtime dependencies.**
- Phase 2+ AI-BOS agent marketplaces (third-party agents delegated to with narrowly scoped permissions), cross-tenant procedure sharing (tenant A's procedure invoked by tenant B's agent with B's user context), and multi-property collaboration (chain agent delegating to property agents with property-scoped permissions) all build on the `DelegationContext` + scope-narrowing contract.

## 7. Review Conditions

- Review if Phase 2+ `DelegationGuard` rule complexity exceeds ~50 distinct policies — would justify adopting Cedar or OPA as the policy engine (per ADR-061).
- Review if the hard 5-hop delegation depth limit proves too low for AI-BOS scenarios — would require per-`AgentContract` tuning.
- Review if JWT size becomes a problem at deeper chains (e.g., 5-hop chains with large `scopeNarrowing` arrays) — would justify compressing `scopeNarrowing` or moving it to a sidecar.
- Review if key rotation cadence (default 90 days per ADR-055) proves insufficient or excessive for production delegation chains.
- Review if a community agent-delegation standard emerges (e.g., a standardized `DelegationContext` claim set, or the Auth0 AAP profile stabilizes) that should replace the SmartAgentics-owned schema.
- Review if Phase 2+ requires explicit JWT revocation (e.g., a `MultiAgentTask` is canceled mid-chain) — would justify a revocation list or short-lived token rotation.
- Review if a PMS feature requires an agent to act with elevated privileges beyond its contract (admin debugging session) — would require a separate `MANAGER_OVERRIDE` flow with its own audit semantics distinct from `DelegationContext`.
