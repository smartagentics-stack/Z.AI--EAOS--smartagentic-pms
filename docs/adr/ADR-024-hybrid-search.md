# ADR-024: Hybrid Search — BM25 + Vector + RRF

**ADR-ID:** ADR-024
**Status:** ACCEPTED
**Context:** 2026-08-05
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §9, File 2 §II.6) classifies **Local RAG** as an "Architecture Contract — NOW" capability. Phase B B4 item #12 confirmed that SmartAgentics has no `Retriever` interface and no hybrid search pipeline. Stream 2 jointly owns the retrieval layer with Stream 3 (which owns the end-to-end `RAGPipeline`). The retrieval layer is the contract that turns a user query into a ranked list of `ScoredChunk`s — the input to the answer-generation stage.

Phase C Stream 2 research (`/home/z/my-project/phase-c-stream2-embeddings-retrieval-report.md`, §6) surveyed hybrid search literature and found a strong consensus: **pure semantic (vector-only) search misses exact keyword matches** (for hotel PMS, queries like "What is the cancellation policy for Suite 402?" contain entity tokens "Suite 402" that BM25 matches exactly but dense embeddings may fuzzy-match); **pure keyword (BM25-only) search misses semantic paraphrases** ("How do I check out late?" semantically matches "late checkout policy" even with zero word overlap); and **Reciprocal Rank Fusion (RRF) consistently beats either alone on NDCG**. The TREC Deep Learning 2019/2020 benchmarks established RRF as the standard fusion algorithm; modern RAG systems (Elasticsearch, Weaviate, Qdrant, ParadeDB) all default to RRF or weighted RRF.

The `EmbeddingsRuntime` (ADR-022) produces query embeddings; the `VectorStore` (ADR-023) stores document embeddings and runs KNN; SQLite FTS5 (built into SQLite, no extension required) provides true BM25 keyword ranking. This ADR defines how those three primitives compose into a `Retriever` interface with a default `'hybrid'` strategy. The `Reranker` (ADR-025) is a post-fusion optional stage; the `Chunker` (ADR-026) defines what is being indexed; the multi-tenant `tenantId` (ADR-027) is a mandatory filter on every retrieval call.

## 2. Problem

The architectural problem: **define a `Retriever` SDK interface that (a) is the single contract for query→ranked-chunks retrieval, (b) defaults to hybrid (BM25 via SQLite FTS5 + vector via `VectorStore.query` + RRF fusion with `k=60`), (c) supports `'semantic'` and `'keyword'` modes for advanced use cases where the query pattern is known, (d) reads `tenantId` from the request context as a mandatory filter (cannot be bypassed — see ADR-027), (e) writes to and reads from FTS5 + vec_chunks atomically (single SQLite transaction at ingestion time, so the two indexes never drift), (f) reserves the `Reranker` stage (ADR-025) as a post-fusion hook, and (g) is additive to the existing Prisma schema (the `fts_chunks` virtual table is created via raw SQL alongside `vec_chunks` from ADR-023).** This ADR defines the retrieval contract that Stream 3's `RAGPipeline` will invoke; the `RAGPipeline` interface itself is reserved for Stream 3.

## 3. Options

### Option A: Pure semantic (vector-only) retrieval

Use only `VectorStore.query()` to retrieve top-K chunks by cosine similarity. Rejected — misses exact keyword matches. For hotel PMS, entity tokens ("Suite 402", "Pool A", "Weekend Rate Code RACK-WK") are common; dense embeddings fuzzy-match these poorly. Research §6.2 decision tree: "Pure semantic misses exact keyword matches" (research §6.1).

### Option B: Pure keyword (BM25-only) retrieval

Use only SQLite FTS5 `MATCH` with `bm25()` ranking. Rejected — misses semantic paraphrases. "How do I check out late?" semantically matches "late checkout policy" even with zero word overlap. BM25 alone returns nothing for paraphrased queries (research §6.1).

### Option C: Hybrid retrieval with RRF fusion (`k=60`), default `'hybrid'` strategy, with `'semantic'` and `'keyword'` reserved

Define a `Retriever` interface in `packages/sdk/src/ai/retriever/`. Default strategy = `'hybrid'`: run BM25 (FTS5) and vector (sqlite-vec) retrievers in parallel, each returning top `k * 2` candidates, then fuse via RRF with `k=60` (canonical TREC default). The RRF implementation is ~10 lines of TypeScript over two ranked lists. `'semantic'` and `'keyword'` modes are reserved for advanced use cases where the query pattern is known (e.g., entity lookup → `'keyword'`; semantic Q&A → `'semantic'`). Per research §6.1 "Decision Candidate" and §7.4.

