# ADR-054: Tool Registry & Tool Calling — Vercel AI SDK + zod + toolApproval

**ADR-ID:** ADR-054
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directives B4 #18 ("ToolRegistry + Tool entity") and B4 #19 ("ToolPermission — User Permissions ≠ Agent Permissions ≠ Tool Permissions") require the architecture to define a `ToolRegistry`, a `Tool` entity with full metadata, and a `ToolPermission` entity. B4 #18 enumerates Phase 1 tools: `check_room_availability`, `create_reservation`, `cancel_reservation`, `issue_invoice`, `update_housekeeping_status`, `read_inventory`. Stream 5 research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §13) confirmed the OpenAI function-calling JSON Schema is the _de facto_ wire format — supported by Ollama (Stream 1), vLLM, llama.cpp's `llama-server`, TGI, and every major cloud provider. Adopting it means SmartAgentics can swap Ollama for any other OpenAI-compatible runtime without changing tool definitions.

Vercel AI SDK (chosen as the LLM interaction layer in ADR-049) provides the TypeScript DX layer: `tool()` helper with zod `inputSchema`/`outputSchema`, `strict: true` for guaranteed schema conformance, `toolApproval` for HITL, `prepareStep` for dynamic per-tenant context, and `stopWhen: stepCountIs(N)` for bounding agent loops. The architectural contribution of Stream 5 is the SmartAgentics-owned `ToolRegistry` interface (per ADR-009 SDK-contract pattern) and the `Tool` / `ToolPermission` Prisma entities.

## 2. Problem

Should SmartAgentics adopt MCP (Model Context Protocol) as the tool-calling transport, hand-roll tool dispatch on top of the `ollama` npm package, or compose Vercel AI SDK `tool()` + zod with a SmartAgentics-owned `ToolRegistry` interface and `Tool`/`ToolPermission` Prisma entities?

## 3. Options

### Option A: MCP (Model Context Protocol) as the tool-calling transport

