# ADR-022: Local Embeddings — EmbeddingsRuntime Interface

**ADR-ID:** ADR-022
**Status:** ACCEPTED
**Context:** 2026-08-05
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 2 §II.5) classifies **Local Embeddings** as an "Architecture Contract — NOW" capability. Phase B B4 item #10 confirmed that the SmartAgentics SDK has NO `EmbeddingsRuntime` interface and the existing `AIProvider` interface in `packages/sdk/src/ai/index.ts` exposes only `isAvailable`, `generate`, and `estimateCost` — no `embed()` method. ADR-001 currently defers "Vector search" (and implicitly embeddings) to a later phase, while the Build-vs-Buy Matrix says "Vector Database — pgvector (Phase 2 only if needed)". This is Foundational Conflict FC-2.2 in the Stream 2 research report.

Phase C Stream 1 research (`/home/z/my-project/phase-c-stream1-local-ai-runtime-report.md`) established the contract boundary: SmartAgentics must NEVER link to llama.cpp/Ollama as a library — the contract boundary is the OpenAI-compatible HTTP API (`/v1/embeddings`) and Ollama's compatible `/api/embed` endpoint. Stream 1 explicitly recommended "Nomic Embed (Apache 2.0) as the embedding model for Stream 2". Stream 2 deep-research (`/home/z/my-project/phase-c-stream2-embeddings-retrieval-report.md`, §2) confirmed `nomic-embed-text-v1.5` (Apache 2.0, 768 dim, 8192-token context, 274 MB GGUF, 81M+ Ollama pulls) as the recommended primary embedding model served via Ollama's `/api/embed` HTTP endpoint, with `nomic-embed-text-v2-moe` (multilingual, but 8192→512 context regression) as secondary and `bge-m3` (1024 dim + sparse + ColBERT, ~2.3 GB FP32 / 418 MB Q4_K_M GGUF) as the alternative when multi-vector retrieval is required.

Every downstream Stream 2 capability (VectorStore ADR-023, Hybrid Search ADR-024, Reranker ADR-025, Chunking ADR-026, Multi-Tenant Isolation ADR-027) and every downstream stream (Stream 3 RAG, Stream 5 Agent Runtime, Stream 6 Memory) depends on a stable embedding-vector contract. Without an `EmbeddingsRuntime` interface in Phase 1, every consumer would hard-code to a specific HTTP client (Ollama, OpenAI, Cohere), making model swaps, version pinning, and cloud fallback impossible without rewriting each consumer.

## 2. Problem

The architectural problem: **define an `EmbeddingsRuntime` SDK interface that (a) is the single contract for converting text to vectors, (b) is served over HTTP to preserve swappability and memory isolation (no in-process model loading in the Next.js process), (c) normalizes the divergent response shapes of Ollama's `/api/embed` and OpenAI's `/v1/embeddings` to a single `number[][]`, (d) supports Matryoshka dimension truncation for storage/memory tradeoffs, (e) integrates with the `ModelRegistry` (ADR-021) for version pinning by SHA256, (f) is additive to the existing `AIProvider` interface (no breaking changes to existing `generate()` consumers), and (g) names `nomic-embed-text-v1.5` as the recommended default while reserving the interface for `nomic-embed-text-v2-moe`, `bge-m3`, and cloud embedding APIs (OpenAI, Cohere, Mistral) as fallbacks.** This ADR resolves Foundational Conflict FC-2.2 for the embeddings axis; ADR-001 should be amended separately to separate "implementation deferred" from "architectural contract NOW".

## 3. Options

### Option A: In-process embedding via transformers.js or ONNX Runtime Node.js

Load the embedding model directly into the Next.js process via `@xenova/transformers` (transformers.js) or `onnxruntime-node`. Rejected — (1) breaks the Stream 1 contract boundary ("SmartAgentics must NEVER link to llama.cpp/Ollama as a library; the contract boundary is HTTP"); (2) couples the embedding model lifecycle to the Next.js process lifecycle (model load/unload, RAM pressure, GC pauses inside the web server); (3) loses the single-source-of-truth model registry that Ollama + `ModelRegistry` (ADR-021) provides; (4) every model swap requires shipping a new binary bundle; (5) transformers.js has a smaller model catalog than Ollama and inconsistent quantization support (research §2, "Decision Candidate").

### Option B: Direct library link to Ollama's internal embedding API

Link to Ollama's Go libraries or call Ollama's internal embedding functions. Rejected — Stream 1 explicitly forbids this ("contract boundary is the OpenAI-compatible HTTP API"); Ollama does not expose a stable library ABI; coupling SmartAgentics to Ollama internals would lock out LocalAI / llama-server alternatives (ADR-015).

### Option C: `EmbeddingsRuntime` SDK interface backed by HTTP, with `OllamaEmbeddingsRuntime` as the reference implementation and cloud (OpenAI / Cohere / Mistral) as fallback

