# ADR-094: Agent Sandbox & Egress Control — Allowlist-Based Egress, Argument Inspection, Parameter Validation

**ADR-ID:** ADR-094
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #29 ("Offline AI security") flags agent sandbox boundaries and egress control as a "NOW" gap. Stream 5 reserved `ToolRegistry` and `ToolPermission`; Stream 6 added Cedar L1/L2/L3 authorization; Stream 7 established hub-and-spoke LAN sync with `idempotencyKey` on every mutable table. None of these specifies the **agent sandbox boundary** — the contract that prevents an agent tool from calling any URL/IP not on an allowlist, inspects tool-call arguments for PII and egress targets, and validates parameters via zod schemas.

The Stream 8 research (s10, s20) is unambiguous:

- **Praesidia rate-limiting research** (March 2026): "An agent that decides to call a tool — send an email, write to a database, call an external API — may trigger a chain of side effects that [compound beyond the original request]."
- **TrueFoundry rate-limiting AI agents** (May 2026): "Implement token buckets, circuit breakers, [per-tool quotas]."
- **NeuralTrust rate-limiting AI agents** (January 2026): "Master AI agent autonomy with Rate Limiting & Throttling: control costs, prevent abuse, and ensure enterprise-grade security and trust."
- **OWASP LLM06:2025 Excessive Agency** (s01): agents with too-permissive tool inputs can take actions beyond what the user intended.
- **Augmentcode agent execution sandbox** (May 2026, s20): "restricts filesystem access, network egress, and [process spawning]."
- **Northflank secure AI-agent sandbox networking** (s20): "An egress allowlist defines exactly where a sandbox can connect. Policies can restrict traffic by hostname, IP range, port, and protocol."
- **Innoq sandboxed coding agents** (March 2026, s20): "I routed all network traffic from my development sandbox through a strict proxy allowlist, allowing only a small [set of trusted endpoints]."

The agent sandbox is the runtime boundary that contains a compromised or injected agent. Even if a prompt-injection attack achieves tool-call execution (e.g., convinces the agent to call `sendEmail`), the sandbox ensures: (a) the call destination is on the egress allowlist; (b) the arguments are zod-validated; (c) the rate limit per `(agentId, toolId, tenantId)` triple is not exceeded; (d) the circuit breaker is not open; (e) idempotency key is present for HIGH/CRITICAL tools.

## 2. Problem

Should SmartAgentics adopt unrestricted agent egress, default-allow egress, default-deny egress with allowlist, or a cloud AI gateway? Should tool arguments be inspected? Should rate limiting be per-agent or per-tool?

## 3. Options

### Option A: Unrestricted agent egress (trust the LAN)

Rejected. A prompt-injection attack that achieves code execution could exfiltrate guest data to any URL. Default-deny egress is mandatory for a production-safe AI PMS.

### Option B: Default-allow egress (allow all, block known-bad)

Rejected. Blocklist approaches are reactive — new attacker endpoints appear faster than blocklists update. Default-deny with explicit allowlist is the only production-safe posture.

### Option C: Cloud AI gateway (Cloudflare AI Gateway, AWS Bedrock Gateway)

Rejected. Violates offline-first. Hotel servers have no guaranteed internet egress.

### Option D: Per-agent rate limiting only (no per-tool granularity)

Rejected. A compromised agent could exhaust its quota on harmless tools and then never reach the dangerous ones; conversely, a runaway loop on one tool shouldn't disable all the agent's other tools. Per-tool granularity is required.

### Option E: Default-deny egress allowlist + zod parameter validation + per-(agentId, toolId, tenantId) rate limiting + circuit breaker + idempotency keys

Adopted. The 5-dimension tool abuse prevention contract wraps the 4-class risk rubric (ADR-086).

## 4. Decision

Adopt **Option E** — the agent sandbox & egress control contract.

### 5-dimension tool abuse prevention

#### 1. Side-effect classification (per ADR-086)

Every `Tool` carries a `sideEffectClass`: `PURE_READ` / `WRITE_IN_SESSION` / `WRITE_PERSISTENT` / `WRITE_IRREVERSIBLE` / `EXTERNAL_EGRESS`. Drives the default rate limit and the approval policy.

#### 2. Rate limiting per `(agentId, toolId, tenantId)` triple

Token-bucket algorithm. Defaults (per ADR-086):

