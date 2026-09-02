# ADR-085: AI Audit Event Catalog — AI-Specific Audit Event Types and Fields

**ADR-ID:** ADR-085
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #24 ("AI audit") is classified as **"Partial"** — Stream 5 created the `AIAuditEvent` table with `actorId, actorType, action, resource, result, severity, details JSON, traceId, tenantId, timestamp` and a basic hash chain. But the existing `AuditEvent` model (in `prisma/schema.prisma`) and Stream 5's sketch lack **AI-specific fields**: no `modelId`/`modelVersion`, no `retrievedChunks[]` for RAG provenance, no `citations[]` for explainability, no `riskClass` for tool calls, no `decisionRecord`, no `promptHash` for prompt-version regression, and no `merkleLeafIndex`/`merkleRootHash` for tamper-evidence.

The Stream 8 research (s06, s15) demands a richer audit catalog for two reasons:

1. **EU AI Act Article 12** (s15): "High-risk AI systems must maintain continuous, automatically generated logs." Regulators require queryable historical logs that capture _what the AI did, why, with what evidence, and under whose approval_ — not merely "an action occurred."
2. **Tamper-evidence** (RFC 6962 Merkle Tree, ADR-084): every audit event must be a Merkle leaf with `merkleLeafIndex` and `merkleRootHash` fields.

Stream 6 ADR-068 (inter-agent auditability) reserved multi-agent delegation fields. Stream 3 (citation-forcing RAG) reserved `KnowledgeCitation` references. Stream 5 (tool registry) reserved `riskClass`. None of these reservations were consolidated into a single **what-to-log catalog** — an enumerable taxonomy of event types and a fixed field set that every `AIAuditEvent` row carries.

The catalog must satisfy four uses: (1) forensic reconstruction (what did the AI do?); (2) compliance export (regulator queryable logs); (3) drift detection (statistical anomaly detection on event rates); (4) Merkle verification (each row is a leaf).

## 2. Problem

Should SmartAgentics keep the existing `AuditEvent` model, extend it with AI fields, create a separate `AIAuditEvent` table (Stream 5 sketch), or define a full event-type taxonomy + fixed field set? Should the catalog be a closed enum or an extensible enum?

## 3. Options

### Option A: Keep the existing `AuditEvent` model, add AI fields ad hoc

Rejected. The existing `AuditEvent` model lacks AI-specific structure; ad hoc additions would scatter AI context across `details JSON` — unqueryable, unverifiable, non-compliant.

### Option B: Single `AuditEvent` table for both PMS and AI events

Rejected. PMS events (e.g., `USER_LOGIN`) and AI events (e.g., `PROMPT_INJECTION_BLOCKED`) have different retention, query patterns, and compliance obligations. Mixing them complicates Merkle verification (different leaf structures) and regulator export.

### Option C: Closed event-type enum (no extension)

Rejected. AI event types will evolve (e.g., new attack classes, new approval states). A closed enum would force a schema migration for every new type.

### Option D: `AIAuditEvent` table (Stream 5 sketch) with extensible enum + fixed field set

Adopted. A separate AI-specific table with an extensible `eventType` enum and a fixed field set that every row carries. The fixed set enables Merkle verification, regulator export, and drift detection; the extensible enum accommodates evolution.

## 4. Decision

Adopt **Option D** — the AI audit event catalog.

### Fixed field set (every `AIAuditEvent` row)

