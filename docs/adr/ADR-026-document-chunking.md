# ADR-026: Document Chunking — Markdown-Aware

**ADR-ID:** ADR-026
**Status:** ACCEPTED
**Context:** 2026-08-05
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §8) classifies **Knowledge Ingestion** as an "Architecture Contract — NOW" capability. Phase B B4 item #13 confirmed that SmartAgentics has no `Chunker` interface. Chunking is the ingestion-stage contract that turns a parsed `Document` into an array of `Chunk`s — the unit of embedding, indexing, and retrieval. Stream 2 owns the `Chunker` + `Indexer` contracts; Stream 3 owns the end-to-end `DocumentIngester` pipeline that orchestrates parse → chunk → embed → index.

Hotel policy documents are markdown-heavy: standard operating procedures (SOPs), employee manuals, room service guides, FAQs, brand-wide policies, property-specific addenda. These documents have natural hierarchical structure (`#`, `##`, `###` headers, tables, code blocks, lists) that fixed-size chunking destroys. Phase C Stream 2 research (`/home/z/my-project/phase-c-stream2-embeddings-retrieval-report.md`, §9) surveyed chunking strategies and selected **recursive character splitting with markdown-header awareness + parent-child retrieval** as the default. Parent-child retrieval is the standard solution to the chunk-size tradeoff: small chunks embed precisely but lack LLM context; large chunks have rich context but embed imprecisely. Parent-child: embed small (precise), retrieve large (contextual).

The `EmbeddingsRuntime` (ADR-022) embeds child chunks; the `VectorStore` (ADR-023) stores child-chunk vectors; the `Retriever` (ADR-024) retrieves child chunks and (optionally) expands to parent chunks for the LLM context; the `Reranker` (ADR-025) scores child-chunk text. This ADR defines the `Chunker` contract and the parent-child data model that all downstream ADRs reference.

## 2. Problem

The architectural problem: **define a `Chunker` SDK interface that (a) is the single contract for Document→Chunk[] transformation, (b) defaults to markdown-header-aware recursive splitting with parent-child retrieval (small child chunks embedded precisely; parent chunks expanded at retrieval time for LLM context), (c) preserves markdown structure (headers stay with their sections, tables are atomic, code blocks are atomic), (d) supports configurable strategy / chunkSize / overlap for non-markdown documents (plain text, logs) and advanced use cases (semantic chunking, LLM-driven chunking reserved for Phase 3+), (e) introduces `parentChunkId` on the `Chunk` model (additive column, no breaking changes), (f) stores parent chunks in a separate `ParentChunk` table (parents have no embedding — only metadata + full text), and (g) is invoked by Stream 3's `DocumentIngester` after parsing and before embedding.** This ADR defines the chunking contract; the `DocumentIngester` orchestration is owned by Stream 3.

## 3. Options

### Option A: Fixed-size chunking (e.g., 512 chars, no overlap)

Split documents into fixed-size character windows. Rejected — splits mid-sentence, loses semantic boundaries, destroys markdown structure (a section header may end up in a different chunk than its body). Use only as a fallback when the document has no structure (e.g., plain-text logs) (research §9.1 "Rejected alternatives").

### Option B: Token-based chunking (e.g., 256 tokens)

Equivalent to character-based for English; choice is implementation detail. Rejected as default — same limitations as fixed-size (research §9.1 "Rejected alternatives").

### Option C: Semantic chunking (embed each sentence, cluster by cosine similarity)

Highest quality chunking — preserves semantic coherence by clustering sentences with similar embeddings. Rejected as default — requires embedding every sentence at ingestion time, 5–10× the embedding cost. Not justified for Phase 1 corpus sizes (research §9.1 "Rejected alternatives", §9.2 comparison matrix). Reserved for Phase 3+ high-value corpora.

### Option D: Page-level chunking

One chunk per page. Rejected — too coarse; one page may contain multiple unrelated sections (research §9.1 "Rejected alternatives").

### Option E: LLM-driven chunking (LLM call per document to identify semantic boundaries)

