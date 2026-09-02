# ADR-060: Multi-Agent Communication — Restate-Native Patterns

**ADR-ID:** ADR-060
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #22 ("Multi-Agent Communication") requires the architecture to "define `MultiAgentCommunication` (architecture only; full sophisticated multi-agent autonomy is LATER per file 2 §14). Pattern: Supervisor → [Reservation Agent, Housekeeping Agent, Finance Agent, Inventory Agent]. Agents collaborate through controlled task/message mechanisms." Phase B #26 reinforces: "Full sophisticated autonomy is later." Phase B #18 ("Department AI Agents — Architecture NOW") mandates "implement only Phase 1-justified agents"; Phase B #41 ("Massive Department-Agent Fleet (20+) — Deferred — LATER / requirements-driven") keeps the 20+ fleet out of Phase 1.

Stream 6 research (`/home/z/my-project/phase-c-stream6-multi-agent-report.md`, §2) confirmed four convergent findings across the multi-agent-systems literature: (1) the five canonical communication patterns — direct invocation, message passing, event-driven, pub/sub, shared blackboard — are well-documented (search s09 `https://fast.io/resources/multi-agent-context-sharing-patterns`; `https://multi-agent.wiki/patterns/blackboard-shared-memory`); (2) Restate — already chosen as SmartAgentics' workflow + agent runtime in ADR-007 and reaffirmed by Stream 5's `AgentSupervisorWorkflow` — ships first-class multi-agent coordination primitives documented at `https://docs.restate.dev/ai/patterns/multi-agent` ("Route tasks between specialized agents with durable decisions. Coordinate agents within the same process using handoffs and tools") and `https://docs.restate.dev/ai/patterns/remote-agents` ("Route tasks between remote agents over HTTP with durable RPC calls"); (3) Restate journals every routing decision, every agent call, every cross-service handoff, and on crash recovery "skips the routing step and resumes the agent call" — durability for free, no extra runtime dependency; (4) Restate explicitly guarantees that "inter-handler communication between two durable handlers goes through Restate (not direct service-to-service)" (Restate request-lifecycle docs) — there is no in-memory agent-to-agent channel that bypasses the journal.

LangChain's "Choosing the Right Multi-Agent Architecture" (`https://www.langchain.com/blog/choosing-the-right-multi-agent-architecture`) frames the design space as four patterns — **Subagents** (centralized supervisor invokes specialists as tools), **Skills** (single agent loads specialized prompts on-demand), **Handoffs** (active agent changes dynamically via tool call, state carries forward), **Router** (stateless routing step dispatches to specialists in parallel and synthesizes) — and opens with the discipline-first principle: "Many agentic tasks are best handled by a single agent with well-designed tools. You should start here—single agents are simpler to build, reason about, and debug." All four patterns are expressible natively in Restate (Subagents = in-process `tool({...})` calls; Handoffs = tool calls with Virtual Object state for last-agent memory; Router = `RestatePromise.all` over multiple `ctx.serviceClient()` calls; Skills = Stream 3 RAG prompt loading).

External protocols — Google's Agent2Agent (A2A, JSON-RPC 2.0, April 2025), IBM's Agent Communication Protocol (ACP, REST-based, March 2025), and Anthropic's Model Context Protocol (MCP, November 2024) — were each evaluated against SmartAgentics' Phase 1 needs. A2A is for cross-vendor interop; SmartAgentics owns all its agents, so there is no cross-vendor requirement in Phase 1–2. ACP is a REST alternative to A2A with the same interop focus. MCP is **orthogonal** to multi-agent collaboration — WorkOS confirms (`https://workos.com/guide/understanding-mcp-acp-a2a`): "MCP does not focus on multi-agent conversations or agent-to-agent negotiations. Instead, it focuses on hooking data and external [resources]." SmartAgentics already has Stream 5's `ToolRegistry` (ADR-054) covering the tool-exposure surface MCP targets. None of these protocols add capability SmartAgentics lacks in Phase 1–2.

## 2. Problem