Define an `EmbeddingsRuntime` interface in `packages/sdk/src/ai/` that normalizes any HTTP embedding endpoint (Ollama `/api/embed`, OpenAI `/v1/embeddings`, Cohere `/v1/embed`, Mistral `/v1/embeddings`) to a single `number[][]` return type. Reference implementation = `OllamaEmbeddingsRuntime` calling `http://localhost:11434/api/embed`. Recommended default model = `nomic-embed-text-v1.5` at 768 dim. Matryoshka truncation (768→512/256/128/64) is supported via the `dim` option. The application NEVER loads an embedding model in-process for the primary path — always through HTTP, mirroring Stream 1's `LocalLLMRuntime` decision. Per Stream 2 §2.1 "Decision Candidate" and research Foundational Conflict FC-2.2 recommended change #2.

## 4. Decision

Adopt **Option C**. The Local Embeddings architectural contract is:

1. **SDK interface** — An `EmbeddingsRuntime` interface in `packages/sdk/src/ai/embeddings/`:

   ```
   EmbeddingsRuntime {
     embed(texts: string[], options?: EmbedOptions): Promise<number[][]>
     listEmbeddingModels(): Promise<EmbeddingModel[]>
     loadEmbeddingModel(modelId: ModelId, version: Version): Promise<void>
     unloadEmbeddingModel(modelId: ModelId, version: Version): Promise<void>
     health(modelId: ModelId, version: Version): Promise<ModelHealth>
   }

   EmbedOptions {
     dim?: number                  // Matryoshka truncation (768 → 512/256/128/64 for Nomic v1.5)
     normalize?: boolean           // L2 normalize output vectors (default: true)
     modelId?: ModelId             // override the runtime default
     batchSize?: number            // batch size for HTTP calls (default: 32)
   }
   ```

2. **`AIProvider` extension** — Extend the existing `AIProvider` interface with an additive `embed(texts: string[], options?: EmbedOptions): Promise<number[][]>` method. Existing `generate()` consumers are unaffected (additive change). `EmbeddingsRuntime` is a sibling sub-interface — implementations MAY implement both `AIProvider` and `EmbeddingsRuntime` (e.g., `OpenAIEmbeddingsRuntime` also implements `generate()`), or only `EmbeddingsRuntime` (e.g., `OllamaEmbeddingsRuntime` when Ollama is used solely for embeddings).

3. **Reference implementation** — `OllamaEmbeddingsRuntime` in `packages/sdk/src/ai/embeddings/ollamaEmbeddingsRuntime.ts`:
   - Calls `POST http://localhost:11434/api/embed` with `{ model: "nomic-embed-text", input: texts[], options: { ... } }`.
   - Normalizes Ollama's response shape `{ embeddings: [[...]] }` to `number[][]`.
   - Batches inputs to respect Ollama's request size limits (default 32 texts per call).
   - Throws typed errors: `EmbeddingsRuntimeUnavailableError`, `EmbeddingModelNotLoadedError`, `EmbeddingDimensionMismatchError`.

4. **Recommended default model** — `nomic-embed-text-v1.5` (Apache 2.0, 768 dim, 8192-token context, 274 MB GGUF). Served via `ollama pull nomic-embed-text`. Pinned by SHA256 via `ModelRegistry` (ADR-021) — floating `:latest` tags are NEVER used as the registry key.

