# ADR-033: Confidence Scoring

**ADR-ID:** ADR-033
**Status:** ACCEPTED
**Context:** 2026-08-06
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §8) classifies **Confidence Scoring** as an "Architecture Contract — NOW" capability (Phase B B4 item #17). Hotel operations staff (front-desk, housekeeping, maintenance) will rely on RAG answers to make operational decisions — a wrong answer with high displayed confidence is materially worse than a wrong answer with low displayed confidence. The existing SmartAgentics repository has no confidence scoring — `KnowledgeSource` (`src/lib/aios/types.ts:149-159`) is a UI status DTO with no confidence field.

Phase C Stream 3 research (`/home/z/my-project/phase-c-stream3-offline-knowledge-report.md`, §6.3) documented the confidence-scoring evidence: **LLM self-reported confidence is unreliable** — LinkedIn (Molina): "Stop asking LLMs for a 'Confidence Score.' They are lying [to] you... When an LLM writes '95%', it is not pausing to introspect." LessWrong (2026): "LLM self-reported confidence doesn't correlate with accuracy. A simple two-step black-box procedure can do much better." FutureAGI (2026): "The visible logprobs cover the final-answer surface, which is often a confident summary of an internally uncertain reasoning trace." — logprobs are a partial signal, not ground truth.

The authoritative metric is **Ragas Faithfulness** (Ragas official docs, verified): "The Faithfulness metric measures how factually consistent a response is with the retrieved context. It ranges from 0 to 1." Formula: `Faithfulness = |V| / |S|` where `|V|` = number of verifiable statements, `|S|` = total statements. Algorithm: (1) break the generated answer into individual statements, (2) for each statement, verify if it can be inferred from the retrieved context, (3) `Faithfulness = verified / total`. The HHEM-2.1-Open variant (Vectara) is "a classifier model (T5) that is trained to detect hallucinations from LLM generated text... free, small, and open-source, making it very efficient in production use cases" (Ragas docs).

The recommended confidence score is a **weighted blend** of (a) `coverage_score` (faithfulness proxy — fraction of LLM-emitted claims that map to ≥1 retrieved chunk, a lightweight local variant of Ragas Faithfulness), (b) `retrieval_score` (mean RRF rank of cited chunks), and (c) optional `logprob_score` (mean token logprob if the runtime exposes logprobs; Ollama does via `logprobs: true`). The `coverage_score` is the **primary** signal (LLM self-reported confidence is unreliable). Phase 1 uses a local heuristic; Phase 2+ integrates HHEM-2.1-Open for true faithfulness scoring. Display: 5-tier label (`Very Low | Low | Medium | High | Very High`) — avoid false precision (research risk R-3.4).

## 2. Problem

The architectural problem: **define a `RagEvaluator` SDK interface and confidence-scoring contract that (a) computes a weighted blend `confidence = 0.5 * coverage_score + 0.3 * retrieval_score + 0.2 * logprob_score` (renormalized to 0.7 / 0.3 if logprobs unavailable), (b) makes `coverage_score` the primary signal — a lightweight local variant of Ragas Faithfulness: `(number of LLM-emitted <source> tags that resolve to retrieved chunks) / (number of LLM-emitted <source> tags + number of unverifiable statements detected by a local NLI classifier)`, (c) Phase 1 simplifies `coverage_score` to `(resolved citations) / (resolved citations + unresolved citations)` — computable in milliseconds, no NLI classifier, (d) Phase 2+ upgrades `coverage_score` with HHEM-2.1-Open (Vectara, free, small, open-source T5 classifier) for true faithfulness scoring (~50–100 ms per answer on CPU), (e) computes `retrieval_score = mean(RRF_rank_score) of cited chunks, normalized to [0,1]` where `RRF_rank_score = 1/(k + rank), k=60`, (f) computes `logprob_score = mean(logprob) of generated tokens, exponentiated` (only if Ollama returns logprobs; otherwise 0 and the weights are renormalized), (g) degrades gracefully when Ollama logprobs are unavailable (drops logprob component, renormalizes coverage + retrieval to 0.7 / 0.3) (research risk R-3.14), (h) persists `confidenceScore` + `confidenceMethod` on every `KnowledgeQuery` row for auditability, (i) displays the score as a 5-tier label (`Very Low | Low | Medium | High | Very High`) — never a precise percentage (research risk R-3.4 false precision), (j) rejects asking the LLM for a self-reported confidence score (proven unreliable), (k) rejects full Ragas Python dependency at runtime (Python dependency, latency — Ragas is a reference framework, its Faithfulness algorithm is reimplemented locally), and (l) feeds Stream 5 (Agent Runtime) — `RagResponse.confidence` is what agents use to decide whether to ask a clarifying question or escalate to a human.** This ADR defines the confidence-scoring contract; the `RagResponse.confidence` shape is owned by ADR-030; the citation inputs (`citedChunkIds`, `unresolvedCitationChunkIds`) are owned by ADR-032.

## 3. Options

### Option A: Ask the LLM for a self-reported confidence score

Prompt the LLM to emit a confidence percentage alongside its answer. **Rejected** — LinkedIn (Molina): "Stop asking LLMs for a 'Confidence Score.' They are lying [to] you." LessWrong (2026): "LLM self-reported confidence doesn't correlate with accuracy." Proven unreliable across multiple authoritative sources. Research §6.3.2, §6.4.

### Option B: Logprobs-only confidence

Use only the mean token logprob as the confidence score. **Rejected as sole signal** — FutureAGI (2026): "The visible logprobs cover the final-answer surface, which is often a confident summary of an internally uncertain reasoning trace." Logprobs are a partial signal, not ground truth. Reserved as one component (0.2 weight) of the blended score. Research §6.3.2.

### Option C: Full Ragas Python dependency at runtime

Use the Ragas framework (Python) for Faithfulness scoring at runtime. **Rejected** — Python dependency, latency. Ragas is a _reference framework_; its Faithfulness algorithm is reimplemented locally for the `coverage_score`. The HHEM-2.1-Open variant (Vectara, free T5 classifier) is the Phase 2+ local NLI classifier — runs on CPU, no Python. Research §6.4.

### Option D: Vectara HHEM-2.1-Open as Phase 1 must-have

Require HHEM-2.1-Open faithfulness scoring in Phase 1. **Rejected as Phase 1 must-have** — additional model download; ~50–100 ms per answer latency. Phase 2+ opt-in. Phase 1 uses the local heuristic `(resolved citations) / (resolved citations + unresolved citations)`. Research §6.4.

### Option E: Weighted blend (coverage + retrieval + optional logprob); Phase 1 local heuristic; Phase 2+ HHEM-2.1-Open; 5-tier label display

`confidence = 0.5 * coverage_score + 0.3 * retrieval_score + 0.2 * logprob_score` (renormalized to 0.7 / 0.3 if logprobs unavailable). `coverage_score` is the primary signal — lightweight local Ragas-Faithfulness variant. Phase 1 simplifies to resolved/unresolved citation ratio. Phase 2+ integrates HHEM-2.1-Open. Display: 5-tier label. Per research §6.3.3.

## 4. Decision

Adopt **Option E**. The Confidence Scoring architectural contract is:

1. **SDK interface** — `RagEvaluator` in `packages/sdk/src/ai/knowledge/eval/RagEvaluator.ts` (research §10):

   ```
   RagEvaluator {
     evaluate(query: RagRequest, response: RagResponse): Promise<EvalResult>;
     // Phase 1: coverage_v1 (local heuristic)
     // Phase 2+: coverage_v2_hhem (HHEM-2.1-Open), faithfulness, answer_relevancy
   }

   EvalResult {
     faithfulness: number;      // 0-1
     answerRelevancy: number;   // 0-1
     contextPrecision: number;  // 0-1
     notes: string[];
   }

   ConfidenceScore {
     score: number;             // 0.0 - 1.0
     method: string;            // "coverage_v1" | "coverage_v2_hhem" | "..."
     components: {
       coverage?: number;       // faithfulness proxy
       retrieval?: number;      // mean RRF rank of cited chunks
       logprob?: number;        // mean token logprob (if available)
     };
   }
   ```

   Reference implementation: `CoverageConfidence` (Phase 1 local heuristic) in `packages/sdk/src/ai/knowledge/eval/CoverageConfidence.ts`.

2. **Weighted blend formula** — Per research §6.3.3:

   ```
   confidence = 0.5 * coverage_score + 0.3 * retrieval_score + 0.2 * logprob_score (if available)

   where:
     coverage_score = (number of LLM-emitted <source> tags that resolve to
                       retrieved chunks) / (number of LLM-emitted <source> tags +
                       number of unverifiable statements detected by a local
                       NLI classifier — Phase 2+; Phase 1 = number of <source> tags)
                       -- this is a lightweight local variant of Ragas Faithfulness

     retrieval_score = mean(RRF_rank_score) of cited chunks, normalized to [0,1]
                       where RRF_rank_score = 1/(k + rank), k=60

     logprob_score   = mean(logprob) of generated tokens, exponentiated
                       (only if Ollama returns logprobs; otherwise 0 and the
                       weights above are renormalized to 0.7 / 0.3)
   ```

3. **Phase 1 simplification** — Per research §6.3.3:
   - Skip the NLI classifier.
   - `coverage_score = (resolved citations) / (resolved citations + unresolved citations)`.
   - `resolved citations` = number of LLM-emitted `<source>` tags whose `chunkId` exists in the retrieved set (ADR-032).
   - `unresolved citations` = number of LLM-emitted `<source>` tags whose `chunkId` does NOT exist in the retrieved set (hallucinated citations, ADR-032).
   - If the LLM emits zero `<source>` tags: `coverage_score = 0` (the LLM made claims without citing any source — low confidence).
   - Computable in milliseconds — no model inference, no Python.

4. **Phase 2+ upgrade — HHEM-2.1-Open** — Per research §6.3.3:
   - Integrate **HHEM-2.1-Open** (Vectara, free, small, open-source T5 classifier) for true faithfulness scoring.
   - Runs on CPU; ~50–100 ms per answer.
   - This matches the Ragas `FaithfulnesswithHHEM` pattern (research §6.3.1).
   - `coverage_score` becomes `Faithfulness = |V| / |S|` where `|V|` = number of verifiable statements (per HHEM), `|S|` = total statements.
   - The `RagEvaluator.evaluate()` method's `method` field records `"coverage_v2_hhem"` when HHEM is used.
   - HHEM-2.1-Open is a model download — opt-in per tenant; `FeatureFlag` gates activation.

5. **`retrieval_score`** —
   - Mean RRF rank score of cited chunks, normalized to [0,1].
   - `RRF_rank_score = 1/(k + rank)` where `k=60` (canonical TREC default, ADR-024).
   - Cited chunks at high ranks (rank 1, 2, 3) contribute near-`1/60 ≈ 0.0164`; lower ranks contribute less.
   - Normalized to [0,1] by dividing by the maximum possible score (all chunks at rank 1).
   - A high `retrieval_score` means the LLM cited chunks that the retriever ranked highly — confidence in retrieval quality.

6. **`logprob_score`** —
   - Mean logprob of generated tokens, exponentiated: `logprob_score = exp(mean(logprob))`.
   - Only computed if Ollama returns logprobs (via `logprobs: true` on the `/v1/chat/completions` call, ADR-030 §2).
   - If unavailable (research risk R-3.14: "LLM logprobs not exposed by Ollama for all models"), `logprob_score = 0` and the weights are renormalized: `confidence = 0.7 * coverage_score + 0.3 * retrieval_score`.
   - FutureAGI (2026): "The visible logprobs cover the final-answer surface, which is often a confident summary of an internally uncertain reasoning trace." — logprobs are a partial signal; the 0.2 weight reflects this.

7. **Graceful degradation** — Per research risk R-3.14:
   - If Ollama logprobs are unavailable for the chosen LLM, the confidence score drops the `logprob` component and renormalizes: `confidence = 0.7 * coverage_score + 0.3 * retrieval_score`.
   - The `ConfidenceScore.components.logprob` field is `undefined` (not 0) when unavailable — the UI distinguishes "logprob not available" from "logprob = 0".
   - If `coverage_score` is 0 (LLM made claims without citing any source), `confidence = 0` regardless of `retrieval_score` and `logprob_score` — coverage is the primary signal.

8. **5-tier label display** — Per research §6.3.3 and risk R-3.4:
   - Display the score as a 5-tier label: `Very Low | Low | Medium | High | Very High`.
   - **Never display a precise percentage** — research risk R-3.4 (Medium/Medium): "Confidence score false precision (user treats '78%' as truth)." Mitigation: "Display as 5-tier label, not percentage; UI guidance text."
   - Tier thresholds (Phase 1 defaults, tunable):
     - `Very Low`: 0.0 – 0.2
     - `Low`: 0.2 – 0.4
     - `Medium`: 0.4 – 0.6
     - `High`: 0.6 – 0.8
     - `Very High`: 0.8 – 1.0
   - The UI shows the label + a short guidance text ("This answer is supported by N citations from the knowledge base. Verify before acting on it.") — never the raw percentage.

9. **`KnowledgeQuery` persistence** — Per ADR-028 §9:
   - `confidenceScore Float` — the blended score (0.0–1.0).
   - `confidenceMethod String` — `"coverage_v1"` (Phase 1), `"coverage_v2_hhem"` (Phase 2+), `"..."`.
   - These columns make every query's confidence reconstructable — for audit, debugging, and model-quality monitoring.

10. **`RagResponse.confidence` shape** — Per ADR-030 §1:
    - `ConfidenceScore { score, method, components: { coverage?, retrieval?, logprob? } }`.
    - The `components` field exposes the individual signals — the UI may show "Coverage: High, Retrieval: Medium, Logprob: N/A" for transparency.

11. **Consumed by Stream 5 (Agent Runtime)** — Per research §17: agents use `RagResponse.confidence` to decide whether to ask a clarifying question or escalate to a human. A "Very Low" confidence answer triggers a "I'm not sure — let me clarify" agent response; a "Very High" confidence answer is acted upon directly.

12. **Rejecting alternatives** —
    - **Asking the LLM for a self-reported confidence score (Option A)**: rejected (proven unreliable — LinkedIn, LessWrong, FutureAGI).
    - **Logprobs-only confidence (Option B)**: rejected as sole signal (FutureAGI: "partial signal, not ground truth"). Reserved as one component (0.2 weight).
    - **Full Ragas Python dependency at runtime (Option C)**: rejected (Python dependency, latency). Ragas is a reference framework; its Faithfulness algorithm is reimplemented locally.
    - **Vectara HHEM as Phase 1 must-have (Option D)**: rejected (additional model download, ~50–100 ms latency). Phase 2+ opt-in.

## 5. Rationale

- **`coverage_score` is the primary signal** — Ragas Faithfulness (authoritative): "measures how factually consistent a response is with the retrieved context." The local variant `(resolved citations) / (resolved citations + unresolved citations)` is a lightweight proxy — computable in milliseconds, no model inference. Phase 2+ HHEM-2.1-Open upgrades it to true faithfulness (research §6.3.1, §6.3.3).
- **LLM self-reported confidence is unreliable** — LinkedIn (Molina): "Stop asking LLMs for a 'Confidence Score.' They are lying [to] you." LessWrong (2026): "LLM self-reported confidence doesn't correlate with accuracy." Multiple authoritative sources confirm — rejecting Option A (research §6.3.2).
- **Logprobs are a partial signal** — FutureAGI (2026): "The visible logprobs cover the final-answer surface, which is often a confident summary of an internally uncertain reasoning trace." The 0.2 weight reflects this — logprobs contribute but do not dominate (research §6.3.2).
- **HHEM-2.1-Open is the Phase 2+ upgrade** — Vectara's HHEM-2.1-Open is "a classifier model (T5) that is trained to detect hallucinations from LLM generated text... free, small, and open-source, making it very efficient in production use cases. Default loads on CPU with batch_size=10." Matches the Ragas `FaithfulnesswithHHEM` pattern (research §6.3.1, §6.3.3).
- **5-tier label avoids false precision** — Research risk R-3.4 (Medium/Medium): "Confidence score false precision (user treats '78%' as truth)." Mitigation: "Display as 5-tier label, not percentage; UI guidance text." A label `Medium` is honest; a number `78%` invites false precision.
- **Graceful degradation on logprob unavailability** — Research risk R-3.14 (Medium/Low): "LLM logprobs not exposed by Ollama for all models." Mitigation: "Confidence score degrades gracefully (drops logprob component, renormalizes coverage + retrieval)." The 0.7 / 0.3 renormalization preserves the primary-signal property.
- **`coverage_score = 0` if LLM emits no `<source>` tags** — If the LLM makes claims without citing any source, confidence is 0 regardless of `retrieval_score` and `logprob_score`. Coverage is the primary signal — no citations means no verifiable faithfulness.
- **`KnowledgeQuery.confidenceScore` + `confidenceMethod` persistence** — Every query's confidence is reconstructable for audit, debugging, and model-quality monitoring. `confidenceMethod` distinguishes Phase 1 (`coverage_v1`) from Phase 2+ (`coverage_v2_hhem`) — important for comparing model quality across upgrades.
- **`RagResponse.confidence.components` transparency** — The UI may show individual signals ("Coverage: High, Retrieval: Medium, Logprob: N/A") for transparency — the user sees why the overall confidence is what it is.
- **Rejecting full Ragas Python runtime (Option C)** — Python dependency, latency. Ragas is a reference framework; its Faithfulness algorithm is reimplemented locally. The HHEM-2.1-Open variant is the local NLI classifier (no Python) (research §6.4).
- **Rejecting HHEM as Phase 1 must-have (Option D)** — Additional model download; ~50–100 ms latency. Phase 1 uses the local heuristic; Phase 2+ opt-in (research §6.4).

## 6. Consequences

**Positive**:

- `coverage_score` is the primary signal — a lightweight local Ragas-Faithfulness variant, computable in milliseconds.
- Phase 2+ HHEM-2.1-Open upgrade path is reserved — no contract change, just a `method` field change.
- 5-tier label display avoids false precision (risk R-3.4 mitigation).
- Graceful degradation when Ollama logprobs are unavailable (risk R-3.14 mitigation).
- `KnowledgeQuery.confidenceScore` + `confidenceMethod` persistence makes every query's confidence reconstructable for audit.
- `RagResponse.confidence.components` transparency — the UI shows individual signals.
- Consumed by Stream 5 (Agent Runtime) — agents use confidence to decide whether to ask a clarifying question or escalate to a human.

**Negative / obligations**:

- Phase 1 must implement `CoverageConfidence` (Phase 1 local heuristic) — estimated part of the 5–7 days for `OllamaRagGenerator` (research §13.3, ADR-030).
- The 5-tier label thresholds (0.2 / 0.4 / 0.6 / 0.8) are Phase 1 defaults — must be tuned based on real hotel-query evaluation; per-tenant configurable.
- HHEM-2.1-Open is a Phase 2+ model download — `FeatureFlag` gates activation; per-tenant opt-in.
- The 0.5 / 0.3 / 0.2 weights are Phase 1 defaults — must be tuned based on real evaluation; the `RagEvaluator` interface allows per-deployment weight overrides.
- `coverage_score` depends on the LLM emitting `<source>` tags — if the LLM (Phi-3.5-mini) is poor at citation emission, `coverage_score` is unreliable. Mitigation: prompt engineering (ADR-030); evaluate a larger LLM (Qwen2.5-7B).
- `logprob_score` is unavailable for some Ollama models (risk R-3.14) — the UI must distinguish "logprob not available" from "logprob = 0".
- The UI must display the 5-tier label + guidance text — never the raw percentage (risk R-3.4).
- The 5-tier label may be too coarse for some use cases (e.g., "is this answer good enough to auto-apply?") — Phase 2+ may add a continuous-score mode for admin/evaluator use only.
- Confidence score does not capture retrieval recall (did the retriever find the right chunks?) — only faithfulness (does the answer match the retrieved chunks?). Phase 2+ `contextPrecision` (Ragas) addresses recall.
- The `RagEvaluator.evaluate()` method's Phase 2+ `EvalResult` shape (faithfulness, answerRelevancy, contextPrecision) is reserved — Phase 1 implements only `confidence`.

**Dependencies on other ADRs**:

- Depends on ADR-030 (RAG Pipeline) — `RagResponse.confidence: ConfidenceScore` shape; `OllamaRagGenerator` calls `RagEvaluator.evaluate()`; `logprobs: true` on the Ollama call.
- Depends on ADR-032 (Source Attribution & Citation) — `coverage_score` inputs are `citedChunkIds` + `unresolvedCitationChunkIds` from `RagResponse`.
- Depends on ADR-024 (Hybrid Search) — `retrieval_score` uses RRF rank (`k=60`) from `RetrievedChunk.score`.
- Depends on ADR-028 (Knowledge Base Architecture) — `KnowledgeQuery.confidenceScore` + `confidenceMethod` columns.
- Depends on ADR-015 (Local AI Runtime) — Ollama `logprobs: true` support; `LocalLLMRuntime.isAvailable()` fail-closed (ADR-030).
- Depends on ADR-021 (Model Registry) — HHEM-2.1-Open (Phase 2+) is a pinned model registered by SHA256.
- Depends on ADR-020 (Model Licensing) — HHEM-2.1-Open license (Vectara, free, open-source) verified.
- Feeds Stream 5 (Agent Runtime) — `RagResponse.confidence` is what agents use to decide whether to ask a clarifying question or escalate to a human.
- Feeds Stream 8 (Security & Governance) — `KnowledgeQuery.confidenceScore` is an audit signal; very-low-confidence answers may trigger review.
- Compatible with ADR-013 (Observability Strategy) — every confidence-score computation is traced (method, components, latencyMs).

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Phase 2+ HHEM-2.1-Open integration is justified** (real evaluation shows `coverage_v1` heuristic insufficient) — implement `coverage_v2_hhem`; benchmark ~50–100 ms latency on hotel CPU; `FeatureFlag` gate.
2. **5-tier label thresholds prove miscalibrated** (e.g., too many "Very High" answers are wrong) — tune thresholds based on real hotel-query evaluation; per-tenant configurable.
3. **The 0.5 / 0.3 / 0.2 weights prove miscalibrated** — tune based on real evaluation; allow per-deployment weight overrides.
4. **Ollama logprobs become unavailable for the chosen LLM** — confidence score degrades gracefully (drops logprob, renormalizes to 0.7 / 0.3); evaluate alternative confidence signals (multi-sample agreement per LessWrong 2026).
5. **The LLM (Phi-3.5-mini) is poor at `<source>` tag emission** — `coverage_score` is unreliable; evaluate a larger LLM (Qwen2.5-7B per Stream 1); tighten the citation-forcing prompt (ADR-030).
6. **A new faithfulness classifier** (better than HHEM-2.1-Open) becomes available — extend the `RagEvaluator` interface; add as a new `method`.
7. **`contextPrecision` (Ragas) becomes justified** (Phase 2+) — implement retrieval-recall scoring in `EvalResult`.
8. **A continuous-score mode** (for admin/evaluator use) becomes justified — add a `displayMode: 'label' | 'continuous'` to `ConfidenceScore`; restrict continuous mode to admin roles.
9. **The UI 5-tier label proves too coarse** for high-stakes decisions — add a 7-tier or 10-tier label; re-evaluate thresholds.
10. **Annually**, as part of the regular ADR review cycle.
