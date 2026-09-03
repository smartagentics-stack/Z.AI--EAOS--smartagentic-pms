// ADR-049 Agent Runtime (Restate + Vercel AI SDK) · ADR-053 Agent Contract Schema · ADR-055 Agent Permissions/Identity.
// Framework-agnostic SDK contract — the SDK NEVER links to LangGraph / AutoGen / CrewAI / Letta / Mastra.
// "AI failure must never become PMS failure" (B4 #26) → every LLM call + tool call is journaled via Restate.

/** Agent lifecycle status per ADR-019 (analog). */
export type AgentStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'DEPRECATED' | 'RETIRED';

/** Tool risk class ceiling — agent may only invoke tools at or below its maxRiskClass. */
export type ToolRiskClass = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Agent permission flags per ADR-055. */
export type AgentPermission =
  | 'CALL_TOOLS'
  | 'CALL_HIGH_RISK_TOOLS'
  | 'CALL_CRITICAL_TOOLS'
  | 'REQUEST_HUMAN_APPROVAL'
  | 'WRITE_MEMORY'
  | 'READ_MEMORY'
  | 'QUERY_KNOWLEDGE'
  | 'ESCALATE'
  | 'DELEGATE';

/** Agent identity descriptor (signed JWT in Stream 5; here just the contract surface). */
export interface AgentIdentity {
  readonly agentId: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly version: string;
  readonly description: string;
}

/** Agent run-time session handle (Restate Virtual Object keyed by tenantId+agentId+sessionId). */
export interface AgentSession {
  readonly sessionId: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly propertyId?: string;
  readonly startedAt: string;
  readonly status: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly stepCount: number;
}

/** One journaled agent step (LLM call, tool call, routing decision, or HITL pause). */
export interface AgentStep {
  readonly stepId: string;
  readonly sessionId: string;
  readonly stepNumber: number;
  readonly kind:
    'LLM_CALL' | 'TOOL_CALL' | 'TOOL_RESULT' | 'ROUTING' | 'HITL_PAUSE' | 'HITL_RESUME' | 'ERROR';
  readonly modelId?: string;
  readonly modelVersion?: string;
  readonly toolId?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly latencyMs?: number;
  readonly errorMessage?: string;
  readonly journalEntryId: string;
}

/** Agent memory/knowledge budgets per ADR-053. */
export interface AgentResourceBudget {
  readonly workingMemoryBudget: number;
  readonly conversationalMemoryBudget: number;
  readonly maxSteps: number;
  readonly maxDurationMs: number;
  readonly maxRiskClass: ToolRiskClass;
}

/** Knowledge/RAG attachment per ADR-053. */
export interface AgentKnowledgeBinding {
  readonly ragEnabled: boolean;
  readonly knowledgeBaseIds: readonly string[];
  readonly tenantScoped: boolean;
}

/** Escalation + collaboration rules per ADR-053 (B4 #14). */
export interface AgentPolicyEnvelope {
  readonly escalationRules: readonly {
    readonly trigger: string;
    readonly escalateToRole: string;
    readonly ttlMs: number;
  }[];
  readonly collaborationRules: readonly {
    readonly partnerAgentId: string;
    readonly mode: 'DELEGATE' | 'INFORM' | 'BLOCKING_APPROVAL';
  }[];
  readonly decisionBoundaries: readonly string[];
  readonly manualFallback: string;
}

/**
 * AgentContract — framework-agnostic contract per ADR-053 §4.
 * Captures every B4 #14 field (Identity, Purpose, Responsibilities, Permissions, Tools,
 * Memory, Knowledge, DecisionBoundaries, Policies, EscalationRules, CollaborationRules, AuditConfiguration).
 */
export interface AgentContract {
  readonly id: string;
  readonly tenantId: string | null;
  readonly identity: AgentIdentity;
  readonly purpose: string;
  readonly responsibilities: readonly string[];
  readonly permissions: readonly AgentPermission[];
  readonly allowedTools: readonly string[];
  readonly budget: AgentResourceBudget;
  readonly memory: {
    readonly workingMemoryBudget: number;
    readonly conversationalMemoryBudget: number;
  };
  readonly knowledge: AgentKnowledgeBinding;
  readonly policies: AgentPolicyEnvelope;
  readonly auditConfiguration: {
    readonly auditLevel: 'OFF' | 'SUMMARY' | 'FULL';
    readonly retentionDays: number;
  };
  readonly status: AgentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Input to AgentRuntime.runTask — every PMS feature calls the Supervisor, not the agent directly. */
export interface AgentTaskInput {
  readonly taskId: string;
  readonly agentId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly requestedBy: {
    readonly userId: string;
    readonly role: string;
    readonly tenantId: string;
    readonly propertyId?: string;
    readonly sessionId?: string;
  };
  readonly idempotencyKey: string;
}

/** Result of a runTask call. */
export interface AgentTaskResult {
  readonly taskId: string;
  readonly status: 'COMPLETED' | 'PAUSED_FOR_APPROVAL' | 'ESCALATED' | 'FAILED' | 'CANCELLED';
  readonly result?: Readonly<Record<string, unknown>>;
  readonly approvalRequestId?: string;
  readonly escalationReason?: string;
  readonly sessionId: string;
  readonly steps: readonly AgentStep[];
  readonly durationMs: number;
}

/**
 * AgentRuntime contract per ADR-049 §4(a). Reference implementation = Restate + Vercel AI SDK +
 * @restatedev/vercel-ai-middleware (the SDK never links to those — implementations do).
 */
export interface AgentRuntime {
  runTask(input: AgentTaskInput): Promise<AgentTaskResult>;
  getStatus(taskId: string): Promise<AgentTaskResult>;
  pause(sessionId: string): Promise<void>;
  resume(
    sessionId: string,
    approval: { readonly approved: boolean; readonly approverRole: string },
  ): Promise<void>;
  cancel(taskId: string): Promise<void>;
  listSteps(sessionId: string): Promise<readonly AgentStep[]>;
}