Should SmartAgentics adopt A2A / ACP / MCP as runtime protocols, build a custom multi-agent message bus, use a heavyweight multi-agent framework (LangGraph, AutoGen, CrewAI), or use Restate-native primitives (already in the dependency tree from Stream 5) as the multi-agent communication substrate?

## 3. Options

### Option A: A2A as runtime protocol

Rejected for Phase 1. No cross-vendor interop requirement; SmartAgentics owns all its agents. Reserved as a future external interop protocol (Phase 3+) and adopted as a _state-machine reference_ (its Task lifecycle state model — see Option D).

### Option B: ACP as runtime protocol

Rejected for Phase 1. Same reason as A2A — no heterogeneous agent fleet. ACP's REST wire format is less aligned with Restate's typed RPC than A2A's JSON-RPC. Reserved as a future external interop protocol.

### Option C: MCP as runtime protocol

Rejected for Phase 1. MCP is agent-to-tool, not agent-to-agent. Stream 5's `ToolRegistry` (ADR-054) already covers tool exposure. Reserved as a future tool-exposure protocol for Phase 2+ external integrations (e.g., exposing SmartAgentics tools to third-party agent hosts).

### Option D: Heavyweight multi-agent framework (LangGraph supervisor / AutoGen GroupChat / CrewAI)

Rejected. Stream 5 already rejected LangGraph (parallel durability layer to Restate), AutoGen (Python-only), and CrewAI (Python-only). The supervisor _pattern_ (LangChain Subagents) is adopted conceptually but implemented natively in Restate per ADR-049. The GroupChat round-robin/selector pattern is reserved as a reference design for Phase 2+ multi-agent routing.

### Option E: Custom message bus (Redis Pub/Sub / NATS / Kafka)

Rejected. Adds operational burden, conflicts with offline-first (ADR-001), duplicates what Restate already does durably. Restate IS the message bus.

### Option F: Direct in-memory agent-to-agent calls (bypassing Restate)

Explicitly rejected. Breaks durability, auditability, and the "AI failure must never become PMS failure" principle. Every cross-agent call must go through Restate.

### Option G: Shared mutable process memory (singleton `Map` between agents)

Rejected. Breaks isolation, durability, multi-tenant safety, and race-free guarantees. The blackboard pattern is implemented as a Restate Virtual Object K/V store (per ADR-062), not as shared process memory.

### Option H: Restate-native multi-agent communication

Adopted. Restate's four primitives (request-response via `ctx.serviceClient(MyAgent).handler(args)`; one-way send via `ctx.serviceSendClient(MyAgent).handler(args)`; event-driven via `ctx.signal(name)` / `ctx.awakeable()` / `ctx.rejectAwakeable()`; fan-out via multiple `serviceSendClient(...)` calls in sequence or `RestatePromise.all` over multiple `serviceClient(...)` calls) cover all five canonical communication patterns. Every primitive is journaled, typed, and exactly-once. No new runtime dependency. The A2A `Task` lifecycle state machine (`submitted | working | input-required | completed | canceled | failed | unknown`) is adopted as the SmartAgentics `MultiAgentTask` state contract because it is the closest thing to an industry-standard multi-agent task state machine and because `input-required` maps directly to SmartAgentics' `PAUSE_FOR_APPROVAL` escalation level (per ADR-065).

## 4. Decision

Adopt **Option H** — Restate-native multi-agent communication.

### Communication primitives (Restate-native)

| Pattern                                  | Restate primitive                                                                                                                                         | Phase                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Direct invocation (request-response RPC) | `ctx.serviceClient(MyAgent).handler(args)`                                                                                                                | Phase 1 (single-agent trivially) |
| Message passing (one-way async)          | `ctx.serviceSendClient(MyAgent).handler(args)`                                                                                                            | Phase 2+                         |
| Event-driven (signals / awakeables)      | `ctx.signal(name)` / `ctx.awakeable()` / `ctx.rejectAwakeable()`                                                                                          | Phase 1 (HITL approval, ADR-065) |
| Pub/sub (fan-out)                        | Explicit sequence of `ctx.serviceSendClient(...)` calls or `RestatePromise.all` over `serviceClient(...)` calls (Restate has no native topic abstraction) | Phase 2+                         |
| Shared blackboard                        | Virtual Object K/V state keyed by `(tenantId, sessionId)` (per ADR-062)                                                                                   | Phase 2+                         |

