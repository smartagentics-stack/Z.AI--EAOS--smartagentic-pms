// ADR-052 AI Auditor — passive observer (Phase 1). Never blocks the Supervisor.
// Two components: AuditorWorkflow (event subscriber + AIAuditEvent persistence) + AIEvaluationPipeline (nightly LLM-as-judge).
// Tamper-evident: every AIAuditEvent is hash-chained (Merkle root per tenant per day).

/** Event types the Auditor subscribes to (per ADR-052 §4 Component 1). */
export type AuditEventType =
  | 'AgentDecisionMade'
  | 'ToolCalled'
  | 'ToolResultReceived'
  | 'HumanApprovalRequested'
  | 'HumanApprovalResolved'
  | 'AgentExecutionFailed'
  | 'AgentExecutionCompleted'
  | 'BudgetExhausted'
  | 'PlanStepCompleted'
  | 'PlanStepFailed'
  | 'MemoryWrite'
  | 'MemoryRead'
  | 'KnowledgeRetrieved'
  | 'RagGenerated';

/** LLM-as-judge verdict on a sampled production decision. */
export type AuditVerdict = 'PASS' | 'WARN' | 'FAIL' | 'ESCALATE';

/** Tamper-evident hash-chain root for one (tenant, day) bucket of AIAuditEvents. */
export interface AuditMerkleRoot {
  readonly tenantId: string;
  readonly date: string;
  readonly rootHash: string;
  readonly eventCount: number;
  readonly previousDayRootHash: string | null;
  readonly computedAt: string;
}

/** Structured AI audit record (Prisma `AIAuditEvent` table per ADR-052 §4). */
export interface AIAuditEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly timestamp: string;
  readonly correlationId: string;
  readonly traceId: string;
  readonly agentId?: string;
  readonly agentContractVersion?: string;
  readonly agentSessionId?: string;
  readonly agentStepId?: string;
  readonly eventType: AuditEventType;
  readonly modelId?: string;
  readonly modelVersion?: string;
  readonly promptVersion?: string;
  readonly toolId?: string;
  readonly toolRiskClass?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly approvalRequired?: boolean;
  readonly approvalRequestId?: string;
  readonly knowledgeSourceChunkIds?: readonly string[];
  readonly retrievalProvenance?: Readonly<Record<string, unknown>>;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly latencyMs?: number;
  readonly confidenceScore?: number;
  readonly errorMessage?: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
}

/** Output of the nightly LLM-as-judge evaluation pipeline (AIEvaluationPipeline). */
export interface AIEvaluationResult {
  readonly id: string;
  readonly tenantId: string;
  readonly evaluatedAt: string;
  readonly sampleSize: number;
  readonly passCount: number;
  readonly warnCount: number;
  readonly failCount: number;
  readonly escalateCount: number;
  readonly evaluatedEventIds: readonly string[];
  readonly verdicts: readonly {
    readonly eventId: string;
    readonly verdict: AuditVerdict;
    readonly rationale: string;
    readonly score: number;
  }[];
}

/** Anomaly alert raised by the Auditor (Phase 2+ continuous monitoring). */
export interface AuditAnomalyAlert {
  readonly alertId: string;
  readonly tenantId: string;
  readonly raisedAt: string;
  readonly anomalyType:
    'RATE_SPIKE' | 'FAILURE_CLUSTER' | 'BUDGET_BURN' | 'UNUSUAL_TOOL' | 'POISONING_SUSPECTED';
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly relatedEventIds: readonly string[];
  readonly description: string;
}

/** Query against the audit trail (7-year retention per ADR-052). */
export interface AuditQuery {
  readonly tenantId: string;
  readonly eventTypes?: readonly AuditEventType[];
  readonly agentId?: string;
  readonly fromTimestamp?: string;
  readonly toTimestamp?: string;
  readonly traceId?: string;
  readonly correlationId?: string;
  readonly limit?: number;
}

/**
 * Auditor contract per ADR-052 §4. Passive observer in Phase 1 — never blocks the Supervisor.
 * The Supervisor writes AIAuditEvents synchronously as Restate journal side effects;
 * the Auditor reads them asynchronously for deeper analysis + nightly LLM-as-judge sampling.
 */
export interface Auditor {
  query(query: AuditQuery): Promise<readonly AIAuditEvent[]>;
  getMerkleRoot(tenantId: string, date: string): Promise<AuditMerkleRoot>;
  verifyChain(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<{ readonly verified: boolean; readonly brokenAtEventId?: string }>;
  runEvaluation(tenantId: string, samplePercent: number): Promise<AIEvaluationResult>;
  raiseAlert(alert: Omit<AuditAnomalyAlert, 'alertId' | 'raisedAt'>): Promise<AuditAnomalyAlert>;
}
