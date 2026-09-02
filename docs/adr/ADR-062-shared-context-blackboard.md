# ADR-062: Shared Context Blackboard — Virtual Object K/V State for Shared Context

**ADR-ID:** ADR-062
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #22 ("Multi-Agent Communication") requires agents to "collaborate through controlled task/message mechanisms" — collaboration implies shared context. Phase B #18 mandates "Department AI Agents" with at least implicit context sharing (front-desk → reservation → housekeeping flows cross-reference guest, reservation, and room state). Stream 4 (`/home/z/my-project/phase-c-stream4-memory-architecture-report.md`) already established a 4-dimensional scope model (`tenantId × userId × agentId × memoryType`) with `WorkingMemory` as the per-session mutable scratchpad and `AgentMemory` as one of the 7 sub-types. Stream 5 reaffirmed the 3-layer state pattern: Restate journal = source of truth; Prisma = queryable projection; WorkingMemory = mutable scratchpad.

Stream 6 research (`/home/z/my-project/phase-c-stream6-multi-agent-report.md`, §5) confirmed that shared context is **the bottleneck** in multi-agent systems. Reddit r/AI_Agents (Mar 2026): "Memory architecture is the real bottleneck in multi-agent AI. Memory architecture means: how do agents share state? AGENTS.md as the entrypoint, dated logs, shared context across agents, ensuring agents stay in sync." JumpCloud: "Learn how shared memory and blackboard architectures synchronize data, automate tasks, and coordinate resources in multi-agent systems."

Three patterns for sharing context are documented (`https://fast.io/resources/multi-agent-context-sharing-patterns`): **blackboard** (shared workspace), **shared workspace** (shared file/KV store), **message-passing** (context passed in messages). The blackboard pattern is well-defined: `https://data-flair.training/blogs/blackboard-architecture-in-agentic-ai`: "A design where multiple AI agents (or knowledge sources) interact through a shared memory space (the 'blackboard') instead of communicating directly with each other." Plus `https://arxiv.org/html/2507.01701v1`: "The blackboard public space serves as a shared memory in which each LLM agent can read and write, enabling seamless communication." Plus the Nir Diamant multi-agent memory techniques repo: "The Blackboard provides a read-only aggregated view of all shared memory. Agents use it to see the current state of the collaborative work without querying each other."

Restate's mechanism for shared context is the **Virtual Object K/V store** (`https://docs.restate.dev/foundations/services`: "Virtual Objects Use for: Modeling entities like user accounts, shopping carts, chat sessions, **AI agents**, state machines, or any business entity needing state"). State is "scoped per key" and "the object key is part of the scoped identity" — the key carries the tenant/session scoping. Restate's concurrency model is the decisive constraint: "Only one write handler runs at a time per key, preventing race conditions." A blackboard implemented as a Virtual Object therefore has **single-writer semantics** — multiple agents can read concurrently (via shared/non-exclusive handlers), but writes are serialized. This is a safety feature, not a limitation: it prevents the write-write conflicts that plague naive shared-memory designs.

Context propagation across agents in Restate happens via **typed invocation arguments** (`ctx.serviceClient(OtherAgent).handler({ ...ctxMetadata, taskPayload })`) — not via ambient context variables. This makes context explicit and journaled. For tenant isolation, the `tenantId` is part of the Virtual Object key (e.g., `tenant-42:session-abc`), so context is **structurally isolated** — an agent for tenant A literally cannot address tenant B's Virtual Object because the key doesn't match.

## 2. Problem

Should SmartAgentics implement shared context as a shared mutable process memory space (singleton `Map`), as Node.js `AsyncLocalStorage` ambient context, as an external cache (Redis), as message-passing-only (no blackboard), as a database table read/written by every agent, or as a Restate Virtual Object K/V store keyed by `(tenantId, sessionId)` with single-writer semantics and structural tenant isolation?

## 3. Options

### Option A: Shared mutable process memory (singleton `Map` between agents)

Rejected. Breaks isolation (any code with a reference can mutate), durability (lost on process restart), multi-tenant safety (no key scoping), and race-free guarantees (no serialization). Fundamentally incompatible with Restate's "every cross-agent call goes through the journal" property (per ADR-060).

### Option B: Node.js `AsyncLocalStorage` / context locals

Rejected. Bypasses the Restate journal (not durable, not replayable); not isolated across Restate invocations (each `ctx.serviceClient()` call is a fresh execution context). Breaks auditability.

### Option C: External shared cache (Redis Pub/Sub or Redis KV)