### `MultiAgentChannel` SDK interface (new file, additive)

A new framework-agnostic SDK interface in `packages/sdk/src/ai/collaboration.ts` abstracts the four Restate primitives so a future A2A/ACP adapter can implement the same interface without touching agent code:

```typescript
// Pseudocode — contract only, NOT for Phase 1 implementation
export interface MultiAgentChannel {
  // Direct invocation (request-response)
  invoke<T>(agentId: AgentId, task: MultiAgentTask): Promise<MultiAgentTaskResult<T>>;
  // One-way message
  send(agentId: AgentId, message: AgentMessage): void;
  // Signal (named, multi-resolvable)
  signal(name: string): Promise<unknown>;
  // Fan-out (parallel invoke, gather results)
  fanOut<T>(
    tasks: Array<{ agentId: AgentId; task: MultiAgentTask }>,
  ): Promise<Array<MultiAgentTaskResult<T>>>;
}
```

### `MultiAgentTask` state contract (adopted from A2A)

```typescript
export type MultiAgentTaskState =
  'submitted' | 'working' | 'input-required' | 'completed' | 'canceled' | 'failed' | 'unknown';
```

Adopted verbatim from A2A v1.0 (Nov 2025). The `input-required` state maps directly to SmartAgentics' `PAUSE_FOR_APPROVAL` escalation level (per ADR-065). Adopting A2A's state names now means a future A2A interop adapter is a thin wrapper rather than a semantic translation.

### Subagents pattern (LangChain #1) as Phase 1 default

Stream 5's `AgentSupervisorWorkflow` (ADR-049) is the Phase 1 realization of the Subagents pattern: the Supervisor invokes specialists as Vercel AI SDK `tool({...})` calls within a single handler. Phase 1 has exactly one specialist (`ReservationAssistantAgent`); the Supervisor's routing step (per ADR-061) is a deterministic lookup that always returns `ReservationAssistantAgent`. Phase 2+ may add Handoffs (Virtual Object state storing `last_agent_name`) and Router (parallel `serviceClient` calls) without changing the underlying primitives.

### Architectural prohibitions

- **No external message broker** — Restate IS the message bus. `MultiAgentChannel.fanOut` is the sanctioned fan-out pattern; adding Redis Pub/Sub / NATS / Kafka is forbidden.
- **No in-memory agent-to-agent calls** — every cross-agent call must go through Restate (per Restate request-lifecycle docs: "inter-handler communication between two durable handlers goes through Restate (not direct service-to-service)").
- **No shared mutable process memory** between agents — the blackboard pattern is a Restate Virtual Object K/V store (per ADR-062).

## 5. Rationale

