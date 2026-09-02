# ADR-053: Agent Contract Schema — Identity, Permissions, Tools, Memory, Boundaries

**ADR-ID:** ADR-053
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #14 ("Agent runtime") implies that every PMS agent must conform to a stable, framework-agnostic contract — the _architectural_ layer that survives changes to the underlying runtime (Restate + Vercel AI SDK per ADR-049). Stream 5 research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §6, §10, §20.1) surveyed role-based agent definitions across CrewAI (Identity, Purpose, Responsibilities, Tools), Microsoft Agent Framework (sessions, type safety, middleware), and the B4 #14 directive itself ("Identity, Purpose, Responsibilities, Permissions, Tools, Memory, Knowledge, DecisionBoundaries, Policies, EscalationRules, CollaborationRules, AuditConfiguration"). CrewAI's role/goal/backstory/tools tuple is more comprehensive than a bare function signature but _less_ comprehensive than what B4 #14 specifies.

The contract is the SDK interface (`AgentContract` in `packages/sdk/src/ai/agent.ts`); the _runtime_ that implements it is Restate + Vercel AI SDK. This mirrors the pattern Stream 3 (ADR-031) and Stream 4 (ADR-048) established for knowledge and memory: thin SmartAgentics-owned abstraction, no full framework runtime dependency.

## 2. Problem