Rejected. Conflicts with offline-first (ADR-001); duplicates what Restate's Virtual Object K/V store already does durably; adds operational burden (separate process, separate backup, separate monitoring). Restate IS the shared state store.

### Option D: Message-passing-only (no blackboard)

Rejected for Phase 2+. Agents would have to query each other for context → N² communication for N agents. Blackboard is O(1) per agent read. Phase 1 (single agent) is trivially message-passing-only.

### Option E: Per-agent `WorkingMemory` shared across agents

Rejected. Breaks agent isolation. Stream 4's `AgentMemory` and Stream 5's `WorkingMemory` are agent-scoped for a reason — agents have private reasoning that should not leak to other agents.

### Option F: Database table as the blackboard (e.g., a `SessionContext` Prisma table read/written by every agent)

Rejected for the hot path. Database round-trip per read; no single-writer serialization; no Restate journaling. Database tables are reserved as a **periodic projection** for queryability (same pattern as Stream 5's 3-layer state: Restate journal = source of truth, Prisma = queryable projection).

### Option G: Restate Virtual Object K/V store keyed by `(tenantId, sessionId)`

Adopted. Single-writer (exclusive handlers) for writes — serialized, race-free. Shared (non-exclusive) handlers for reads — concurrent reads from any agent. Context propagation via typed invocation arguments. Context isolation via key scoping (`tenantId` always in key). `SessionContextService` is the new Restate Virtual Object service.

## 4. Decision

Adopt **Option G** — `SessionContextService` as a Restate Virtual Object keyed by `(tenantId, sessionId)`.

### `SessionContextService` handler classes

Two handler classes, distinguished by Restate's exclusive/shared handler model:

- **Exclusive (write) handlers** — serialized per session key, race-free:
  - `appendFact(sessionId, fact)` — append a fact to the session blackboard.
  - `updateGuestContext(sessionId, update)` — partial update to the guest context.
  - `setReservationContext(sessionId, context)` — overwrite the reservation context.
- **Shared (read) handlers** — concurrent reads from any agent, no blocking:
  - `getFacts(sessionId)` — return all facts.
  - `getGuestContext(sessionId)` — return the guest context.
  - `getReservationContext(sessionId)` — return the reservation context.

### `SessionContext` SDK interface (new file, additive)

```typescript
// Pseudocode — contract only, NOT for Phase 1 implementation
export interface SessionContext {
  // Read (shared handler — concurrent)
  getFacts(sessionId: string): Promise<Fact[]>;
  getGuestContext(sessionId: string): Promise<GuestContext>;
  getReservationContext(sessionId: string): Promise<ReservationContext>;
  // Write (exclusive handler — serialized per session key)
  appendFact(sessionId: string, fact: Fact): Promise<void>;
  updateGuestContext(sessionId: string, update: Partial<GuestContext>): Promise<void>;
}
```

### Context propagation

Context is propagated across agents via **typed invocation arguments** (Restate `serviceClient` calls). No ambient context. The `MultiAgentTask` payload (per ADR-060) carries a `SessionContextRef` (the session key) so the receiving agent can read the blackboard:

```typescript
interface MultiAgentTask {
  // ... (per ADR-060)
  sessionId: string; // the SessionContext key suffix
  // ... the agent reads SessionContext via ctx.objectClient(SessionContextService, `${tenantId}:${sessionId}`)
}
```

The Supervisor injects `SessionContextRef` into every `MultiAgentTask` payload. Agents **MUST** read the blackboard before acting — enforced by the Auditor (ADR-052) as a read-before-act rule.

### Context isolation

Context isolation is **structural** via the Virtual Object key. The key always includes `tenantId`. An agent for tenant A cannot address tenant B's `SessionContext` because the key doesn't match. This is enforced by Restate's key-scoping, not by application-level checks.

Key construction is **centralized** in `SessionContextService.client(tenantId, sessionId)`. No raw key strings in agent code — mitigates R-6.5.4 (cross-tenant context leak from misconstructed keys).

### `WorkingMemory` (Stream 4) vs `SessionContext` (Stream 6)

The two are distinct interfaces and must not be conflated:

- **`WorkingMemory`** (Stream 4, per-agent scratchpad): "what this agent is currently thinking about" — private, ephemeral, agent-scoped. Agents read/write their own `WorkingMemory` freely.
- **`SessionContext`** (Stream 6, per-session shared blackboard): "what all agents in this session know about the guest/reservation/issue" — shared, session-scoped, single-writer. Agents read freely but write only via the serialized exclusive handlers.

This matches the Nir Diamant blackboard definition: "The Blackboard provides a read-only aggregated view of all shared memory. Agents use it to see the current state of the collaborative work without querying each other."

### `SessionContextSnapshot` Prisma table (Phase 2+ projection)

Optional new Prisma table — periodic projection of `SessionContext` Virtual Object state for queryability by the PMS UI. Same 3-layer pattern as Stream 5's `AgentSession`. Phase 1 may defer (single agent reads its own `SessionContext` directly via Restate; no cross-service queryability needed).

## 5. Rationale

- **B4 #22 satisfaction**: agents share context through a controlled, journaled, single-writer mechanism — not through ambient variables or shared process memory.
- **Restate Virtual Object is the right primitive**: single-writer semantics prevent write-write conflicts; shared handlers enable concurrent reads; key scoping enforces tenant isolation structurally. No new runtime dependency.
- **Single-writer is a safety feature, not a limitation**: hotel PMS session write rates are low (human-paced); single-writer serialization is sufficient (R-6.5.1).
- **No shared mutable process memory**: aligns with ADR-060's prohibition and with Restate's "every cross-agent call goes through the journal" property.
- **No `AsyncLocalStorage`**: would bypass the journal; Restate invocations are fresh execution contexts.
- **No external cache**: Restate IS the shared state store; offline-first preserved.
- **Structural tenant isolation**: key scoping means cross-tenant context leak is impossible by construction (assuming centralized key construction).
- **`WorkingMemory` ≠ `SessionContext`**: Stream 4's per-agent scratchpad is preserved; Stream 6 adds a separate per-session shared blackboard. Agents retain private reasoning.
- **Database projection for queryability**: same 3-layer state pattern as Stream 5 — Restate journal is the source of truth; Prisma is the queryable projection.
- **Phase 1 ships the contract** (`SessionContextService` as a Restate Virtual Object); single agent reads and writes its own session context. No cross-agent context sharing is exercised in Phase 1, but the contract is in place for Phase 2+.

## 6. Consequences

- New Restate Virtual Object service `SessionContextService` (additive).
- New SDK interface `SessionContext` in `packages/sdk/src/ai/collaboration.ts` (additive).
- Optional new Prisma table `SessionContextSnapshot` (Phase 2+ projection; Phase 1 may defer).
- Stream 4's `WorkingMemory` (per ADR-038) is unchanged.
- Stream 5's 3-layer state pattern (per ADR-056) is extended — `SessionContext` is a new Virtual Object service.
- The Supervisor (ADR-050) injects `SessionContextRef` into every `MultiAgentTask` payload; the Auditor (ADR-052) enforces read-before-act.
- **R-6.5.2 risk (`SessionContext` grows unbounded)**: mitigated by periodic compaction (Stream 4 memory consolidation pattern) + max facts per session.
- **R-6.5.3 risk (agents forget to read the blackboard → stale context)**: mitigated by Supervisor injection + Auditor enforcement.
- **R-6.5.4 risk (cross-tenant context leak if key is misconstructed)** — HIGH severity — mitigated by centralized key construction in `SessionContextService.client(tenantId, sessionId)`; no raw key strings in agent code.
- Dependencies: ADR-007 (Restate); ADR-038 (Stream 4 `WorkingMemory`); ADR-056 (Stream 5 3-layer state pattern); ADR-060 (`MultiAgentTask` payload). **No new runtime dependencies.**
- Future AI-BOS cross-tenant procedure sharing uses a separate `ProcedureContext` (Stream 4 `ProceduralMemory`) — distinct from `SessionContext`.

## 7. Review Conditions

- Review if Phase 2+ multi-agent write concurrency exceeds single-writer capacity — would justify sharding `SessionContextService` by session sub-key.
- Review if `SessionContext` grows unbounded in long hotel-stay sessions — would require earlier-than-Phase-2 compaction or fact-count limits.
- Review if Phase 2+ requires cross-tenant context sharing (chain-wide guest preferences) — would introduce a separate `ChainContextService` distinct from `SessionContext` to preserve tenant isolation.
- Review if agents repeatedly fail to read the blackboard before acting (Auditor finding) — would require adding a compiler-level or runtime-level read-before-act enforcement.
- Review if `SessionContextSnapshot` is needed in Phase 1 for PMS UI queryability (Phase D decision) — would pull the projection table forward.
- Review if a community multi-agent shared-context standard emerges (e.g., a standardized blackboard schema) that should replace the SmartAgentics-owned `SessionContext` interface.
- Review if a PMS feature requires agents to share `WorkingMemory` directly (e.g., a debugging mode where two agents collaboratively reason) — would require a separate `SharedWorkingMemory` interface with explicit opt-in.
