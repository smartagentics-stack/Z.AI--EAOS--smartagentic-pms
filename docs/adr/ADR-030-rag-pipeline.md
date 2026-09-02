# ADR-030: RAG Pipeline

**ADR-ID:** ADR-030
**Status:** ACCEPTED
**Context:** 2026-08-06
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §8) classifies **Local RAG** as an "Architecture Contract — NOW" capability (Phase B B4 item #12). Stream 2 defined the retrieval layer — `Retriever` (BM25 via FTS5 + vector via sqlite-vec + RRF k=60 fusion per ADR-024), `Reranker` (ADR-025, Phase 2+), `Chunker` (markdown-aware recursive + parent-child per ADR-026) — and explicitly reserved the `DocumentIngester` and generation-layer contracts for Stream 3 to specify fully (research §1.2).

Phase C Stream 3 research (`/home/z/my-project/phase-c-stream3-offline-knowledge-report.md`, §4) defined the end-to-end RAG pipeline as two distinct phases: **ingest** (owned by ADR-028/029/034) and **query** (owned by this ADR). The query phase is: RBAC context attached → optional query rewrite (Phase 2+) → query embedding via Stream 2's `EmbeddingsRuntime` → hybrid retrieval via Stream 2's `Retriever` → optional rerank via Stream 2's `Reranker` (Phase 2+) → citation-forcing prompt construction → call Stream 1's `LocalLLMRuntime` (Ollama HTTP API at `http://localhost:11434/v1/chat/completions`) → post-process LLM output (parse `<source>` tags, resolve `chunkId`s, strip tags, render citations) → compute confidence score (ADR-033) → persist `KnowledgeQuery` + `KnowledgeCitation` rows (ADR-028/032) → stream answer + citations to UI.

Evidence (research §4.2): Premai (2026) confirms "Reranking is the single highest-ROI addition to a basic RAG pipeline" — supports Stream 2's Phase 2+ reranker sequencing. The canonical RAG flow (ingest → chunk → embed → vector-search → rerank → LLM → answer) is documented in multiple sources (Derrick Ryan Giggs, Zachary Proser). Air-gapped local RAG via Ollama is documented and proven (Medium rahasak, LocalAI Master). The LlamaIndex "silent OpenAI fallback" report (Reddit r/LocalLLaMA) is a real production hazard — justifies SmartAgentics owning the abstraction rather than depending on LlamaIndex (see ADR-037).

## 2. Problem

The architectural problem: **define a `RagGenerator` SDK interface and end-to-end query pipeline that (a) consumes Stream 1's `LocalLLMRuntime` (Ollama HTTP API, never links to llama.cpp/Ollama as a library — ADR-015), (b) consumes Stream 2's `EmbeddingsRuntime` + `Retriever` (BM25 + vector + RRF k=60) + optional `Reranker` (Phase 2+), (c) attaches RBAC context (`tenantId` + `propertyIds[]` + `departments[]` + `aclRoles[]`) on every retrieval call — no unscoped retrieval path (ADR-027/031), (d) uses a citation-forcing prompt template that requires inline `<source chunk_id="..."/>` tags for every claim (ADR-032), (e) post-processes LLM output to parse `<source>` tags, resolve `chunkId`s to `(docId, docVersion, headerPath, sourcePath, pageNumber)`, strip tags from displayed answer, and emit a structured `citations[]` array + `unresolvedCitationChunkIds[]` (hallucination defense — ADR-032), (f) computes a confidence score via `RagEvaluator` (ADR-033), (g) persists `KnowledgeQuery` + `KnowledgeCitation` rows for auditability (ADR-028/032), (h) optionally populates `SemanticCacheEntry` (existing table) when confidence > threshold, (i) is fail-closed on `LocalLLMRuntime.isAvailable()` — never silently falls back to a cloud LLM (research risk R-3.7), (j) supports streaming answer + citations to the UI, (k) keeps end-to-end latency within the 3–8 second typical budget on hotel hardware (research §4.4), and (l) is owned by Stream 3 and consumed by Stream 5 (Agent Runtime) as a tool.** This ADR defines the generation-layer contract; retrieval is owned by ADR-024; source attribution by ADR-032; confidence scoring by ADR-033; framework policy by ADR-037.

## 3. Options

### Option A: LangChain.js / LlamaIndex.TS as the runtime RAG orchestrator

Adopt LangChain.js or LlamaIndex.TS as the runtime RAG chain/retrieval/generation framework. Rejected — research §4.3 and ADR-037: heavy dependency trees, frequent breaking changes, and the documented "silent OpenAI fallback" hazard (Reddit r/LocalLLaMA LlamaIndex report — "If you are building a Local-First RAG using LlamaIndex, double-check your dependency injections right now. There is a silent fallback mechanism [to OpenAI]"). For an offline Windows installer, this hazard is unacceptable. SmartAgentics should own a thin abstraction. `@langchain/textsplitters` is the only LangChain-family runtime dependency (ADR-037).

### Option B: AnythingLLM / RAGFlow as an embedded runtime

AnythingLLM is a GUI app (not a library); bundles LanceDB. RAGFlow is server-based. Both rejected — research §3.5: AnythingLLM is "useful inspiration for the workspace concept but not embeddable inside SmartAgentics' Next.js process"; RAGFlow is "server-based, not embedded-friendly."

### Option C: Cloud LLM fallback (OpenAI/Anthropic) when local LLM is busy or low-quality

Allow the `RagGenerator` to fall back to a cloud LLM API when the local Ollama runtime is unavailable or when the local model quality is insufficient. **Rejected** — violates the offline-first principle and the AI-BOS "Local AI — NOW" directive. Research risk R-3.7: "LLM silent fallback to OpenAI if Ollama is down (LlamaIndex-style hazard)" — likelihood Low but impact High. SmartAgentics owns the abstraction; no framework that auto-falls-back; explicit `runtime.isAvailable()` check before each call; **fail-closed** (return error, never silently call cloud).

### Option D: Custom RAG pipeline orchestration with no LLM (extractive summarization only)

Skip the LLM generation step; return concatenated chunk text as the "answer." Rejected — does not meet the AI-BOS directive's "Local RAG — NOW" requirement for natural-language answers. Extractive summarization is a fallback mode if the LLM is unavailable, but not the default.

### Option E: Thin SmartAgentics-owned `RagGenerator` orchestrating Stream 1 LLM + Stream 2 retrieval + citation-forcing prompt + post-processor

A `RagGenerator` interface in `packages/sdk/src/ai/knowledge/` with a reference implementation (`OllamaRagGenerator`) that calls Ollama directly via the OpenAI-compatible HTTP API, builds a citation-forcing prompt, post-processes `<source>` tags, resolves `chunkId`s, computes confidence (ADR-033), and persists `KnowledgeQuery` + `KnowledgeCitation` rows. ~500-line TypeScript module. Per research §4.1, §4.3, §13.1.

## 4. Decision

Adopt **Option E**. The RAG Pipeline architectural contract is:

1. **SDK interface** — `RagGenerator` in `packages/sdk/src/ai/knowledge/generator/RagGenerator.ts` (research §10):

   ```
   RagGenerator {
     generate(request: RagRequest): Promise<RagResponse>;
   }

   RagRequest {
     query: string;
     retrievedChunks: RetrievedChunk[];
     systemPromptOverride?: string;
     llm: LocalLLMRuntime;       // from Stream 1
     temperature?: number;
     maxTokens?: number;
   }

   RagResponse {
     answer: string;             // post-processed (citations stripped)
     answerRaw: string;          // LLM raw output with <source> tags
     citations: ResolvedCitation[];
     unresolvedCitationChunkIds: string[];   // LLM cited chunk IDs NOT in retrieved set
     confidence: ConfidenceScore;
     usage: { tokensIn: number; tokensOut: number; latencyMs: number };
   }

   ResolvedCitation {
     chunkId: string;
     docId: string;
     docVersion: number;
     headerPath: string;
     sourcePath: string;
     pageNumber?: number;
     snippet: string;           // the chunk text snippet that supports the claim
   }
   ```

   Reference implementation: `OllamaRagGenerator` in `packages/sdk/src/ai/knowledge/generator/OllamaRagGenerator.ts`.

2. **End-to-end query pipeline** — Per research §4.1:
   1. User question arrives (PMS UI chat / API / agent).
   2. RBAC context attached: `{ tenantId, propertyId, department, aclRoles[] }`. The `Retriever` extracts `tenantId` from the authenticated session (ADR-027) — application code cannot bypass isolation.
   3. (Optional, Phase 2+) Query rewrite: small LLM call to expand abbreviations (e.g., "check-out policy" → "late check-out policy standard checkout time"). Phase 1 uses raw query.
   4. Embed query via `EmbeddingsRuntime.embed()` (Stream 2 ADR-022; nomic-embed-text-v1.5, 768-dim).
   5. Hybrid retrieval via `Retriever.retrieve()` (Stream 2 ADR-024):
      a. BM25 search via FTS5: `WHERE tenantId=? AND propertyId IN (?) AND department IN (?) AND aclRoles_overlap(?) ORDER BY bm25(KnowledgeChunk_fts) LIMIT 20`.
      b. Vector search via sqlite-vec: `vec_distance(embedding, query_vec) WHERE partition_key=tenantId LIMIT 20` (pre-filter on partition key per ADR-027).
      c. RRF k=60 fusion of the two ranked lists → top 10.
   6. (Phase 2+) Rerank with `bge-reranker-v2-m3` (ADR-025) → top 5.
   7. Build prompt:
      - System: "You are a hotel operations assistant. Answer ONLY using the provided context. For every claim, emit `<source chunk_id=\"...\"/>`. If the context does not answer the question, say 'I don't have that information in the knowledge base.'"
      - Context: concatenated top-K chunks, each prefixed with `[chunk_id=abc123, doc=Front Desk SOP v3, §3.2]`.
      - User: original question.
   8. Call `LocalLLMRuntime.chat()` (Stream 1 ADR-015; Ollama HTTP API at `http://localhost:11434/v1/chat/completions`). Phase 1 default LLM: Phi-3.5-mini Q4_K_M per Stream 1. `logprobs: true` for optional confidence scoring (ADR-033).
   9. Post-process LLM output (ADR-032):
      a. Parse `<source chunk_id="..."/>` tags.
      b. Resolve each `chunkId` → `(docId, docVersion, headerPath, sourcePath, pageNumber)` via `CitationResolver` (ADR-032).
      c. Strip tags from displayed answer.
      d. Verify every cited `chunkId` exists in the retrieved-chunk set for this query — if not, strip the citation and flag with `citation_irregularity` audit event (hallucination defense, research §6.2.3).
      e. Render footnotes / sidebar citations in UI.
   10. Compute confidence score via `RagEvaluator.evaluate()` (ADR-033).
   11. Persist:
       - `KnowledgeQuery` row (id, tenantId, userId, question, answer, answerRaw, retrievedChunkIds[], citedChunkIds[], confidenceScore, confidenceMethod, modelUsed, tokensIn, tokensOut, latencyMs, createdAt).
       - `KnowledgeCitation` rows (one per cited chunk, with `docVersion` snapshot for stability — ADR-032/034).
       - Optionally `SemanticCacheEntry` (existing table) if confidence > threshold.
   12. Stream answer + citations to UI.

3. **Citation-forcing prompt template** — Per research §6.2.1:
   - Each retrieved chunk is injected into the prompt with a stable `chunkId` (CUID) prefix: `[chunk_id=abc123 doc="Front Desk SOP v3" §3.2] ...chunk text...`.
   - System prompt: "For every factual claim in your answer, emit `<source chunk_id=\"...\"/>` immediately after the claim. Use only chunk IDs present in the context. Do NOT emit a source if the claim is your own reasoning. If you cannot answer from the context, say 'I don't have that information in the knowledge base.'"
   - Post-processor parses `<source>` tags, resolves `chunkId`s, emits structured `citations[]` array alongside the answer text.
   - UI renders the answer with inline footnote markers `[1]`, `[2]` linked to the citations sidebar (research §18 #8 default).

4. **Hallucinated-citation defense** — Per research §6.2.3:
   - After post-processing, **verify** every `chunkId` in the LLM output exists in the retrieved-chunk set for this query.
   - If the LLM cites a `chunkId` not in the retrieved set, **strip the citation** and **flag the answer** with a `citation_irregularity` audit event.
   - This is the local equivalent of promptfoo's RAG-Source-Attribution red-team test (research §6.1).
   - `RagResponse.unresolvedCitationChunkIds` exposes the flagged IDs to the UI for transparency.

5. **Fail-closed on `LocalLLMRuntime.isAvailable()`** — Per research risk R-3.7:
   - Before each LLM call, the `OllamaRagGenerator` calls `LocalLLMRuntime.isAvailable()`.
   - If the local runtime is unavailable, **return an error** ("Local LLM runtime unavailable. Please start Ollama.") — never silently call a cloud LLM.
   - No framework that auto-falls-back is allowed in the dependency tree (ADR-037).

6. **Performance budget** — Per research §4.4:
   - Query embed: ~50 ms (nomic-embed-text-v1.5 via Ollama `/api/embed`).
   - Retrieval: ~50 ms for 10K chunks per tenant (sqlite-vec brute-force + FTS5 BM25, Stream 2 §11).
   - Prompt build: ~5 ms.
   - LLM call: 3–8 s (Phi-3.5-mini @ Q4_K_M ~12 tok/s on 8-core CPU for a 60-token answer).
   - Post-process: ~20 ms.
   - **End-to-end latency: 3–8 seconds typical.** Acceptable for hotel operations assistant use case (conversational, not real-time chat).

7. **Streaming** — The `OllamaRagGenerator` supports streaming via Ollama's SSE streaming response. The UI receives tokens incrementally; `<source>` tags are parsed as they arrive; citations are resolved after the stream completes. (Phase 1 may ship non-streaming if streaming adds complexity; Phase 2+ streams.)

8. **`SemanticCacheEntry` integration** — The existing `SemanticCacheEntry` table (research §1.4) is optionally populated when `confidenceScore > threshold` (default threshold 0.8). On a subsequent query, if the cached entry's embedding similarity to the new query exceeds a threshold (default 0.95), the cached answer is returned without re-running the LLM. This is a latency optimization, not a correctness mechanism — the cache is per-tenant (ADR-027) and the `RetrievedChunk`s are re-verified if the underlying documents have been re-ingested (ADR-034).

9. **`KnowledgeQuery` + `KnowledgeCitation` persistence** — Per ADR-028/032:
   - Every query persists a `KnowledgeQuery` row for auditability (who asked what, when, with what confidence, using which model).
   - Every cited chunk persists a `KnowledgeCitation` row with `docVersion` snapshot — the citation remains resolvable even after the underlying document is re-ingested (ADR-034).
   - Retention policy: default 7 years for compliance-relevant docs (research §18 #3 open question).

10. **Consumed by Stream 5 (Agent Runtime)** — Per research §17: agents use `RagGenerator.generate()` as a tool. The `RagResponse.citations` array is what agents cite when explaining their reasoning. The `RagRequest.llm` parameter allows agents to choose the LLM (e.g., a smaller model for query rewrite, a larger model for answer generation).

## 5. Rationale

- **Thin SmartAgentics-owned abstraction** — Research §4.3: "the LangChain/LlamaIndex abstractions are valuable for prototyping but their full surface area (agents, chains, retrievers, memories, vector-store adapters, document-loaders) is a liability for an offline Windows installer: dependency bloat, silent-cloud-fallback risk, breaking-change churn. SmartAgentics' RAG needs are narrow and well-defined; a ~500-line TypeScript module suffices." See ADR-037 for the full framework-policy decision.
- **Citation-forcing prompt + `<source>` tag post-processor** — Research §6.1: Tensorlake (2025) confirms "the citation magic happens in two places: how you structure chunks (above) and how you prompt the LLM (below). Returning Citations with LLM [requires `<source>` XML tags]." Anthropic-style citations (Medium, Ryaboy): "the pattern is portable to any LLM via prompt engineering." Cianfrani (2025): "Prompt engineering. Have the LLM output `<source>` XML tags inline with the response, then parse them."
- **Hallucinated-citation defense** — Research §6.1: promptfoo red-team confirms "hallucinated citations are a known attack/failure vector and must be tested." The post-processor verifies every cited `chunkId` against the retrieved set; stripped + flagged on mismatch (research §6.2.3, risk R-3.3).
- **Fail-closed on local runtime availability** — Research risk R-3.7: "LLM silent fallback to OpenAI if Ollama is down (LlamaIndex-style hazard)" — likelihood Low, impact High. Mitigation: SmartAgentics owns the abstraction; no framework that auto-falls-back; explicit `runtime.isAvailable()` check; fail-closed (return error, never silently call cloud).
- **`docVersion` snapshot in `KnowledgeCitation`** — Research §6.2.2: "even if the underlying document is re-ingested (new version), the citation remains resolvable to the _specific version that was used to generate the answer_." Soft-delete chunks (never hard-delete) until all citations are archived (research §6.2.2, risk R-3.15).
- **`SemanticCacheEntry` is per-tenant** — The existing `SemanticCacheEntry` table is re-used; the cache is per-tenant (ADR-027) and re-verifies `RetrievedChunk`s if documents have been re-ingested (ADR-034).
- **Performance budget is acceptable** — 3–8 s typical end-to-end latency on hotel hardware (Phi-3.5-mini @ Q4_K_M ~12 tok/s). Hotel operations assistant is conversational, not real-time chat (research §4.4).
- **Streaming is opt-in** — Phase 1 may ship non-streaming; Phase 2+ streams via Ollama SSE. Citations resolve after the stream completes.
- **Rejecting LangChain.js/LlamaIndex.TS runtime (Option A)** — Heavy dependency trees, frequent breaking changes, silent-cloud-fallback risk (research §4.3, ADR-037).
- **Rejecting AnythingLLM/RAGFlow (Option B)** — GUI app / server-based, not embeddable (research §3.5).
- **Rejecting cloud LLM fallback (Option C)** — Violates offline-first principle and AI-BOS "Local AI — NOW" directive; risk R-3.7.
- **Rejecting extractive-only (Option D)** — Does not meet the AI-BOS directive's natural-language answer requirement.

## 6. Consequences

**Positive**:

- Thin, owned abstraction — no framework dependency bloat, no silent-cloud-fallback risk.
- Citation-forcing prompt + post-processor produces structured `citations[]` for every answer — UI renders footnotes / sidebar citations (ADR-032).
- Hallucinated-citation defense strips + flags invalid `chunkId`s — risk R-3.3 mitigation.
- Fail-closed on `LocalLLMRuntime.isAvailable()` — no silent cloud fallback (risk R-3.7).
- `KnowledgeQuery` + `KnowledgeCitation` persistence provides full auditability (who asked what, when, with what confidence, citing which chunks).
- `SemanticCacheEntry` integration reduces latency for high-confidence repeat queries.
- Consumed by Stream 5 (Agent Runtime) as a tool — `RagResponse.citations` is what agents cite when explaining reasoning.
- End-to-end latency 3–8 s typical — acceptable for hotel operations assistant.

**Negative / obligations**:

- Phase 1 must implement `OllamaRagGenerator` + citation post-processor + `RagEvaluator` (Phase 1 coverage_v1 heuristic per ADR-033) — estimated 5–7 days (research §13.3).
- Citation-forcing prompt may degrade answer quality on Phi-3.5-mini (small model) — prompt engineering iteration required; `systemPromptOverride` allows per-use-case tuning.
- Streaming adds complexity — Phase 1 may ship non-streaming; Phase 2+ streams.
- `SemanticCacheEntry` cache invalidation on document re-ingestion (ADR-034) is an obligation — the cache must re-verify `RetrievedChunk`s if documents have been re-ingested.
- `KnowledgeQuery` + `KnowledgeCitation` retention policy is an open question (research §18 #3) — default 7 years for compliance-relevant docs; per-tenant configurable.
- LLM logprobs may not be exposed by Ollama for all models (research risk R-3.14) — confidence score degrades gracefully (drops logprob component, renormalizes coverage + retrieval per ADR-033).
- Citation hallucination is a known risk (R-3.3, Medium likelihood / High impact) — the post-processor + `citation_irregularity` audit event is the mitigation; promptfoo red-team test pattern should be added to the test suite.
- The PMS UI must render citations as a sidebar list + inline `[n]` markers (research §18 #8 default) — UI obligation.
- Ollama must be running on the hotel server — operational dependency; the installer must start Ollama as a service.

**Dependencies on other ADRs**:

- Depends on ADR-015 (Local AI Runtime) — `LocalLLMRuntime` (Ollama HTTP API); Phi-3.5-mini Q4_K_M Phase 1 default; `logprobs: true` support.
- Depends on ADR-022 (Local Embeddings) — `EmbeddingsRuntime.embed()` for query embedding (nomic-embed-text-v1.5, 768-dim).
- Depends on ADR-023 (Vector Store) — `KnowledgeChunk_vector` sqlite-vec virtual table; partition-key pre-filtering.
- Depends on ADR-024 (Hybrid Search) — `Retriever.retrieve()` (BM25 + vector + RRF k=60); `RetrievedChunk` shape.
- Depends on ADR-025 (Reranker) — Phase 2+ `bge-reranker-v2-m3` reranking.
- Depends on ADR-026 (Document Chunking) — parent-child chunks; `RetrievedChunk` text.
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` non-optional on `Retriever.retrieve()`; `Retriever` extracts `tenantId` from authenticated session.
- Depends on ADR-028 (Knowledge Base Architecture) — `KnowledgeQuery` + `KnowledgeCitation` tables; `KnowledgeStore.retrieve()`.
- Depends on ADR-032 (Source Attribution & Citation) — `CitationResolver`; `<source>` tag post-processor; `citation_irregularity` audit event.
- Depends on ADR-033 (Confidence Scoring) — `RagEvaluator.evaluate()`; `ConfidenceScore` shape.
- Depends on ADR-034 (Versioning & Incremental Re-index) — `docVersion` snapshot in `KnowledgeCitation`; cache invalidation on re-ingestion.
- Depends on ADR-037 (RAG Framework Policy) — no LangChain/LlamaIndex runtime; `@langchain/textsplitters` is the only LangChain-family runtime dep.
- Depends on ADR-001 (Reference Stack) — Auth.js session context; Restate workflow orchestrator; `SemanticCacheEntry` existing table.
- Feeds Stream 4 (Memory) — `RagGenerator` is the retrieval primitive for episodic recall.
- Feeds Stream 5 (Agent Runtime) — `RagGenerator.generate()` as a tool.
- Feeds Stream 6 (Multi-Agent Collaboration) — agents share `RetrievedChunk` objects with stable `chunkId`s.
- Feeds Stream 8 (Security & Governance) — `KnowledgeQuery` + `KnowledgeCitation` is the audit trail; `citation_irregularity` is a security event.
- Compatible with ADR-013 (Observability Strategy) — every `generate()` call is traced (query, retrievedChunkIds, citedChunkIds, confidenceScore, latencyMs, modelUsed).

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Citation hallucination rate exceeds threshold** (>5% of answers contain `unresolvedCitationChunkIds`) — tighten the citation-forcing prompt; evaluate a larger LLM (Qwen2.5-7B per Stream 1); add promptfoo red-team tests to CI.
2. **End-to-end latency exceeds 10 s typical** — evaluate a smaller/faster LLM (e.g., Qwen2.5-3B); evaluate streaming; evaluate `SemanticCacheEntry` threshold tuning.
3. **Ollama logprobs are unavailable for the chosen LLM** — confidence score degrades gracefully (drops logprob component per ADR-033); evaluate alternative confidence signals (multi-sample agreement per LessWrong 2026).
4. **A Phase 2+ deployment moves to a cloud LLM** (with explicit user opt-in) — implement a `CloudRagGenerator` behind the same `RagGenerator` interface; never auto-fallback.
5. **Streaming becomes a primary UX requirement** — implement streaming via Ollama SSE; ensure `<source>` tags are parsed incrementally; citations resolve after stream completes.
6. **`SemanticCacheEntry` cache hit rate is low** (<10%) — tune the similarity threshold; consider per-document-type cache strategies.
7. **A new LLM** (e.g., a future Phi-4 or Qwen3) becomes the Phase 1 default — re-evaluate the citation-forcing prompt; re-benchmark latency.
8. **`KnowledgeQuery` + `KnowledgeCitation` storage grows beyond SQLite's practical limit** — define the retention + archival policy (research §18 #3).
9. **The promptfoo RAG-Source-Attribution red-team test surfaces a vulnerability** — tighten the post-processor; add the test to CI.
10. **Annually**, as part of the regular ADR review cycle.
