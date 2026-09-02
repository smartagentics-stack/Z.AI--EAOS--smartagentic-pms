# ADR-032: Source Attribution & Citation

**ADR-ID:** ADR-032
**Status:** ACCEPTED
**Context:** 2026-08-06
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §8) classifies **Source Attribution** and **Citation Rendering** as "Architecture Contract — NOW" capabilities (Phase B B4 items #15, #16). The existing SmartAgentics repository has no citation tracking — `KnowledgeSource` (`src/lib/aios/types.ts:149-159`) is a UI status DTO with no citation field, no provenance, no chunk-level attribution.

Phase C Stream 3 research (`/home/z/my-project/phase-c-stream3-offline-knowledge-report.md`, §6) documented the citation problem in RAG: Reddit r/Rag (2026) — "source attribution completely degrades as data moves through the pipeline. A 'citation' is usually just a broad document-level link [which is insufficient]." Tensorlake (2025) — "The citation magic happens in two places: how you structure chunks (above) and how you prompt the LLM (below). Returning Citations with LLM [requires `<source>` XML tags]." Anthropic-style citations (Medium, Ryaboy) — "the pattern is portable to any LLM via prompt engineering." promptfoo red-team — "The RAG Source Attribution plugin tests whether AI systems fabricate document citations, policy references, or source attributions when [the answer is not in the KB]" — hallucinated citations are a known attack/failure vector.

The recommended citation implementation is **chunk-ID-based citation with a citation-forcing prompt + post-processor + `KnowledgeCitation` table + `docVersion` snapshot for stability**. Every retrieved chunk carries a stable `chunkId` (CUID). The LLM is instructed to emit `<source chunk_id="...">` tags. A post-processor parses the tags, resolves them back to `(docId, docVersion, headerPath, pageNumber, sourcePath)`, and renders footnoted citations in the UI. The `KnowledgeCitation` table stores a per-query snapshot with `docVersion` — citations remain resolvable even after the underlying document is re-ingested (ADR-034). A hallucinated-citation defense verifies every cited `chunkId` against the retrieved-chunk set; mismatches are stripped + flagged with a `citation_irregularity` audit event.

## 2. Problem

The architectural problem: **define a `CitationResolver` SDK interface and chunk-ID-based citation contract that (a) makes every retrieved chunk carry a stable `chunkId` (CUID) injected into the LLM prompt with prefix `[chunk_id=abc123 doc="Front Desk SOP v3" §3.2] ...chunk text...`, (b) uses a citation-forcing system prompt that requires inline `<source chunk_id="..."/>` tags for every claim and instructs the LLM to say "I don't have that information" if the context does not answer the question, (c) post-processes LLM output to parse `<source>` tags, resolve each `chunkId` to `(docId, docVersion, headerPath, sourcePath, pageNumber, snippet)` via `CitationResolver`, strip tags from displayed answer, and emit a structured `citations[]` array alongside the answer text, (d) implements a hallucinated-citation defense — verify every cited `chunkId` exists in the retrieved-chunk set; strip + flag with `citation_irregularity` audit event on mismatch (local equivalent of promptfoo RAG-Source-Attribution red-team test), (e) persists a `KnowledgeCitation` row per cited chunk with `docVersion` snapshot — citations remain resolvable even after the underlying document is re-ingested (ADR-034), (f) soft-deletes `KnowledgeChunk` rows (never hard-deletes) until all citations referencing them are archived (retention: 7 years for compliance-relevant docs), (g) renders citations in the UI as a sidebar list + inline `[n]` markers (default; Perplexity-style), (h) records `retrievedChunkIds[]` + `citedChunkIds[]` on every `KnowledgeQuery` row for auditability, (i) supports sub-sentence citations as a Phase 3+ extension (arXiv 2509.20859), and (j) feeds Stream 5 (Agent Runtime) — `RagResponse.citations[]` is what agents cite when explaining their reasoning.** This ADR defines the citation contract; the prompt template is owned by ADR-030; the versioning snapshot is owned by ADR-034.

## 3. Options

### Option A: Document-level citations only

Cite at the document level ("Source: Front Desk SOP v3") without chunk-level granularity. Rejected — Reddit r/Rag (2026): "source attribution completely degrades as data moves through the pipeline. A 'citation' is usually just a broad document-level link [which is insufficient]." The user cannot verify which specific passage supports the claim. Research §6.1.

### Option B: Ask the LLM for self-reported source URLs / document names

Let the LLM emit free-text source references (e.g., "According to the Front Desk SOP..."). Rejected — the LLM may hallucinate source names; no machine-verifiable link to a specific chunk. promptfoo red-team confirms hallucinated citations are a known attack vector. Research §6.1.

### Option C: Full Ragas Python dependency at runtime

Use the Ragas framework (Python) for citation extraction + faithfulness scoring at runtime. Rejected — Python dependency, latency. Ragas is a _reference framework_; its Faithfulness algorithm is reimplemented locally for confidence scoring (ADR-033). Research §6.4.

### Option D: Sub-sentence citations (arXiv 2509.20859)

Cite at the sub-sentence level — every clause has its own citation. Rejected for Phase 1 — research frontier (arXiv 2509.20859, 2025: "concise and sufficient sub-sentence-level citations for LLM-based RAG systems"). Reserved for Phase 3+ when the LLM and prompt engineering support it. Research §6.1.

### Option E: Chunk-ID-based citation with citation-forcing prompt + post-processor + `KnowledgeCitation` table + `docVersion` snapshot + hallucinated-citation defense

Inject each retrieved chunk into the prompt with a stable `chunkId` (CUID) prefix. Citation-forcing system prompt requires `<source chunk_id="..."/>` tags for every claim. Post-processor parses tags, resolves `chunkId`s via `CitationResolver`, strips tags, emits structured `citations[]` array. `KnowledgeCitation` table stores per-query snapshot with `docVersion`. Hallucinated-citation defense verifies cited `chunkId`s against the retrieved set; strips + flags mismatches. Per research §6.2.

## 4. Decision

Adopt **Option E**. The Source Attribution & Citation architectural contract is:

1. **SDK interface** — `CitationResolver` in `packages/sdk/src/ai/knowledge/citation/CitationResolver.ts` (research §10):

   ```
   CitationResolver {
     resolve(chunkId: string, docVersion: number): Promise<ResolvedCitation | null>;
     resolveMany(chunkIds: string[], docVersion: number): Promise<ResolvedCitation[]>;
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

   Reference implementation: `ChunkIdCitationResolver` in `packages/sdk/src/ai/knowledge/citation/ChunkIdCitationResolver.ts`.

2. **Stable `chunkId` (CUID) on every retrieved chunk** —
   - Every `KnowledgeChunk` row has a stable `id` (CUID, ADR-028 §9 Prisma schema).
   - The `chunkId` is invariant across re-ingestion (ADR-034): a chunk with unchanged text retains its `chunkId`; a changed chunk gets a new `chunkId` (the old one is soft-deleted, not reused).
   - The `chunkId` is the citation anchor — every citation resolves to a `chunkId`.

3. **Citation-forcing prompt template** — Per research §6.2.1 and ADR-030 §3:
   - Each retrieved chunk is injected into the prompt with a stable `chunkId` prefix: `[chunk_id=abc123 doc="Front Desk SOP v3" §3.2] ...chunk text...`.
   - System prompt: "You are a hotel operations assistant. Answer ONLY using the provided context. For every factual claim in your answer, emit `<source chunk_id=\"...\"/>` immediately after the claim. Use only chunk IDs present in the context. Do NOT emit a source if the claim is your own reasoning. If you cannot answer from the context, say 'I don't have that information in the knowledge base.'"
   - The `chunkId` prefix gives the LLM a machine-readable handle to cite; the `<source>` tag is the citation format.

4. **Post-processor** — `CitationPostProcessor` in `packages/sdk/src/ai/knowledge/citation/CitationPostProcessor.ts`:
   - Parses `<source chunk_id="..."/>` tags from the LLM raw output (`answerRaw`).
   - Resolves each `chunkId` to a `ResolvedCitation` via `CitationResolver.resolveMany(chunkIds, docVersion)`.
   - Strips `<source>` tags from the displayed answer (`answer`).
   - Emits a structured `citations: ResolvedCitation[]` array alongside the answer text.
   - Records `unresolvedCitationChunkIds: string[]` — `chunkId`s the LLM cited that are NOT in the retrieved-chunk set (hallucinated citations).
   - The `RagResponse` (ADR-030 §1) carries `answer`, `answerRaw`, `citations`, `unresolvedCitationChunkIds`.

5. **Hallucinated-citation defense** — Per research §6.2.3:
   - After post-processing, **verify** every `chunkId` in the LLM output exists in the retrieved-chunk set for this query.
   - If the LLM cites a `chunkId` not in the retrieved set, **strip the citation** from the displayed `citations[]` and add the `chunkId` to `unresolvedCitationChunkIds`.
   - **Flag the answer** with a `citation_irregularity` `AuditEvent` (existing table, ADR-001): `actorId=system`, `resource=KnowledgeQuery:<id>`, `result=warning`, `details={unresolvedCitationChunkIds, totalCitations, unresolvedCount}`.
   - This is the local equivalent of promptfoo's RAG-Source-Attribution red-team test (research §6.1).
   - The UI may display a warning badge if `unresolvedCitationChunkIds` is non-empty ("This answer contains citations that could not be verified against the retrieved context.").

6. **`KnowledgeCitation` table (per-query snapshot)** — Per ADR-028 §9 and research §6.2.2:

   ```
   model KnowledgeCitation {
     id            String   @id @default(cuid())
     queryId       String
     chunkId       String
     docId         String
     docVersion    Int      // snapshot — stable even after doc is re-ingested
     headerPath    String
     sourcePath    String
     pageNumber    Int?
     citedAt       DateTime @default(now())

     query         KnowledgeQuery @relation(fields: [queryId], references: [id])

     @@index([queryId])
     @@index([chunkId])
   }
   ```
   - One `KnowledgeCitation` row per cited chunk per query.
   - `docVersion` is a **snapshot** — even if the underlying document is re-ingested (new version per ADR-034), the citation remains resolvable to the _specific version that was used to generate the answer_.
   - `KnowledgeQuery.citedChunkIds` (JSON array) is a denormalized copy for fast query; `KnowledgeCitation` is the normalized relation.

7. **Soft-delete (never hard-delete) `KnowledgeChunk` rows** — Per research §6.2.2:
   - `KnowledgeChunk.deletedAt DateTime?` — soft-delete on re-ingestion (ADR-034).
   - **Never hard-delete** a `KnowledgeChunk` until all `KnowledgeCitation` rows referencing it are themselves archived.
   - Retention policy: 7 years for compliance-relevant docs (research §18 #3 open question); per-tenant configurable.
   - The `CitationResolver.resolve(chunkId, docVersion)` looks up the soft-deleted chunk if needed — citations remain resolvable.

8. **`docVersion` snapshot for citation stability** — Per ADR-034 and research §6.2.2:
   - `KnowledgeChunk.docVersion Int` — snapshot version (ADR-028 §9).
   - `KnowledgeCitation.docVersion Int` — snapshot version at citation time.
   - When a document is re-ingested (ADR-034), `currentVersion` increments; new chunks get the new `docVersion`; old chunks (unchanged) keep their `docVersion`; changed chunks are soft-deleted and replaced with new chunks at the new `docVersion`.
   - A `KnowledgeCitation` referencing `docVersion=3` remains resolvable even after the document is at `docVersion=4` — the soft-deleted v3 chunks are retained.

9. **UI rendering** — Per research §18 #8 default:
   - Sidebar list + inline `[n]` markers (Perplexity-style).
   - Each citation shows: `[n] doc title (version), §headerPath, page X` — clickable to expand the `snippet`.
   - The UI receives `RagResponse.citations: ResolvedCitation[]` and `RagResponse.unresolvedCitationChunkIds: string[]`.
   - Footnote-style (academic) and inline-chip-style (Wikipedia) are alternative renderings — Phase 2+ UX iteration.

10. **`KnowledgeQuery` audit columns** — Per ADR-028 §9:
    - `retrievedChunkIds String` (JSON array) — every chunk the retriever returned.
    - `citedChunkIds String` (JSON array) — the subset the LLM actually cited (after hallucination defense).
    - `answer String` — post-processed (citations stripped).
    - `answerRaw String` — LLM raw output (with `<source>` tags) — retained for debugging + audit.
    - These columns make every query fully reconstructable: the question, the retrieved chunks, the LLM's raw answer, the resolved citations, and the unresolved (hallucinated) citations.

11. **Sub-sentence citations (Phase 3+ extension)** — Per research §6.1 (arXiv 2509.20859, 2025): "concise and sufficient sub-sentence-level citations for LLM-based RAG systems." Reserved for Phase 3+ when the LLM and prompt engineering support finer-grained citation. The `ResolvedCitation` shape accommodates this — `snippet` may shrink to a sub-sentence; the contract is unchanged.

12. **Consumed by Stream 5 (Agent Runtime)** — Per research §17: agents use `RagGenerator.generate()` as a tool; the `RagResponse.citations` array is what agents cite when explaining their reasoning. Agents may re-cite a `ResolvedCitation` in a subsequent turn without re-retrieving — the `chunkId` + `docVersion` snapshot is stable.

## 5. Rationale

- **Chunk-level citations are required** — Reddit r/Rag (2026): "source attribution completely degrades as data moves through the pipeline. A 'citation' is usually just a broad document-level link [which is insufficient]." Document-level citations don't let the user verify which specific passage supports the claim (research §6.1).
- **`<source>` XML tags are the proven pattern** — Tensorlake (2025): "Returning Citations with LLM [requires `<source>` XML tags]." Anthropic-style citations (Medium, Ryaboy): "the pattern is portable to any LLM via prompt engineering." Cianfrani (2025): "Prompt engineering. Have the LLM output `<source>` XML tags inline with the response, then parse them." (research §6.1).
- **Stable `chunkId` (CUID) is the citation anchor** — Every chunk has a stable `id` (ADR-028 §9); the `chunkId` is invariant across re-ingestion for unchanged chunks (ADR-034). The LLM cites `chunkId`s; the post-processor resolves them.
- **Hallucinated-citation defense is mandatory** — promptfoo red-team (research §6.1): "The RAG Source Attribution plugin tests whether AI systems fabricate document citations, policy references, or source attributions when [the answer is not in the KB]." The post-processor verifies every cited `chunkId` against the retrieved set; strips + flags mismatches with a `citation_irregularity` audit event. This is the local equivalent of the promptfoo test (research §6.2.3, risk R-3.3).
- **`docVersion` snapshot for citation stability** — Research §6.2.2: "even if the underlying document is re-ingested (new version), the citation remains resolvable to the _specific version that was used to generate the answer_." Critical for compliance — a user must be able to reconstruct exactly what the LLM saw when it generated an answer 6 months ago.
- **Soft-delete (never hard-delete) chunks** — Hard-deleting a chunk would orphan its `KnowledgeCitation` rows. Soft-delete (`deletedAt`) preserves resolvability; the `CitationResolver` looks up soft-deleted chunks if needed (research §6.2.2, risk R-3.15).
- **7-year retention for compliance-relevant docs** — Research §18 #3 open question; default 7 years (typical regulatory retention); per-tenant configurable.
- **`KnowledgeQuery` audit columns** — `retrievedChunkIds` + `citedChunkIds` + `answerRaw` make every query fully reconstructable — critical for debugging, audit, and red-team testing.
- **UI rendering = sidebar list + inline `[n]` markers (Perplexity-style)** — Research §18 #8 default. Footnote-style (academic) and inline-chip-style (Wikipedia) are alternative renderings — Phase 2+ UX iteration.
- **Rejecting document-level citations (Option A)** — Insufficient for verification; Reddit r/Rag confirms (research §6.1).
- **Rejecting LLM self-reported source URLs (Option B)** — Hallucination risk; no machine-verifiable link (research §6.1, promptfoo red-team).
- **Rejecting full Ragas Python runtime (Option C)** — Python dependency, latency. Ragas is a reference framework; its Faithfulness algorithm is reimplemented locally for confidence scoring (ADR-033) (research §6.4).
- **Rejecting sub-sentence citations for Phase 1 (Option D)** — Research frontier (arXiv 2509.20859). Reserved for Phase 3+ (research §6.1).

## 6. Consequences

**Positive**:

- Chunk-level citations let the user verify which specific passage supports each claim.
- Stable `chunkId` (CUID) is the citation anchor — invariant across re-ingestion for unchanged chunks.
- `<source>` XML tag pattern is portable to any LLM via prompt engineering (Anthropic-style).
- Hallucinated-citation defense strips + flags invalid `chunkId`s — risk R-3.3 mitigation.
- `docVersion` snapshot preserves citation resolvability across document re-ingestion.
- Soft-delete (never hard-delete) chunks preserves citation resolvability for the retention period (7 years default).
- `KnowledgeQuery` audit columns (`retrievedChunkIds`, `citedChunkIds`, `answerRaw`) make every query fully reconstructable.
- Consumed by Stream 5 (Agent Runtime) — `RagResponse.citations` is what agents cite when explaining reasoning.

**Negative / obligations**:

- Phase 1 must implement `CitationPostProcessor` + `ChunkIdCitationResolver` + the citation-forcing prompt — estimated part of the 5–7 days for `OllamaRagGenerator` (research §13.3, ADR-030).
- Citation-forcing prompt may degrade answer quality on Phi-3.5-mini (small model) — prompt engineering iteration required.
- Hallucinated-citation defense requires the retrieved-chunk set to be passed to the post-processor — tight coupling between `Retriever` and `RagGenerator`.
- `KnowledgeCitation` retention policy (7 years default, per-tenant configurable) is an open question (research §18 #3) — must be finalized in Phase E.
- Soft-deleted chunks accumulate over time — periodic hard-purge of chunks with no remaining citations is needed (a Restate workflow).
- Sub-sentence citations are deferred to Phase 3+ — the `ResolvedCitation.snippet` is chunk-level in Phase 1.
- The UI must render citations as a sidebar list + inline `[n]` markers — UI obligation.
- `answerRaw` (with `<source>` tags) is retained indefinitely for audit — storage cost; mitigation: compress; archive old queries.
- The promptfoo RAG-Source-Attribution red-team test should be added to CI — research risk R-3.3 mitigation.
- Citation resolution may fail if a chunk is hard-purged before its retention period expires (operational error) — the `CitationResolver.resolve()` returns `null`; the UI shows "Citation no longer available."

**Dependencies on other ADRs**:

- Depends on ADR-028 (Knowledge Base Architecture) — `KnowledgeCitation` table; `KnowledgeQuery.citedChunkIds` + `answerRaw`; `KnowledgeChunk.id` (CUID).
- Depends on ADR-030 (RAG Pipeline) — `RagGenerator` builds the citation-forcing prompt; `RagResponse.citations` + `unresolvedCitationChunkIds` shape.
- Depends on ADR-034 (Versioning & Incremental Re-index) — `docVersion` snapshot; soft-delete on re-ingestion; chunk stability.
- Depends on ADR-024 (Hybrid Search) — `RetrievedChunk.chunkId` is the citation anchor.
- Depends on ADR-026 (Document Chunking) — `headerPath` metadata enables "§3.2 Cancellation Policy" in citations.
- Depends on ADR-001 (Reference Stack) — `AuditEvent` existing table for `citation_irregularity`.
- Feeds ADR-033 (Confidence Scoring) — `coverage_score` uses `citedChunkIds` + `unresolvedCitationChunkIds`.
- Feeds ADR-035 (Freshness & Staleness) — citations include `lastVerifiedAt` of the cited document (down-rank stale).
- Feeds Stream 5 (Agent Runtime) — `RagResponse.citations` is what agents cite when explaining reasoning.
- Feeds Stream 6 (Multi-Agent Collaboration) — agents share `ResolvedCitation` objects with stable `chunkId`s.
- Feeds Stream 8 (Security & Governance) — `KnowledgeCitation` + `AuditEvent` (`citation_irregularity`) is the provenance/auditability foundation.
- Compatible with ADR-013 (Observability Strategy) — every citation resolution is traced (chunkId, docVersion, latencyMs).

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Citation hallucination rate exceeds threshold** (>5% of answers contain `unresolvedCitationChunkIds`) — tighten the citation-forcing prompt; evaluate a larger LLM (Qwen2.5-7B per Stream 1); add the promptfoo RAG-Source-Attribution red-team test to CI.
2. **`KnowledgeCitation` storage grows beyond SQLite's practical limit** (>10M rows) — define the retention + archival policy (research §18 #3); consider a separate audit database.
3. **Sub-sentence citations become justified** (Phase 3+) — extend the `ResolvedCitation.snippet` to sub-sentence granularity; update the citation-forcing prompt.
4. **A compliance-driven deployment requires longer retention** (>7 years) — make retention per-tenant configurable; verify the soft-delete + hard-purge workflow.
5. **Citation resolution latency becomes significant** (>20 ms per citation) — index `KnowledgeCitation(chunkId)`; cache resolved citations in `SemanticCacheEntry`.
6. **The UI rendering (sidebar list + inline `[n]` markers) proves unsuitable** — evaluate footnote-style (academic) or inline-chip-style (Wikipedia) renderings.
7. **A new LLM** does not support `<source>` XML tag emission — fall back to a structured-output format (JSON citations); update the post-processor.
8. **Cross-document citation chaining** (e.g., "SOP A references Policy B") becomes a use case — evaluate a knowledge-graph augmentation (ADR-028 Phase 2+ KG extension).
9. **The promptfoo red-team test surfaces a new citation-fabrication pattern** — tighten the post-processor; add the test to CI.
10. **Annually**, as part of the regular ADR review cycle.
