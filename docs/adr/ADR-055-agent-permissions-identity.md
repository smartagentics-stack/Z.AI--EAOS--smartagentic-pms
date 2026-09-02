# ADR-055: Agent Permissions & Identity — Signed-JWT Agent Identity, Permission Intersection

**ADR-ID:** ADR-055
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #19 ("ToolPermission — User Permissions ≠ Agent Permissions ≠ Tool Permissions") and B4 #22 ("Multi-Agent Architecture" with identity propagation) require the architecture to define agent identity as distinct from user identity. Stream 4 explicitly reserved "agent identity via signed JWT" for Stream 5 (per `/home/z/my-project/phase-c-stream5-agent-runtime-report.md` §6: "Stream 4 reserved the 'agent identity via signed JWT' contract for Stream 5"). Stream 5 research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §13) cited the multi-tenant AI access-control principle: "Identity, permissions and tenant boundaries must be enforced at the data, credential and tool layers, propagated through every agent" (LinkedIn multi-tenant AI architecture) and "Least privilege access for AI agents means restricting each agent's tool access, API permissions, and data scope to only what its specific [task requires]" (Cequence).

The architectural separation is: **User Permissions** (human roles — `MANAGER`, `FRONT_DESK`, `HOUSEKEEPING`), **Agent Permissions** (capabilities granted to an agent by its `AgentContract` — ADR-053), and **Tool Permissions** (per-tool role/permission requirements declared on the `Tool` entity — ADR-054). An agent may invoke a tool only when **all three intersect favorably**: the _user_ who triggered the agent has the role the tool requires; the _agent's contract_ permits the tool and lists it in `allowedTools`; the _tool permission row_ grants `ALLOW` (or `ALLOW_WITH_APPROVAL` for HIGH/CRITICAL) to that agent.

## 2. Problem

Should SmartAgentics model agent identity as a bare string ID, as a user-impersonation token (the agent acts _as_ the triggering user), as an opaque session-bound capability, or as a signed-JWT agent identity with explicit permission intersection at every tool call?

## 3. Options

### Option A: Bare string agent ID

Rejected: no tamper-evidence, no tenant binding, no expiry, no revocation, no per-session scoping. A bare ID is forgeable by any code that knows the ID.

### Option B: User-impersonation token (the agent acts as the triggering user)

Rejected: conflates user identity with agent identity. The Auditor (ADR-052) cannot distinguish "the user did X" from "the agent did X on behalf of the user" — destroying the audit trail's value. Also violates the principle that an agent's capabilities may be a strict subset of the user's (least privilege per Cequence): if the agent impersonates the user, it inherits _all_ the user's permissions, including those the `AgentContract` should deny.

### Option C: Opaque session-bound capability

Rejected: capabilities are difficult to audit and reason about at rest (the `AIAuditEvent` table needs a serializable identity). Capabilities also do not encode `tenantId`/`propertyId`/`sessionId` in a verifiable way without a signature.

### Option D: Signed-JWT agent identity with explicit three-way permission intersection

Every agent invocation mints a signed JWT that encodes `{ agentId, agentContractVersion, tenantId, propertyId, sessionId, actorUserId, invokedAt, expiresAt }`, signed by the Supervisor (ADR-050) at the `dispatch` step using a SmartAgentics-local signing key. The JWT is propagated to every tool call as the agent's identity. Tool execution enforces three-way intersection: `User.roles ⊇ Tool.requiredRoles` AND `AgentContract.allowedTools ∋ toolId` AND `AgentContract.maxRiskClass ≥ Tool.riskClass` AND `ToolPermission(toolId, agentId) ∈ {ALLOW, ALLOW_WITH_APPROVAL}`.

## 4. Decision

Adopt **Option D** — signed-JWT agent identity with explicit three-way permission intersection.

### `AgentPermission` entity (per ADR-053 `permissions` field)

```typescript
export interface AgentPermission {
  scope: 'TENANT' | 'PROPERTY' | 'SESSION';
  action: string; // e.g., 'reservation.create', 'billing.refund'
  constraints?: Record<string, unknown>; // e.g., { maxAmount: 1000 } for refunds
}
```

### Signed-JWT agent identity

- **Issuer**: the Supervisor at the `dispatch` step (ADR-050). Signing key: a SmartAgentics-local secret managed per ADR-010 (dev/config package) — never the user's credentials, never a cloud KMS.
- **Claims**: `{ agentId, agentContractVersion, tenantId, propertyId, sessionId, actorUserId, requestedByRole, invokedAt, expiresAt }`.
- **Expiry**: `expiresAt = invokedAt + AgentContract.maxDurationMs + 60s` (grace period for audit writes after timeout).
- **Propagation**: the JWT is passed as the `agentIdentity` field in every Vercel AI SDK tool-execution context (`prepareStep` injects it); every tool handler receives it as the first argument.
- **Verification**: every tool handler verifies the JWT signature and expiry before executing; failure is logged as `AIAuditEvent.eventType = 'PERMISSION_DENIED'` with `severity = 'WARN'`.

### Three-way permission intersection (enforced at every tool call)