| Field               | Type              | Purpose                                                                                      |
| ------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| `id`                | CUID              | Primary key                                                                                  |
| `tenantId`          | String            | Tenant isolation (ADR-083 T1)                                                                |
| `timestamp`         | DateTime (HLC)    | Stream 7 hybrid logical clock                                                                |
| `correlationId`     | String            | Stream 6 3-ID model (traceId + correlationId + causalId)                                     |
| `eventType`         | Enum (extensible) | See event-type catalog below                                                                 |
| `agentId`           | String            | Agent identity                                                                               |
| `sessionId`         | String            | Agent session                                                                                |
| `invocationId`      | String            | Restate invocation ID (Stream 6)                                                             |
| `userId`            | String            | Originating user (from signed JWT)                                                           |
| `delegationChain`   | JSON              | Stream 6 multi-agent: `[{agentId, hop, scopeNarrowing[]}]`                                   |
| `modelId`           | String            | From Stream 1 `LocalLLMRuntime`                                                              |
| `modelVersion`      | String            | From Stream 1 `LocalLLMRuntime`                                                              |
| `toolId`            | String?           | If event is tool-related                                                                     |
| `toolArgs`          | JSON?             | Zod-validated tool arguments                                                                 |
| `toolResult`        | String?           | Truncated to 1KB; full result in cold storage                                                |
| `riskClass`         | Enum?             | LOW/MEDIUM/HIGH/CRITICAL (ADR-086)                                                           |
| `approvalRequestId` | String?           | If applicable (ADR-087)                                                                      |
| `retrievedChunks`   | String[]          | Stream 3 `KnowledgeChunk.id` list — RAG provenance + tenant-isolation invariant (ADR-083 T4) |
| `citations`         | String[]          | Stream 3 `KnowledgeCitation.id` list — explainability (ADR-089)                              |
| `confidenceScore`   | Float?            | Stream 3 coverage score + optional logprob                                                   |
| `decisionRecord`    | JSON?             | Per ADR-089                                                                                  |
| `promptHash`        | String            | SHA-256 of rendered prompt template + inputs — prompt-version regression                     |
| `prevHash`          | String            | SHA-256 of previous row's `rowHash` (Tier 1 hash chain)                                      |
| `rowHash`           | String            | SHA-256 of all row fields + `prevHash`                                                       |
| `merkleLeafIndex`   | Int               | Position in the Merkle Tree (ADR-084 Tier 2)                                                 |
| `merkleRootHash`    | String            | Root this leaf belongs to (ADR-084 Tier 2)                                                   |
| `severity`          | Enum              | INFO / WARN / ERROR / CRITICAL                                                               |

### Event-type catalog (extensible enum)

| Category        | Event types                                                                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent lifecycle | `AGENT_INVOCATION_STARTED`, `AGENT_INVOCATION_COMPLETED`, `AGENT_INVOCATION_FAILED`, `AGENT_INVOCATION_CANCELLED`, `AGENT_DELEGATED`, `AGENT_HANDOFF`                                                                                    |
| Tool            | `TOOL_CALLED`, `TOOL_RESULT`, `TOOL_REJECTED`, `TOOL_CIRCUIT_BREAKER_OPEN`, `TOOL_RATE_LIMIT_EXCEEDED`                                                                                                                                   |
| Approval        | `HUMAN_APPROVAL_REQUESTED`, `HUMAN_APPROVAL_GRANTED`, `HUMAN_APPROVAL_REJECTED`, `HUMAN_APPROVAL_TIMEOUT`, `DUAL_CONTROL_FIRST_APPROVED`, `DUAL_CONTROL_SECOND_APPROVED`                                                                 |
| Knowledge       | `KNOWLEDGE_RETRIEVED`, `CITATION_RENDERED`                                                                                                                                                                                               |
| Security        | `PROMPT_INJECTION_BLOCKED`, `UNSAFE_OUTPUT_BLOCKED`, `PII_REDACTED_INPUT`, `PII_LEAK_BLOCKED_OUTPUT`, `EGRESS_BLOCKED`, `TENANT_ISOLATION_VIOLATION`, `MODEL_INTEGRITY_VERIFIED`, `MODEL_INTEGRITY_FAILED`, `MERKLE_VERIFICATION_FAILED` |
| Decision        | `DECISION_MADE` (with `decisionRecord`), `DECISION_OVERRIDDEN_BY_HUMAN`                                                                                                                                                                  |
| Drift           | `DRIFT_DETECTED` (from ADR-090 nightly eval)                                                                                                                                                                                             |

### Retention