- `PURE_READ`: 100 calls/min/agent.
- `WRITE_IN_SESSION`: 30 calls/min/agent.
- `WRITE_PERSISTENT`: 10 calls/min/agent.
- `WRITE_IRREVERSIBLE`: 2 calls/hour/agent.
- `EXTERNAL_EGRESS`: 5 calls/min/agent.

Per-tenant overrides via `AIConfiguration` (ADR-095). On violation: `AIAuditEvent` `eventType=TOOL_RATE_LIMIT_EXCEEDED` + Supervisor pauses agent.

#### 3. Parameter validation via zod schemas

Every tool MUST have a zod schema (already in Stream 5 Vercel AI SDK `tool({inputSchema: z.object({...})})` with `strict: true`). `strict: true` is mandatory for production tools. Reject any tool call whose arguments fail zod validation.

#### 4. Idempotency keys for `WRITE_PERSISTENT` and `WRITE_IRREVERSIBLE`

Extends Stream 7's `idempotencyKey` pattern. Every HIGH/CRITICAL tool call MUST generate a UUID idempotency key; the tool implementation must be idempotent under replay. Stream 7's `@@unique([tenantId, idempotencyKey])` constraint on mutable tables (Reservations, Rooms, etc.) provides the dedup mechanism.

#### 5. Circuit breaker per tool

After N consecutive failures (default 5), the tool is marked `DEGRADED` for `breakerTtl` (default 5 min); agent calls to a `DEGRADED` tool are rejected with `ToolCircuitBreakerOpen`. Prevents runaway retry loops.

### Egress allowlist (default-deny)

| Phase    | Allowlist contents                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1  | `127.0.0.1` (Ollama, SQLite hub), local SMTP relay, local network printer. No external internet egress from any agent tool.      |
| Phase 2+ | Per-tenant admin-configurable allowlist (ADR-095); each addition logged as `AIAuditEvent` `eventType=EGRESS_ALLOWLIST_MODIFIED`. |

### `EgressAllowlist` Prisma table (new, per-tenant)

```prisma
model EgressAllowlist {
  id          String   @id @default(cuid())
  tenantId    String
  hostPattern String   // hostname or IP range (e.g., "smtp.local", "192.168.1.0/24")
  port        Int?
  protocol    String   // "tcp" | "udp" | "http" | "https" | "smtp"
  addedBy     String   // admin userId
  addedAt     DateTime @default(now())
  reason      String   // why this entry was added (audit)

  @@unique([tenantId, hostPattern, port, protocol])
  @@index([tenantId])
}
```

### `EgressAllowlist` SDK interface (new in `packages/sdk/src/ai/`)

```typescript
export interface EgressAllowlist {
  isAllowed(target: { host: string; port: number; protocol: string }, tenantId: string): boolean;
  addEntry(entry: EgressAllowlistEntry, adminUserId: string): Promise<void>;
  removeEntry(entryId: string, adminUserId: string): Promise<void>;
  listEntries(tenantId: string): Promise<EgressAllowlistEntry[]>;
}
```

### Tool-call argument inspection

Before any `EXTERNAL_EGRESS` tool call executes:

1. The sandbox inspects the resolved target (host, port, protocol) against `EgressAllowlist`.
2. If not allowed → `AIAuditEvent` `eventType=EGRESS_BLOCKED` + reject.
3. The sandbox also runs `PIIRedactor.detectAndRedactInput` (ADR-082 D1) on the tool arguments — any PII in arguments is redacted before the call.

### `RateLimiter` and `CircuitBreaker` Restate Virtual Objects

Keyed by `(tenantId, agentId, toolId)`. Token-bucket state and breaker state are durable (Restate journaling).

### Phase 1 scope

- Egress allowlist enforcement at tool-call boundary (Phase 1 allowlist: local-only).
- Rate limiting + circuit breaker per `(agentId, toolId, tenantId)`.
- zod validation (already in Stream 5).
- Idempotency keys (extends Stream 7).
- Per-tenant admin UI for egress allowlist deferred to Phase 2.

## 5. Rationale

