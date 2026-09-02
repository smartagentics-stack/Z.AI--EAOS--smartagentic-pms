# ADR-100: Workflow & Rules Engine (XState v5 + Restate + JSON Decision Tables + JSONata)

**ADR-ID:** ADR-100
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

The domain-neutral architecture (ADR-097/098) requires deterministic state machines for domain workflows (reservation lifecycle, order processing, application processing) and a business-rules engine for declarative decision logic. The directive's workflow examples (lines 680–735) — reservation state transitions, procurement triggers, approval chains — all map to state machines. The directive's rule examples (lines 763–766) — "IF stock < reorderLevel THEN create procurement task" — map to decision tables or rule chains.

Existing SmartAgentics ADRs:

- **ADR-007 (Restate)** is the workflow engine — durable execution, journaling, virtual objects.
- **ADR-049 (Agent Runtime)** §4(f) says: "State machines = plain TypeScript `if/switch` in Phase 1; optional `@restatedev/xstate` integration in Phase 2+ for complex agent state machines."

Web research (Phase D Revision research report, Topic 4) confirms:

- **XState v5** (`https://www.npmjs.com/package/xstate`, Aug 2026) is the leading TypeScript state-machine library. NearForm (Oct 2021) documents `createMachine` API and best practices. dev.to (Dec 2019) confirms XState's TypeScript integration provides compile-time state-machine type safety. XState community discussion #3398 (Jul 2022) confirms XState's fit for "articulating the essential complexity of domain entities."
- **Restate + XState is an official, documented integration** (`https://www.restate.dev/blog/persistent-serverless-state-machines-with-xstate-and-restate`, Oct 2024): "Persistent serverless state machines with XState and Restate" — official Restate blog post showing how to persist XState machines in Restate's durable journal. ADR-049 already reserves `@restatedev/xstate` for "Phase 2+ for complex agent state machines."
- **Business rules engines** — dominant patterns are decision tables, expression sets, and rule chains. Salesforce Business Rules Engine ("three core tools: Expression Sets, Decision Matrices, and Decision Tables"); Flowable (Aug 2025) describes expression sets and decision tables; GoRules (`https://gorules.io/components/decision-table`) is an open-source decision-table component for business analysts; CodeEffects uses rule-to-IL compilation.
- **Safe expression evaluation** — JavaScript `eval` is unsafe; JSONata (`jsonata` npm), `expr-eval`, or a sandboxed evaluator is required for formula evaluation. JSONata is sandboxed by design (read-only, no side effects, no arbitrary code execution).

The key distinction is: **domain workflows (reservation, order, application) are deterministic state machines**, NOT agent loops. ADR-049's reservation of XState for "agent state machines" misses the broader domain-workflow need. The domain-neutral architecture requires XState for **domain workflows** in Phase E — not just agent state machines in Phase 2+.

## 2. Problem

Should SmartAgentics (a) keep ADR-049's plain TypeScript `if/switch` for all state machines (works for trivial cases; loses formalism for complex domain workflows), (b) adopt XState for agent state machines only per ADR-049's Phase 2+ reservation (misses the Phase E domain-workflow need), (c) use a heavyweight BPMN engine like Flowable or Camunda (operationally heavy; conflicts with offline-first), or (d) adopt a three-layer workflow/rules foundation: XState v5 (workflow state machines) + JSON decision tables (rule evaluation) + JSONata (formula expression), all hosted inside Restate workflows (ADR-007)?

## 3. Options

### Option A: Plain TypeScript `if/switch` for all state machines (keep ADR-049 §4(f) as-is)

Rejected for domain workflows. Domain workflows (reservation lifecycle, order processing, application processing) have 5–15 states with complex transitions, guards, and side effects. Plain `if/switch` loses formalism, type-safety at transition boundaries, and the ability to visualize/serialize the machine. ADR-049's reservation of XState for "complex agent state machines" already acknowledged this; the domain-workflow case is even stronger.

### Option B: XState for agent state machines only (ADR-049 Phase 2+ reservation)

