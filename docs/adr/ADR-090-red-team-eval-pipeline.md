# ADR-090: Red-Team & Evaluation Pipeline — Promptfoo CI + Nightly Drift Detection

**ADR-ID:** ADR-090
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #25 ("AI evaluation") is classified as **"Partial"** — Stream 5 reserved LLM-as-judge Auditor. Phase B B4 #29 ("Offline AI security") demands regression testing for prompt injection (OWASP LLM01:2025). Neither specifies the **red-team & evaluation pipeline** that catches prompt-injection regressions in CI and detects behavior drift in production.

The Stream 8 research (s23) identified Promptfoo as the de-facto open-source standard:

- **Promptfoo red-team** (`https://www.promptfoo.dev/docs/red-team`): "LLM red teaming is a way to find vulnerabilities in AI systems before they're deployed by using simulated adversarial inputs." Runs 100% locally (per `https://github.com/promptfoo/promptfoo`). Tests "coding agents against repository prompt injection, terminal output injection, secret environment read, sandbox read escape, and verifier sabotage risks."
- **OWASP LLM Prompt Injection Prevention Cheat Sheet** (s25): "Conduct regular security testing with known attack patterns. Monitor for new injection techniques and update defenses accordingly."

The drift-detection research (s14) establishes that **model behavior changes over time even when weights don't change** (data drift, concept drift, prompt drift):

- **Evidently AI concept drift** (January 2025): "Concept drift refers to changes in the data patterns and relationships that the model has learned, potentially causing a decline in [model performance over time]."
- **AWS Prescriptive Guidance drift detection**: "In the context of LLMs, drift refers to the gradual degradation of its performance over time. This is typically caused by changes in data distributions [or prompt templates]."
- **Galileo LLM drift monitoring platforms** (March 2026): "An LLM output drift monitoring platform detects unexpected changes in your model behavior and output characteristics over time, even when your [model weights are unchanged]."

Two distinct concerns must be addressed: (1) **CI regression** — every code/prompt change runs the Promptfoo eval suite; a regression blocks merge. (2) **Nightly drift detection** — a nightly job re-runs the eval suite against production-sampled `AIAuditEvent` records and alerts on regression beyond configurable thresholds.

## 2. Problem

Should SmartAgentics adopt a cloud-based AI eval platform, a custom eval framework, Promptfoo for CI only, Promptfoo for CI + nightly drift, or no automated eval? Should drift detection use statistical anomaly detection or eval-suite re-runs?

## 3. Options

### Option A: Cloud-based AI eval platform (LangSmith, Braintrust, Galileo)

Rejected. Violates offline-first. Hotel servers have no guaranteed internet egress. Production-sampled `AIAuditEvent` records contain guest PII that cannot leave the deployment.

### Option B: Custom eval framework (build our own)

Rejected. Reinvents the wheel; Promptfoo is MIT-licensed, runs 100% locally, and is the de-facto OSS standard. SmartAgentics' value-add is the PMS, not the eval framework.

### Option C: Promptfoo CI only (no nightly drift)

Rejected. CI catches regressions on code/prompt changes but not production drift. A model that degrades over time (e.g., due to changing guest query patterns) would go undetected.

### Option D: No automated eval (manual red-team before release)

Rejected. Manual red-team is unscalable and error-prone; prompt-injection attack patterns evolve weekly. CI regression is mandatory for a production-safe AI PMS.

### Option E: Promptfoo CI regression + nightly drift detection via eval-suite re-runs + statistical anomaly detection

Adopted. Two layers: (1) Promptfoo in CI blocks merge on regression; (2) nightly drift job re-runs the eval suite against production samples + statistical anomaly detection on event rates.

## 4. Decision

Adopt **Option E** — the Promptfoo CI + nightly drift pipeline.

### Layer 1 — Promptfoo CI regression (Phase 1 mandatory)

- Every pull request that touches `packages/ai/`, `packages/sdk/src/ai/`, or any `AgentContract` prompt template runs `promptfoo eval` against the canonical eval suite.
- The eval suite lives in `packages/ai/evals/promptfoo.yaml` and includes:
  - **Prompt injection regression tests**: known attack patterns (jailbreak attempts, delimiter injection, indirect injection via retrieved documents).
  - **Tool-call safety tests**: agent must not call HIGH/CRITICAL tools without approval; agent must not call tools outside its `capabilities[]`.
  - **PII redaction tests**: agent must redact PII in input; agent must not leak PII in output.
  - **Tenant isolation tests**: agent must not retrieve cross-tenant chunks.
  - **Explainability tests**: every decision must produce a `DecisionRecord` with citations.
- Pass threshold: 95% (configurable). A regression below threshold blocks merge.
- Runs 100% locally (no cloud); uses the bundled Ollama models.

### Layer 2 — Nightly drift detection (Phase 2 impl; Phase 1 contract only)

A nightly Restate workflow `DriftEvaluationWorkflow` per tenant that:

