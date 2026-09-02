# ADR-091: AI Observability — OTel GenAI Semantic Conventions, Self-Hosted Langfuse Deferred

**ADR-ID:** ADR-091
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #23 ("AI observability") is classified as **"Partial"** — Stream 5 reserved an Auditor (LLM-as-judge); Stream 6 added W3C Trace Context and OTel GenAI conventions. Stream 8 Foundational Conflict **FC-8.1** (High) flags that ADR-013 "Observability Strategy" defines lifecycle tracing for `SyncRecord` (general PMS), NOT AI-specific observability. The AI observability surface — drift, anomaly, OTel GenAI, self-hosted Langfuse — requires an explicit ADR-013 amendment (performed separately) and a dedicated ADR (this one).

The Stream 8 research (s08, s21) identified the de-facto standards:

- **OpenTelemetry GenAI semantic conventions** (`https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans`): standardized attributes for LLM spans — `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.prompt_tokens`, `gen_ai.usage.completion_tokens`, `gen_ai.response.id`, `gen_ai.response.finish_reasons`, etc. Maintained in `https://github.com/open-telemetry/semantic-conventions-genai`.
- **Langfuse OpenTelemetry integration** (`https://langfuse.com/integrations/native/opentelemetry`): "OpenTelemetry GenAI semantic conventions and support major LLM instrumentation frameworks. Furthermore, Langfuse uses attributes within the [langfuse namespace]."
- **Langfuse blog: OTel for LLM Observability** (October 2024): "Explore the challenges of LLM observability and the current state of using OpenTelemetry (OTel) for standardized instrumentation."
- **Greptime OTel GenAI tracing** (May 2026): "This is where GenAI semantic conventions diverge most from traditional OTel. Distributed tracing has HTTP spans, RPC spans, [and DB spans]; GenAI spans add `gen_ai.*` attributes."

Stream 5 line 612 already established: "External auditor service (Langfuse, Arize, etc.): partially rejected for offline-first reasons. Langfuse is cloud-first ... _Local_ Langfuse (self-hosted) may be adopted in Stream 8 as an _additional_ observability surface; the `AIAuditEvent` table is the authoritative source of truth, and Langfuse (if adopted) reads from it."

The architectural insight is that Langfuse v3+ is **OpenTelemetry-native** — SmartAgentics instruments once with OTel GenAI `gen_ai.*` spans and can export to Langfuse locally (Phase 1-2) or to a cloud OTel collector (Phase 3+) without code change. This decouples instrumentation (Phase 1 mandatory) from the UI surface (Langfuse deferred to Phase 2).

## 2. Problem

Should SmartAgentics adopt cloud Langfuse, Arize Phoenix / Weights & Biases / Datadog LLM Observability, a custom observability stack, OpenLLMetry, or OTel GenAI + self-hosted Langfuse deferred? What ships in Phase 1 vs Phase 2?

## 3. Options

### Option A: Cloud Langfuse (Langfuse Cloud)

Rejected. Violates offline-first. Production LLM traces contain guest PII that cannot leave the deployment.

### Option B: Arize Phoenix, Weights & Biases, Datadog LLM Observability

Rejected. All cloud-first; some have self-hosted options but with restrictive licenses. Langfuse MIT license is the cleanest.

### Option C: Custom observability stack (no Langfuse, no OTel)

Rejected. Reinvents the wheel; OTel GenAI is the standard; Langfuse is the de-facto OSS UI. SmartAgentics' value-add is the PMS, not the observability stack.

### Option D: OpenLLMetry (wrapper library)

Partially rejected. OpenLLMetry is a wrapper that emits OTel GenAI spans; it's an alternative instrumentation library. Phase 1 instruments directly with `@opentelemetry/api`; OpenLLMetry may be adopted in Phase 2 if its higher-level abstractions prove useful.

### Option E: OTel GenAI instrumentation (Phase 1 mandatory) + self-hosted Langfuse (Phase 2 deferred) + drift detection (Phase 2)

Adopted. Instrument once with OTel GenAI; export to SQLite `OtelSpan` table in Phase 1 (no Docker dependency); export to self-hosted Langfuse in Phase 2 (richer UI); export to cloud OTel collector in Phase 3+ (no code change).

## 4. Decision

Adopt **Option E** — the 3-component AI observability architecture.

### Component 1 — OpenTelemetry GenAI instrumentation (Phase 1 mandatory)

Every `LocalLLMRuntime.generate()` call emits an OTel span with `gen_ai.*` attributes per the semantic conventions (s21). Every `tool()` call emits a child span. Every `Retriever.retrieve()` emits a child span. The spans are exported to:

- Phase 1: local OTel collector → SQLite `OtelSpan` table (simple, queryable, no Docker).
- Phase 2+: local OTel collector → self-hosted Langfuse (richer UI, dashboards).
- Phase 3+: optional cloud OTel collector (no code change required — the instrumentation is already OTel-native).

### Component 2 — Self-hosted Langfuse (optional Phase 1, recommended Phase 2)

Langfuse is open-source (MIT), self-hostable via Docker. Runs as a Docker Desktop sidecar on the hotel server (Windows). Provides:

- LLM call tracing UI (every prompt + completion + tool call visible to ops).
- Cost analytics (tokens × price per model).
- Latency percentiles.
- Per-tenant / per-agent / per-tool breakdowns.
- Evaluation pipeline integration (Promptfoo evals surface in Langfuse).

