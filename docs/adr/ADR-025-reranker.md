# ADR-025: Reranker — NoOp Phase 1, BGE Phase 2+

**ADR-ID:** ADR-025
**Status:** ACCEPTED
**Context:** 2026-08-05
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 2 §II.6) classifies **Local RAG** as an "Architecture Contract — NOW" capability, implicitly including the retrieval pipeline that reranking refines. Phase B B4 item #12 confirmed that SmartAgentics has no `Reranker` interface. Reranking is the optional post-fusion stage of the retrieval pipeline: after `Retriever.retrieve()` (ADR-024) produces a fused ranked list via BM25 + vector + RRF, a reranker applies a more expensive cross-encoder to re-score the top candidates for higher precision.

Phase C Stream 2 research (`/home/z/my-project/phase-c-stream2-embeddings-retrieval-report.md`, §8) surveyed reranking options and concluded:

- **For Phase 1**, hybrid search alone (BM25 + vector + RRF) typically achieves recall@5 of 0.80–0.90 on domain-specific corpora — sufficient for hotel-policy Q&A without reranking. Adding a cross-encoder reranker in Phase 1 would add 50–200 ms latency per query on CPU and require a 570 MB model (`bge-reranker-v2-m3` int8 ONNX) that may not fit low-RAM hotel workstations — unjustified cost for Phase 1 corpus sizes and recall targets.
- **For Phase 2+**, when (a) the LLM context window is small (need to pass only top-3 chunks instead of top-10), OR (b) retrieval quality from hybrid search is measured to be insufficient (e.g., recall@5 < 0.85 on a hotel-policy evaluation set), a cross-encoder reranker lifts recall@5 to 0.90–0.95 — a marginal but worthwhile improvement.
- **Recommended Phase 2+ reranker**: `bge-reranker-v2-m3` (568M params, ~570 MB as int8 ONNX, multilingual, BAAI MIT-style license) — the natural reranker companion to `bge-m3` embeddings (ADR-022 alternative). Cross-encoder latency 50–200 ms per 20 candidates on CPU.
- **Rejected**: LLM-based reranking (4–6 seconds latency, cloud-only in practice — incompatible with offline mandate); Cohere Rerank 3 / Rerank 3 Nimble (cloud-only, $2/1M tokens); ms-marco-MiniLM cross-encoders (English-only, lower accuracy — alternative only for tight RAM English-only deployments).

The `Retriever` (ADR-024) calls `Reranker.rerank()` after hybrid fusion, before returning to the caller. This ADR defines the `Reranker` contract and the phased activation strategy: `NoOpReranker` is the Phase 1 default; `BgeRerankerV2M3Reranker` is the Phase 2+ upgrade — both implement the same interface, so activation is a behind-the-interface swap.

## 2. Problem

The architectural problem: **define a `Reranker` SDK interface that (a) is the single contract for post-fusion candidate re-scoring, (b) defaults to `NoOpReranker` (passthrough) in Phase 1 to avoid premature latency / model-size commitments, (c) reserves `bge-reranker-v2-m3` (ONNX int8, in-process) as the Phase 2+ implementation, (d) is invoked by the `Retriever` (ADR-024) after hybrid fusion and before parent-child expansion, (e) caps the rerank batch at 20 candidates (the cross-encoder latency sweet spot), (f) integrates with `ModelRegistry` (ADR-021) for version pinning, and (g) introduces NO new runtime dependencies in Phase 1 (`onnxruntime-node` is Phase 2+ only).** This ADR reserves the reranker contract in Phase 1 so that Phase 2+ activation requires no architectural change — only a behind-the-interface implementation swap.

## 3. Options

### Option A: LLM-based reranking (GPT-4o-mini, local LLM listwise reranking)

Use a generative LLM to score or listwise-rerank the top candidates. Rejected — (1) 4–6 seconds latency per query (ZeroEntropy benchmark) is unacceptable for hotel PMS Q&A; (2) cloud-only in practice (local LLM reranking would compete with the actual answer-generation LLM for RAM); (3) research §8.4 confirms "LLM-based reranking can sometimes provide 5-8% higher accuracy over listwise reranking tasks but adds 4-6 seconds of latency compared to cross-encoders" — the latency/accuracy tradeoff is wrong for Phase 1 or Phase 2+ hotel PMS.

### Option B: Cross-encoder reranker in Phase 1 (`bge-reranker-v2-m3` int8 ONNX)

