# ADR-052: AI Auditor — Restate Workflow, LLM-as-Judge, Tamper-Evident Hash Chain

**ADR-ID:** ADR-052
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #17 ("AI Auditor") requires the architecture to "audit AI decisions, tool calls, data access, actions, policy compliance, anomalies, approvals, rejected actions" and to "integrate with existing AuditEvent table (extend schema) AND define AI-specific audit fields". Phase B worklog line 7941 specifies the observability surface: "model used, model version, inference duration, token/compute metrics where available, tool calls, agent execution, failures, retries, confidence/uncertainty indicators where meaningful, human overrides, audit events."

Stream 5 research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §12) confirmed three industry findings: (1) AI audit trails must be **structured records**, not LLM-generated narratives (RunLayer: "keep logs tamper-proof"); (2) **LLM-as-judge** is the established evaluation method for sampling production decisions (Evidently AI: "an evaluation method to assess the quality of text outputs from any LLM-powered product"); (3) audit retention must satisfy compliance horizons — SmartAgentics adopts Stream 4's 7-year retention pattern. The existing `AuditEvent` table is human/system audit; extending it with nullable AI fields would be a schema smell. The correct pattern (mirroring Stream 4's `MemoryEvent`) is a separate `AIAuditEvent` table cross-referenced to `AuditEvent` via `correlationId`.

## 2. Problem

How should SmartAgentics audit AI agent activity — by extending the existing `AuditEvent` table with nullable AI fields, by an LLM-only auditor that reads conversations and produces audit narratives, by an external SaaS auditor (Langfuse), or by a dedicated `AIAuditEvent` table populated from the Restate journal and evaluated by an LLM-as-judge sampling pipeline?

## 3. Options

### Option A: Extend the existing `AuditEvent` table with nullable AI fields

Rejected: schema smell. Every non-AI audit record would carry nullable `modelId`, `modelVersion`, `agentId`, `toolId`, `approvalRequired`, `knowledgeSourceChunkIds`, `promptVersion`, `retrievalProvenance` fields. Mirrors the same anti-pattern Stream 4 rejected for `MemoryEvent`.

### Option B: Synchronous auditor (block the Supervisor on every audit entry)

Rejected: would make the Supervisor's latency dominated by audit writes. The Auditor is asynchronous — the Supervisor writes audit entries synchronously as Restate journal side effects, and the Auditor reads them asynchronously for deeper analysis.

### Option C: LLM-only auditor (no structured audit table; the LLM reads the conversation and produces audit reports)

Rejected: non-compliant. Auditors require tamper-evident structured records, not LLM-generated narratives (RunLayer). LLM narratives are non-reproducible, non-queryable, and non-tamper-evident.

### Option D: External auditor service (cloud Langfuse, Arize, etc.)

Partially rejected. Cloud Langfuse conflicts with the offline-first mandate (worklog line 7941: "Langfuse is cloud, conflicts with offline-first"). _Local_ Langfuse (self-hosted) may be adopted in Stream 8 as an _additional_ observability surface; the `AIAuditEvent` table remains the authoritative source of truth, and Langfuse (if adopted) reads from it. The Langfuse-vs-local decision is deferred to Stream 8.

### Option E: Two components — `AuditorWorkflow` (event subscriber + `AIAuditEvent` persistence + anomaly alerts) + `AIEvaluationPipeline` (nightly LLM-as-judge sampling)

The Auditor is a **passive observer** in Phase 1 — it never blocks the Supervisor. The Supervisor writes audit entries synchronously as a side effect of each Restate journal entry; the Auditor Workflow reads them asynchronously and performs deeper analysis. LLM-as-judge samples a configurable percentage of recent records nightly per tenant and writes `AIEvaluationResult` rows.

## 4. Decision

Adopt **Option E** — implement the AI Auditor as two components.

### Component 1: `AuditorWorkflow` (Restate Workflow)

- Implementation: `packages/ai/src/auditor/auditor.workflow.ts`.
- Subscribes to events: `AgentDecisionMade`, `ToolCalled`, `ToolResultReceived`, `HumanApprovalRequested`, `HumanApprovalResolved`, `AgentExecutionFailed`, `AgentExecutionCompleted`, `BudgetExhausted`, `PlanStepCompleted`, `PlanStepFailed`.
- For each event, writes an `AIAuditEvent` row to Prisma:

```
AIAuditEvent {
  id, tenantId, propertyId, timestamp,
  correlationId,        // links to AuditEvent for the triggering user action
  traceId,              // OpenTelemetry trace ID
  agentId, agentContractVersion,
  agentSessionId, agentStepId,
  eventType,
  modelId, modelVersion, promptVersion,
  input: JSON, output: JSON,
  toolId, toolArgs: JSON, toolResult: JSON, toolRiskClass,
  knowledgeSourceChunkIds: [],   // Stream 3 citation tracking
  memorySourceIds: [],           // Stream 4 memory provenance
  approvalRequired: bool, approvalRequestId?, approvedBy?, approvalDecision?,
  durationMs, tokenCount, cost,
  anomalyFlags: [],              // ['unusual_tool_call_rate', 'unknown_tool', 'budget_threshold_exceeded', ...]
  actorUserId,                   // the user who triggered the agent
  severity: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  prevHash, rowHash               // SHA-256 tamper-evidence chain
}
```