1. Samples N% (default 5%) of `AIAuditEvent` records from the last 24h.
2. Re-runs the Phase 1 Promptfoo eval suite (s23) against the sampled inputs.
3. Compares eval pass-rate against the baseline (set at Phase 1 release).
4. If pass-rate drops more than `driftThreshold` (default 10 percentage points) → `DRIFT_DETECTED` `AIAuditEvent` + alert to ops dashboard.
5. Also tracks (statistical anomaly detection, z-score > 3):
   - Average `confidenceScore` trend.
   - PII redaction rate.
   - Prompt-injection block rate.
   - Tool-call failure rate.
   - Human-approval rejection rate.

### Phase 1 scope

- Layer 1 (Promptfoo CI) — full impl.
- Layer 2 (nightly drift) — contract only; impl deferred to Phase 2 (needs a mature eval suite that doesn't exist until Phase 1 ships).

### `DriftEvaluator` SDK interface (new in `packages/sdk/src/ai/`)

```typescript
export interface DriftEvaluator {
  runCIRegression(suitePath: string): Promise<EvalResult>;
  runNightlyDrift(tenantId: string, sampleRate: number): Promise<DriftReport>;
  getBaseline(): Promise<EvalBaseline>;
  setBaseline(baseline: EvalBaseline): Promise<void>;
}
```

### `DriftEvaluationResult` Prisma table (new)

Records nightly drift results per tenant per night. Used for trend analysis.

## 5. Rationale

- **OWASP LLM01:2025 closure** (s01): prompt injection is the #1 LLM risk; CI regression catches it before deployment.
- **OWASP Cheat Sheet principle** (s25): "Conduct regular security testing with known attack patterns" — Layer 1 is the regular security testing.
- **Evidently AI principle** (s14): "concept drift refers to changes in data patterns" — Layer 2 catches production drift that CI cannot.
- **Galileo principle** (s14): "detects unexpected changes in your model behavior over time, even when your [model weights are unchanged]" — prompt-template drift, retrieval-corpus drift, and guest-query-pattern drift are all caught by Layer 2.
- **Promptfoo is the de-facto OSS standard** (s23): MIT-licensed, 100% local, no cloud. Aligns with offline-first.
- **Two-layer defense**: CI catches regressions on code/prompt changes; nightly catches production drift. Neither alone is sufficient.
- **Statistical anomaly detection** (z-score > 3) is a simple, explainable drift signal — doesn't require ML drift models.
- **5% sample rate** limits re-run cost to ~50 LLM calls per tenant per night — manageable on a hotel server.
- **Phase 1 ships CI only** — Layer 2 needs a mature eval suite; deferring to Phase 2 is honest about Phase 1 readiness.

## 6. Consequences

- New `DriftEvaluator` SDK interface in `packages/sdk/src/ai/`.
- New `DriftEvaluationResult` Prisma table (Phase 2 impl).
- New `DriftEvaluationWorkflow` Restate workflow (Phase 2 impl).
- New `AIAuditEvent` event type: `DRIFT_DETECTED`.
- `packages/ai/evals/promptfoo.yaml` — the canonical eval suite, version-controlled.
- CI pipeline gains a `promptfoo eval` step (blocks merge on regression below 95%).
- **Risk: 95% pass threshold may be too strict for Phase 1** (the eval suite is immature). Mitigation: configurable; start at 90% and tighten as the suite matures.
- **Risk: nightly drift re-runs model calls, which costs compute.** Mitigation: 5% sample rate limits to ~50 re-runs per tenant per night; manageable on a hotel server.
- **Risk: statistical anomaly detection (z-score > 3) may fire false positives on small tenants** (low event volume → high variance). Mitigation: minimum sample size (e.g., 100 events) before anomaly detection runs; otherwise skip.
- **Risk: the eval suite itself drifts** (test cases become outdated as attack patterns evolve). Mitigation: monthly review of the eval suite; new attack patterns added from public red-team resources.
- **Risk: Promptfoo CLI is Node.js-based; Windows compatibility.** Mitigation: Promptfoo runs on Node.js (already a SmartAgentics dependency); verified Windows-compatible per `https://github.com/promptfoo/promptfoo`.
- Dependencies: Promptfoo CLI (MIT, s23); Stream 5 `AIAuditEvent` (sample source); ADR-091 (OTel GenAI spans for eval instrumentation); Stream 1 Ollama runtime (eval runs locally).
- Phase 1 effort: ~1 week (Promptfoo CI integration); nightly drift deferred to Phase 2.

## 7. Review Conditions

- Review if Phase 1 95% pass threshold proves too strict — would lower to 90% or add per-test-suite thresholds.
- Review if Phase 2 nightly drift job runs longer than the off-peak window — would lower sample rate or move to weekly.
- Review if z-score > 3 anomaly detection fires false positives on small tenants — would raise the minimum sample size or switch to a more robust anomaly detector.
- Review if the eval suite itself drifts (test cases outdated) — would institute a monthly review cadence.
- Review if a new attack class emerges (e.g., multi-modal injection) that the eval suite doesn't cover — would extend the suite.
- Review if a community red-team standard emerges (e.g., OWASP releases a standardized prompt-injection test corpus) that should replace the SmartAgentics-owned suite.
- Review if Phase 3+ requires cloud eval (e.g., for cross-tenant benchmarking) — would add a cloud eval adapter alongside the local one, with PII redaction before any cloud upload.