Rejected. The directive's workflow examples (lines 680–735) are domain workflows, not agent loops. They are deterministic state machines (reservation: `PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT`; order: `DRAFT → SUBMITTED → APPROVED → FULFILLED`). These need XState in Phase E, not Phase 2+. Agent state machines (per ADR-049) remain plain TypeScript in Phase 1 because agents are bounded by `maxSteps`, not state-machine formalism.

### Option C: Heavyweight BPMN engine (Flowable, Camunda)

Rejected. BPMN engines are operationally heavy (Java runtime, external database, separate service). Conflicts with the directive's offline-first requirement and ADR-007's Restate-as-workflow-host decision. BPMN engines are overkill for hotel-PMS-scale workflows.

### Option D: Three-layer foundation — XState v5 + JSON Decision Tables + JSONata, hosted in Restate

Adopted. Three layers, all hosted inside Restate workflows (ADR-007):

1. **Layer 1 (Workflow State Machines)** — XState v5 declarative state machines, persisted via `@restatedev/xstate`.
2. **Layer 2 (Decision Tables)** — `RuleDefinition` Prisma entity stores decision tables as JSON; a Restate `RuleEvaluationService` evaluates them.
3. **Layer 3 (Formula Expression Engine)** — `jsonata` for safe read-only formula evaluation.

## 4. Decision

Adopt **Option D** — the Three-Layer Workflow & Rules Foundation.

### Layer 1 — Workflow State Machines (XState v5 + `@restatedev/xstate`)

- **XState v5** declarative state machines, persisted via `@restatedev/xstate` (the official Restate-XState integration, per the Oct 2024 Restate blog post).
- A `WorkflowDefinition` Prisma entity stores the XState machine as JSON (XState machines are serializable).
- A `WorkflowInstance` Restate Virtual Object runs the machine, persisting state transitions to Restate's durable journal.
- Domain packages ship pre-defined `WorkflowDefinition` rows: PMS ships `ReservationWorkflow`, `CheckInWorkflow`, `HousekeepingWorkflow`; the School domain ships `AdmissionWorkflow`, `GradeAppealWorkflow`.
- The directive's workflow examples (lines 680–735) all map to XState machines.
- **Phase E delivers the foundation contracts** (`WorkflowDefinition` model, `WorkflowInstance` Restate Virtual Object, the XState-JSON serialization schema). The visual workflow builder is Phase F+ per directive §19.

### Layer 2 — Decision Tables (JSON)

- A `RuleDefinition` Prisma entity stores decision tables as JSON:

```typescript
interface DecisionTable {
  inputs: Array<{ name: string; type: 'string' | 'number' | 'boolean' | 'date' }>;
  outputs: Array<{ name: string; type: 'string' | 'number' | 'boolean' }>;
  rows: Array<{
    inputs: Array<number | string | boolean | null>; // null = wildcard
    outputs: Array<number | string | boolean>;
  }>;
  defaultOutputs: Array<number | string | boolean>; // applied when no row matches
}
```

- A Restate `RuleEvaluationService` evaluates decision tables at runtime: given an input tuple, find the first matching row (wildcard `null` matches any value), return its outputs; if no row matches, return `defaultOutputs`.
- This is the simplest rule pattern — for the directive's examples like "IF stock < reorderLevel THEN create procurement task" (lines 763–766).
- For rule conditions with side effects (e.g., "THEN create procurement task"), the rule emits an event (per ADR-101 CloudEvents envelope) consumed by a Restate workflow; the workflow performs the side effect. **Rules NEVER execute side effects directly** — they emit events; workflows perform side effects. This separation preserves auditability and replayability.

### Layer 3 — Formula Expression Engine (JSONata)