5. **Secondary model (multilingual)** — `nomic-embed-text-v2-moe` (Apache 2.0, 768→256 Matryoshka, 512-token context — **regression from v1.5's 8192**). Use ONLY when deployment language is non-English or mixed. The 512-context regression forces more aggressive chunking (ADR-026). Triggered by a `multilingual: boolean` flag in `ModelRegistry` and the hotel onboarding wizard's "primary language" question.

6. **Alternative model (multi-vector)** — `bge-m3` (MIT, 1024 dim + sparse + ColBERT, 8192 context, 418 MB Q4_K_M GGUF). Reserved for Phase 3+ when dense+sparse+ColBERT multi-vector retrieval is required. The `VectorStore` interface (ADR-023) reserves the ability to store multi-vector outputs but Phase 1 implementation is single-vector dense only.

7. **Cloud fallback runtimes** — `OpenAIEmbeddingsRuntime` (`POST https://api.openai.com/v1/embeddings`, normalizes `{ data: [{ embedding: [...] }] }` to `number[][]`), `CohereEmbeddingsRuntime`, `MistralEmbeddingsRuntime`. Used when (a) Ollama is unavailable (offline failure → cloud fallback per ADR-001's optional cloud AI fallback), OR (b) a deployment explicitly chooses cloud embeddings. Cloud runtimes are NEVER the primary path for offline-first deployments.

8. **Matryoshka dimension policy** — Default `dim = 768` (full precision for Nomic v1.5). Storage-optimized deployments MAY set `dim = 256` or `dim = 128` for long-term memory (Stream 6) to reduce vector storage 3–6× at the cost of small recall degradation. The `dim` value is recorded as metadata on every `vec_chunks` row (ADR-023) so re-embedding is detectable when `dim` changes.

9. **Model versioning** — Every embedding call records `embedding_model_id` and `embedding_version` (per ADR-018) on the resulting vector rows. When Nomic releases v1.6 (or SmartAgentics upgrades to v2-moe), a background re-embedding job scans chunks with stale `embedding_model_id`/`embedding_version` and re-embeds them. Old vectors are retained until re-embedding completes (per research Open Question #7).

10. **No schema change required in Phase 1** — The `EmbeddingsRuntime` interface produces `number[][]`; persistence is owned by the `VectorStore` (ADR-023). The `Model` table (ADR-021) already accommodates embedding models via `modelType = "embeddings"`. This is purely an additive SDK interface change.

## 5. Rationale

- **HTTP transport (not in-process)** preserves the Stream 1 contract boundary — Ollama owns model loading, RAM, and lifecycle; SmartAgentics owns the request/response contract. In-process loading (Option A) breaks memory isolation and ties model lifecycle to the Next.js process (research §2.1, "Decision Candidate": "the application must NEVER embed directly via transformers.js or ONNX runtime in-process for the primary path — always through HTTP, to preserve swappability and to keep model loading outside the Next.js process").
- **`nomic-embed-text-v1.5` as default** — Satisfies every Stream 2 evaluation criterion: offline-first (Ollama), Windows/local (native installer, single GGUF blob), SQLite compatibility (vectors stored as 768-float BLOBs), LAN operation (Ollama bindable to `0.0.0.0:11434`), Apache 2.0 license (commercial use + redistribution), 274 MB fits 4 GB RAM hotel workstation, 8192-token context fits most hotel policy documents in a single chunk, 81M+ Ollama pulls (production-validated), top-tier MTEB for sub-200M models (research §2.1 "Inference").
- **Matryoshka dimension support** — Nomic v1.5 is trained with Matryoshka Representation Learning, allowing 768→512/256/128/64 truncation without retraining. This gives downstream systems (Stream 6 Memory, Stream 5 Agent Runtime) a storage/precision knob without changing the embedding model.
- **8192-token context (vs 512 for v2-MoE)** — Hotel policy documents often run multi-page; 8192 context fits most sections in a single chunk, materially simplifying chunking (ADR-026). v2-MoE's 512-context regression is a deal-breaker for English-default deployments (research §2.2).
- **`bge-m3` reserved for Phase 3+** — Triple-vector (dense + sparse + ColBERT) retrieval is powerful but adds 4× inference cost, 4× storage cost, and operational complexity. Phase 1's Nomic + FTS5 hybrid (ADR-024) achieves 0.80–0.90 recall@5 without multi-vector overhead (research §2.3).
- **Cloud fallback reserved** — OpenAI / Cohere / Mistral embedding APIs are cloud-only (proprietary licenses). They violate the offline-first mandate as primary path but are valid fallbacks when (a) Ollama is unavailable, or (b) a cloud-only deployment explicitly chooses them. The interface contract normalizes their divergent response shapes to `number[][]` (research §2.1 risk: "Ollama's `/api/embed` vs OpenAI's `/v1/embeddings` differ in shape — Ollama returns `{embeddings: [[...]]}` while OpenAI returns `{data: [{embedding: [...]}]}`. Mitigation: SDK `EmbeddingsRuntime` interface normalizes both to `number[][]`").
- **Additive to `AIProvider`** — Existing `generate()` consumers are unaffected; `embed()` is additive. New `EmbeddingsRuntime` sibling interface is purely additive. Migration impact: "None for existing code (no breaking changes)" (research §14 FC-2.2).
- **Pinning by SHA256 via `ModelRegistry`** — Ollama's `:latest` tag for `nomic-embed-text` re-points across releases. The `ModelRegistry` (ADR-021) pins specific SHA256 digests; `EmbeddingsRuntime.loadEmbeddingModel(modelId, version)` resolves to a specific pinned manifest, never to a floating tag.
- **Rejecting in-process (Option A)** — breaks Stream 1 contract boundary, couples model lifecycle to Next.js, loses `ModelRegistry` as single source of truth.
- **Rejecting library link (Option B)** — Stream 1 explicitly forbids; no stable Ollama library ABI; locks out LocalAI / llama-server alternatives.

## 6. Consequences

**Positive**:

- Single contract for text→vector conversion — every downstream consumer (VectorStore ADR-023, Hybrid Retriever ADR-024, Stream 3 RAG, Stream 5 Agent Runtime, Stream 6 Memory) programs against `EmbeddingsRuntime`, not against hardcoded Ollama/OpenAI HTTP clients.
- HTTP transport preserves memory isolation — Next.js process never loads the 274 MB model; Ollama owns the RAM.
- Matryoshka dimension knob enables per-use-case storage/precision tradeoffs (768 for retrieval, 256 for memory).
- Cloud fallback (OpenAI / Cohere / Mistral) is a behind-the-interface swap — application code unchanged when Ollama is unavailable.
- Additive to `AIProvider` — no breaking changes to existing `generate()` consumers.
- Resolves Foundational Conflict FC-2.2 for the embeddings axis.

**Negative / obligations**:

- Phase 1 must include the `EmbeddingsRuntime` interface and the `OllamaEmbeddingsRuntime` reference implementation — estimated 2–3 days of Phase E engineering (research §2.1 "Impact on Phase 1").
- HTTP transport adds ~5–15 ms per 512-token text on commodity CPUs (Nomic's published benchmarks). For batch ingestion of 10K chunks, this is ~2–5 minutes — acceptable but must be batched (default `batchSize: 32`).
- Ollama must be installed and running for the primary path. Hotel IT must run `ollama pull nomic-embed-text` during onboarding (mitigated by ADR-021 `register()` + ADR-019 lifecycle automation).
- Multilingual deployments require either (a) accepting `nomic-embed-text-v2-moe`'s 512-token context with more aggressive chunking, or (b) deploying `bge-m3` (418 MB Q4_K_M, 1.5 GB inference RAM). Either is a heavier operational footprint than the English-default path.
- Re-embedding on model upgrade is a background job that must be monitored (research Open Question #7).
- Cloud fallback runtimes (OpenAI/Cohere/Mistral) require API keys and network egress — must be opt-in, never silent.

**Dependencies on other ADRs**:

- Depends on ADR-015 (Local AI Runtime) — Ollama is the runtime serving `/api/embed`.
- Depends on ADR-021 (Model Registry) — `loadEmbeddingModel(modelId, version)` resolves to a `ModelRegistry` entry pinned by SHA256.
- Depends on ADR-018 (Model Versioning) — `embedding_model_id` + `embedding_version` per ADR-018 vocabulary.
- Depends on ADR-019 (Model Lifecycle) — `loadEmbeddingModel`/`unloadEmbeddingModel` follow the ADR-019 state machine.
- Depends on ADR-020 (Model Licensing) — `nomic-embed-text-v1.5` (Apache 2.0), `nomic-embed-text-v2-moe` (Apache 2.0), `bge-m3` (MIT) all pass the ADR-020 acceptability filter.
- Depends on ADR-016 (Hardware Capability Detection) — embedding model choice (v1.5 vs v2-moe vs bge-m3) is gated by `HardwareProfile` (RAM, CPU).
- Feeds ADR-023 (Vector Store) — `embed()` output is the input to `VectorStore.upsert()`.
- Feeds ADR-024 (Hybrid Search) — `embed(query)` is the semantic half of hybrid retrieval.
- Compatible with ADR-013 (Observability Strategy) — every `embed()` call is traced (model, dim, latency, token count).
- ADR-001 should be amended separately to separate "implementation deferred" from "architectural contract NOW" (research §14 FC-2.1 recommended change #1).

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Nomic releases a v1.6 (or later) embedding model** — re-evaluate default; the v1.5→v1.6 upgrade path requires the re-embedding background job.
2. **A hotel deployment requires multilingual embeddings** — finalize the `nomic-embed-text-v2-moe` vs `bge-m3` decision for the multilingual secondary path (the 512-context regression in v2-MoE may force `bge-m3` as the multilingual default instead).
3. **Ollama adds native reranker support** (research Open Question #4) — re-evaluate whether `EmbeddingsRuntime` and a future `Reranker` runtime (ADR-025) should share a transport or remain separate.
4. **`bge-m3` multi-vector retrieval is needed** (Phase 3+) — extend `EmbedOptions` to return `{ dense: number[], sparse: ..., colbert: number[][] }` and extend `VectorStore` (ADR-023) to store multi-vector outputs.
5. **A new embedding model** (e.g., a future OpenAI text-embedding-4, Cohere Embed 5) becomes relevant — extend the cloud fallback runtimes.
6. **Matryoshka truncation causes measurable recall degradation** in production — re-evaluate the default `dim` for high-precision use cases.
7. **HTTP transport latency becomes a bottleneck** for batch ingestion (>10 minutes for 10K chunks) — evaluate optional in-process batching via transformers.js as a non-default optimization (would require an ADR amendment).
8. **LAN-shared Ollama authentication** is specified by Stream 8 (AI Security) — extend `EmbeddingsRuntime` with authentication options (research Open Question #8).
9. **Annually**, as part of the regular ADR review cycle.
