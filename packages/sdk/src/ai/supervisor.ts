// ADR-050 AI Supervisor — Restate Workflow with 8 explicit journal steps.
// The Supervisor is the SINGLE orchestrator for every AI action — no PMS code calls an agent directly.
// It blocks only on HIGH/CRITICAL tool calls (Vercel AI SDK toolApproval); the Auditor (ADR-052) observes asynchronously.

import type { AgentTaskInput, AgentTaskResult } from './agent.js';

/** One of the 8 supervisor workflow steps per ADR-050 §4. */
export type SupervisorStepName =
  | 'authorize'
  | 'buildToolset'
  | 'checkBudget'
  | 'dispatch'
  | 'monitor'
  | 'finalize'
  | 'requestApproval'
  | 'escalate';

/** Status of an individual supervisor step (each is a Restate journal entry). */
export type SupervisorStepStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';

/** Single journaled supervisor step. */
export interface SupervisorStep {
  readonly stepId: string;
  readonly taskId: string;
  readonly stepName: SupervisorStepName;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly status: SupervisorStepStatus;
  readonly errorMessage?: string;
  readonly journalEntryId: string;
}

/** Context the supervisor operates under — constructed from AgentTaskInput + AgentContract. */
export interface SupervisorContext {
  readonly taskId: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly userId: string;
  readonly role: string;
  readonly sessionId?: string;
  readonly idempotencyKey: string;
  readonly maxDurationMs: number;
  readonly escalationTtlMs: number;
}

/** Result of the dispatch step — sub-invocation of the agent handler as a child Restate service. */
export interface DispatchResult {
  readonly agentSessionId: string;
  readonly status: 'COMPLETED' | 'PAUSED_FOR_APPROVAL' | 'ESCALATED' | 'FAILED' | 'TIMEOUT';
  readonly result?: Readonly<Record<string, unknown>>;
  readonly approvalRequestId?: string;
  readonly escalationReason?: string;
  readonly durationMs: number;
  readonly steps: readonly SupervisorStep[];
}

/** Output of the authorize step — validates AgentContract + tenant boundary + user role. */
export interface AuthorizationResult {
  readonly authorized: boolean;
  readonly reason: string | null;
  readonly agentContractId: string;
  readonly tenantMatch: boolean;
  readonly rolePermitted: boolean;
}

/** Output of the buildToolset step — AgentContract.allowedTools ∩ ToolRegistry.byRiskClass(maxRiskClass). */
export interface ToolsetResult {
  readonly tools: readonly string[];
  readonly rejectedByContract: readonly string[];
  readonly rejectedByRiskClass: readonly string[];
}

/** Output of the checkBudget step — rejects with 429 if tenant token budget is exhausted. */
export interface BudgetCheckResult {
  readonly allowed: boolean;
  readonly remainingTokens: number;
  readonly remainingCostUSD: number;
  readonly rejectionReason: string | null;
}

/**
 * Supervisor contract per ADR-050 §4. The single choke point for every AI action.
 * Implemented as a Restate Workflow (`AgentSupervisorWorkflow`) in Phase 1.
 */
export interface Supervisor {
  runTask(input: AgentTaskInput): Promise<AgentTaskResult>;
  getStatus(taskId: string): Promise<AgentTaskResult>;
  listSteps(taskId: string): Promise<readonly SupervisorStep[]>;
  requestApproval(
    approvalRequestId: string,
    approverRole: string,
    approved: boolean,
  ): Promise<void>;
  escalate(taskId: string, reason: string): Promise<void>;
}