- `jsonata` (JSONata query/expression language) for safe read-only formula evaluation.
- Example: `Order.total = sum(items.price * items.quantity)` evaluated against the order record's JSON.
- JSONata is **sandboxed by design**: read-only, no side effects, no arbitrary JavaScript execution, no `eval`. This is the safe-formula layer that ADR-029 (Parser Stack) does not cover (ADR-029 covers document parsers, not formula parsers).
- Formulas are stored in `RuleDefinition.formulaJson` (a JSONata expression string + input/output bindings) or inline in `WorkflowDefinition` guards (e.g., a transition guard `when: jsonata("order.total > 1000")`).

### Layer 4 — Restate as host

- Per ADR-007, all workflow instances are Restate workflows.
- Per ADR-049 (Agent Runtime), agent state machines use plain TypeScript `if/switch` in Phase 1; **ADR-100 amends ADR-049 §4(f)**: XState is the workflow state-machine layer for **domain workflows** in Phase E (Phase E foundation contract). Agent state machines remain plain TypeScript in Phase 1 (agents are bounded by `maxSteps`, not state-machine formalism). The Phase 2+ reservation for agent-XState is preserved.

### SDK interfaces (extends ADR-009 `packages/sdk/src/workflow/`)

```typescript
export interface WorkflowDefinition {
  id: string;
  domainId: string;
  name: string; // "ReservationWorkflow"
  version: string; // semver
  machineJson: object; // serializable XState v5 machine definition
  triggerEventTypes: string[]; // CloudEvents types that start this workflow (per ADR-101)
  inputSchema: object; // JSON Schema 2020-12 for the workflow input
  active: boolean;
  // sync metadata per ADR-072
  updatedAt: DateTime;
  revision: Int;
  deletedAt: DateTime | null;
  syncOrigin: string | null;
  idempotencyKey: string | null;
}

export interface WorkflowInstance {
  id: string; // Restate Virtual Object key
  tenantId: string;
  domainId: string;
  workflowDefinitionId: string;
  workflowDefinitionVersion: string;
  status: 'running' | 'succeeded' | 'failed' | 'suspended' | 'cancelled';
  currentState: string; // XState current state value
  contextJson: object; // XState extended-state context
  inputJson: object;
  outputJson: object | null;
  startedAt: DateTime;
  completedAt: DateTime | null;
  parentInstanceId: string | null; // for nested workflows
}

export interface RuleDefinition {
  id: string;
  domainId: string;
  name: string; // "ProcurementTriggerRule"
  ruleType: 'decision-table' | 'formula';
  decisionTableJson: object | null; // for ruleType='decision-table'
  formulaJson: object | null; // for ruleType='formula' (JSONata expression + bindings)
  triggerEventTypes: string[]; // CloudEvents types that evaluate this rule
  outputEventTypes: string[]; // CloudEvents types emitted on match
  active: boolean;
  // sync metadata per ADR-072
  updatedAt: DateTime;
  revision: Int;
  deletedAt: DateTime | null;
  syncOrigin: string | null;
  idempotencyKey: string | null;
}
```

### Amendment / reference register