- **OWASP LLM06:2025 closure** (s01): the 5-dimension contract prevents excessive agency.
- **Praesidia principle** (s10): "an agent may trigger a chain of side effects" — rate limiting + circuit breaker + idempotency contain the chain.
- **Augmentcode / Northflank / Innoq principle** (s20): egress allowlist is the production isolation boundary for agent network access.
- **Default-deny egress** is the only production-safe posture — blocklist approaches are reactive.
- **Per-tool rate limiting** (not per-agent) prevents a runaway loop on one tool from disabling all the agent's other tools, and prevents a compromised agent from exhausting its quota on harmless tools.
- **zod validation with `strict: true`** rejects unexpected tool arguments — a prompt-injection attack that tries to call `issueRefund({amount: 99999, account: "attacker"})` with malformed args is rejected before execution.
- **Idempotency keys** (Stream 7 pattern) prevent replay attacks — a duplicated HIGH/CRITICAL tool call is deduplicated via `@@unique([tenantId, idempotencyKey])`.
- **Circuit breaker** prevents runaway retry loops — after 5 consecutive failures, the tool is `DEGRADED` for 5 min.
- **PII inspection on tool arguments** (D1 from ADR-082) prevents PII exfiltration via tool-call arguments (e.g., `sendEmail({body: "guest passport is P1234567"})`).
- **Offline-first respected**: no cloud AI gateway; the egress allowlist is a local SQLite table.

## 6. Consequences

- New `EgressAllowlist` Prisma table (per-tenant).
- New `EgressAllowlist`, `RateLimiter`, `CircuitBreaker` SDK interfaces / Restate Virtual Objects.
- New `AIAuditEvent` event types: `EGRESS_BLOCKED`, `EGRESS_ALLOWLIST_MODIFIED`, `TOOL_RATE_LIMIT_EXCEEDED`, `TOOL_CIRCUIT_BREAKER_OPEN`, `TOOL_REJECTED`.
- ADR-048 amendment adds `sideEffectClass`, `rateLimitConfig`, `breakerTtl` to the `Tool` Prisma model.
- **Risk: rate-limit values may be wrong for real hotel workloads.** Mitigation: per-tenant overrides via `AIConfiguration` (ADR-095); tune in Phase 2 based on production telemetry from `AIAuditEvent`.
- **Risk: circuit breaker may mask underlying bugs** (tool always fails → breaker always open). Mitigation: `AIAuditEvent` `TOOL_CIRCUIT_BREAKER_OPEN` event triggers an alert; Phase 2 ops dashboard surfaces stuck breakers.
- **Risk: egress allowlist may break legitimate Phase 2 use cases** (e.g., weather API for tourism recommendations). Mitigation: per-tenant admin-configurable allowlist; each addition logged as `AIAuditEvent`.
- **Risk: zod schema is missing for a tool** (developer forgot). Mitigation: verifier rule (VERIFY-AI-SECURITY-01) flags `Tool` without `riskClass` and the same rule can enforce zod schema presence.
- **Risk: idempotency key is missing for a HIGH/CRITICAL tool call.** Mitigation: the Supervisor rejects any HIGH/CRITICAL call without an idempotency key with `ToolIdempotencyKeyMissing`.
- Dependencies: Stream 5 `ToolRegistry` + `ToolPermission`; Stream 5 Vercel AI SDK `tool()` with zod; Stream 7 `idempotencyKey` pattern; Stream 5 `AIAuditEvent`; ADR-082 (PIIRedactor for argument inspection); ADR-086 (side-effect classification drives rate limits).
- Phase 1 effort: ~1 week (egress allowlist enforcement at tool-call boundary). Rate limiting + circuit breaker + zod validation reuse Stream 5/7 contracts.

## 7. Review Conditions

- Review if rate-limit defaults prove wrong for real hotel workloads — would tune via `AIConfiguration` (ADR-095) per-tenant overrides.
- Review if a stuck circuit breaker masks a real bug — would require ops dashboard surfacing stuck breakers (Phase 2).
- Review if Phase 2+ use cases (weather API, tourism recommendations) require external egress — would activate the per-tenant admin-configurable allowlist.
- Review if a tool author omits zod schema — verifier rule (VERIFY-AI-SECURITY-01) catches it in CI.
- Review if a prompt-injection attack attempts to call `EXTERNAL_EGRESS` tools with PII in arguments — the PII inspection (ADR-082 D1) redacts before the call.
- Review if a community agent-sandbox standard emerges (e.g., OWASP Agentic Applications sandbox profile) that should replace the SmartAgentics-owned contract.
- Review if Phase 3+ requires per-agent sandbox isolation (e.g., separate process per agent) — would extend the sandbox boundary from tool-call to process.