The `AIAuditEvent` table remains the authoritative source of truth for compliance; Langfuse is the _operations_ surface.

### Component 3 — Drift detection (Phase 2 impl; Phase 1 contract only)

A nightly Restate workflow `DriftEvaluationWorkflow` per tenant (per ADR-090 Layer 2). Phase 1 ships the contract; Phase 2 ships the impl.

### `OtelSpan` Prisma table (new, Phase 1)

Stores OTel GenAI spans in SQLite for Phase 1 queryability. Schema: `traceId, spanId, parentSpanId, name, kind, startTime, endTime, attributes JSON, status, tenantId`. Indexed on `(tenantId, startTime)`.

### Phase 1 scope

- OTel instrumentation in `LocalLLMRuntime` and `ToolRegistry`.
- `OtelSpan` table + basic query UI (per-agent / per-tool latency).
- Drift-eval workflow contract (impl deferred to Phase 2).
- Langfuse itself deferred to Phase 2.

### Why `AIAuditEvent` (authoritative) vs Langfuse (operations)

- `AIAuditEvent` is the compliance source of truth: Merkle-verified, 7-year retention, regulator-exportable. Every event is tamper-evident (ADR-084).
- Langfuse is the operations surface: rich UI, cost analytics, latency percentiles. Reads from `AIAuditEvent` via OTel span export; not itself tamper-evident.
- If Langfuse is unavailable (Docker not installed), the PMS still functions — `AIAuditEvent` is the fallback.

## 5. Rationale

- **FC-8.1 closure**: ADR-013 amendment (performed separately) adds the AI observability surface; this ADR specifies Langfuse + OTel GenAI + drift.
- **OTel GenAI is the standard** (s21): instrumentation is portable across Phase 1 (SQLite), Phase 2 (Langfuse), Phase 3+ (cloud OTel collector) without code change.
- **Langfuse is OTel-native** (s08): "Langfuse uses attributes within the [OTel GenAI semantic conventions]" — no adapter code required to switch from SQLite to Langfuse.
- **Offline-first respected**: Phase 1 ships OTel-to-SQLite (no Docker); Phase 2 ships Langfuse as an _optional_ sidecar for hotels that want the richer UI.
- **`AIAuditEvent` remains authoritative** (Stream 5 line 612): Langfuse is the operations surface; compliance reads from `AIAuditEvent`.
- **Greptime insight** (s21): "GenAI spans add `gen_ai.*` attributes" — the semantic conventions are stable enough for Phase 1; pin a specific version to manage evolution.
- **Drift detection is a separate concern** (s14) from tracing — addressed by ADR-090 Layer 2, not by Langfuse alone.
- **Docker deferred to Phase 2**: Phase 1 ships without Docker Desktop dependency (simpler install); Phase 2 ships Langfuse as optional sidecar.

## 6. Consequences

- New `OtelSpan` Prisma table (Phase 1).
- New `DriftEvaluationResult` Prisma table (Phase 2 impl).
- New `DriftEvaluationWorkflow` Restate workflow (Phase 2 impl).
- ADR-013 amendment (performed separately) adds the AI observability surface.
- OTel instrumentation in `LocalLLMRuntime`, `ToolRegistry`, `Retriever`.
- Phase 2: Docker Desktop sidecar with Langfuse container.
- **Risk: OTel GenAI semantic conventions are still evolving** (s21 notes the spec moved to a separate repo). Mitigation: pin a specific version of the semantic conventions; this ADR names the version.
- **Risk: Langfuse self-hosted requires Docker Desktop on Windows, which adds install complexity.** Mitigation: Phase 1 ships OTel-to-SQLite only (no Docker dependency); Phase 2 ships Langfuse as an _optional_ sidecar.
- **Risk: Promptfoo nightly drift eval re-runs model calls, which costs compute.** Mitigation: 5% sample rate limits to ~50 re-runs per tenant per night (per ADR-090).
- **Risk: `OtelSpan` table grows unboundedly.** Mitigation: 30-day retention for hot spans; older spans archived to cold storage.
- **Risk: OTel instrumentation adds latency to every LLM call.** Mitigation: span creation is ~microseconds; export is batched and asynchronous.
- Dependencies: `@opentelemetry/api` (Apache 2.0); `@opentelemetry/sdk-trace-base` (Apache 2.0); Langfuse Docker image (MIT, Phase 2); Promptfoo CLI (MIT, ADR-090).
- Phase 1 effort: ~2 weeks (OTel instrumentation ~1 week, `OtelSpan` table + query UI ~3 days, drift-eval workflow contract ~3 days, impl deferred to Phase 2).

## 7. Review Conditions

- Review if OTel GenAI semantic conventions release a breaking change — would require a migration of `OtelSpan.attributes` JSON.
- Review if Phase 2 Langfuse adoption is blocked by Docker Desktop unavailability on hotel servers — would require a Node.js-native Langfuse alternative or a Langfuse-lite implementation.
- Review if `OtelSpan` 30-day retention proves too short for ops troubleshooting — would extend hot retention.
- Review if a community OTel GenAI UI emerges (e.g., Jaeger adds `gen_ai.*` visualization) that should replace Langfuse.
- Review if Phase 3+ cloud OTel collector is demanded by a multi-property hotel chain — would activate the cloud export path (no code change required).
- Review if drift detection (ADR-090 Layer 2) fires false positives frequently — would tune the z-score threshold or sample rate.
- Review if OpenLLMetry's higher-level abstractions prove useful in Phase 2 — would adopt it as the instrumentation library.