Highest quality but highest cost (one LLM call per document). Reserved for Phase 4+ knowledge-graph extraction use cases (research §9.2 comparison matrix). Not Phase 1.

### Option F: Markdown-header-aware recursive splitting + parent-child retrieval

Primary split: markdown headers (`#`, `##`, `###`). Each section becomes a parent chunk. Secondary split: if a parent chunk exceeds 1500 chars, recursively split by paragraph (`\n\n`), then by sentence (`. `), then by character (800 char fallback) with 200-char overlap. Child chunks (~800–1200 chars, 200-char overlap) are what get embedded and indexed. At retrieval time, retrieve child chunks via hybrid search (ADR-024), then expand to parent chunks for the LLM context. Per research §9.1 "Recommendation" and "Decision Candidate".

## 4. Decision

Adopt **Option F**. The Document Chunking architectural contract is:

1. **SDK interface** — A `Chunker` interface in `packages/sdk/src/ai/chunker/`:

   ```
   Chunker {
     chunk(document: Document): Promise<Chunk[]>
   }

   ChunkerConfig {
     strategy: 'fixed' | 'recursive' | 'markdown' | 'semantic'   // default: 'markdown'
     chunkSize: number               // target child-chunk size in chars (default: 1000)
     overlap: number                 // child-chunk overlap in chars (default: 200)
     parentChild: boolean            // default: true
     minChunkSize: number            // drop chunks smaller than this (default: 100)
     maxChunkSize: number            // hard ceiling; recursive split if exceeded (default: 1500)
     preserveTables: boolean         // default: true (tables are atomic)
     preserveCodeBlocks: boolean     // default: true (code blocks are atomic)
   }
   ```
   - The `Chunker` is constructed with a `ChunkerConfig`; the default config (no arguments) = markdown strategy with parent-child enabled.
   - The `Document` input has `text`, `mimeType`, `metadata` (per ADR-023 `Chunk` Prisma model).

2. **Default strategy = `'markdown'`** — `MarkdownHeaderChunker` in `packages/sdk/src/ai/chunker/markdownHeaderChunker.ts`:
   - **Primary split**: Markdown headers (`#`, `##`, `###`, `####`). Each section becomes a **parent chunk**. The header text is preserved in the parent chunk's text.
   - **Secondary split**: If a parent chunk exceeds `maxChunkSize` (default 1500 chars), recursively split by paragraph (`\n\n`), then by sentence (`. `), then by character (with `overlap` char overlap). Each secondary split is a **child chunk**.
   - **Child chunk size**: ~`chunkSize` chars (default 1000), with `overlap` chars (default 200) between consecutive children of the same parent.
   - **Child chunks are what get embedded and indexed** in `vec_chunks` (ADR-023) and `fts_chunks` (ADR-024).
   - **Parent chunks are NOT embedded** — they live in a separate `ParentChunk` table with only metadata + full section text. At retrieval time, `Retriever` (ADR-024) fetches the parent chunk via `parentChunkId` for the LLM context.

3. **`Chunk` Prisma model** (additive to existing schema, per ADR-023):

   ```
   model Chunk {
     id              String   @id @default(cuid())
     documentId      String
     document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
     tenantId        String                          // mandatory (ADR-027)
     propertyId      String?                         // optional (ADR-027)
     parentChunkId   String?                         // null for top-level parent chunks; FK to ParentChunk
     parentChunk     ParentChunk? @relation(fields: [parentChunkId], references: [id])
     ordinal         Int                             // position within document
     text            String                          // child chunk text (embedded + indexed)
     tokenCount      Int                             // estimated token count (for context budgeting)
     metadata        Json?                           // { heading, headingLevel, headingPath, ... }
     embeddingModelId String?                        // pinned embedding model (ADR-022, ADR-021)
     embeddingVersion String?                        // pinned embedding version (ADR-018)
     dim             Int?                            // Matryoshka dim used (ADR-022)
     createdAt       DateTime @default(now())

     @@index([documentId])
     @@index([tenantId, propertyId])
     @@index([parentChunkId])
   }

   model ParentChunk {
     id              String   @id @default(cuid())
     documentId      String
     document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
     tenantId        String                          // mandatory (ADR-027)
     propertyId      String?                         // optional (ADR-027)
     ordinal         Int                             // position within document
     text            String                          // full section text (NOT embedded)
     headingPath     String?                         // e.g., "§3.2 Cancellation Policy"
     metadata        Json?
     children        Chunk[]
     createdAt       DateTime @default(now())

     @@index([documentId])
     @@index([tenantId, propertyId])
   }
   ```
   - Parent chunks have **no embedding** — they are fetched by `parentChunkId` at retrieval time and returned to the LLM as context.
   - Child chunks reference their parent via `parentChunkId`. A child chunk's `parentChunkId` is `null` only if the document has no markdown structure (flat text) and `parentChild: false` — in which case the chunk is both the embedding unit and the LLM context unit.
   - `embeddingModelId` + `embeddingVersion` + `dim` columns support re-embedding detection when the embedding model is upgraded (ADR-022 §9, research risk R-2.14).