Ship `bge-reranker-v2-m3` (570 MB int8 ONNX) as the Phase 1 default reranker. Rejected — (1) 570 MB model may not fit low-RAM (4 GB) hotel workstations alongside the embedding model (274 MB) and the answer-generation LLM; (2) 50–200 ms per query is unjustified when hybrid search alone achieves recall@5 of 0.80–0.90 on Phase 1 corpus sizes; (3) `onnxruntime-node` is a non-trivial native dependency — adding it to Phase 1 increases the install / Windows-binary footprint; (4) research §8.1 explicitly recommends "Skip reranking in Phase 1. Reserve the `Reranker` interface in the SDK; add a `BgeReranker` implementation in Phase 2+."

### Option C: `NoOpReranker` default in Phase 1; `bge-reranker-v2-m3` (ONNX int8) in Phase 2+

Define a `Reranker` interface with two implementations: `NoOpReranker` (passthrough — returns candidates unchanged) is the Phase 1 default; `BgeRerankerV2M3Reranker` (568M-param cross-encoder, ONNX int8, in-process via `onnxruntime-node`) is the Phase 2+ upgrade. The `Retriever` (ADR-024) calls `reranker.rerank()` after fusion; in Phase 1 the call is a no-op. Activation in Phase 2+ is a behind-the-interface swap — no architectural change. Per research §8.2 "Decision Candidate" and §8.1 "Recommendation".

### Option D: Cohere Rerank 3 / Rerank 3 Nimble (cloud API)

Use Cohere's hosted rerank API. Rejected — cloud-only, $2/1M tokens, incompatible with offline mandate (research §8.2 "Rejected alternatives").

### Option E: ms-marco-MiniLM cross-encoders (English-only, ~80 MB)

Use `cross-encoder/ms-marco-MiniLM-L6-v2`. Rejected as default — English-only, MS MARCO-trained, lower accuracy than `bge-reranker-v2-m3` on modern benchmarks. Suitable only as a Phase 2+ alternative for English-only deployments with tight RAM constraints (research §8.3).

## 4. Decision

Adopt **Option C**. The Reranker architectural contract is:

1. **SDK interface** — A `Reranker` interface in `packages/sdk/src/ai/reranker/`:

   ```
   Reranker {
     rerank(query: string, candidates: ScoredChunk[], options?: RerankOptions): Promise<ScoredChunk[]>
     health?(): Promise<ModelHealth>
   }

   RerankOptions {
     topK?: number                  // number of candidates to return (default: candidates.length)
     batchSize?: number             // ONNX inference batch size (default: 20)
     minScore?: number              // drop candidates below this score (default: -Infinity)
   }
   ```
   - Input: `query` string + `candidates` array of `ScoredChunk` (from `Retriever.retrieve()` post-fusion, pre-expansion).
   - Output: re-scored `ScoredChunk[]` sorted descending by reranker score; length = `min(topK, candidates.length)`.
   - The reranker MUST NOT introduce new candidates — it only re-orders and filters the input list.

2. **Phase 1 default = `NoOpReranker`** — In `packages/sdk/src/ai/reranker/noOpReranker.ts`. Returns `candidates` unchanged (sorted by the original `score` from `Retriever`). The `Retriever` is wired with `NoOpReranker` by default in Phase 1. No ONNX dependency in Phase 1.

3. **Phase 2+ upgrade = `BgeRerankerV2M3Reranker`** — In `packages/sdk/src/ai/reranker/bgeRerankerV2M3.ts`:
   - Model: `bge-reranker-v2-m3` (568M params, multilingual, BAAI MIT-style license — consistent with `bge-m3` embedding model, ADR-022 alternative).
   - Deployment form: ONNX int8 (~570 MB) via `onnxruntime-node` for in-process CPU inference.
   - Inference: cross-encoder scores each `(query, candidate.text)` pair jointly (vs. bi-encoders which embed query and document separately). Cross-encoders are 5–10% more accurate than bi-encoders on retrieval but 100× slower per pair — rerank only the top-20 hybrid-search results, not the entire corpus (research §8.2).
   - Latency budget: 50–200 ms per 20 candidates on commodity CPU (research §8.2). Acceptable in Phase 2+; not in Phase 1.
   - Pinned by SHA256 via `ModelRegistry` (ADR-021).

4. **Invocation by `Retriever`** — Per ADR-024, the `Retriever.retrieve()` flow is:

   ```
   1. Semantic retriever: embed(query) → VectorStore.query → top k*2
   2. Keyword retriever: FTS5 MATCH → top k*2
   3. RRF fusion → top k*2 candidates (deduped)
   4. Reranker.rerank(query, candidates, { topK: k }) → top k         [Phase 1: NoOp; Phase 2+: BGE]
   5. Parent-child expansion → fetch parent chunks for top k          [if expandParent: true]
   6. Return top k ScoredChunks (parent chunks with child-chunk scores)
   ```

   The reranker runs AFTER fusion but BEFORE parent-child expansion — so the reranker sees child chunks (precise embeddings), and parent expansion fetches context only for the final top-k.

