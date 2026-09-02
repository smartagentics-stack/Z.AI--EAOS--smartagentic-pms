# ADR-049: Agent Runtime — Restate + Vercel AI SDK

**ADR-ID:** ADR-049
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #14 ("Agent runtime") is classified "Architecture Contract — NOW". Stream 5 deep research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §2–§9) evaluated six candidate agent runtimes — LangGraph, Microsoft Agent Framework (AutoGen + Semantic Kernel), CrewAI, Letta/MemGPT, Mastra, and a custom TypeScript runtime built on Restate + Vercel AI SDK — against SmartAgentics' offline-first, TypeScript-native, Windows-deployable, multi-tenant, auditable constraints.

Restate was already chosen as SmartAgentics' workflow orchestrator in ADR-001 and proven in the EAOS investigation ("663 workflows, 0 failures, exactly-once semantics"). Restate's official documentation ships a first-class "Durable Agents" pattern (https://docs.restate.dev/ai/patterns/durable-agents) explicitly designed for B4 #26's "AI failure must never become PMS failure" requirement: every LLM call, every tool execution, and every routing decision is journaled; on crash, completed steps are replayed without duplicate cost or duplicate side effects (no double bookings, no duplicate refunds, no duplicate emails).

This ADR extends Restate's role (per ADR-001) from "workflow orchestrator" to "agent runtime + workflow orchestrator + durability layer". It does not introduce a new dependency.

## 2. Problem

Should SmartAgentics adopt a heavyweight agent framework (LangGraph, AutoGen, CrewAI, Semantic Kernel, Letta, Mastra) as a runtime dependency, or compose the agent runtime from Restate (already in stack) + Vercel AI SDK (TypeScript-native LLM interaction layer) + the official `@restatedev/vercel-ai-middleware` bridge?

## 3. Options

### Option A: LangGraph.js (langchain-ai/langgraph)

MIT-licensed; StateGraph + interrupt/checkpointer model. Rejected: creates a parallel durability layer competing with Restate's journal; LangChain itself deprecated `langgraph-supervisor` ("we now recommend using the supervisor pattern directly via tools"); LangGraph.js is less mature than the Python variant; the StateGraph model assumes the LLM is the orchestrator, conflicting with SmartAgentics' "deterministic-core orchestrates, LLM is a step" principle (ADR-058). Documented as a _reference design_ that informed the `AgentRuntime` interface shape — no `@langchain/langgraph` runtime dependency.

### Option B: Microsoft Agent Framework (AutoGen + Semantic Kernel merger)

MIT-licensed; sessions, type safety, middleware, graph workflows. Rejected: **no TypeScript/Node.js support** (only .NET, Python, Go preview). Requires either a Python sidecar (violates Windows offline-first simplicity) or a .NET runtime (non-starter for a Node.js PMS). Azure AI Foundry-tied examples suggest Azure lock-in trajectory. Microsoft's own guidance — "if you can write a function to handle the task, do that instead of using an AI agent" — is precisely the SmartAgentics principle. Architectural patterns adopted as _reference designs_ only.

### Option C: CrewAI (crewaiinc/crewai)

Role-based multi-agent orchestration. Rejected: **Python-only**, no TypeScript SDK; role abstractions hide the LLM-call boundary that the AI Auditor (B4 #17) must observe; "Crew" autonomy conflicts with "AI failure must never become PMS failure" (B4 #26). `AgentContract` (ADR-053) incorporates the role-based design (Identity, Purpose, Responsibilities, Permissions, Tools) as a _conceptual reference_.

### Option D: Letta / MemGPT (letta-ai/letta)

Stateful memory agents. Rejected: **Python-only**; Letta is itself a _full agent runtime_ — adopting it creates a second runtime competing with Restate; its 2-tier memory (recall + archival) is superseded by Stream 4's 7-sub-type CoALA taxonomy (ADR-038 through ADR-048). MemGPT's 4-block working memory pattern was already incorporated as a _conceptual reference_ into ADR-038 §1.

### Option E: Mastra (mastra-ai/mastra)

TypeScript-native agent framework. Considered as the closest TypeScript-native alternative; rejected because it duplicates Restate's orchestration role and would create the same parallel-durability-layer anti-pattern as LangGraph.

### Option F: Custom TypeScript runtime composed from Restate + Vercel AI SDK

Compose: (1) Restate (already in ADR-001) for durability, journaling, retries, pause/resume, virtual objects, workflows, timers; (2) Vercel AI SDK (`ai` + `@ai-sdk/openai`) for TypeScript-native LLM interaction, tool calling with zod schemas, strict mode, `toolApproval` for HITL, `prepareStep` for per-tenant context; (3) `@restatedev/vercel-ai-middleware` to wrap every LLM call in a Restate journal entry so responses are persisted and replayed on recovery. All MIT-licensed.

## 4. Decision

Adopt **Option F** — Restate TypeScript SDK + Vercel AI SDK + `@restatedev/vercel-ai-middleware` as the SmartAgentics agent runtime. The runtime is a _composition_, not a single library.

(a) `AgentRuntime` interface in `packages/sdk/src/ai/agent.ts` exposes `runTask`, `getStatus`, `pause`, `resume`, `cancel`, `listSteps`.

(b) Reference implementation = Restate TypeScript SDK + Vercel AI SDK + `@restatedev/vercel-ai-middleware`. All agent code lives in Restate services under `packages/ai/src/agents/<name>.agent.ts`.

(c) LLM client = Vercel AI SDK with `@ai-sdk/openai` provider pointing at `http://localhost:11434/v1` (Ollama per Stream 1) by default; cloud providers (OpenAI, Anthropic) optional per ADR-001's "Optional cloud AI fallback" — _not_ the default.

(d) Tool calling = Vercel AI SDK `tool()` with zod schemas; `strict: true` enabled for all production tools; `toolApproval` config drives HITL via Restate Pause & Resume.

(e) Agent loop bounded by `stopWhen: stepCountIs(N)` where N defaults to 20 (configurable per `AgentContract.maxSteps`) — prevents infinite loops.

(f) State machines = plain TypeScript `if/switch` in Phase 1; optional `@restatedev/xstate` integration in Phase 2+ for complex agent state machines.

(g) The application **must NEVER** link to LangGraph, AutoGen, CrewAI, Semantic Kernel, Microsoft Agent Framework, Letta, or Mastra as runtime dependencies. The SDK contracts in `packages/sdk/src/ai/agent.ts` are framework-agnostic.

## 5. Rationale

- **No new heavyweight dependency**: Restate is already in ADR-001; Vercel AI SDK is the SDK Restate's own official examples use (https://docs.restate.dev/ai/patterns/durable-agents).
- **TypeScript-native end-to-end**: matches ADR-001's "Backend: Node.js + TypeScript" — no Python sidecar, no .NET runtime, no cross-process overhead.
- **Offline-first**: both Restate and Vercel AI SDK run locally; the `@ai-sdk/openai` provider can point at Ollama's OpenAI-compatible endpoint per Stream 1.
- **Windows-deployable**: Node.js + Restate Server binary both run natively on Windows; proven in EAOS.
- **Single durability layer**: Restate journals every step; no parallel checkpointer, no second state store to back up.
- **B4 #26 satisfaction**: "AI failure must never become PMS failure" is _the_ documented use case for Restate Durable Agents — completed steps are replayed without duplicate cost or duplicate side effects.
- **Consistency with prior streams**: extends the Stream 3 (ADR-031) and Stream 4 (ADR-048) "thin SmartAgentics-owned abstraction; no full framework runtime dependency" pattern from knowledge and memory to the agent runtime.
- **Licensing**: all components MIT-licensed — no risk.
- **Auditable by construction**: every step is journaled; the `AIAuditEvent` table (ADR-052) reads from the Restate journal as the authoritative source, never from LLM-side self-reporting.
- **Multi-tenant by keying**: Restate Virtual Objects keyed by `(tenantId, agentId, sessionId)` provide per-tenant isolation at the runtime layer; Vercel AI SDK `prepareStep` injects `tenantId` into every tool context.

## 6. Consequences

- SmartAgentics owns and maintains the `AgentRuntime`, `AgentContract`, `SupervisorInterface`, `PlannerInterface`, `AuditorInterface`, `ToolRegistry`, `ToolPermission`, `AgentPermission` SDK interfaces.
- The `@restatedev/vercel-ai-middleware` is relatively new; a Phase E PoC must verify LLM response persistence and replay work correctly with Ollama (the docs only show OpenAI examples). Mitigation: PoC deliverable in Phase E.
- Restate Server runs as a separate process; the PMS installer manages its lifecycle as a Windows service (already required by ADR-001).
- Restate's agent-pattern APIs are evolving; the `@restatedev/vercel-ai-middleware` API may change. Mitigation: pin exact versions in `package.json`; the `AgentRuntime` SDK interface abstracts over the middleware.
- Restate has no native tenant concept; isolation is by Virtual Object key. Mitigation: every agent service is keyed by `(tenantId, agentId, sessionId)`; every tool execution enforces `tenantId` via `prepareStep`.
- This ADR is an _amendment_ to ADR-001 (extending Restate's role), to be reconciled by the Phase D architect per FC-5.1.
- The existing `AIProvider` interface (`packages/sdk/src/ai/index.ts`) is unchanged — it remains for non-agent LLM calls (e.g., memory summarization). The new `AgentRuntime` interface _uses_ `AIProvider` (via Vercel AI SDK) but adds tool-calling, durability, and governance.
- Phase 1 ships one reference agent end-to-end (`ReservationAssistantAgent`) proving the contract is implementable.

## 7. Review Conditions

- Review if the `@restatedev/vercel-ai-middleware` PoC with Ollama fails to deliver response persistence/replay (would force reconsidering Option E — Mastra — or a hand-rolled middleware).
- Review if LangGraph.js releases a TypeScript-native, Restate-compatible, offline-first variant with a strictly smaller surface than Vercel AI SDK.
- Review if the OpenTelemetry GenAI semantic conventions supersede Vercel AI SDK's tool-calling abstraction.
- Review if a future Restate release bundles an LLM-SDK bridge that deprecates `@restatedev/vercel-ai-middleware`.
- Review if a SmartAgentics requirement emerges that Vercel AI SDK cannot satisfy (e.g., a non-OpenAI-compatible model protocol) — would force a direct SDK approach.