4. **Table preservation** — Markdown tables are atomic: never split mid-row, always include the header row in every chunk that contains any table rows (AI/TLDR rule per research §9.1: "For Markdown tables, the rule is simple: never split a table mid-row, and always include the header row in every chunk."). Implementation: detect `|` lines as table; treat table as a single unsplittable unit. If a table exceeds `maxChunkSize`, it becomes its own parent chunk (no further splitting).

5. **Code block preservation** — Fenced code blocks (`...`) are atomic. If a code block exceeds `maxChunkSize`, it becomes its own parent chunk.

6. **Heading metadata** — Each child chunk's `metadata` records `heading`, `headingLevel`, `headingPath` (e.g., "§3.2 Cancellation Policy"), enabling future metadata filtering (ADR-023 `MetadataFilter`) by section.

7. **`ParentExpander` post-processor** — In `packages/sdk/src/ai/retriever/parentExpander.ts`. Invoked by `Retriever` (ADR-024) when `expandParent: true` (default). Fetches parent chunks for the top-k retrieved child chunks (via `parentChunkId`); deduplicates parent chunks (multiple child chunks may share a parent); returns parent chunks (with their best child-chunk score) for the LLM context. This preserves context (the LLM sees the full section, not just the matching paragraph) while keeping embeddings precise.

8. **Fallback strategies** —
   - `'recursive'`: LangChain-default recursive character splitter (no markdown awareness). Use for plain-text documents.
   - `'fixed'`: fixed-size character windows. Use for unstructured logs.
   - `'semantic'`: embed each sentence, cluster by cosine similarity. Reserved for Phase 3+ high-value corpora (5–10× embedding cost).
   - Each strategy has its own implementation class (`RecursiveChunker`, `FixedSizeChunker`, `SemanticChunker`) behind the `Chunker` interface.

9. **Token count estimation** — `tokenCount` is estimated via a lightweight tokenizer (e.g., `gpt-tokenizer` for OpenAI-compatible tokenization, or character-count/4 heuristic). Used by Stream 3's `RAGPipeline` for context-budget calculation (top-k chunks must fit in the LLM context window).

10. **No schema migration for existing tables** — `Chunk` and `ParentChunk` are new tables. The migration is `CREATE TABLE`, no `ALTER` or `DROP` of existing Prisma models. Additive only.

## 5. Rationale