Deferred to Phase 2+. MCP is Anthropic's protocol for tool discovery and invocation across process boundaries. Phase 1 doesn't need it — all tools are in-process TypeScript functions. MCP adds an IPC layer for a use case (external AI clients, e.g., a hotel's Microsoft Copilot integration) that doesn't exist in Phase 1. The `Tool` entity's `handlerModule` field is MCP-compatible (the handler _can_ be an MCP server invocation) — the schema does not preclude MCP later.

### Option B: Hand-rolled tool dispatch on the bare `ollama` npm package

Rejected for the agent runtime. The `ollama` package is a thin HTTP client; Vercel AI SDK provides tool-calling orchestration, streaming, strict mode, and `toolApproval` that the bare `ollama` package does not. (Phase 1 may use the `ollama` package for low-level Ollama management — model loading, health checks — per Stream 1's `LocalLLMRuntime` interface; the agent runtime uses Vercel AI SDK.)

### Option C: OpenAI built-in tools (web search, code execution)

Rejected: cloud-tied, conflicts with the offline-first mandate.

### Option D: Vercel AI SDK `tool()` + zod + SmartAgentics-owned `ToolRegistry` interface + `Tool`/`ToolPermission` Prisma entities

The OpenAI-compatible tool-calling spec is the wire format (already supported by Ollama per Stream 1); Vercel AI SDK `tool()` + zod is the TypeScript DX layer; a SmartAgentics-owned `ToolRegistry` interface is the architectural contract. Each tool is a Prisma `Tool` entity + a TypeScript handler function. Each tool permission is a Prisma `ToolPermission` entity.

## 4. Decision

Adopt **Option D** — Vercel AI SDK `tool()` + zod + SmartAgentics-owned `ToolRegistry` + `Tool`/`ToolPermission` Prisma entities.

### `Tool` Prisma entity (per B4 #18 full metadata)

```
Tool {
  id, tenantId?,              // null = global tool; non-null = tenant-specific
  name,                       // e.g., 'createReservation'
  description,                // LLM-facing description (used in tool-calling prompt)
  inputSchema: JSON,          // JSON Schema (zod-compatible)
  outputSchema: JSON,         // JSON Schema (zod-compatible)
  handlerModule,              // e.g., '@smartagentics/ai/tools/reservation'
  handlerFunction,            // e.g., 'createReservation'
  riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  requiredRoles: UserRole[],                       // human roles required to invoke
  requiredAgentPermissions: AgentPermission[],     // agent permissions required (ADR-055)
  sideEffects: 'NONE' | 'READ' | 'WRITE' | 'IRREVERSIBLE',
  auditLevel: 'OFF' | 'SUMMARY' | 'FULL',
  offlineCompatible: bool,    // can this tool run without internet?
  compensationToolId?,        // per ADR-057 saga pattern
  version, status, createdAt, updatedAt
}
```

### `ToolPermission` Prisma entity (per B4 #19)

```
ToolPermission {
  id, toolId, agentId,        // or toolId + roleId for human permissions
  permission: 'ALLOW' | 'DENY' | 'ALLOW_WITH_APPROVAL',
  conditions: JSON,           // e.g., { maxAmount: 1000 } for issueRefund
  createdAt, createdBy
}
```

### `ToolRegistry` SDK interface (`packages/sdk/src/ai/agent.ts`)

```typescript
export interface ToolRegistry {
  register(tool: ToolDefinition): Promise<void>;
  get(toolId: string, tenantId: string): Promise<ToolDefinition | null>;
  list(filter: ToolFilter): Promise<ToolDefinition[]>;
  checkPermission(
    toolId: string,
    agentId: string,
    tenantId: string,
  ): Promise<ToolPermissionDecision>;
}
```

### Enforcement model

- **Single source of truth for schema**: the TypeScript `tool()` definition is the source; the Prisma `Tool` row is generated from it via a codegen step. Integration tests verify the two match (mitigates schema drift).
- **Build-time pre-filter**: the Supervisor's `buildToolset` step (ADR-050) intersects `AgentContract.allowedTools` with `ToolRegistry.byRiskClass(agent.maxRiskClass)` — only the relevant subset is passed to the LLM (mitigates tool sprawl).
- **Strict mode**: `strict: true` on every production tool — guarantees schema conformance.
- **HITL by risk class**: `toolApproval: { runCommand: 'user-approval' }` fires for HIGH/CRITICAL tools; the Supervisor's `requestApproval` step (ADR-050) translates this to Restate Pause & Resume.
- **Per-tenant context**: Vercel AI SDK's `prepareStep` injects `tenantId` into every tool's execution context — tools cannot escape tenant boundaries ("isolation by architecture, not by prompt", Microsoft SFI rule cited in Stream 4).

## 5. Rationale

- **De-facto standard wire format**: the OpenAI function-calling JSON Schema is supported by Ollama, vLLM, llama.cpp, TGI, and every major cloud provider. SmartAgentics can swap Ollama for any other OpenAI-compatible runtime without changing tool definitions.
- **TypeScript-native DX**: Vercel AI SDK's `tool()` + zod provides compile-time type safety for tool inputs/outputs; `strict: true` guarantees runtime schema conformance.
- **HITL by construction**: `toolApproval` for HIGH/CRITICAL tools maps directly to Restate Pause & Resume — no custom coordination logic.
- **Three layers of tool-abuse defense**: (1) `AgentPermission` (ADR-055) — least-privilege access per `https://www.cequence.ai/blog/ai/ai-agent-least-privilege-access`: "restricting each agent's tool access, API permissions, and data scope to only what its specific [task requires]"; (2) the Supervisor's `buildToolset` intersection — the enforcement point; (3) the Auditor (ADR-052) flags anomalous tool calls as a third layer.
- **Per-tool `riskClass`**: enables the per-step retry policy in ADR-057 (HIGH/CRITICAL tools never auto-retry — no double-charge risk).
- **Compensation-aware**: `compensationToolId` enables the saga pattern in ADR-057 — failed multi-step operations can be rolled back via the declared compensation tool.
- **MCP-compatible**: the `handlerModule` field can later wrap an MCP server invocation when Phase 2+ requires external tool clients.
- **Stream 3/4 integration**: Stream 3's `RAGPipeline` becomes one tool among many (`searchKnowledgeBase`); Stream 4's `MemoryStore` becomes another (`readMemory`/`writeMemory`).

## 6. Consequences

- Two new Prisma tables (`Tool`, `ToolPermission`) — additive. No existing interface is broken.
- Stream 3's `RAGPipeline` is re-positioned as one tool among many — additive wrapper, not a rewrite.
- Phase 1 ships ~10–15 production tools (per B4 #18 list) with zod schemas, strict mode, and risk-class classification, plus a `ToolRegistryService` (Restate service) that the Supervisor queries. Tool definitions live in `packages/ai/src/tools/<category>.tool.ts`.
- **Tool sprawl risk**: as the PMS grows, the `ToolRegistry` may grow to hundreds of tools, making the LLM's tool-selection harder. Mitigation: `AgentContract.allowedTools` constrains each agent's toolset; `buildToolset` pre-filters per task.
- **Schema drift risk**: the Prisma `Tool.inputSchema` and the TypeScript `tool()` definition may diverge. Mitigation: codegen + integration tests.
- **Tool abuse risk**: a malicious or compromised agent may attempt to call tools it shouldn't. Mitigation: three-layer defense (AgentPermission, Supervisor buildToolset, Auditor anomaly detection).
- Dependencies: Vercel AI SDK (`ai` + `@ai-sdk/openai`); zod; Prisma `Tool` + `ToolPermission` tables; Stream 4 `MemoryStore`; Stream 3 `RAGPipeline`.
- Existing `AIProvider` interface is unchanged — used for non-agent LLM calls (e.g., memory summarization). The new `AgentRuntime` _uses_ `AIProvider` via Vercel AI SDK but adds tool-calling, durability, and governance (FC-5.4).

## 7. Review Conditions

- Review if Phase 2+ requires MCP for external AI clients (e.g., a hotel's Microsoft Copilot integration) — would adopt MCP transport while keeping the `Tool` entity as the schema source of truth.
- Review if tool count grows past ~100 per agent — would justify a smarter `buildToolset` pre-filter (e.g., embedding-based tool retrieval).
- Review if a community tool-registry standard emerges (e.g., a standardized tool interchange format beyond OpenAI's JSON Schema) that should replace the SmartAgentics-owned `Tool` entity.
- Review if Vercel AI SDK's `tool()` abstraction is superseded by an OpenTelemetry GenAI-native tool spec.
- Review if `compensationToolId` proves insufficient for non-trivial sagas — would justify a dedicated saga-orchestration ADR.