- **7 years** (per Stream 6 ADR-062). Exceeds EU AI Act Article 12 minimum of 6 months.
- **Cold storage after 90 days**: rows older than 90 days are exported to a separate `AIAuditEventArchive` SQLite file per tenant per month; hot table retains 90 days for fast querying.

### Phase 1 scope

- Full field set ships in Phase 1.
- All event types in the catalog above are emitted by Phase 1 reference agent.
- Cold-storage archival job ships in Phase 1 (nightly Restate workflow).

## 5. Rationale

- **EU AI Act Article 12 satisfaction** (s15): "continuous, automatically generated logs" — the fixed field set + 7-year retention satisfies the regulator's queryable historical log requirement.
- **RFC 6962 Merkle Tree compatibility** (ADR-084): every row carries `merkleLeafIndex` and `merkleRootHash` — a Merkle leaf.
- **RAG provenance** (`retrievedChunks[]`): enables ADR-083 T4 tenant-isolation invariant verification and ADR-089 explainability.
- **Prompt-version regression** (`promptHash`): a drift eval (ADR-090) can detect when a prompt template change degrades agent behavior, by joining on `promptHash`.
- **Multi-agent delegation** (`delegationChain`): Stream 6 ADR-068 reserved this; the catalog materializes it as a queryable JSON field.
- **Extensible enum** accommodates evolution without schema migration; new event types are added to the enum without breaking existing rows.
- **Cold-storage archival** keeps the hot table small (90 days) for fast querying; 7-year retention is preserved in archive files.

## 6. Consequences

- `AIAuditEvent` Prisma table (Stream 5 sketch) materialized with the full field set.
- `AuditEvent` (existing PMS table) remains separate — no mixing.
- New `AIAuditEventArchive` SQLite file (per tenant per month) for cold storage.
- New nightly archival Restate workflow.
- **Risk: `decisionRecord` JSON can grow large (10KB+ for complex multi-tool decisions).** Mitigation: cold-storage reference for `retrievedBusinessData[].resultRef` and `citations[].quotedText` (truncate `quotedText` to 500 chars in hot storage; full text in `KnowledgeChunk`).
- **Risk: extensible enum drift across deployments.** Mitigation: the enum is defined in `packages/sdk/src/ai/` and version-controlled; a deployment running an older enum version emits `UNKNOWN` for newer event types (logged but not blocked).
- **Risk: `toolResult` truncation to 1KB loses evidence.** Mitigation: full result in cold storage (`AIAuditEventArchive`); the truncated field is for fast querying, not the authoritative record.
- **Risk: cold-storage archival job failure leaves hot table growing unboundedly.** Mitigation: nightly job has retry + alert on failure; a separate weekly job checks hot table size and alerts if > 1M rows.
- Dependencies: Stream 5 `AIAuditEvent` sketch; Stream 6 multi-agent fields; Stream 7 HLC timestamps; Stream 3 `KnowledgeCitation`; ADR-084 Merkle fields; ADR-089 `decisionRecord` schema.
- Phase 1 effort: architecture contract only (no full impl); the catalog is consumed by all other Stream 8 ADRs that emit events.

## 7. Review Conditions

- Review if a new event type is needed that the catalog does not cover — would extend the enum (additive; no migration).
- Review if the 1KB `toolResult` truncation proves too aggressive for forensic reconstruction — would increase the truncation limit or move to a configurable per-tenant limit.
- Review if cold-storage archival job fails repeatedly — would indicate a disk-space or SQLite-lock issue requiring ops intervention.
- Review if a regulator demands a specific export format (e.g., JSON-LD per a future regulator schema) — would add an export adapter (ADR-096).
- Review if the 90-day hot / 7-year cold split proves wrong for query patterns — would tune the retention split.
- Review if `delegationChain` JSON grows large for deep multi-agent chains (>5 hops) — would cap the chain depth (Stream 6 already limits to 5 hops).
- Review if Phase 2+ requires streaming export (e.g., to a SIEM) — would add a streaming sink adapter alongside the persistent table.