- **Markdown-aware is correct for hotel policy documents** — Hotel SOPs/policies/employee manuals/FAQs are markdown-heavy. Markdown-header-aware chunking preserves the document's natural hierarchy — "§3.2 Cancellation Policy" stays together as a parent chunk; its paragraphs are child chunks. Materially better than fixed-size chunking for hierarchical documents (research §9.1 "Inference").
- **Parent-child retrieval is the standard chunk-size-tradeoff solution** — Small chunks embed precisely but lack LLM context; large chunks have rich context but embed imprecisely. Parent-child: embed small (precise), retrieve large (contextual) (research §9.1, cited LangChain, GraphRAG, Bisok).
- **Recursive fallback handles section-size variance** — Markdown sections vary wildly in size (a one-line header vs. a multi-page section). The recursive fallback (paragraph → sentence → character) handles this without losing semantic boundaries (research §9.1 risk: "Markdown sections vary wildly in size ... The recursive fallback handles this").
- **Tables and code blocks must be atomic** — Splitting a markdown table mid-row loses context (the header row is in a different chunk than the data rows). AI/TLDR's rule: "never split a table mid-row, and always include the header row in every chunk." Same for code blocks (research §9.1).
- **`ParentChunk` separate table** — Parent chunks have no embedding; storing them in the same `vec_chunks` table (with null embeddings) would waste rows and confuse KNN scans. Separate `ParentChunk` table is cleaner (research Open Question #5: "Should parent chunks be stored in the same `vec_chunks` table (with null embeddings) or in a separate `parent_chunks` table? → Phase D ADR-020 should specify. Recommendation: separate table").
- **`embeddingModelId` + `embeddingVersion` + `dim` columns** — Support re-embedding detection when the embedding model is upgraded (ADR-022 §9). A background job scans chunks with stale `embeddingModelId`/`embeddingVersion` and re-embeds them (research risk R-2.14).
- **Heading metadata enables future filtering** — `headingPath` metadata allows future `MetadataFilter` queries like "retrieve only chunks under §3 Cancellation Policies" (ADR-023).
- **Rejecting fixed-size (Option A)** — splits mid-sentence; loses semantic boundaries (research §9.1).
- **Rejecting token-based (Option B)** — equivalent to character-based for English; no advantage.
- **Rejecting semantic chunking as default (Option C)** — 5–10× embedding cost; not justified for Phase 1 (research §9.1). Reserved for Phase 3+.
- **Rejecting page-level (Option D)** — too coarse (research §9.1).
- **Rejecting LLM-driven (Option E)** — one LLM call per document; Phase 4+ only (research §9.2).
- **Additive migration** — `Chunk` and `ParentChunk` are new tables; no breaking changes to existing Prisma models (research §9.1 "Impact on existing architecture: Adds `Chunker` interface and `MarkdownHeaderChunker` implementation. Adds `parentChunkId` to `Chunk` model. ... No changes to existing Prisma models.").

## 6. Consequences

**Positive**:

- Single contract for Document→Chunk[] transformation — Stream 3's `DocumentIngester` programs against `Chunker`, not against a specific splitter implementation.
- Markdown-aware chunking preserves document hierarchy — hotel SOPs/policies chunk cleanly into parent (section) + child (paragraph) units.
- Parent-child retrieval solves the chunk-size tradeoff — small chunks embed precisely; parent chunks provide LLM context.
- Tables and code blocks are atomic — no mid-row or mid-block splits.
- `embeddingModelId` + `embeddingVersion` + `dim` columns support re-embedding detection on model upgrade.
- Heading metadata enables future `MetadataFilter` by section.
- Additive migration — `Chunk` and `ParentChunk` are new tables; no breaking changes.
- Fallback strategies (`'recursive'`, `'fixed'`, `'semantic'`) reserved for non-markdown documents and Phase 3+ advanced use cases.

**Negative / obligations**:

- Phase 1 must include the `Chunker` interface + `MarkdownHeaderChunker` implementation + `ParentChunk` Prisma model + test corpus validation — estimated 2 days of Phase E + Phase 1 engineering (research §9.1 "Impact on Phase 1: Phase 1 PoC should chunk 100 sample policy docs using the default strategy. Validate: (a) no chunks exceed 1500 chars, (b) no chunks are <100 chars (over-splitting), (c) tables and code blocks are atomic. Estimated effort: 2 days for interface + implementation + test corpus.").
- Markdown parser dependency — optionally `marked` or `remark` for header detection. `marked` is already a common Next.js dependency (research §9.1 "Dependencies: Optionally, a markdown parser (`marked` or `remark`) for header detection").
- Chunk size variance — markdown sections vary wildly; the recursive fallback handles this, but very large sections (multi-page) produce many child chunks per parent, increasing parent-expansion cost at retrieval time.
- Token-count estimation accuracy — character/4 heuristic underestimates CJK text; `gpt-tokenizer` is more accurate but adds a dependency. Phase 1 may use the heuristic; Phase 2+ may upgrade.
- Parent-expansion adds one extra DB fetch per query — `Retriever` (ADR-024) fetches parent chunks via `parentChunkId` after fusion + reranking. Negligible cost (chunk IDs are indexed); deduplication needed when multiple child chunks share a parent.
- Re-embedding on model upgrade is a background job that must be monitored (research risk R-2.14).
- `'semantic'` and `'fixed'` fallback implementations are reserved but not implemented in Phase 1 — only `'markdown'` (default) and `'recursive'` (fallback) are Phase 1.

**Dependencies on other ADRs**:

- Depends on ADR-005 (Prisma) for `Chunk` and `ParentChunk` schema management.
- Depends on ADR-006 (SQLite) for persistence.
- Feeds ADR-022 (Local Embeddings) — `EmbeddingsRuntime.embed()` is called on each child chunk's `text`.
- Feeds ADR-023 (Vector Store) — `VectorStore.upsert()` stores child-chunk embeddings; `Chunk` and `ParentChunk` are the relational tables joined to `vec_chunks` via `chunk_id`.
- Feeds ADR-024 (Hybrid Search) — `Retriever` retrieves child chunks; `ParentExpander` fetches parent chunks via `parentChunkId`.
- Feeds ADR-025 (Reranker) — reranker scores child-chunk `text`; chunk size affects reranker quality.
- Feeds ADR-027 (Multi-Tenant Vector Isolation) — `Chunk` and `ParentChunk` have mandatory `tenantId` + optional `propertyId`.
- Feeds ADR-021 (Model Registry) — `embeddingModelId` references a `Model` row pinned by SHA256.
- Feeds ADR-018 (Model Versioning) — `embeddingVersion` per ADR-018 vocabulary.
- Compatible with ADR-013 (Observability Strategy) — chunking operations are traced (document, strategy, chunk count, size distribution).
- Stream 3 will define `DocumentIngester` and `RAGPipeline` interfaces that orchestrate `Chunker` + `EmbeddingsRuntime` + `VectorStore` + `Retriever` + `Reranker`.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Chunking quality on the test corpus is poor** (e.g., >5% of chunks exceed `maxChunkSize` or are below `minChunkSize`) — tune `chunkSize`/`overlap`/`maxChunkSize` defaults; evaluate per-document-type configurations.
2. **A non-markdown document type** (e.g., PDF, DOCX, HTML) becomes a primary ingestion source — implement a parser-specific chunker (e.g., `PdfChunker`, `HtmlChunker`) behind the same interface.
3. **Semantic chunking becomes justified** (Phase 3+ high-value corpora) — implement `SemanticChunker` (embed each sentence, cluster by cosine similarity); re-evaluate default strategy.
4. **LLM-driven chunking becomes justified** (Phase 4+ knowledge graph extraction) — implement `LlmDrivenChunker`; re-evaluate default strategy.
5. **Re-embedding on model upgrade becomes operationally painful** — define a re-embedding runbook; consider append-only versioning (every chunk update creates a new vector with a new version; queries filter to `version = latest`) per research §12.1 "Rejected alternatives: _Append-only with versioning_".
6. **Parent-expansion cost becomes significant** (many child chunks per parent, large parent text) — evaluate hybrid expansion (return parent + top child chunks), or section-level chunking without parent-child.
7. **Token-count estimation accuracy becomes critical** (e.g., tight LLM context budget) — upgrade from character/4 heuristic to `gpt-tokenizer` or model-specific tokenizer.
8. **Heading metadata filtering becomes a primary use case** — promote `headingPath` from `metadata` JSON to a dedicated indexed column.
9. **A new chunking strategy** (e.g., late-chunking, contextual retrieval) becomes relevant — extend the `'strategy'` enum.
10. **Annually**, as part of the regular ADR review cycle.
