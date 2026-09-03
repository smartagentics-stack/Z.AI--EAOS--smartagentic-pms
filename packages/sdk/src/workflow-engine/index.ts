/**
 * Workflow & Rules Engine SDK interfaces (ADR-100).
 *
 * Three-layer foundation, all hosted inside Restate workflows (ADR-007):
 *  - Layer 1: XState v5 declarative state machines, persisted via
 *    `@restatedev/xstate`;
 *  - Layer 2: JSON decision tables for declarative rule evaluation;
 *  - Layer 3: JSONata for safe read-only formula expression evaluation.
 *
 * Rules NEVER execute side effects directly — they emit CloudEvents
 * (ADR-101); workflows perform the side effects. This separation preserves
 * auditability and replayability.
 *
 * This file contains TYPE DEFINITIONS ONLY — no implementation logic.
 */

/** Lifecycle state of a running `WorkflowInstance`. */
export type WorkflowInstanceStatus = 'running' | 'succeeded' | 'failed' | 'suspended' | 'cancelled';

/** Rule type discriminator (decision-table vs. formula). */
export type RuleType = 'decision-table' | 'formula';

/** Decision-table cell value (null = wildcard). */
export type DecisionValue = number | string | boolean | null;

/** JSONata-style formula binding (input/output path mapping). */
export interface FormulaBinding {
  readonly name: string;
  readonly path: string;
}

/** JSONata formula expression + input/output bindings (Layer 3). */
export interface FormulaDefinition {
  readonly expression: string;
  readonly inputBindings: readonly FormulaBinding[];
  readonly outputBindings: readonly FormulaBinding[];
}

/** Decision-table column declaration (Layer 2). */
export interface DecisionTableColumn {
  readonly name: string;
  readonly type: 'string' | 'number' | 'boolean' | 'date';
}

/** Decision-table row — input tuple maps to output tuple. */
export interface DecisionTableRow {
  readonly inputs: readonly DecisionValue[];
  readonly outputs: readonly DecisionValue[];
}

/** Decision-table definition stored as JSON (Layer 2). */
export interface DecisionTable {
  readonly inputs: readonly DecisionTableColumn[];
  readonly outputs: readonly DecisionTableColumn[];
  readonly rows: readonly DecisionTableRow[];
  readonly defaultOutputs: readonly DecisionValue[];
}

/** A state-machine transition edge in a `WorkflowDefinition`. */
export interface StateTransition {
  readonly source: string;
  readonly target: string;
  readonly event?: string;
  readonly guard?: string;
  readonly action?: string;
  readonly guardFormula?: FormulaDefinition;
}

/** Execution context passed to a running `WorkflowInstance`. */
export interface WorkflowContext {
  readonly workflowId: string;
  readonly tenantId: string;
  readonly domainId: string;
  readonly entityTypeId?: string;
  readonly recordId?: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly startedAt: string;
  readonly parentInstanceId?: string;
  readonly actorId?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
}

