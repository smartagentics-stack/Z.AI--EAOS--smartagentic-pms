# ADR-103: Domain-to-AI Context (Schema-to-Prompt Compiler + Auto-Generated Tools + MCP Surface)

**ADR-ID:** ADR-103
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

The domain-neutral architecture (ADR-097/098) makes entity types a runtime concept — when an administrator creates entity `Bar`, the platform must surface that entity to AI agents without code change. Existing SmartAgentics AI contracts (ADR-053 Agent Contract, ADR-054 Tool Registry, ADR-083 AI Tenant Isolation 5-Layer, ADR-095 AI Configuration Policy, ADR-096 EU AI Act + GDPR) are tenant-scoped and statically defined: `AgentContract` has no `domainId`; `Tool` entries point to static TypeScript handlers; the AI context preamble is hand-authored per agent.

Web research (Phase D Revision research report, Topic 7) confirms:

- **Model Context Protocol (MCP)** (`https://modelcontextprotocol.io`) is Anthropic's open standard for connecting AI to external tools and data sources. Anthropic launch (Nov 2024); MCP spec (Jul 2026): "The Model Context Protocol (MCP) allows servers to expose tools that can be invoked by language models." Databricks blog: "MCP is an open standard that enables AI applications to connect seamlessly with external data sources, tools, and systems." CodiLime (Feb 2026): "Tools in MCP are defined using JSON Schema, specifying the expected input parameters and, optionally, the output structure." Stytch (Mar 2025): "MCP is essentially a universal adapter between AI applications and external tools or data sources. It defines a common protocol (built on JSON-RPC)."
- **JSON Schema is the lingua franca of LLM tool definitions.** Agenta (Sep 2025): "Both libraries follow the same pattern: define your data structure once, generate a JSON schema, send that schema to the LLM as formatting instructions." Guild.ai (Feb 2026): "The LLM generates JSON output that conforms to the constraints defined in the JSON Schema. Function Calling and Tool Use." mbrenndoerfer (Feb 2026): "Explains how function calling enables LLMs to invoke external tools and APIs through structured JSON schemas." OpenAI, Anthropic, Ollama, vLLM, llama.cpp all support OpenAI-compatible function-calling JSON Schema (per ADR-054).
- **Existing ADR-054 (Tool Registry)** already uses JSON Schema for `inputSchema` and `outputSchema`. The new domain-neutral requirement is **automatic tool generation from entity definitions** — when an administrator creates entity `Bar`, the platform auto-generates tools `bar.create`, `bar.read`, `bar.update`, `bar.delete`, `bar.list`, `bar.search` from the entity's JSON Schema (per the directive's "Generic CRUD/Query/Command Foundation" E16, lines 424–466).
- **The directive's E23** (lines 916–925) requires each `FieldDefinition` to carry `searchable`, `filterable`, `sortable`, `aggregatable`, `reportable`, `aiReadable`, `aiWritable` booleans. The schema-to-prompt compiler must respect `aiReadable`/`aiWritable` — fields marked `aiReadable: false` are omitted from the AI context; fields marked `aiWritable: false` cannot be set by an agent tool. This is defense-in-depth on top of ADR-083 T4 context-window invariant (per FC-DN-20).

## 2. Problem