5. **Rerank batch cap** — The reranker MUST cap the input `candidates` array at 20 (the cross-encoder latency sweet spot per research §8.2). If fusion returns more than 20, truncate to top-20 by RRF score before reranking. If `k < 20`, the reranker still scores all 20 but returns only top `k`.

6. **Conditional activation** — The reranker SHOULD skip execution (return candidates unchanged) when:
   - `candidates.length < 10` — reranking adds latency without meaningful precision gain on small candidate sets.
   - The runtime is `NoOpReranker` (Phase 1 default) — always passthrough.
   - The deployment's `HardwareProfile` (ADR-016) does not meet the reranker model's `hardwareRequirements` — fall back to `NoOpReranker` with a warning log.

7. **ONNX runtime transport** — `bge-reranker-v2-m3` is loaded in-process via `onnxruntime-node` (NOT via Ollama — as of late 2025, Ollama does not natively serve rerankers; research §8.2 risk: "Ollama does not natively serve rerankers. Mitigation: use ONNX runtime in-process; or use LocalAI"). Re-evaluate the transport when Ollama adds native rerank endpoint support (research Open Question #4).

8. **`ms-marco-MiniLM-L6-v2` reserved** — Alternative for English-only deployments with tight RAM constraints (~80 MB vs 570 MB). Listed in `ModelRegistry` as supported-but-not-default. Activation requires an explicit `Reranker` implementation class `MsMarcoMiniLMReranker` (Phase 2+, optional).

9. **No schema change** — The `Reranker` operates on `ScoredChunk[]` in memory; no persistence. The `Model` table (ADR-021) accommodates reranker models via `modelType = "reranking"`. Purely additive SDK interface.

## 5. Rationale

- **Phase 1 NoOp is correct** — Hybrid search alone achieves recall@5 of 0.80–0.90 on domain-specific corpora (research §8.1). Reranking lifts this to 0.90–0.95 — a marginal improvement that does not justify 50–200 ms latency + 570 MB model + ONNX dependency in Phase 1. Research §8.1: "For Phase 1, hybrid search alone typically achieves recall@5 of 0.80–0.90 on domain-specific corpora — sufficient for hotel-policy Q&A. Reranking lifts this to 0.90–0.95 — a marginal improvement that does not justify the latency in Phase 1."
- **Phase 2+ BGE is the natural upgrade** — `bge-reranker-v2-m3` is the natural reranker companion to `bge-m3` embeddings (ADR-022 alternative). 568M-param cross-encoder, multilingual (matches `bge-m3` language coverage), BAAI MIT-style license (consistent with `bge-m3`), 5–10% more accurate than bi-encoders (research §8.2).
- **Cross-encoder > bi-encoder for reranking** — Cross-encoders score query-document pairs jointly (vs. bi-encoders which embed query and document separately). 100× slower per pair but materially more accurate. The tradeoff: rerank only the top-20, not the entire corpus (research §8.2).
- **ONNX int8 transport** — 570 MB int8 ONNX (vs 2.3 GB FP32 source) fits 4 GB RAM with reduced headroom. `onnxruntime-node` is the standard Node.js ONNX runtime. In-process — no separate server. Re-evaluate when Ollama adds native rerank support (research §8.2 risk).
- **Interface reservation** — Defining the `Reranker` interface in Phase 1 with `NoOpReranker` default means Phase 2+ activation is a behind-the-interface swap. No architectural change required — only wiring `BgeRerankerV2M3Reranker` as the default in the `Retriever` factory.
- **Batch cap at 20** — Cross-encoder latency sweet spot per research §8.2: "only rerank if hybrid search returned ≥10 candidates; cap rerank batch at 20."
- **Rejecting LLM-based reranking (Option A)** — 4–6 seconds latency is unacceptable; cloud-only in practice (research §8.4).
- **Rejecting cross-encoder in Phase 1 (Option B)** — unjustified latency + model size + ONNX dependency for Phase 1 corpus sizes and recall targets (research §8.1).
- **Rejecting Cohere Rerank (Option D)** — cloud-only; incompatible with offline mandate (research §8.2).
- **Reserving ms-marco-MiniLM (Option E)** — English-only, lower accuracy; alternative only for tight-RAM English-only deployments (research §8.3).
- **Pinning by SHA256 via `ModelRegistry`** — `bge-reranker-v2-m3` ONNX int8 model is pinned by SHA256 in the `ModelRegistry` (ADR-021). Floating tags are never used.

## 6. Consequences

**Positive**:

- Single contract for post-fusion reranking — `Retriever` (ADR-024) programs against `Reranker`, not against `onnxruntime-node` or Ollama rerank APIs directly.
- Phase 1 ships with zero reranker latency / model / dependency — `NoOpReranker` is passthrough.
- Phase 2+ activation is a behind-the-interface swap — no architectural change, no breaking changes to `Retriever` consumers.
- `bge-reranker-v2-m3` is multilingual — matches `bge-m3` embedding model language coverage (ADR-022 alternative).
- BAAI MIT-style license — passes ADR-020 acceptability filter.
- Pinned by SHA256 via `ModelRegistry` (ADR-021) — reproducible deployments.

**Negative / obligations**:

- Phase 1 must include the `Reranker` interface + `NoOpReranker` implementation — estimated 0.5 day of Phase E engineering (research §8.1 "Impact on Phase 1: Interface only; `NoOpReranker` is the default. No ONNX dependency in Phase 1.").
- Phase 2+ must add `onnxruntime-node` dependency, `bge-reranker-v2-m3` ONNX int8 model (~570 MB) to the `ModelRegistry`, and `BgeRerankerV2M3Reranker` implementation — estimated 3–5 days of Phase 2 engineering.
- 570 MB model may not fit 4 GB RAM hotel workstations alongside embedding model (274 MB) and answer-generation LLM — `HardwareProfile` (ADR-016) gating is mandatory; fall back to `NoOpReranker` with warning when RAM is insufficient (research risk R-2.10).
- 50–200 ms per query latency — must be measured in Phase 2+ PoC on hotel-grade CPU; if unacceptable, fall back to `NoOpReranker` or `MsMarcoMiniLMReranker` (80 MB, faster, English-only).
- Ollama does not natively serve rerankers (as of late 2025) — `onnxruntime-node` in-process is the transport. Re-evaluate when Ollama adds native rerank support (research risk R-2.12, Open Question #4).
- Reranker activation must be conditional — skip when `candidates.length < 10` (no precision gain on small sets).
- Reranker sees child chunks (pre-expansion) — if the chunk text is too short for the cross-encoder to score meaningfully, reranker quality degrades. Mitigation: chunker (ADR-026) targets 800–1200 chars per child chunk.

**Dependencies on other ADRs**:

- Depends on ADR-024 (Hybrid Search) — `Retriever` invokes `Reranker.rerank()` after fusion.
- Depends on ADR-021 (Model Registry) — `bge-reranker-v2-m3` ONNX int8 model registered with `modelType = "reranking"`, pinned by SHA256.
- Depends on ADR-018 (Model Versioning) — `version` + `compatibility` per ADR-018 vocabulary.
- Depends on ADR-019 (Model Lifecycle) — load/unload follows the ADR-019 state machine.
- Depends on ADR-020 (Model Licensing) — BAAI MIT-style license passes the acceptability filter.
- Depends on ADR-016 (Hardware Capability Detection) — `BgeRerankerV2M3Reranker` activation is gated by `HardwareProfile` (RAM).
- Depends on ADR-026 (Document Chunking) — reranker scores child-chunk text; chunk size affects reranker quality.
- Compatible with ADR-013 (Observability Strategy) — `rerank()` calls are traced (model, candidate count, latency, score distribution).
- ADR-015 (Local AI Runtime) — if Ollama adds native rerank endpoint support, `OllamaRerankerRuntime` may become a sibling implementation; deferred to a future ADR amendment.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Retrieval quality on a hotel-policy evaluation set is measured to be insufficient** (recall@5 < 0.85 with hybrid search alone) — activate `BgeRerankerV2M3Reranker` (Phase 2+); re-measure recall@5.
2. **Ollama adds native rerank endpoint support** (research Open Question #4) — re-evaluate transport: Ollama HTTP vs ONNX in-process. If Ollama-native, define `OllamaRerankerRuntime` and deprecate `onnxruntime-node` dependency.
3. **`bge-reranker-v2-m3` 570 MB int8 model does not fit target hotel hardware** (4 GB RAM workstations) — fall back to `MsMarcoMiniLMReranker` (80 MB, English-only) or stay on `NoOpReranker` for low-RAM deployments.
4. **Reranker latency exceeds 200 ms per 20 candidates on hotel-grade CPU** — re-evaluate batch cap, model size, or fall back to `NoOpReranker`.
5. **A new reranker model** (e.g., `bge-reranker-v3`, or a future Cohere Rerank 5 with offline distribution) becomes relevant — extend the implementation roster behind the same interface.
6. **LLM-based reranking becomes viable offline** (e.g., a future local LLM with sub-1s listwise reranking) — re-evaluate Option A.
7. **Reranker activation changes the `Retriever` fusion-vs-rerank tradeoff** — re-evaluate whether RRF `k * 2` candidate count (ADR-024) is the right reranker input size.
8. **A new model type** (e.g., vision reranker for multimodal RAG) becomes relevant — extend the `Reranker` interface or define a sibling `MultiModalReranker`.
9. **Annually**, as part of the regular ADR review cycle.