- **B4 #22 satisfaction**: the multi-agent communication contract is defined (architecture-only; full sophisticated autonomy deferred to Phase 2+ per B4 #26 and B4 #41).
- **Restate is already in the dependency tree** (per ADR-007 + Stream 5): no new runtime dependency is added. The decisive architectural property is that every routing decision, agent call, and cross-service handoff is journaled and replayable on crash — this is what separates a demo that looks good on Twitter from a reliable multi-agent system that can power business-critical hotel operations.
- **Durability for free**: every agent-to-agent call is journaled. On crash, recovery replays the call. No double agent invocations, no lost messages. Restate HN confirmation: "Restate will make sure that the callee will be executed exactly once and there is no need for the user to pass an idempotency key" for in-process calls; explicit `idempotencyKey` available for cross-service calls.
- **TypeScript-native**: `ctx.serviceClient(MyAgent).handler(args)` is a typed call. No JSON-RPC marshalling, no schema registry, no wire-format negotiation. The compiler enforces the contract.
- **A2A / ACP / MCP rejected for Phase 1** because SmartAgentics owns all its agents and they all run on the same Restate runtime — there is no cross-vendor boundary to cross. The protocols are reserved as future external interop (Phase 3+).
- **A2A `Task` state model adopted** because (1) it is the closest thing to an industry-standard multi-agent task state machine; (2) `input-required` maps directly to SmartAgentics' `PAUSE_FOR_APPROVAL`; (3) adopting the names now keeps future A2A interop a thin wrapper rather than a semantic translation.
- **LangChain discipline-first principle** aligns with Phase B #18 / #41: Phase 1 ships exactly one agent (`ReservationAssistantAgent` per Stream 5 §20). Multi-agent is an architecture-only contract.
- **`MultiAgentChannel` interface is framework-agnostic**: a future A2A / ACP / MCP adapter implements the same interface; agent code never touches wire protocols.
- **MCP is orthogonal** to multi-agent collaboration (WorkOS confirmation); Stream 5's `ToolRegistry` already covers MCP's agent-to-tool surface. No double-coverage.
- **Offline-first preserved**: no cloud-tied multi-agent framework (AWS Bedrock multi-agent, Databricks Supervisor Agent) is adopted. Their supervisor-delegation _pattern_ is adopted conceptually but implemented natively in Restate.

## 6. Consequences

- New SDK file `packages/sdk/src/ai/collaboration.ts` is added (additive). It exports `MultiAgentChannel`, `MultiAgentTask`, `MultiAgentTaskState`, `AgentHandoff`, and related supporting types.
- Stream 5's `AgentSupervisorWorkflow` "task routing" step (Step 2 per Stream 5 §10) is generalized to a `RoutingPolicy` interface (per ADR-061) — backward-compatible (deterministic is a valid `RoutingPolicy`).
- New Prisma tables `MultiAgentTask` (correlation root for delegation chains) and `AgentDelegation` (one row per delegation hop) are added, both cross-referenced to Stream 5's `AgentSession` / `AIAuditEvent` via `correlationId` (per ADR-068).
- **Phase 1 ships the contract** (SDK interface + Prisma tables + the `MultiAgentTask` state machine) but only **one agent**. The `MultiAgentChannel` interface is implemented as a thin wrapper over Restate primitives. The single-agent `RoutingPolicy` always returns `ReservationAssistantAgent`. No second specialist agent is built in Phase 1.
- **R-6.2.1 risk (Restate exclusive-handler deadlock risk)** is addressed by ADR-066 (deadlock-safe topology + verifier rule).
- **R-6.2.5 risk (no native pub/sub topic may tempt developers to add a broker)** is mitigated by this ADR's explicit prohibition on external brokers.
- Dependencies: ADR-007 (Restate); ADR-049 (Stream 5 `AgentSupervisorWorkflow`); ADR-054 (Stream 5 `ToolRegistry`); Restate TypeScript SDK + `@restatedev/vercel-ai-middleware` (already in tree). **No new runtime dependencies.**
- Future A2A / ACP / MCP adapters (Phase 3+) implement `MultiAgentChannel`; agent code is unchanged.
- This is the AI-BOS "Multi-Agent Architecture" capability (B4 #22) — contract only; full autonomy is LATER.

## 7. Review Conditions

- Review if a Phase 3+ cross-vendor interop requirement emerges (OTA booking agents, channel-manager agents, supplier agents) — would justify adopting an A2A / ACP adapter implementing `MultiAgentChannel`.
- Review if the A2A `Task` lifecycle state model is revised in a way that requires re-mapping SmartAgentics' `MultiAgentTaskState`.
- Review if Restate adds a native pub/sub topic abstraction that should replace the explicit `fanOut` pattern.
- Review if a community multi-agent communication standard beyond A2A/ACP/MCP emerges that should replace the SmartAgentics-owned `MultiAgentChannel` interface.
- Review if Phase 2+ multi-agent topologies expose deadlock risks not covered by ADR-066's topology rules — would extend the deadlock-safe topology contract.
- Review if an external tool-host integration (Phase 2+) requires adopting MCP as a tool-exposure protocol alongside Stream 5's `ToolRegistry`.