| Existing ADR                       | Relationship                             | Change                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **ADR-007 (Restate)**              | REFERENCED, REAFFIRMED (FC-DN-05 — NONE) | Restate is the workflow host. XState machines run inside Restate workflows via the official `@restatedev/xstate` middleware. No conflict.                                                                                                                                                                                |
| **ADR-049 (Agent Runtime)**        | AMENDED (MINOR — FC-DN-06)               | ADR-049 §4(f) is amended: XState is the workflow state-machine layer for **domain workflows** in Phase E (Phase E foundation contract). Agent state machines remain plain TypeScript in Phase 1 (agents are bounded by `maxSteps`, not state-machine formalism). The Phase 2+ reservation for agent-XState is preserved. |
| **ADR-029 (Parser Stack)**         | REFERENCED                               | ADR-100 introduces a "formula parser" (JSONata) — distinct from document parsers. JSONata is the safe-formula layer; ADR-029's document parsers are unaffected.                                                                                                                                                          |
| **ADR-009 (Internal SDK)**         | AMENDED (FC-DN-04)                       | SDK extended with `packages/sdk/src/workflow/` interfaces: `WorkflowDefinition`, `WorkflowInstance`, `RuleDefinition`. Same pattern as existing SDK — interfaces only, no implementations.                                                                                                                               |
| **ADR-072 (Sync Metadata Schema)** | REFERENCED, REINFORCED                   | `WorkflowDefinition` and `RuleDefinition` carry the five sync-metadata columns; mutations flow through `SyncOutbox`.                                                                                                                                                                                                     |
| **ADR-073 (Transactional Outbox)** | REFERENCED                               | Rule evaluation emits CloudEvents (per ADR-101) written transactionally to `SyncOutbox`.                                                                                                                                                                                                                                 |
| **ADR-097 (Domain Meta-Model)**    | CROSS-REFERENCE                          | `WorkflowDefinition` and `RuleDefinition` are scoped to a `Domain` (carry `domainId`).                                                                                                                                                                                                                                   |
| **ADR-101 (CloudEvents Envelope)** | CROSS-REFERENCE                          | Workflow triggers and rule outputs use CloudEvents types (`<entityType>.<operation>` per ADR-101).                                                                                                                                                                                                                       |
| **ADR-098 (Hybrid Persistence)**   | CROSS-REFERENCE                          | `WorkflowDefinition` and `RuleDefinition` are Layer-1 (Platform Core) typed Prisma models.                                                                                                                                                                                                                               |

### Conflicts resolved

- **FC-DN-04** (ADR-009 MODERATE) — resolved by extending `packages/sdk/src/workflow/` with workflow/rules interfaces.
- **FC-DN-05** (ADR-007 NONE) — no conflict; Restate is reaffirmed as the workflow host.
- **FC-DN-06** (ADR-049 MINOR) — resolved by amending ADR-049 §4(f): XState for domain workflows in Phase E; agent state machines remain plain TypeScript in Phase 1; Phase 2+ agent-XState reservation preserved.

## 5. Rationale

- **XState v5 is the leading TypeScript state-machine library** (npm, NearForm, dev.to) with compile-time type safety — essential for domain workflows with 5–15 states and complex transitions. XState machines are serializable (JSON), which fits the `WorkflowDefinition` Prisma entity model and enables the Phase F+ visual workflow builder.
- **Restate + XState is an official, documented integration** (Restate blog Oct 2024) — `@restatedev/xstate` persists XState machines in Restate's durable journal. This is the canonical pattern; ADR-049 already reserved it.
- **Domain workflows are deterministic state machines, not agent loops**: the directive's workflow examples (lines 680–735) are deterministic (reservation: `PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT`). XState's formalism (states, transitions, guards, actions) is the right abstraction; plain `if/switch` loses it.
- **Agent state machines remain plain TypeScript in Phase 1** because agents are bounded by `maxSteps` (per ADR-049); state-machine formalism is overkill for agents that run ≤ 10 steps. The Phase 2+ reservation for agent-XState is preserved for complex agent loops.
- **Decision tables are the simplest rule pattern** (Salesforce BRE, Flowable, GoRules) — business analysts can author them without code. JSON encoding makes them serializable, versionable, and syncable (per ADR-072).
- **JSONata is the safe-formula layer** — sandboxed, read-only, no side effects, no `eval`. ADR-029 (Parser Stack) covers document parsers but not formula parsers; JSONata fills that gap.
- **Rules emit events; workflows perform side effects** — this separation preserves auditability (every side effect is a workflow invocation, journaled by Restate) and replayability (a rule re-evaluation produces the same event; the workflow re-consumes it idempotently via ADR-072 `idempotencyKey`).
- **Heavyweight BPMN engines are rejected** for offline-first compatibility and operational simplicity — Restate + XState is lighter and fits ADR-007.

## 6. Consequences

