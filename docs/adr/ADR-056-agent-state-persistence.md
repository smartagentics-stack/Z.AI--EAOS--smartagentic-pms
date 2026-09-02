# ADR-056: Agent State Persistence — Restate Journal + Prisma Projections + Working Memory

**ADR-ID:** ADR-056
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #14 ("Agent runtime") implies a state-persistence model for agents. Stream 5 research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §14) confirmed three industry findings: (1) Restate journals every step (per ADR-001 and the Restate Durable Agents docs — "every step is recorded in a journal, so if the process crashes, the agent picks up exactly where it left off"); (2) the Restate journal is not directly queryable (only via Restate's reflection API) — but the PMS UI needs "show me the last 10 agent sessions for tenant X" queries; (3) the agent's _scratchpad_ (working memory) is a separate concern from the audit history (Stream 4 ADR-038 explicitly reserves the `WorkingMemory` sub-type for this).

The three-layer split mirrors Stream 4's pattern (episodic = append-only events; semantic = mutable facts; working = scratchpad). The Restate journal is the _event log_ (analogous to Stream 4's `MemoryEvent`); the Prisma `AgentStep` table is the _queryable projection_ (analogous to `MemoryRecord`); the working memory is the _scratchpad_ (analogous to `WorkingMemory`).

## 2. Problem

Should SmartAgentics persist agent state in a single layer (Restate journal only, or Prisma only, or working memory only), or in three layers each with a different access pattern?

## 3. Options

### Option A: Single-layer — Restate journal only

Rejected: the Restate journal is not directly queryable. The PMS UI needs "show me recent agent sessions" and "show me all sessions where tool T was called" queries that the journal's reflection API cannot efficiently serve. The Auditor (ADR-052) also needs queryable projections for anomaly investigation.

### Option B: Single-layer — Prisma only (no Restate journal)

Rejected: loses durability. Agent crashes would lose in-flight state; Restate's "no duplicate side effects on crash recovery" guarantee (per ADR-049) requires the journal. Prisma writes are transactional but not journal-replayable.

### Option C: Single-layer — store full state in working memory (per LangGraph pattern)

Rejected: Stream 4's `WorkingMemory` is for the agent's scratchpad, not for audit history. Conflating them produces a confused schema (per Stream 4 §4 Rejected Alternatives analog). Working memory is mutable and per-session; audit history is append-only and 7-year-retention.

### Option D: Three layers, each with a different access pattern