1. **User leg**: `User.roles ⊇ Tool.requiredRoles`. The user who triggered the agent must have a role the tool requires. (If the user is a `FRONT_DESK` and the tool requires `MANAGER`, the call is denied — even if the agent's contract allows it. The user must escalate to a manager.)
2. **Agent-contract leg**: `AgentContract.allowedTools ∋ toolId` AND `AgentContract.maxRiskClass ≥ Tool.riskClass`. The agent's contract must list the tool and the tool must be within the agent's risk ceiling. The Supervisor's `buildToolset` step (ADR-050) enforces this _before_ dispatch — tools that fail this check are not even presented to the LLM.
3. **Tool-permission leg**: `ToolPermission(toolId, agentId).permission ∈ {ALLOW, ALLOW_WITH_APPROVAL}`. The per-agent, per-tool permission row must grant access (or grant-with-approval for HIGH/CRITICAL).

If any leg fails, the tool call is denied and an `AIAuditEvent` with `eventType = 'TOOL_DENIED'` is written. If `ALLOW_WITH_APPROVAL`, the Supervisor's `requestApproval` step (ADR-050) fires — the workflow pauses for human approval before the tool executes.

### Tenant boundary enforcement

- The JWT's `tenantId` claim is the _only_ source of truth for tenant scoping inside any tool. Tool handlers must not accept a `tenantId` from the LLM-produced tool arguments; they read it from the verified JWT.
- Cross-tenant tool calls are impossible by construction: the JWT signature would have to be forged.
- Per-tool `prepareStep` injection (per ADR-054) ensures the LLM cannot override the tenant context ("isolation by architecture, not by prompt", Microsoft SFI rule cited in Stream 4).

## 5. Rationale

- **B4 #19 satisfaction**: User Permissions ≠ Agent Permissions ≠ Tool Permissions. The three-way intersection makes this distinction operational — each leg is enforced independently, and failure of any leg denies the call.
- **Auditable by identity**: the JWT is serializable and verifiable; the `AIAuditEvent` table records the exact `agentId`, `agentContractVersion`, `actorUserId`, `tenantId`, and `sessionId` for every tool call. The Auditor (ADR-052) can answer "which agent acting on behalf of which user called tool T at time T'?" without ambiguity.
- **Least privilege by construction**: the agent inherits only the permissions its contract grants — never the full user permission set. The agent cannot escalate beyond `AgentContract.maxRiskClass` or call tools outside `allowedTools`.
- **Tamper-evidence**: a signed JWT cannot be forged by the agent's own code (the LLM cannot re-sign a JWT to escalate privileges). The signing key is held by the Supervisor and the SmartAgentics config layer (ADR-010), not by the agent.
- **Expiry bounds blast radius**: a stolen or leaked JWT expires after `maxDurationMs + 60s`; long-lived agent identities are impossible by construction.
- **Tenant isolation by signature**: the `tenantId` claim in the signed JWT is the authoritative source — a tool handler that reads `tenantId` from the JWT (not from LLM arguments) cannot be tricked into cross-tenant access.
- **Fulfills Stream 4's reservation**: Stream 4 explicitly reserved "agent identity via signed JWT" for Stream 5. This ADR fulfills that reservation.
- **Microsoft SFI alignment**: "isolation by architecture, not by prompt" — the JWT-enforced `tenantId` is the architectural enforcement; prompt-level instructions are insufficient.

## 6. Consequences

- SmartAgentics must implement and maintain a local JWT signing key (per ADR-010), a `signAgentIdentity` helper in the Supervisor, and a `verifyAgentIdentity` helper used by every tool handler.
- The `AgentPermission` SDK interface and the `ToolPermission` Prisma entity (ADR-054) are the two permission surfaces; this ADR defines the _intersection_ logic, not a new entity.
- Every tool handler must verify the JWT before executing — a small but mandatory boilerplate. Mitigation: a `withAgentIdentity(handler)` decorator wraps the verification.
- **Key rotation**: the signing key must be rotated periodically. Mitigation: the JWT `kid` (key ID) header supports multi-key verification during rotation; the Supervisor accepts tokens signed by the current or previous key for a configurable grace period.
- **Performance**: JWT verification is sub-millisecond on local hardware — negligible vs. LLM call latency.
- **Revocation**: JWTs are short-lived (`maxDurationMs + 60s`); explicit revocation is not required for Phase 1. If Phase 2+ requires revocation (e.g., an agent contract is `DISABLED` mid-session), the Supervisor's `cancel` method short-circuits running sessions via Restate.
- Dependencies: ADR-053 `AgentContract`; ADR-054 `Tool`/`ToolPermission`; ADR-010 (signed-key management); Stream 4 `MemoryStore` (the JWT's `sessionId` binds memory writes to the agent's session).
- Existing user-authentication JWT (per ADR-009 internal SDK) is unchanged — the agent JWT is a _separate_ token type, signed by the Supervisor, not by the user auth service.

## 7. Review Conditions

- Review if Phase 2+ requires explicit JWT revocation (e.g., disabled-contract mid-session) — would justify a revocation list or short-lived token rotation.
- Review if key rotation cadence (default: 90 days) proves insufficient or excessive for production.
- Review if a community agent-identity standard emerges (e.g., a standardized agent JWT claim set) that should replace the SmartAgentics-owned claim schema.
- Review if Stream 6 multi-agent collaboration requires _agent-to-agent_ identity propagation (an agent invoking another agent) — would extend the JWT to carry a chain of agent identities.
- Review if a PMS feature requires an agent to act with elevated privileges beyond its contract (e.g., an admin debugging session) — would require a separate `MANAGER_OVERRIDE` flow with its own audit semantics.