Should SmartAgentics adopt a framework-defined agent schema (CrewAI's role tuple, LangGraph's StateGraph config, AutoGen's agent config), or define its own `AgentContract` Prisma entity that captures the B4 #14 fields and binds every agent to a stable, auditable, framework-agnostic schema?

## 3. Options

### Option A: CrewAI's role/goal/backstory/tools tuple

Rejected: insufficient for PMS use. Missing `permissions`, `memory`, `knowledge`, `decisionBoundaries`, `policies`, `escalationRules`, `collaborationRules`, `auditConfiguration`, `manualFallback`, `maxSteps`, `maxRiskClass`. CrewAI's role abstractions also hide the LLM-call boundary that the Auditor (ADR-052) must observe. Adopted as a _conceptual reference_ — every PMS agent has Identity, Purpose, Responsibilities, Permissions, Tools — but the runtime is Restate, not CrewAI.

### Option B: LangGraph's StateGraph config

Rejected: tied to a runtime SmartAgentics does not adopt (ADR-049). The contract must be framework-agnostic so it survives runtime changes.

### Option C: AutoGen's agent config

Rejected: AutoGen has no TypeScript support (ADR-049 Option B rejection). Config schema is Python-shaped.

### Option D: SmartAgentics-owned `AgentContract` Prisma entity

A new Prisma entity + SDK interface that captures every B4 #14 field: Identity, Purpose, Responsibilities, Permissions, Tools, Memory, Knowledge, DecisionBoundaries, Policies, EscalationRules, CollaborationRules, AuditConfiguration, plus `manualFallback`, `maxSteps`, `maxRiskClass`, `maxDurationMs`, and lifecycle `status`. Every PMS agent conforms to this contract; the Supervisor (ADR-050) reads the contract at the `authorize` and `buildToolset` steps.

## 4. Decision

Adopt **Option D** — define the `AgentContract` Prisma entity and SDK interface.

### SDK interface (`packages/sdk/src/ai/agent.ts`)

```typescript
export interface AgentContract {
  id: string;
  tenantId: string | null; // null = global agent template
  identity: { name: string; version: string; description: string };
  purpose: string;
  responsibilities: string[];
  permissions: AgentPermission[]; // per ADR-055
  allowedTools: string[]; // ToolIds — intersected with maxRiskClass at buildToolset
  maxRiskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  memory: {
    workingMemoryBudget: number;
    conversationalMemoryBudget: number;
  }; // Stream 4 budgets
  knowledge: {
    ragEnabled: boolean;
    knowledgeBaseIds: string[]; // Stream 3 isolation
  };
  decisionBoundaries: string[]; // human-readable constraints
  policies: AgentPolicy[]; // machine-checkable policy rules
  escalationRules: EscalationRule[];
  collaborationRules: CollaborationRule[]; // Stream 6 multi-agent
  auditConfiguration: {
    auditLevel: 'SUMMARY' | 'FULL';
    retentionDays: number; // default 2555 (7 years) per ADR-052
  };
  manualFallback: {
    // per ADR-057
    uiRoute: string;
    message: string;
    prefillData?: unknown;
  };
  maxSteps: number; // default 20 — bounds the agent loop
  maxDurationMs: number; // default 300000 (5 min) — bounds the wall clock
  status: 'DRAFT' | 'ACTIVE' | 'DEPRECATED' | 'DISABLED';
}
```

### Prisma entity (`AgentContract`)

Persisted as a Prisma row keyed by `(id, tenantId)`. Versioned via `identity.version` and `agentContractVersion` (every `AgentSession` and `AIAuditEvent` references the _exact_ contract version that governed it — no retroactive re-interpretation of historical decisions).

### Lifecycle

- `DRAFT`: contract being authored; cannot be invoked.
- `ACTIVE`: contract is live; the Supervisor's `authorize` step (ADR-050) accepts it.
- `DEPRECATED`: contract still callable but flagged for removal; new sessions discouraged.
- `DISABLED`: contract is hard-blocked at `authorize`; running sessions complete.

### Cross-stream integration

- **Permissions** (`permissions`, `allowedTools`, `maxRiskClass`) → ADR-055 (signed-JWT agent identity, permission intersection), ADR-054 (ToolRegistry).
- **Memory** (`memory.budgets`) → Stream 4 `MemoryStore` (ADR-038 through ADR-048).
- **Knowledge** (`knowledge.knowledgeBaseIds`) → Stream 3 `RAGPipeline` (ADR-028, ADR-031).
- **Audit** (`auditConfiguration`) → ADR-052 (`AIAuditEvent` retention).
- **Manual fallback** (`manualFallback`) → ADR-057 (graceful degradation).
- **Boundaries** (`decisionBoundaries`, `maxSteps`, `maxDurationMs`) → ADR-058 (deterministic-core boundary).

## 5. Rationale

- **Framework-agnostic**: the contract survives changes to the underlying runtime. Restate + Vercel AI SDK (ADR-049) is the _reference implementation_; the contract is the _architectural commitment_.
- **Auditable by version**: every `AgentSession` and `AIAuditEvent` references the exact contract version that governed it. Historical decisions cannot be retroactively re-interpreted by a contract change.
- **Comprehensive over CrewAI**: B4 #14 specifies more fields than CrewAI's role tuple — `permissions`, `memory`, `knowledge`, `decisionBoundaries`, `policies`, `escalationRules`, `collaborationRules`, `auditConfiguration`, `manualFallback`, `maxSteps`, `maxRiskClass`. The contract captures all of them.
- **Bounded by construction**: `maxSteps` (default 20) prevents infinite agent loops via Vercel AI SDK's `stopWhen: stepCountIs(N)`; `maxDurationMs` (default 5 min) bounds the wall clock via the Supervisor's `monitor` step.
- **Risk-class ceiling**: `maxRiskClass` is the _upper bound_ on what tools an agent may call. The Supervisor's `buildToolset` step intersects `allowedTools` with `ToolRegistry.byRiskClass(maxRiskClass)` — an agent cannot escalate its own risk ceiling.
- **Manual fallback is contractual, not emergency-only**: every `AgentContract` declares its `manualFallback` — the deterministic PMS feature (ADR-058) that replaces the agent when AI fails (ADR-057). The "Complete manually" button on the AI assistant widget is a _first-class_ alternative path, always available.
- **Phase-1 deferrable for some fields**: `collaborationRules` is reserved for Phase 2+ multi-agent (Stream 6); the contract ships in Phase 1 with the field present but unused.

## 6. Consequences

- SmartAgentics must implement and maintain the `AgentContract` Prisma entity, the `AgentContract` SDK interface, and an authoring UI (Phase 2+).
- One new Prisma table (`AgentContract`) — additive.
- Every PMS agent must conform to this schema. The Phase 1 reference agent (`ReservationAssistantAgent`) is the first instance.
- Contract changes are versioned; the `agentContractVersion` field on `AgentSession` and `AIAuditEvent` is immutable post-write.
- The `authorize` step (ADR-050) and `buildToolset` step (ADR-050) both depend on this contract — they fail closed (deny invocation) if the contract is missing, `DISABLED`, or tenant-mismatched.
- Dependencies: Prisma `AgentContract` table; ADR-054 `Tool` and `ToolPermission` (referenced by `allowedTools`); ADR-055 `AgentPermission` (referenced by `permissions`); Stream 4 `MemoryStore` (referenced by `memory`); Stream 3 `RAGPipeline` (referenced by `knowledge`).
- Future AI-BOS capabilities (Future Vision 35d dynamic no-code agent builder, 35h AI Builder) consume and produce this contract.

## 7. Review Conditions

- Review if Phase 2 multi-agent collaboration (Stream 6) requires extending `collaborationRules` beyond a stub field.
- Review if a community agent-contract standard emerges (e.g., a standardized agent definition interchange format) that should replace the SmartAgentics-owned schema.
- Review if the 20-step / 5-minute defaults prove wrong for production agents (would adjust per-agent via contract fields, not the schema).
- Review if `manualFallback` requires its own ADR once Phase 2+ ships multiple fallback patterns (UI route vs. CLI vs. bulk-operations API).
- Review if contract versioning needs a formal change-management process (e.g., dual-control approval for `ACTIVE` → `DEPRECATED` transitions on production agents).