### Option D: Weighted score fusion (normalize BM25 + cosine to common scale, then weighted sum)

Requires normalizing BM25 (unbounded positive) and cosine ([-1, 1]) to a common scale — brittle when distributions shift across query types and corpora. Rejected — RRF's rank-only approach is more robust (research §6.1 "Rejected alternatives: _Weighted score fusion_").

### Option E: Learned fusion (ConvexERA, ML-trained fusion weights)

Requires training data and a model — overkill for Phase 1. Rejected (research §6.1 "Rejected alternatives: _ConvexERA / learned fusion_").

## 4. Decision

Adopt **Option C**. The Hybrid Search architectural contract is:

1. **SDK interface** — A `Retriever` interface in `packages/sdk/src/ai/retriever/`:

   ```
   Retriever {
     retrieve(query: string, options: RetrievalOptions): Promise<ScoredChunk[]>
   }

   RetrievalOptions {
     k: number                                      // top-K results to return (default: 5)
     tenantId: string                               // mandatory; from authenticated session
     propertyId?: string                            // optional; tenant-level docs have null
     filter?: MetadataFilter                        // additional filters (document_type, language, ...)
     strategy?: 'hybrid' | 'semantic' | 'keyword'   // default: 'hybrid'
     rrfK?: number                                  // RRF constant (default: 60)
     reranker?: Reranker                            // optional post-fusion reranker (ADR-025)
     expandParent?: boolean                         // default: true (ADR-026 parent-child)
   }
   ```

   `tenantId` is a **non-optional** parameter — the implementation MUST refuse to execute a query without it (see ADR-027). The `Retriever` extracts `tenantId` from the request context (authenticated user's session); application code cannot bypass tenant isolation.

2. **Default strategy = `'hybrid'`** — Run two retrievers in parallel:
   - **Semantic retriever**: `EmbeddingsRuntime.embed([query])` → `VectorStore.query(vector, { k: k * 2, filter, tenantId, propertyId })`. Returns top `k * 2` chunks by cosine similarity.
   - **Keyword retriever**: SQLite FTS5 `MATCH` query with `bm25()` ranking, returning top `k * 2`. The query string is passed through FTS5 query syntax (with escaping).
   - **Fusion**: RRF merges the two ranked lists.

3. **RRF algorithm** — Canonical TREC formula:

   ```
   RRF_score(d) = Σ_q 1 / (k + rank_q(d))
   ```

   where `k = 60` (TREC default; configurable per deployment via `rrfK`), `q` ranges over the retrievers (`'semantic'`, `'keyword'`), and `rank_q(d)` is the rank of chunk `d` in retriever `q`'s results (1-indexed). Chunks not in a retriever's top-K contribute 0 from that retriever. Final top-K by RRF score (descending).

4. **`'semantic'` strategy** — Skip the keyword retriever; return `VectorStore.query()` top-K directly. Reserved for advanced use cases (semantic Q&A where exact keyword match is irrelevant).

5. **`'keyword'` strategy** — Skip the semantic retriever; return FTS5 `MATCH` top-K directly. Reserved for advanced use cases (entity lookup, ID lookup).

6. **FTS5 schema** — `fts_chunks` virtual table created via Prisma migration raw SQL alongside `vec_chunks` (ADR-023):

   ```sql
   CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
     chunk_id TEXT UNINDEXED,
     tenant_id TEXT UNINDEXED,
     property_id TEXT UNINDEXED,
     text,
     tokenize = 'porter unicode61'
   );
   ```
   - `chunk_id`, `tenant_id`, `property_id` are `UNINDEXED` (stored but not tokenized — used for JOIN and filter).
   - `text` is the indexed column.
   - Default tokenizer = `'porter unicode61'` (English Porter stemming + Unicode). For non-English hotels, use `'trigram'` (language-agnostic, better for CJK) — configurable per tenant (research Open Question #6, recommendation: per-tenant configurable, defaulting to `'porter unicode61'`).
   - `bm25()` ranking function returns negative scores (better matches have lower numeric scores) — handled in application code via `ORDER BY rank ASC`.

7. **Atomic ingestion** — The `DocumentIngester` pipeline (Stream 3) writes to BOTH `vec_chunks` and `fts_chunks` in a single SQLite transaction. If either write fails, the transaction rolls back — the two indexes never drift. This addresses research risk R-2.7: "Hybrid search requires FTS5 + vector indexes in sync — mitigation: ingestion pipeline writes to both in one SQLite transaction."

8. **`Reranker` hook** — After RRF fusion produces top-`k * 2` candidates, if `options.reranker` is provided (non-null), call `reranker.rerank(query, candidates, { topK: k })` (ADR-025). In Phase 1, the default `Reranker` is `NoOpReranker` (passthrough) — fusion results are returned unchanged.

9. **Parent-child expansion** — If `options.expandParent` is `true` (default), after fusion (and optional reranking), the `Retriever` fetches the parent chunks for each returned child chunk via `parentChunkId` (ADR-026) and returns parent chunks (with their child-chunk scores) for the LLM context. This preserves context (the LLM sees the full section) while keeping embeddings precise (small chunks embed better than large ones).

10. **Reference implementation** — `HybridRetriever` in `packages/sdk/src/ai/retriever/hybridRetriever.ts`. Additional implementations: `SemanticRetriever` (vector-only), `KeywordRetriever` (FTS5-only). All three implement the `Retriever` interface; `HybridRetriever` is the default.

11. **Phase 2+ Postgres deployments** — When SmartAgentics deploys against PostgreSQL (ADR-023 Tier 3), the keyword retriever switches from FTS5 to ParadeDB `pg_search` (true BM25, AGPL-3.0 — license risk per research §3.5) or native `tsvector + ts_rank` (weaker than true BM25 but no license risk). The `Retriever` interface is unchanged — only the keyword retriever implementation swaps.

## 5. Rationale

- **Hybrid beats pure semantic and pure keyword** — Three cited references (Digital Applied, Redis blog, GopenAI blog) converge: RRF fusion "consistently beats either alone on NDCG". Pure semantic misses exact keyword matches; pure keyword misses semantic paraphrases (research §6.1).
- **RRF is score-free** — Only uses rank positions, so it works even when BM25 scores (unbounded positive) and cosine similarities ([-1, 1]) are on different scales. No normalization required. Robust to distribution shift across query types and corpora (research §6.1: "RRF's advantage: it is _score-free_").
- **`k=60` is the canonical TREC default** — Established by TREC Deep Learning 2019/2020 benchmarks; used by Elasticsearch, Weaviate, Qdrant, ParadeDB as the default. Configurable per deployment for tuning (research §6.1).
- **SQLite FTS5 is the only zero-dependency, true-BM25 keyword backend that works in SmartAgentics Phase 1** — Built into SQLite (no extension required). The `bm25()` ranking function is the same algorithm used by Lucene/Elasticsearch. ParadeDB pg_search (true BM25 on Postgres) is reserved for Phase 2+ Postgres deployments (research §7.3 comparison matrix).
- **FTS5 + vec_chunks in one SQLite file** — Same backup, same transaction, same source of truth as ADR-023. The atomic-transaction ingestion guarantee (Decision §7) means the two indexes never drift.
- **`tenantId` non-optional** — The interface enforces tenant isolation at the type level. A bug that forgets to pass `tenantId` is a compile-time error, not a runtime data leak (research §13, ADR-027).
- **Parent-child retrieval** — Standard solution to the chunk size tradeoff: small chunks embed precisely but lack LLM context; large chunks have rich context but embed imprecisely. Parent-child: embed small (precise), retrieve large (contextual) (research §9.1).
- **`'semantic'` and `'keyword'` reserved** — The default `'hybrid'` handles all query patterns adequately (research §6.2 decision tree). Pure modes are reserved for advanced use cases where the query pattern is known in advance.
- **Rejecting weighted score fusion (Option D)** — Brittle when distributions shift; requires normalization (research §6.1 "Rejected alternatives").
- **Rejecting learned fusion (Option E)** — Requires training data; overkill for Phase 1 (research §6.1 "Rejected alternatives").
- **Rejecting Cohere Rerank as fusion** — Cloud-only; incompatible with offline mandate (research §6.1 "Rejected alternatives").
- **Phase 2+ Postgres path is reserved** — When SmartAgentics deploys against PostgreSQL, the keyword retriever switches to ParadeDB `pg_search` (preferred, true BM25) or native `tsvector + ts_rank` (fallback if ParadeDB AGPL is unacceptable). The `Retriever` interface is unchanged — only the keyword retriever implementation swaps (research §5.3, §3.5).

## 6. Consequences

**Positive**:

- Single contract for query→ranked-chunks retrieval — Stream 3's `RAGPipeline` (and Stream 5 Agent Runtime, Stream 6 Memory) programs against `Retriever`, not against FTS5/sqlite-vec-specific SQL.
- Hybrid retrieval achieves recall@5 of 0.80–0.90 on domain-specific corpora (research §8.1) — sufficient for hotel-policy Q&A without reranking.
- RRF fusion is ~10 lines of TypeScript over two ranked lists — minimal implementation complexity.
- FTS5 is built into SQLite — zero additional dependencies in Phase 1.
- Atomic transaction ingestion guarantees the FTS5 + vec_chunks indexes never drift.
- `tenantId` non-optional at the interface — compile-time enforcement of multi-tenant isolation (ADR-027).
- Parent-child expansion preserves LLM context while keeping embeddings precise.
- Phase 2+ Postgres path (ParadeDB pg_search) is a behind-the-interface swap.

**Negative / obligations**:

- Phase 1 must include the `Retriever` interface + `HybridRetriever` implementation + `fts_chunks` Prisma migration + end-to-end PoC — estimated 1 additional day on top of the `VectorStore` PoC (research §6.1 "Impact on Phase 1").
- FTS5 index must be populated at ingestion time — if chunks are added without updating FTS5, keyword search returns nothing. Mitigation: atomic transaction ingestion (Decision §7).
- FTS5 tokenizer is ASCII-centric by default — non-English hotels need `'trigram'` tokenizer or per-tenant configurable tokenization (research Open Question #6).
- FTS5 `bm25()` returns negative scores (better matches have lower numeric scores) — application code must use `ORDER BY rank ASC`, not `DESC`. Documented quirk, handled in `KeywordRetriever`.
- RRF `k=60` may need tuning for hotel-policy domain — the constant is configurable per deployment; tuning requires an evaluation set (Phase 2+ optimization).
- Two parallel retriever calls per query — doubles the per-query work vs pure-semantic. For Phase 1 small corpus, both calls are <10 ms each; total <20 ms — acceptable. For larger corpora, the parallel calls may need to be async with timeout.
- Parent-child expansion adds one extra DB fetch per query — negligible cost (chunk IDs are indexed).
- Reranker hook (ADR-025) is reserved but not implemented in Phase 1 — `NoOpReranker` is the default.

**Dependencies on other ADRs**:

- Depends on ADR-022 (Local Embeddings) — `EmbeddingsRuntime.embed([query])` produces the query vector for the semantic retriever.
- Depends on ADR-023 (Vector Store) — `VectorStore.query()` is the semantic half of hybrid retrieval.
- Depends on ADR-005 (Prisma) for the `Chunk` model (joined to `fts_chunks` via `chunk_id`).
- Depends on ADR-006 (SQLite) for FTS5 (built-in).
- Feeds ADR-025 (Reranker) — `Retriever` calls `Reranker.rerank()` after fusion.
- Feeds ADR-026 (Document Chunking) — `Retriever` returns chunks produced by `Chunker.chunk()`; `expandParent` fetches parent chunks via `parentChunkId`.
- Feeds ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` non-optional at the interface.
- Compatible with ADR-013 (Observability Strategy) — `retrieve()` calls are traced (query, strategy, k, latency, result count, RRF scores).
- Stream 3 will define `RAGPipeline` and `DocumentIngester` interfaces that compose `Retriever` + `Reranker` + `Chunker` + answer generation.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Retrieval quality on a hotel-policy evaluation set is measured to be insufficient** (e.g., recall@5 < 0.85) — tune RRF `k`, evaluate weighted RRF (e.g., 0.7 vector + 0.3 BM25), or activate the `Reranker` (ADR-025 Phase 2+).
2. **SmartAgentics deploys against PostgreSQL** (Phase 2+ cloud) — implement ParadeDB `pg_search` keyword retriever (or fall back to native `tsvector + ts_rank` if ParadeDB AGPL is unacceptable); validate BM25 quality vs FTS5.
3. **A non-English deployment requires CJK tokenization** — finalize the per-tenant FTS5 tokenizer strategy (`'trigram'` vs `'porter unicode61'` vs custom).
4. **Hybrid retrieval latency exceeds 50 ms** on production corpus — evaluate parallel retriever timeouts, caching, or migration to LanceDB (Tier 2) with HNSW ANN.
5. **A new retrieval mode** (e.g., graph retrieval, SQL retrieval, tool retrieval) becomes relevant — extend the `'strategy'` enum and add a new retriever that contributes a ranked list to RRF fusion.
6. **Weighted RRF tuning becomes necessary** — extend `RetrievalOptions` with `weights?: { semantic: number; keyword: number }` (research §6.1 "Weighted RRF (e.g., 0.7 vector + 0.3 BM25) is a tuning knob reserved for future optimization").
7. **Reranker activation (ADR-025 Phase 2+)** changes the fusion-vs-rerank tradeoff — re-evaluate whether RRF `k * 2` candidate count is the right reranker input size.
8. **FTS5 + vec_chunks drift is detected in production** despite atomic ingestion — investigate transaction isolation, add a reconciliation job, or migrate to a single-index store (LanceDB hybrid).
9. **Annually**, as part of the regular ADR review cycle.