- New Prisma models: `WorkflowDefinition`, `RuleDefinition` (Layer-1 Platform Core, per ADR-098). `WorkflowInstance` is a Restate Virtual Object (not a Prisma model — its state lives in Restate's journal).
- New SDK module: `packages/sdk/src/workflow/` with `WorkflowDefinition`, `WorkflowInstance`, `RuleDefinition` interfaces.
- New Restate services: `WorkflowInstance` Virtual Object (runs XState machines), `RuleEvaluationService` (evaluates decision tables and formulas).
- New runtime dependencies: `xstate` (v5), `@restatedev/xstate`, `jsonata`.
- **Risk: XState v5 machine serialization format drift across versions.** Mitigation: `WorkflowDefinition.version` (semver) pins the XState machine format; a migration script upgrades machines on XState minor-version bumps. XState v5's serialization format is stable.
- **Risk: JSONata expression complexity.** A poorly-authored JSONata expression can be slow (O(n²) on large arrays). Mitigation: a JSONata linter in CI rejects expressions that don't pass static analysis; the `RuleEvaluationService` enforces a 100ms evaluation timeout.
- **Risk: decision-table row explosion.** A decision table with N input columns and M values per column has M^N rows. Mitigation: wildcards (`null`) compress the table; the `RuleEvaluationService` enforces a 10,000-row limit per table; tables exceeding the limit are flagged for refactoring into multiple smaller tables or a formula.
- **Risk: rule-event feedback loops.** A rule emits an event that triggers another rule that emits an event that triggers the first rule — infinite loop. Mitigation: every emitted event carries a `ruleEvaluationChain` trace; the `RuleEvaluationService` rejects events whose chain exceeds 5 hops (configurable).
- **Risk: ADR-049 amendment may surprise developers** who read §4(f) as "no XState until Phase 2+." Mitigation: the amendment is explicit — XState for domain workflows in Phase E; agent state machines unchanged in Phase 1; Phase 2+ agent-XState reservation preserved. The verifier rule flags domain-workflow code that uses plain `if/switch` instead of XState.
- Dependencies: ADR-007 (Restate), ADR-009 (Internal SDK — amended), ADR-029 (Parser Stack — referenced), ADR-049 (Agent Runtime — amended), ADR-072 (Sync Metadata), ADR-073 (Transactional Outbox), ADR-097 (Domain Meta-Model — cross-reference), ADR-098 (Hybrid Persistence — cross-reference), ADR-101 (CloudEvents Envelope — cross-reference).
- Phase E effort: ~3 weeks for the SDK interfaces, Prisma models, `WorkflowInstance` Restate Virtual Object, `RuleEvaluationService`, JSONata integration, and the ADR-049 §4(f) amendment.

## 7. Review Conditions

- Review if Phase 1 telemetry shows XState machine serialization/deserialization exceeds 5% of workflow-instance startup latency — would cache compiled machines in memory.
- Review if JSONata expression evaluation timeout (100ms) proves too tight for legitimate complex formulas — would investigate per-formula timeout configuration or move complex formulas to compiled TypeScript.
- Review if decision-table row limit (10,000) proves too tight for legitimate business rules — would investigate table partitioning or a move to expression sets.
- Review if rule-event feedback loops occur in production despite the 5-hop chain limit — would tighten the limit or add per-rule recursion guards.
- Review if a community standard for workflow/rules authoring emerges (e.g., a JSON standard for decision tables, or a DMN-compatible format) that should replace the SmartAgentics-owned JSON encoding.
- Review if the directive's §19 visual workflow builder (Phase F+) requires additional `WorkflowDefinition` fields (e.g., UI node positions, transition labels) not anticipated by ADR-100 — would warrant a Phase F+ additive-column ADR.
- Review if Phase 2+ agent-XState (per ADR-049 reservation) requires a different XState integration pattern than domain-workflow XState — would warrant a Phase 2+ agent-workflow ADR.
- Review if Restate's durable journal proves insufficient for very long-running workflows (> 1 day) — would investigate workflow checkpointing or a split into sub-workflows.
- Review if a BPMN engine becomes necessary for cross-organizational workflows (e.g., a hotel chain's group-level approval workflows) — would warrant a Phase 3+ BPMN-interop ADR.