1. **Restate journal** (authoritative, write-only from the agent's perspective) — every step's input and output is journaled. Source of truth for "what happened". Survives crashes. Read by the Auditor via Restate's reflection API. Not directly queryable.
2. **Prisma `AgentSession` + `AgentStep` tables** (queryable, derived from the journal) — every agent invocation creates an `AgentSession` row; every step creates an `AgentStep` row. Written by the Supervisor's `finalize` step (ADR-050) and by the Auditor (ADR-052). Queryable for: "last 10 sessions", "sessions where tool T was called", "step-by-step trace of session Y".
3. **Prisma `AgentContract.workingMemory`** (per-agent, per-session, read-write) — the agent's working memory block (per Stream 4 ADR-038). Mutable state via the `MemoryStore` interface (Stream 4). Persisted via Stream 4's `MemoryRecord` table with `type='WORKING'`, `scope='SESSION'`.

## 4. Decision

Adopt **Option D** — three-layer agent state persistence.

### Layer 1: Restate journal (authoritative)

- Every LLM call, every tool call, every routing decision is journaled by Restate via `@restatedev/vercel-ai-middleware` (per ADR-049).
- On crash, completed steps are replayed without re-execution; execution resumes from the first incomplete step. No duplicate LLM cost, no duplicate tool side effects (no double bookings, no duplicate refunds, no duplicate emails).
- Read access is via Restate's reflection API (used by the Auditor; not directly by the PMS UI).
- Each invocation has a `restateInvocationId` recorded on the `AgentSession` row for cross-reference.

### Layer 2: Prisma `AgentSession` + `AgentStep` (queryable projection)

```
AgentSession {
  id, tenantId, propertyId,
  agentId, agentContractVersion,
  taskId,
  status: 'PENDING' | 'EXECUTING' | 'PAUSED_FOR_APPROVAL' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
  requestedByUserId,
  input: JSON, output: JSON?,
  startedAt, completedAt?, durationMs?,
  tokenCount, costUsd,
  error?: JSON,
  restateInvocationId              // cross-reference to the authoritative journal
}

AgentStep {
  id, sessionId, stepNumber,
  stepType: 'LLM_CALL' | 'TOOL_CALL' | 'TOOL_RESULT' | 'ROUTING_DECISION' |
            'POLICY_CHECK' | 'HUMAN_APPROVAL' | 'ESCALATION',
  description,
  input: JSON, output: JSON?,
  startedAt, completedAt?, durationMs?,
  modelId?, toolId?,
  tokenCount?, costUsd?,
  auditEventId?                    // cross-reference to AIAuditEvent (ADR-052)
}
```

- Written by the Supervisor's `finalize` step (ADR-050) and idempotently by the Auditor.
- The `finalize` step is idempotent (writes `AgentStep` rows with `ON CONFLICT DO NOTHING`).
- Queryable: PMS UI lists sessions; Auditor investigates anomalies; developers debug step-by-step traces.

### Layer 3: Stream 4 `WorkingMemory` (mutable scratchpad)

- The agent's working memory block (per Stream 4 ADR-038 §1) — persona, human, task, scratchpad (Letta/MemGPT-inspired 4-block pattern, adopted as a _conceptual reference_).
- Access via the Stream 4 `MemoryStore` interface (`read(scope='SESSION', type='WORKING')`, `write(scope='SESSION', type='WORKING')`).
- Persisted in Stream 4's `MemoryRecord` table — no new persistence layer.
- Bound by `AgentContract.memory.workingMemoryBudget` (ADR-053) — prevents unbounded scratchpad growth.

### Reconciliation

- A nightly Restate job reconciles the journal and the Prisma `AgentStep` table, flagging mismatches (mitigates journal/projection drift if the Supervisor crashes between journaling a step and writing the Prisma row).

### Phase 2+ option

- Optional `@restatedev/xstate` integration for complex agent state machines (state-machine DSL + Restate durability). Phase 1 uses plain TypeScript `if/switch` for state transitions to keep the dependency surface minimal (per ADR-049 §4.f).

## 5. Rationale

- **Mirrors Stream 4's proven pattern**: episodic (append-only) / semantic (mutable facts) / working (scratchpad) — three access patterns, three storage layers. Stream 4's `MemoryEvent` / `MemoryRecord` / `WorkingMemory` split is the precedent.
- **Restate journal is the source of truth**: never trust agent self-reported state; trust the journal. The Auditor (ADR-052) reads from the journal as authoritative.
- **Prisma projections are queryable**: the PMS UI's "show me recent agent sessions" use case is not served by Restate's reflection API; the `AgentSession`/`AgentStep` tables are. Projections are derived, idempotent, and reconciled nightly.
- **Working memory is mutable, audit history is append-only**: separating them avoids the schema-smell of storing audit data in a mutable scratchpad. Stream 4's `WorkingMemory` is the right home for the agent's scratchpad; the `AgentStep` table is the right home for audit history.
- **B4 #26 satisfaction**: the journal's "no duplicate side effects on crash recovery" guarantee (per ADR-049) is the foundation of "AI failure must never become PMS failure" (ADR-057). Without journaling, crash recovery would re-execute tools — double charges, double emails, double bookings.
- **Cross-reference, not duplication**: `restateInvocationId` links `AgentSession` to the journal; `auditEventId` links `AgentStep` to `AIAuditEvent` (ADR-052); `sessionId` links `MemoryRecord` to the agent session. Every record traces to every other relevant record.
- **Volume is manageable**: a single agent invocation produces 10–50 `AgentStep` rows. At 1000 invocations/day/tenant, that's 10K–50K rows/day — well within SQLite's capacity.

## 6. Consequences

- Two new Prisma tables (`AgentSession`, `AgentStep`) — additive. No existing interface is broken.
- The Supervisor's `finalize` step (ADR-050) is the primary writer of `AgentSession`/`AgentStep` rows; the Auditor writes additional rows for events the Supervisor does not observe directly (e.g., `BudgetExhausted`, `PlanStepCompleted` per ADR-052).
- **Journal/projection drift risk**: the Restate journal and the Prisma `AgentStep` table may diverge if the Supervisor crashes between journaling a step and writing the Prisma row. Mitigation: idempotent `ON CONFLICT DO NOTHING` writes + nightly reconciliation job.
- **Step volume**: a single agent invocation may produce 10–50 `AgentStep` rows. Manageable for SQLite; index on `(sessionId, stepNumber)` and `(tenantId, startedAt)` for query performance.
- Working memory is owned by Stream 4 (ADR-038) — this ADR only specifies the _integration_ with agent state, not a new storage layer.
- Optional Phase 2+ `@restatedev/xstate` integration is reserved — Phase 1 uses plain TypeScript state transitions to minimize the dependency surface.
- Dependencies: Restate TypeScript SDK (per ADR-001); Prisma `AgentSession` + `AgentStep` tables; Stream 4 `MemoryStore` for working memory; ADR-052 `AIAuditEvent` (cross-reference via `auditEventId`).
- This is the persistence layer for every AI-BOS agent's execution history. AI Trainer (Future Vision 35g) consumes `AgentStep` records as training data.

## 7. Review Conditions

- Review if the nightly reconciliation job surfaces drift rates that justify moving `AgentStep` writes inside the same Restate transaction as the journal entry.
- Review if Phase 2+ complex agent state machines justify `@restatedev/xstate` adoption (would amend ADR-049 §4.f and this ADR's Phase 2+ option).
- Review if `AgentStep` volume grows beyond SQLite's comfortable capacity (~50M rows) — would justify partitioning or migration to a dedicated time-series store for `AgentStep`.
- Review if a community agent-state standard emerges (e.g., a standardized `AgentStep` interchange schema) that should replace the SmartAgentics-owned entity.
- Review if working memory budgets (`workingMemoryBudget`, `conversationalMemoryBudget` per ADR-053) prove insufficient for production agents — would adjust defaults or move to per-step budgets.
