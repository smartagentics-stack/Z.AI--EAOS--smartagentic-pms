# ADR-059: Agent Observability — Three-Surface Stack with OpenTelemetry GenAI Semantic Conventions

**ADR-ID:** ADR-059
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #23 ("AI Observability") requires the architecture to "define `AIObservabilityEmitter` extending existing metrics + logger. Track: model used, model version, inference duration, token/compute metrics where available, tool calls, agent execution, failures, retries, confidence/uncertainty indicators where meaningful, human overrides, audit events." Phase B worklog line 7941 specifies: "Build-vs-Buy says Langfuse — but Langfuse is cloud, conflicts with offline-first. Phase C research Stream 8 + Stream 5 will determine whether local Langfuse (self-hosted) or local-first alternative."

Stream 5 research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §17) confirmed three industry findings: (1) the OpenTelemetry GenAI semantic conventions (`gen_ai.*` attribute namespace per https://opentelemetry.io/docs/specs/semconv/gen-ai/) are the standard for AI-specific spans (`gen_ai.request.model`, `gen_ai.usage.prompt_tokens`, `gen_ai.usage.completion_tokens`, `gen_ai.tool.name`, `gen_ai.tool.call.id`); (2) Restate natively emits OpenTelemetry spans and provides step-by-step execution traces via Restate UI (`http://localhost:9070`); (3) the Langfuse-vs-local decision is properly deferred to Stream 8 — Stream 5's contribution is the SDK interface, the span emission, and the `AIAuditEvent` table as the durable audit surface.

## 2. Problem

Should SmartAgentics adopt cloud Langfuse as the observability surface, rely on Restate UI alone, build a custom observability format, or compose a three-surface stack (Restate UI + OpenTelemetry GenAI spans + `AIAuditEvent` table) with the Langfuse-vs-local decision deferred to Stream 8?

## 3. Options

### Option A: Cloud Langfuse (SaaS)

Rejected: conflicts with the offline-first mandate (per worklog line 7941: "Langfuse is cloud, conflicts with offline-first").

### Option B: No observability emitter (rely on Restate UI alone)

Rejected: Restate UI is ephemeral (per-invocation traces, not durable aggregates); compliance requires durable queryable audit (per ADR-052 `AIAuditEvent` table); data scientists / evaluators require aggregated evaluation surfaces.

### Option C: Custom observability format (no OTel)

Rejected: OTel GenAI semantic conventions are the industry standard; adopting a custom format would foreclose compatibility with any OTel-compatible tool (Langfuse, Phoenix, Logfire, Jaeger, etc.).

### Option D: Three-surface observability stack with OTel GenAI as the wire format

1. **Restate UI** (`http://localhost:9070`) — the developer/operator surface (real-time, ephemeral).
2. **OpenTelemetry GenAI semantic conventions** (`gen_ai.*` spans) — the standard wire format, emitted by `AIObservabilityEmitter`.
3. **`AIAuditEvent` table** (per ADR-052) — the durable, queryable, tamper-evident, 7-year-retention compliance surface.
   Phase 2+ may add an OTel collector → local Langfuse / Phoenix / Logfire as the evaluation surface; the Langfuse-vs-local decision is deferred to Stream 8.

## 4. Decision

Adopt **Option D** — the three-surface observability stack.

### Surface 1: Restate UI (`http://localhost:9070`)

- The developer/operator surface. Already provided by Restate per ADR-001 — no SmartAgentics work.
- Shows step-by-step execution traces of every agent invocation, every LLM call, every tool execution, every state change.
- Real-time and ephemeral (per-invocation); not a durable aggregate.

### Surface 2: OpenTelemetry GenAI semantic conventions (`gen_ai.*` spans)

- The standard wire format for AI-specific spans.
- SmartAgentics' `AIObservabilityEmitter` interface (extending the existing `metrics` and `logger` SDK modules) emits `gen_ai.*` spans for every LLM call, tool call, and routing decision.

```typescript
// packages/sdk/src/ai/observability.ts
export interface AIObservabilityEmitter {
  emitLLMCallSpan(span: LLMCallSpanInput): void;
  emitToolCallSpan(span: ToolCallSpanInput): void;
  emitRoutingDecisionSpan(span: RoutingDecisionSpanInput): void;
  emitHumanApprovalSpan(span: HumanApprovalSpanInput): void;
  emitEscalationSpan(span: EscalationSpanInput): void;
}
```

- **Phase 1 export target**: the existing SmartAgentics logger (PII-redacted per existing pattern) + a new `AIAuditEvent` table (per ADR-052). No external OTel collector required for Phase 1.
- **Phase 2+ export target**: optional OTel collector → local Langfuse (self-hosted) OR Arize Phoenix (local) OR Pydantic Logfire (local) — per Stream 8's recommendation.

### Surface 3: `AIAuditEvent` table (per ADR-052)

- The queryable, tamper-evident, 7-year-retention audit trail.
- The _compliance_ surface (RunLayer: "keep logs tamper-proof").
- Cross-references the OTel `traceId` for span-to-audit correlation.

### Three audiences, three surfaces

- **Developers / operators** (Restate UI) — debugging, performance analysis. Real-time, ephemeral.
- **Compliance / audit** (`AIAuditEvent` table) — regulatory, internal governance, "why did the agent do X?" investigations. Durable, queryable.
- **Data scientists / evaluators** (OTel → Langfuse / Phoenix / Logfire, Phase 2+) — agent evaluation, prompt optimization, regression detection. Aggregated.

The three surfaces are _complementary_, not redundant.

### PII handling

- LLM inputs/outputs may contain PII (guest names, payment info). The `AIObservabilityEmitter` applies the existing PII-redaction pattern from `packages/sdk/src/logger/index.ts` before emitting spans.
- `AIAuditEvent.input` and `AIAuditEvent.output` are encrypted at rest via SQLCipher (per Stream 4 ADR-040 pattern).
- Phase 2+ OTel collectors inherit the same PII-redaction pipeline.

### Span volume

- Every LLM call produces 1+ span; every tool call produces 1+ span. At 1000 agent invocations/day/tenant, that's 10K–50K spans/day.
- **Phase 1 mitigation**: spans emit to the logger (rate-limited).
- **Phase 2+ mitigation**: dedicated OTel collector with sampling.

## 5. Rationale

- **B4 #23 satisfaction**: `AIObservabilityEmitter` extends existing `metrics` + `logger` SDK modules; tracks every B4 #23 field (model used, model version, inference duration, token/compute metrics, tool calls, agent execution, failures, retries, confidence/uncertainty indicators, human overrides, audit events).
- **OTel GenAI is the industry standard**: `gen_ai.*` attributes ensure future compatibility with any OTel-compatible tool. Adopting a custom format would foreclose this.
- **Three audiences, three surfaces**: developers (Restate UI), compliance (`AIAuditEvent`), evaluators (OTel → Langfuse/Phoenix/Logfire). The three surfaces are complementary, not redundant.
- **Offline-first**: cloud Langfuse rejected; local Langfuse / Phoenix / Logfire deferred to Stream 8. Phase 1 requires no external collector.
- **Restate UI is free**: already provided by Restate per ADR-001 — no SmartAgentics work. Real-time step-by-step traces are the developer surface.
- **`AIAuditEvent` is the durable surface**: per ADR-052, the tamper-evident hash-chained 7-year-retention table is the compliance surface. OTel spans are _additional_; the `AIAuditEvent` table is the authoritative source of truth.
- **PII handled by existing patterns**: the `AIObservabilityEmitter` reuses the existing PII-redaction pipeline; `AIAuditEvent.input`/`output` are encrypted at rest via SQLCipher.
- **Langfuse-vs-local decision deferred**: Stream 8 (the proper observability stream) decides whether to add Langfuse, Phoenix, or Logfire as the evaluation surface. Stream 5's contribution is the SDK interface, the span emission, and the `AIAuditEvent` table.
- **Restate natively emits OTel**: the Restate "Observability & Control" pattern (per the Durable Agents navigation) emits OTel spans by default — SmartAgentics inherits this without custom work.

## 6. Consequences

- The existing `metrics` and `logger` SDK modules are extended with a new `AIObservabilityEmitter` interface — additive. No existing interface is broken.
- `@opentelemetry/api` is added as a dependency (already common in Node.js projects).
- Phase 1 ships `AIObservabilityEmitter` with logger + `AIAuditEvent` export. Restate UI is used as-is.
- Phase 2+ adds an OTel collector → Stream 8 decides target (local Langfuse / Phoenix / Logfire).
- **PII in spans risk**: LLM inputs/outputs may contain PII. Mitigation: existing PII-redaction pattern + SQLCipher encryption at rest for `AIAuditEvent`.
- **Span volume risk**: 10K–50K spans/day/tenant. Mitigation: Phase 1 rate-limits logger export; Phase 2+ uses a dedicated OTel collector with sampling.
- ADR-013 (general observability strategy) is amended to reference this ADR for AI-specific observability (FC-5.3 partial). The amendment is reconciled by the Phase D architect.
- Dependencies: `@opentelemetry/api`; existing `metrics` and `logger` SDK modules; `AIAuditEvent` table (per ADR-052); Restate UI (per ADR-001).
- This is the AI-BOS "AI Observability" capability (B4 #23). Stream 8 will extend with the evaluation surface (Langfuse-vs-local decision).

## 7. Review Conditions

- Review if Stream 8 adopts local Langfuse / Phoenix / Logfire as the evaluation surface — would add a Phase 2+ OTel collector configuration to this ADR.
- Review if the OpenTelemetry GenAI semantic conventions are revised in a way that requires re-mapping `AIObservabilityEmitter` span attributes.
- Review if PII-redaction proves insufficient for production PII varieties — would require extending the redaction pipeline (potentially via a dedicated PII-detection model).
- Review if span volume forces earlier-than-Phase-2 sampling — would require adopting a dedicated OTel collector ahead of Stream 8.
- Review if a community AI-observability standard emerges beyond OTel GenAI (e.g., a higher-level agent-trace schema) that should replace the SmartAgentics-owned `AIObservabilityEmitter` interface.
- Review if Restate UI is replaced or augmented by a future Restate observability surface — would re-evaluate Surface 1.