- **Tamper-evidence**: every `AIAuditEvent` row carries `prevHash` + `rowHash` (SHA-256 of all fields + previous row's hash) — a lightweight blockchain-style chain. Verification = a nightly Restate job that recomputes hashes and flags mismatches (mirrors Stream 4's `MemoryAccessLog` integrity-check pattern).
- **Retention**: 7 years (per Stream 4 `MemoryAccessLog` 7-year retention pattern).
- **Write protection**: SQLCipher encryption (Stream 4 ADR-040 pattern) + database-level insert-only permissions for `AIAuditEvent` (no update/delete without manager role + dual control).

### Component 2: `AIEvaluationPipeline` (Restate Workflow, extends `AIEvaluator` per B4 #25)

- Implementation: `packages/ai/src/auditor/evaluation.workflow.ts`.
- Nightly Restate workflow per tenant.
- Samples N% (default 5%) of `AIAuditEvent` records from the last 24 hours.
- For each sample, runs an LLM-as-judge evaluation (per Evidently AI) against: **tool correctness**, **retrieval quality**, **hallucination**, **policy compliance**, **harmfulness**.
- Writes `AIEvaluationResult` rows: `{ id, auditEventId, evaluatorModelId, evaluatorModelVersion, scores: { toolCorrectness, retrievalQuality, hallucination, policyCompliance, harmfulness }, reasoning, flagged: bool, flagReason? }`.
- **Evaluator ≠ generator**: the evaluator model is a _separate_ model from the agent model (Evidently AI best practice: "use a different model for evaluation than for generation to avoid bias").
- Flagged results emit alerts (ADR-013 / ADR-059); persistent low-scoring agents trigger retraining/re-prompting workflow (Phase 2+, depends on Stream 8 / AI Trainer Future Vision 35g).

## 5. Rationale

- **Structured, tamper-evident, queryable**: the `AIAuditEvent` table is the compliance surface (RunLayer: "keep logs tamper-proof"). LLM narratives are non-compliant.
- **Clean schema**: a separate `AIAuditEvent` table (vs. extending `AuditEvent`) mirrors Stream 4's `MemoryEvent` pattern — no nullable AI fields on human/system audit records. Cross-reference via `correlationId`.
- **Async by design**: the Supervisor's latency is never dominated by audit writes; the Auditor reads from the authoritative Restate journal asynchronously.
- **LLM-as-judge is sample-based, not exhaustive**: Phase 1 ships 5% sampling; flagged results are surfaced for human review, not auto-acted-upon. This balances evaluation coverage against LLM cost.
- **Evaluator ≠ generator**: prevents the systematic bias where a model grades its own outputs.
- **7-year retention** matches Stream 4's `MemoryAccessLog` and aligns with hospitality regulatory horizons.
- **Insert-only writes + SQLCipher + hash chain**: three layers of tamper-evidence. The hash chain catches database-level tampering; insert-only permissions enforce immutability at the SQL layer; SQLCipher protects at-rest data.
- **Provenance by cross-reference**: `knowledgeSourceChunkIds` links to Stream 3 `KnowledgeCitation`; `memorySourceIds` links to Stream 4 `MemoryEvent`. Every AI decision traces back to its evidence.

## 6. Consequences

- Two new Prisma tables (`AIAuditEvent`, `AIEvaluationResult`) — additive. The existing `AuditEvent` table is unchanged.
- The existing `AIEvaluator` interface (B4 #25: `evaluate()`, `runGoldenSuite()`) is extended with `runLLMJudgeEvaluation()`. No existing interface is broken.
- **Audit volume**: every AI action may produce 5–20 `AIAuditEvent` rows (one per step). At 1000 AI actions/day/tenant, that's 5,000–20,000 rows/day — 1.8M–7.3M rows/year/tenant. SQLite handles this volume; 7-year retention = ~50M rows/tenant worst case. Index on `(tenantId, timestamp)`; partition by month for query performance.
- **LLM-as-judge reliability**: the evaluator LLM may disagree with a human reviewer. Mitigation: sample-based, surfaced-for-review (not auto-acted), separate model from generator.
- **Tamper-evidence depends on DB write protection**: the hash chain is only as strong as the database's write protection. Mitigation: SQLCipher + insert-only table permissions requiring manager role + dual control for any update/delete.
- Phase 1 ships `AuditorWorkflow` with event subscription + `AIAuditEvent` persistence + 5% sampling LLM-as-judge evaluation. The `AIEvaluationPipeline` ships with the existing Promptfoo integration (B4 #25, Promptfoo runs locally) for golden-suite regression tests plus the new LLM-as-judge sampling for production decisions.
- Dependencies: Prisma `AIAuditEvent` + `AIEvaluationResult` tables; Stream 4 `MemoryEvent`; Stream 3 `KnowledgeCitation`; Ollama (Stream 1) for the LLM-as-judge evaluator; OpenTelemetry GenAI semantic conventions (ADR-059).
- Reclassifies AI Auditor from ADR-011 "Future Vision" to "Architecture Contract — NOW" (FC-5.2).

## 7. Review Conditions

- Review if 5% sampling proves insufficient for compliance in Phase 2 (would raise the default sampling rate or add risk-stratified sampling).
- Review if Stream 8 adopts local Langfuse / Phoenix / Logfire as the evaluation surface — would reposition `AIEvaluationPipeline` as the writer-of-record feeding that surface.
- Review if a community AI audit standard emerges (e.g., a standardized `AIAuditEvent` interchange schema) that should replace the SmartAgentics-owned entity.
- Review if 7-year retention is insufficient for specific jurisdictions (some hospitality regulations require longer).
- Review if the hash-chain verification nightly job surfaces drift rates that justify moving to an append-only ledger database (e.g., immudb) for `AIAuditEvent`.
