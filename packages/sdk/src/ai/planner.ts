// ADR-051 AI Planner — Restate Virtual Object (Plan-and-Execute), keyed by (tenantId, planId).
// Planning does NOT automatically mean execution (B4 #16): the Plan is a reviewable, persisted artifact.
// HIGH/CRITICAL PlanSteps trigger human approval via the Supervisor's requestApproval step.

import type { ToolRiskClass } from './agent.js';

/** Plan lifecycle status per ADR-051 §4. */
export type PlanStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'PARTIALLY_COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** Individual PlanStep lifecycle. */
export type PlanStepStatus = 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/** A single step in a Plan DAG. */
export interface PlanStep {
  readonly id: string;
  readonly planId: string;
  readonly stepNumber: number;
  readonly description: string;
  readonly assignedAgent: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly dependsOn: readonly string[];
  readonly riskClass: ToolRiskClass;
  readonly status: PlanStepStatus;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly agentSessionId?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly divergenceReason?: string;
}

/** A persisted Plan (Prisma entity per ADR-051 §4). */
export interface Plan {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly goal: string;
  readonly status: PlanStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly planVersion: number;
  readonly parentPlanId?: string;
  readonly steps: readonly PlanStep[];
}

/** Natural-language + structured goal submitted to the Planner. */
export interface PlanningRequest {
  readonly description: string;
  readonly requestedBy: {
    readonly userId: string;
    readonly role: string;
    readonly tenantId: string;
    readonly propertyId?: string;
  };
  readonly constraints?: Readonly<Record<string, string | number | boolean | null>>;
  readonly idempotencyKey: string;
}

/** Result of a planning call — persisted Plan + (optional) approval request. */
export interface PlanningResult {
  readonly plan: Plan;
  readonly requiresApproval: boolean;
  readonly approvalRequestId?: string;
  readonly replanAttempts: number;
}

/** Result of executing a Plan via the Supervisor. */
export interface ExecutionResult {
  readonly planId: string;
  readonly status: PlanStatus;
  readonly completedSteps: number;
  readonly failedSteps: number;
  readonly escalationRequestIds: readonly string[];
  readonly durationMs: number;
}

/**
 * Planner contract per ADR-051 §4. Implemented as a Restate Virtual Object (`PlannerService`)
 * keyed by (tenantId, planId). Planning and execution are separate phases.
 */
export interface Planner {
  createPlan(goal: PlanningRequest): Promise<PlanningResult>;
  getPlan(planId: string): Promise<Plan>;
  submitPlanForApproval(planId: string): Promise<{ readonly approvalRequestId: string }>;
  executePlan(planId: string): Promise<ExecutionResult>;
  cancelPlan(planId: string): Promise<void>;
}