/** XState v5 machine definition serialized as JSON (Layer 1). */
export interface WorkflowDefinition {
  readonly id: string;
  readonly domainId: string;
  readonly name: string;
  readonly version: string;
  readonly machineJson: Readonly<Record<string, unknown>>;
  readonly transitions: readonly StateTransition[];
  readonly triggerEventTypes: readonly string[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly active: boolean;
  readonly updatedAt: string;
  readonly revision: number;
  readonly deletedAt: string | null;
  readonly syncOrigin: string | null;
  readonly idempotencyKey: string | null;
}

/** Running instance of a `WorkflowDefinition` (Restate Virtual Object). */
export interface WorkflowInstance {
  readonly id: string;
  readonly tenantId: string;
  readonly domainId: string;
  readonly workflowDefinitionId: string;
  readonly workflowDefinitionVersion: string;
  readonly status: WorkflowInstanceStatus;
  readonly currentState: string;
  readonly contextJson: Readonly<Record<string, unknown>>;
  readonly inputJson: Readonly<Record<string, unknown>>;
  readonly outputJson: Readonly<Record<string, unknown>> | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly parentInstanceId: string | null;
  readonly error?: string;
}

/** Rule definition — either a decision table or a JSONata formula. */
export interface RuleDefinition {
  readonly id: string;
  readonly domainId: string;
  readonly name: string;
  readonly ruleType: RuleType;
  readonly decisionTableJson: DecisionTable | null;
  readonly formulaJson: FormulaDefinition | null;
  readonly triggerEventTypes: readonly string[];
  readonly outputEventTypes: readonly string[];
  readonly active: boolean;
  readonly updatedAt: string;
  readonly revision: number;
  readonly deletedAt: string | null;
  readonly syncOrigin: string | null;
  readonly idempotencyKey: string | null;
}

/** Result of evaluating a `RuleDefinition` against an input tuple. */
export interface RuleEvaluationResult {
  readonly ruleId: string;
  readonly matched: boolean;
  readonly outputs: readonly DecisionValue[];
  readonly emittedEvents: readonly string[];
  readonly evaluatedAt: string;
}

/**
 * `FormulaEvaluator` — Layer 3 safe read-only JSONata evaluation. JSONata
 * is sandboxed by design (no side effects, no `eval`, no arbitrary code
 * execution) per ADR-100 §4 Layer 3.
 */
export interface FormulaEvaluator {
  evaluate(formula: FormulaDefinition, input: Readonly<Record<string, unknown>>): Promise<unknown>;
  validate(formula: FormulaDefinition): Promise<readonly string[]>;
}

/**
 * `RuleEngine` — evaluates `RuleDefinition`s against data tuples. Rules
 * emit CloudEvents on match; side effects are performed by workflows,
 * never by the rule engine itself (per ADR-100 §4 Layer 2 separation).
 */
export interface RuleEngine {
  evaluate(
    rule: RuleDefinition,
    input: Readonly<Record<string, unknown>>,
  ): Promise<RuleEvaluationResult>;
  evaluateBatch(
    rules: readonly RuleDefinition[],
    input: Readonly<Record<string, unknown>>,
  ): Promise<readonly RuleEvaluationResult[]>;
  register(rule: RuleDefinition): Promise<void>;
  list(domainId?: string): Promise<readonly RuleDefinition[]>;
}

/** Input to start a new `WorkflowInstance`. */
export interface WorkflowStartInput {
  readonly tenantId: string;
  readonly domainId: string;
  readonly workflowDefinitionId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly agentId?: string;
  readonly parentInstanceId?: string;
}

/** Filter for `WorkflowEngine.list`. */
export interface WorkflowInstanceFilter {
  readonly tenantId?: string;
  readonly domainId?: string;
  readonly status?: WorkflowInstanceStatus;
  readonly workflowDefinitionId?: string;
}

/**
 * `WorkflowEngine` — manages the lifecycle of `WorkflowInstance`s on top
 * of Restate durable execution (ADR-007). Hosts XState v5 machines via
 * `@restatedev/xstate` for deterministic domain workflows (reservation,
 * check-in, housekeeping, admission, etc.). The visual workflow builder
 * is Phase F+ (per directive §19); this contract ships in Phase E.
 */
export interface WorkflowEngine {
  start(
    definition: WorkflowDefinition,
    input: WorkflowStartInput,
  ): Promise<{ readonly workflowId: string }>;
  getInstance(workflowId: string): Promise<WorkflowInstance | null>;
  sendEvent(
    workflowId: string,
    event: string,
    payload?: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  cancel(workflowId: string): Promise<void>;
  getResult(workflowId: string, timeoutMs?: number): Promise<WorkflowInstance>;
  list(filter?: WorkflowInstanceFilter): Promise<readonly WorkflowInstance[]>;
}