Should SmartAgentics (a) hand-author every AI tool and prompt preamble (doesn't scale to dynamic entities; violates domain-neutrality), (b) auto-generate tools but skip the prompt preamble (LLMs lack entity context; tool hallucination risk), (c) expose raw SQL / Prisma queries to the agent (unsafe; violates ADR-054 Tool Registry; violates ADR-083 T4 context-window invariant), or (d) build a schema-to-prompt compiler that produces OpenAI-compatible tool definitions from `EntityType` metadata, auto-generates CRUD tools, respects `aiReadable`/`aiWritable` field metadata, and exposes an MCP-compatible surface for Phase 2+ external clients?

## 3. Options

### Option A: Hand-author every AI tool and prompt preamble

Rejected. Doesn't scale to dynamic entities. When an admin creates entity `Bar`, a developer would have to hand-author `bar.create`, `bar.read`, etc. — violating domain-neutrality and the directive's "Generic CRUD/Query/Command Foundation" (E16). The Phase F+ visual entity builder would be blocked on engineering capacity.

### Option B: Auto-generate tools but skip the prompt preamble

Rejected. Without a prompt preamble listing entity types, fields, relationships, and available tools in the agent's authorized scope, the LLM hallucinates tool calls (invents parameters, calls non-existent tools). The preamble is the AI's map of the domain; omitting it degrades tool-call accuracy.

### Option C: Expose raw SQL / Prisma queries to the agent

Rejected. Unsafe — violates ADR-054 Tool Registry (every tool must have `riskClass`, `requiredRoles`, `inputSchema`, `outputSchema`). Violates ADR-083 T4 context-window invariant (raw SQL bypasses the per-tenant / per-domain scoping). Violates ADR-096 (raw SQL can read `aiReadable: false` fields like `passportNumber`).

### Option D: Schema-to-prompt compiler + auto-generated tools + MCP-compatible surface

Adopted. Five components:

1. **Tool auto-generation** — for each `EntityType`, the compiler generates six generic CRUD tools (create, read, update, delete, list, search) from the EntityType's JSON Schema.
2. **Schema-to-prompt compiler** — when an agent session starts, the compiler emits a domain-context preamble listing entity types, fields, relationships, and available tools in the agent's authorized scope.
3. **MCP-compatible tool surface** — the auto-generated tools are exposed via an MCP server in Phase 2+ (per ADR-054 §3 Option A "MCP deferred to Phase 2+"). Phase 1 ships in-process TypeScript tool handlers (Vercel AI SDK `tool()`).
4. **AI-readable / AI-writable field metadata** — the compiler respects `aiReadable`/`aiWritable` field booleans (per directive E23).
5. **Domain-aware agent contract** — `AgentContract` (ADR-053) is extended with `domainId`; the agent's tools, knowledge bases, and memory scope are scoped to that domain.

## 4. Decision

Adopt **Option D** — the Schema-to-Prompt Compiler + Auto-Generated Tools + MCP-Compatible Surface.

### Tool auto-generation

For each `EntityType` (both Layer-2 typed and Layer-3 dynamic), the compiler generates six generic CRUD tools following the directive's "Generic CRUD/Query/Command Foundation" (E16, lines 424–466):

| Tool              | Operation         | inputSchema source                                                          | outputSchema source                                            |
| ----------------- | ----------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `<entity>.create` | INSERT            | EntityType.schemaJson (minus `aiWritable: false` fields)                    | EntityType.schemaJson (full, minus `aiReadable: false` fields) |
| `<entity>.read`   | SELECT by id      | `{ id: string }`                                                            | EntityType.schemaJson (minus `aiReadable: false` fields)       |
| `<entity>.update` | UPDATE by id      | `{ id: string, patch: Partial<schema> }` (minus `aiWritable: false` fields) | EntityType.schemaJson (minus `aiReadable: false` fields)       |
| `<entity>.delete` | soft-delete by id | `{ id: string }`                                                            | `{ id: string, deletedAt: string }`                            |
| `<entity>.list`   | paginated SELECT  | `{ filter?: FilterExpr, sort?: SortExpr, limit?: int, cursor?: string }`    | `{ items: schema[], nextCursor: string? }`                     |
| `<entity>.search` | full-text search  | `{ query: string, filter?: FilterExpr, limit?: int }`                       | `{ items: schema[], score: number[] }`                         |

Each tool's `inputSchema` and `outputSchema` are **derived from the EntityType's JSON Schema** (per ADR-097). The `ToolRegistry` (ADR-054) registers these tools at EntityType-publish time. The handler is a generic `GenericEntityTool` parameterized by `(entityTypeId, operation)` — no per-entity TypeScript code.

### Schema-to-prompt compiler

When an agent session starts, the compiler emits a domain-context preamble added to the system prompt (per ADR-083 T5 — per-tenant AgentContract, extended to per-domain). The preamble includes:

1. **Entity types in the agent's authorized scope** — name, description, key fields (with `aiReadable: true` only), relationships.
2. **Available tools** — the six CRUD tools per entity, with their `inputSchema` summaries (field names + types + descriptions; full JSON Schema attached via OpenAI function-calling).
3. **Relationships** — `Reservation.guestId → Guest.id` (one-to-many); the LLM uses these to chain tool calls (e.g., `guest.read(id=<reservation.guestId>)`).
4. **Domain constraints** — non-null fields, enums, conditional-required (`dependentSchemas`).

The preamble is bounded by token budget (per ADR-083 T4 context-window invariant); large domains paginate the entity list and include only the entities referenced in the current conversation.

### MCP-compatible tool surface (Phase 2+)

- **Phase 1**: in-process TypeScript tool handlers (Vercel AI SDK `tool()`). The `GenericEntityTool` handler is a TypeScript function parameterized by `(entityTypeId, operation)`; it executes against the `Record` Prisma model (Layer-3) or the typed Prisma model (Layer-2) via the `EntityType.typedTableName` indirection.
- **Phase 2+**: the same tool handlers are wrapped in an **MCP server** (`@modelcontextprotocol/sdk`) for external AI clients (e.g., a hotel's Microsoft Copilot, a school's Google Workspace AI). The MCP server exposes the tools via JSON-RPC; the tool definitions are the same OpenAI-compatible JSON Schemas. This satisfies ADR-054 §3 Option A "MCP deferred to Phase 2+."

### AI-readable / AI-writable field metadata (defense-in-depth on ADR-096)

Per the directive's E23 (lines 916–925), each `FieldDefinition` carries `aiReadable` and `aiWritable` booleans (per ADR-097). The schema-to-prompt compiler:

- **Omits `aiReadable: false` fields from the preamble and from tool `outputSchema`** — a guest's `passportNumber` field marked `aiReadable: false` never reaches the AI context. This is defense-in-depth on top of ADR-083 T4 context-window invariant (T4 checks tenant/domain scoping at the chunk level; `aiReadable: false` checks at the field level).
- **Omits `aiWritable: false` fields from tool `inputSchema` (for create/update)** — a guest's `loyaltyTier` field marked `aiWritable: false` cannot be set by an agent tool (only by a human workflow).

This is the FC-DN-20 resolution — the `decisionEffectClass` taxonomy (per ADR-096 §5) gains an additional enforcement layer: fields marked `aiReadable: false` are stripped from the AI context by the schema-to-prompt compiler BEFORE the LLM call.

### Domain-aware agent contract (amends ADR-053)

`AgentContract` (ADR-053) is extended with a `domainId` field:

```typescript
interface AgentContract {
  // ... existing fields per ADR-053 ...
  domainId: string | null; // null = cross-domain agent
}
```

- An agent is bound to a domain; its tools, knowledge bases, and memory scope are scoped to that domain.
- The `domainId` is propagated through the signed JWT (ADR-055) and enforced at every tool call (the `GenericEntityTool` handler checks `Tool.domainId == AgentContract.domainId` at `buildToolset` time).
- A null `domainId` indicates a cross-domain agent (e.g., a "tenant admin assistant" that can operate across all domains of the tenant); cross-domain agents are rare and require elevated authorization (per ADR-099 5-way intersection).

### `Tool` registry extension (amends ADR-054)

The `Tool` entity (ADR-054) is extended with a `generatorType` field:

```typescript
interface Tool {
  // ... existing fields per ADR-054 ...
  generatorType: 'static' | 'auto-crud' | 'auto-search' | null;
  // 'static' = handlerModule/handlerFunction point to TypeScript (existing behavior)
  // 'auto-crud' = GenericEntityTool handler parameterized by (entityTypeId, operation)
  // 'auto-search' = GenericEntityTool handler parameterized by (entityTypeId, 'search')
  domainId: string | null; // the domain the tool belongs to (null = platform tool)
}
```

- Auto-generated tools use the generic `GenericEntityTool` handler parameterized by `(entityTypeId, operation)`.
- The `Tool` row is auto-created when an EntityType is published; the handler is generic.
- The `Tool.registryType` ("static" vs "auto-crud" vs "auto-search") drives the handler resolution at tool-call time.

### `AIConfiguration` extension (amends ADR-095)

`AIConfiguration` (ADR-095) is extended with a `domainId` field:

```typescript
interface AIConfiguration {
  // ... existing fields per ADR-095 ...
  domainId: string | null; // null = tenant-wide; non-null = domain-scoped override
}
```

Domain-scoped configurations inherit from tenant-wide configuration with override semantics (e.g., the PMS domain may use a more conservative `maxTokens` than the tenant-wide default; the Bar domain may disable `toolCalling` for cost reasons).

### Amendment / reference register

| Existing ADR                               | Relationship                                  | Change                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-053 (Agent Contract)**               | AMENDED (MODERATE — FC-DN-11)                 | `AgentContract` gains `domainId String?` (null = cross-domain agent). The agent's `allowedTools` are filtered by `Tool.domainId == AgentContract.domainId` at `buildToolset` time.                                                                                                                               |
| **ADR-054 (Tool Registry)**                | AMENDED (MODERATE — FC-DN-12)                 | `Tool` gains `generatorType String?` ("static" \| "auto-crud" \| "auto-search") and `domainId String?`. Auto-generated tools use a generic `GenericEntityTool` handler parameterized by `(entityTypeId, operation)`. The `Tool` row is auto-created at EntityType-publish time.                                  |
| **ADR-083 (AI Tenant Isolation 5-Layer)**  | AMENDED (HIGH — FC-DN-16, AI-context portion) | T5 prompt-template isolation extends to per-domain AgentContract. T4 context-window invariant extends to check `chunk.domainId == session.domainId` (or `chunk.domainId ∈ session.authorizedDomains` for cross-domain agents). The schema-to-prompt compiler is the T5 implementation for domain-neutral agents. |
| **ADR-095 (AI Configuration Policy)**      | AMENDED (MODERATE — FC-DN-19)                 | `AIConfiguration` gains `domainId String?` (null = tenant-wide; non-null = domain-scoped override). Domain-scoped configurations inherit from tenant-wide configuration with override semantics.                                                                                                                 |
| **ADR-096 (EU AI Act + GDPR)**             | AMENDED (MINOR — FC-DN-20)                    | The `decisionEffectClass` taxonomy gains an additional enforcement layer — fields marked `aiReadable: false` are stripped from the AI context by the schema-to-prompt compiler BEFORE the LLM call. Defense-in-depth on top of T4 context-window invariant.                                                      |
| **ADR-055 (Agent Permissions & Identity)** | REFERENCED                                    | The signed JWT (ADR-055) carries the `domainId` claim (alongside `agentId` and `openfgaTuplesetHash` per ADR-099). The `GenericEntityTool` handler verifies `Tool.domainId == JWT.domainId` at tool-call time.                                                                                                   |
| **ADR-097 (Domain Meta-Model)**            | CROSS-REFERENCE                               | The schema-to-prompt compiler consumes `EntityType.schemaJson` + `FieldDefinition.aiReadable`/`aiWritable` to auto-generate tools and prompt preambles.                                                                                                                                                          |
| **ADR-098 (Hybrid Persistence)**           | CROSS-REFERENCE                               | The `GenericEntityTool` handler reads/writes via the Layer-2 typed Prisma model (`EntityType.typedTableName`) or the Layer-3 `Record` table, based on `EntityType.storageClass`.                                                                                                                                 |
| **ADR-099 (Fine-Grained Authorization)**   | CROSS-REFERENCE                               | The 5-way permission intersection (ADR-099) includes the OpenFGA relationship check; auto-generated tools carry `requiredRelation` (viewer/editor/creator/owner) metadata consumed by the intersection.                                                                                                          |
| **ADR-054 (Tool Registry) §3 Option A**    | REFERENCED                                    | "MCP deferred to Phase 2+" — ADR-103 implements the Phase 2+ MCP surface. Phase 1 ships in-process TypeScript tool handlers.                                                                                                                                                                                     |

### Conflicts resolved

- **FC-DN-11** (ADR-053 MODERATE) — resolved by adding `domainId` to `AgentContract` and filtering `allowedTools` by domain at `buildToolset` time.
- **FC-DN-12** (ADR-054 MODERATE) — resolved by adding `generatorType` and `domainId` to `Tool`; auto-generated tools use the generic `GenericEntityTool` handler.
- **FC-DN-16** (ADR-083 HIGH, AI-context portion) — resolved by extending T5 to per-domain AgentContract and T4 to check `chunk.domainId`.
- **FC-DN-19** (ADR-095 MODERATE) — resolved by adding `domainId` to `AIConfiguration` with tenant-wide inheritance + domain-scoped override.
- **FC-DN-20** (ADR-096 MINOR) — resolved by stripping `aiReadable: false` fields from the AI context before the LLM call (defense-in-depth on T4).

## 5. Rationale

- **MCP is the emerging open standard for AI-tool interconnection** (Anthropic, Databricks, CodiLime, Stytch) — JSON-RPC-based, JSON-Schema-defined tools. SmartAgentics adopts the MCP-compatible surface for Phase 2+ external clients; the Phase 1 in-process handlers use the same JSON Schemas, so the Phase 2+ MCP wrapper is a thin adapter.
- **JSON Schema is the lingua franca of LLM tool definitions** (Agenta, Guild.ai, mbrenndoerfer; OpenAI/Anthropic/Ollama/vLLM/llama.cpp all support OpenAI-compatible function-calling JSON Schema per ADR-054). The schema-to-prompt compiler leverages the EntityType's existing JSON Schema (per ADR-097) — no separate tool-definition format.
- **Tool auto-generation is the only way to support dynamic entities**: when an admin creates entity `Bar`, a developer cannot hand-author `bar.create`/`bar.read`/etc. — that violates domain-neutrality. The generic `GenericEntityTool` handler parameterized by `(entityTypeId, operation)` is the only scalable pattern (per the directive's E16 "Generic CRUD/Query/Command Foundation").
- **The prompt preamble is the AI's map of the domain**: without it, the LLM hallucinates tool calls. The compiler emits entity types, fields, relationships, and available tools in the agent's authorized scope — bounded by token budget (per ADR-083 T4).
- **`aiReadable`/`aiWritable` field metadata is defense-in-depth on ADR-096 (EU AI Act + GDPR)**: a guest's `passportNumber` field marked `aiReadable: false` never reaches the AI context, even if the agent has read access to the record. This is the FC-DN-20 resolution — the `decisionEffectClass` taxonomy gains a field-level enforcement layer on top of the T4 chunk-level invariant.
- **Domain-aware agent contract (ADR-053 amendment) is necessary for domain isolation**: an agent bound to the PMS domain should not see Bar-domain tools. The `domainId` field + the `allowedTools` filter at `buildToolset` time enforce this.
- **`AIConfiguration` domain-scoping (ADR-095 amendment) enables per-domain AI policy**: the PMS domain may use a conservative `maxTokens`; the Bar domain may disable `toolCalling` for cost. Domain-scoped configurations inherit from tenant-wide with override semantics — the same pattern as ADR-078 per-property overrides.
- **Phase 1 in-process handlers + Phase 2+ MCP wrapper is the ADR-054 §3 Option A path**: no Phase 1 MCP dependency; the Phase 2+ MCP wrapper is a thin adapter over the same JSON Schemas. This respects the directive's PHASE BOUNDARY RULE (lines 1396–1408).

## 6. Consequences

- New SDK module: `packages/sdk/src/ai-context/` with `SchemaToPromptCompiler`, `GenericEntityTool`, `ToolGenerator` interfaces.
- New runtime component: `SchemaToPromptCompiler` — invoked at agent-session start; emits the domain-context preamble; bounded by token budget.
- New runtime component: `ToolGenerator` — invoked at EntityType-publish time; auto-creates six `Tool` rows (create/read/update/delete/list/search) with `generatorType = 'auto-crud'` (or `'auto-search'` for the search tool).
- New runtime component: `GenericEntityTool` — the handler for auto-generated tools; parameterized by `(entityTypeId, operation)`; reads/writes via Layer-2 typed Prisma model or Layer-3 `Record` table based on `EntityType.storageClass`.
- `AgentContract` schema extended (additive): `domainId String?`.
- `Tool` schema extended (additive): `generatorType String?`, `domainId String?`.
- `AIConfiguration` schema extended (additive): `domainId String?`.
- Signed JWT (ADR-055) claims extended (additive, alongside ADR-099): `domainId`.
- **Risk: schema-to-prompt compiler token budget overflow.** A large domain (50 entity types, 20 fields each) exceeds the preamble token budget. Mitigation: the compiler paginates the entity list; includes only entities referenced in the current conversation; uses field summaries (name + type + description) instead of full JSON Schemas in the preamble (full schemas attached via OpenAI function-calling).
- **Risk: `GenericEntityTool` handler performance.** The handler resolves `EntityType.storageClass` → Layer-2 typed Prisma model or Layer-3 `Record` table at every call. Mitigation: the `EntityType` lookup is cached; the handler is O(1) after lookup.
- **Risk: auto-generated tools bypass the 5-way permission intersection (ADR-099).** Mitigation: the `GenericEntityTool` handler invokes the `PermissionResolver` (per ADR-088/099) before executing; auto-generated tools carry `requiredRelation` (viewer/editor/creator/owner) metadata consumed by the intersection.
- **Risk: `aiReadable: false` field stripping is bypassed by a hand-authored tool.** Mitigation: the verifier rule flags `Tool` rows with `generatorType = 'static'` that return `aiReadable: false` fields in their `outputSchema`; the `SchemaToPromptCompiler` refuses to include such tools in the preamble unless explicitly authorized.
- **Risk: ADR-053 amendment may surprise developers** who read `AgentContract` as tenant-scoped. Mitigation: the amendment is explicit — `domainId` is null for cross-domain agents; the verifier rule flags `AgentContract` rows with `domainId` set but `allowedTools` containing tools from a different domain.
- **Risk: ADR-054 amendment may surprise developers** who read `Tool.handlerModule`/`handlerFunction` as required. Mitigation: for `generatorType = 'auto-crud'`, `handlerModule`/`handlerFunction` are null; the `ToolRegistry` resolves the handler via `GenericEntityTool`. The verifier rule flags `Tool` rows with `generatorType` set but `handlerModule` non-null (inconsistent).
- Dependencies: ADR-053 (Agent Contract — amended), ADR-054 (Tool Registry — amended), ADR-055 (Agent Permissions & Identity — referenced for JWT `domainId` claim), ADR-083 (AI Tenant Isolation 5-Layer — amended), ADR-095 (AI Configuration Policy — amended), ADR-096 (EU AI Act + GDPR — amended), ADR-097 (Domain Meta-Model — cross-reference), ADR-098 (Hybrid Persistence — cross-reference), ADR-099 (Fine-Grained Authorization — cross-reference).
- Phase E effort: ~3 weeks for the SDK interfaces, `SchemaToPromptCompiler`, `ToolGenerator`, `GenericEntityTool`, the ADR-053/054/095/096 amendments, and the verifier rules.

## 7. Review Conditions

- Review if Phase 1 telemetry shows the schema-to-prompt preamble exceeds 20% of the system-prompt token budget — would investigate preamble compression or per-conversation entity filtering.
- Review if `GenericEntityTool` handler performance is a hot-path bottleneck — would cache the `EntityType` lookup and the handler resolution.
- Review if auto-generated tools prove insufficient for domain-specific operations (e.g., `reservation.checkIn` is not a generic CRUD operation) — would warrant a Phase F+ domain-tool-authoring ADR (per directive §19 visual tool builder).
- Review if the Phase 2+ MCP surface proves incompatible with a target external AI client (e.g., a hotel's Microsoft Copilot uses a non-standard MCP profile) — would warrant an integration-profile ADR.
- Review if `aiReadable: false` field stripping is bypassed in production (a hand-authored tool leaks a sensitive field) — would tighten the verifier rule or move stripping to the `PermissionResolver` layer (defense-in-depth).
- Review if a community standard for schema-to-prompt compilation emerges (e.g., an MCP extension for entity-metadata-driven tool generation) that should replace the SmartAgentics-owned compiler.
- Review if cross-domain agents (`domainId = null`) prove too permissive in production — would restrict cross-domain agents to a specific elevated role (e.g., `tenant_admin`).
- Review if the directive's §19 visual agent builder (Phase F+) requires additional `AgentContract` fields (e.g., UI hints for tool selection, per-domain system-prompt templates) not anticipated by ADR-103 — would warrant a Phase F+ additive-column ADR.
- Review if ADR-096 (EU AI Act + GDPR) field-level enforcement proves insufficient (a regulator demands field-level audit of AI-readable fields) — would extend the `AIAuditEvent` catalog (per ADR-085) to log field-level AI access.
- Review if the prompt preamble's entity-list pagination proves confusing for the LLM (it doesn't know which entities exist outside the current page) — would investigate a two-tier preamble (entity index + on-demand entity detail).
