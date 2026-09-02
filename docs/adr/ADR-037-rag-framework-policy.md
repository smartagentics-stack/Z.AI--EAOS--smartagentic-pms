# ADR-037: RAG Framework Policy

**ADR-ID:** ADR-037
**Status:** ACCEPTED
**Context:** 2026-08-06
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 1 §8, File 2 §5/§6) classifies **Local RAG** as an "Architecture Contract — NOW" capability (Phase B B4 item #12). The Build-vs-Buy Matrix (`download/smartagentics/04-Build-vs-Buy-Matrix.md`) lists "Knowledge Engine (likely LlamaIndex)" under "Phase 2+ Components (Not Evaluated Yet)" — research foundational conflict FC-3.1 (Stream 3 report §11) carries forward from Stream 2 FC-2.1: the AI-BOS directive reclassifies the Knowledge Engine as NOW.

Phase C Stream 3 research (`/home/z/my-project/phase-c-stream3-offline-knowledge-report.md`, §4.3, §3.5) evaluated the RAG framework landscape (LangChain.js, LlamaIndex.TS, Haystack, AnythingLLM, RAGFlow) and concluded that **none should be adopted as a runtime dependency** for SmartAgentics. The recommended policy: **build a thin SmartAgentics-owned `RagGenerator` interface and reference implementation that calls Ollama directly**; adopt LangChain.js's `@langchain/textsplitters` (a small, focused, MIT-licensed package) as the **only** LangChain-family runtime dependency. LangChain.js / LlamaIndex.TS may be used as _reference implementations_ but their heavy dependency trees and frequent breaking changes are unacceptable for an offline Windows installer.

Critical hazard documented in research §4.2: the LlamaIndex "silent OpenAI fallback" report (Reddit r/LocalLLaMA) — "If you are building a Local-First RAG using LlamaIndex, double-check your dependency injections right now. There is a silent fallback mechanism [to OpenAI]..." — evidence that framework abstractions can violate offline-first guarantees. This hazard is unacceptable for SmartAgentics' hotel-chain customers who may be air-gapped or who have explicit no-cloud-egress compliance requirements. Research risk R-3.7 (Low likelihood / High impact): "LLM silent fallback to OpenAI if Ollama is down (LlamaIndex-style hazard)" — mitigation: SmartAgentics owns the abstraction; no framework that auto-falls-back; explicit `runtime.isAvailable()` check before each call; fail-closed (return error, never silently call cloud).

The single most important architectural decision (research §0 Executive Summary): SmartAgentics must define `DocumentIngester`, `KnowledgeStore`, `Retriever`, `RagGenerator`, `CitationResolver`, and `RagEvaluator` interfaces in `packages/sdk/src/ai/` in Phase 1, even if Phase 1 ships with a thin Tier-1-only PoC implementation. These interfaces are the _contract_; the parsers and stores are swappable. This mirrors Stream 1's `LocalLLMRuntime` (ADR-015) and Stream 2's `VectorStore` (ADR-023) / `EmbeddingsRuntime` (ADR-022) conclusions.

## 2. Problem

The architectural problem: **define the RAG framework policy that (a) prohibits adopting any full RAG framework (LangChain.js, LlamaIndex.TS, Haystack, AnythingLLM, RAGFlow) as a runtime dependency in Phase 1, (b) mandates a thin SmartAgentics-owned `RagGenerator` interface and reference implementation (`OllamaRagGenerator`) that calls Ollama directly via the OpenAI-compatible HTTP API — ~500-line TypeScript module, (c) permits `@langchain/textsplitters` (small, focused, MIT-licensed) as the ONLY LangChain-family runtime dependency — used for markdown-aware recursive chunking per ADR-026, (d) prohibits any framework that auto-falls-back to a cloud LLM (the LlamaIndex "silent OpenAI fallback" hazard — research §4.2) — explicit `LocalLLMRuntime.isAvailable()` check before each call; fail-closed (return error, never silently call cloud), (e) permits LangChain.js / LlamaIndex.TS / Haystack / AnythingLLM / RAGFlow as _reference implementations_ (their patterns inform the SmartAgentics-owned abstractions) but not as runtime dependencies, (f) reserves the right to adopt a framework in Phase 3+ IF a Phase 2+ evaluation demonstrates that the SmartAgentics-owned abstractions are insufficient AND the framework has shed its dependency-bloat / silent-fallback / breaking-change risk, (g) extends the same policy to parsers (ADR-029) — no unstructured.io runtime, no LangChain document-loaders runtime, no LlamaIndex readers runtime; SmartAgentics owns the `DocumentParser` interface and Tier-1/2/3 implementations, (h) extends the same policy to vector stores (ADR-023, Stream 2) — no LangChain vector-store-adapters runtime; SmartAgentics owns the `VectorStore` interface and sqlite-vec / LanceDB implementations, (i) extends the same policy to retrievers (ADR-024, Stream 2) — no LangChain retrievers runtime; SmartAgentics owns the `Retriever` interface and BM25+vector+RRF implementation, and (j) feeds Stream 5 (Agent Runtime) — agents use the SmartAgentics-owned `RagGenerator` as a tool, not a LangChain chain or LlamaIndex query engine.** This ADR is the cross-cutting framework policy referenced by ADR-028 through ADR-036; it is the Stream 3 extension of Stream 2's framework-avoidance conclusions (ADR-022/023/024/025/026).

## 3. Options

### Option A: Adopt LangChain.js as the runtime RAG framework

Use LangChain.js chains, retrievers, vector-store adapters, document-loaders, and memory as the runtime RAG orchestrator. **Rejected** — research §4.3 and §3.5: heavy dependency trees, frequent breaking changes, and the documented "silent OpenAI fallback" hazard (Reddit r/LocalLLaMA LlamaIndex report — applies analogously to LangChain). Dependency bloat is unacceptable for an offline Windows installer. SmartAgentics' RAG needs are narrow; a thin owned abstraction suffices. Research §4.3.

### Option B: Adopt LlamaIndex.TS as the runtime RAG framework

Use LlamaIndex.TS query engines, retrievers, vector-store integrations as the runtime RAG orchestrator. **Rejected** — research §4.2, §4.3: the LlamaIndex "silent OpenAI fallback" is a documented production hazard ("If you are building a Local-First RAG using LlamaIndex, double-check your dependency injections right now. There is a silent fallback mechanism [to OpenAI]"). Parity lag vs Python LlamaIndex; same dependency bloat as LangChain. Research §4.3.

### Option C: Adopt Haystack as the runtime RAG framework

Use Haystack pipelines as the runtime RAG orchestrator. **Rejected** — research §4.3: Python-first; Node.js parity weak. SmartAgentics is a TypeScript/Next.js stack; Haystack's Python-first design is a poor fit.

### Option D: Adopt AnythingLLM as an embedded runtime

Use AnythingLLM (GUI app, bundles LanceDB) as an embeddable runtime. **Rejected** — research §3.5: AnythingLLM is a GUI app, not a library; useful inspiration for the workspace concept but not embeddable inside SmartAgentics' Next.js process. Reserved as a _reference UI_ design.

### Option E: Adopt RAGFlow as an embedded runtime

Use RAGFlow (server-based RAG system) as an embedded runtime. **Rejected** — research §3.5: RAGFlow is server-based, not embedded-friendly. Adds a second server process to the Windows installer.

### Option F: SmartAgentics-owned thin abstraction; `@langchain/textsplitters` as the only LangChain-family runtime dep; LangChain/LlamaIndex as reference only; fail-closed on local runtime availability

A `RagGenerator` interface in `packages/sdk/src/ai/knowledge/` with a reference implementation (`OllamaRagGenerator`) that calls Ollama directly via the OpenAI-compatible HTTP API, builds a citation-forcing prompt, post-processes `<source>` tags, resolves `chunkId`s, computes confidence (ADR-033), and persists `KnowledgeQuery` + `KnowledgeCitation` rows. ~500-line TypeScript module. `@langchain/textsplitters` (small, focused, MIT-licensed) is the only LangChain-family runtime dependency — used for markdown-aware recursive chunking (ADR-026). LangChain.js / LlamaIndex.TS / Haystack / AnythingLLM / RAGFlow may be used as _reference implementations_ but not as runtime dependencies. Fail-closed on `LocalLLMRuntime.isAvailable()` — never silently call cloud. Per research §4.3, §0 Executive Summary.

## 4. Decision

Adopt **Option F**. The RAG Framework Policy architectural contract is:

1. **No full RAG framework as a runtime dependency in Phase 1** — The following are **prohibited** as runtime dependencies:
   - **LangChain.js** (full runtime) — chains, retrievers, vector-store adapters, document-loaders, memory, agents. Dependency bloat; silent-fallback risk.
   - **LlamaIndex.TS** (full runtime) — query engines, retrievers, vector-store integrations, readers. Silent OpenAI fallback hazard (research §4.2); parity lag vs Python; dependency bloat.
   - **Haystack** — Python-first; Node.js parity weak.
   - **AnythingLLM** — GUI app, not a library.
   - **RAGFlow** — server-based, not embedded-friendly.
   - **unstructured.io** (full runtime) — Python only, 12 GB+ Docker footprint (ADR-029 §3 Option A).
   - The policy extends to parsers (no LangChain document-loaders, no LlamaIndex readers — ADR-029), vector stores (no LangChain vector-store-adapters — ADR-023/027), and retrievers (no LangChain retrievers — ADR-024).

2. **Thin SmartAgentics-owned abstractions** — The following SDK interfaces in `packages/sdk/src/ai/knowledge/` (ADR-028 §13.1) are the _contract_; the implementations are swappable:
   - `DocumentParser` (ADR-029) — Tier-1 native Node.js (mammoth, pdf-parse, officeparser, turndown, eml-parser, tesseract.js), Tier-2 Apache Tika sidecar (opt-in), Tier-3 OCRmyPDF / Docling (Phase 2+).
   - `DocumentIngester` (ADR-028/034) — `SqliteIngester` reference implementation.
   - `KnowledgeStore` (ADR-028) — `SqliteKnowledgeStore` reference implementation.
   - `Retriever` (ADR-024, Stream 2) — BM25 (FTS5) + vector (sqlite-vec) + RRF k=60 fusion.
   - `Reranker` (ADR-025, Stream 2) — Phase 2+ `bge-reranker-v2-m3`.
   - `Chunker` (ADR-026, Stream 2) — `MarkdownHeaderChunker` using `@langchain/textsplitters`.
   - `RagGenerator` (ADR-030) — `OllamaRagGenerator` reference implementation; calls Ollama directly via OpenAI-compatible HTTP API at `http://localhost:11434/v1/chat/completions`.
   - `CitationResolver` (ADR-032) — `ChunkIdCitationResolver` reference implementation.
   - `RagEvaluator` (ADR-033) — `CoverageConfidence` (Phase 1 local heuristic) reference implementation.

3. **`@langchain/textsplitters` is the ONLY LangChain-family runtime dependency** —
   - Small, focused, MIT-licensed package — the markdown-aware recursive splitter.
   - Used by `MarkdownHeaderChunker` (ADR-026) for the primary split (markdown headers) and secondary split (recursive character with overlap).
   - Must be **pinned to a specific version** and audited on upgrade — transitive dependencies must be reviewed.
   - This is the only LangChain-family package allowed in `package.json` runtime dependencies.

4. **Fail-closed on `LocalLLMRuntime.isAvailable()`** — Per ADR-030 §5 and research risk R-3.7:
   - Before each LLM call, the `OllamaRagGenerator` calls `LocalLLMRuntime.isAvailable()`.
   - If the local runtime is unavailable, **return an error** ("Local LLM runtime unavailable. Please start Ollama.") — never silently call a cloud LLM.
   - No framework that auto-falls-back is allowed in the dependency tree.
   - The LlamaIndex "silent OpenAI fallback" hazard (research §4.2) is the canonical example of what to avoid.

5. **LangChain.js / LlamaIndex.TS / Haystack / AnythingLLM / RAGFlow as reference implementations only** —
   - These frameworks' patterns (text splitters, document loaders, retrievers, citation post-processors) inform the SmartAgentics-owned abstractions.
   - They may be consulted during development (read the source, adopt the patterns) but NOT added to `package.json` runtime dependencies.
   - The LangChain.js `@langchain/textsplitters` package is the exception — small, focused, MIT-licensed, no transitive cloud-call risk.

6. **Dependency audit obligation** —
   - The `package.json` runtime dependencies must be audited on every PR — no LangChain-family package other than `@langchain/textsplitters`; no LlamaIndex; no Haystack; no AnythingLLM; no RAGFlow; no unstructured.io.
   - The audit is automated (a CI check — e.g., `depcheck` with a denylist).
   - Transitive dependencies of `@langchain/textsplitters` must be reviewed on upgrade — if a future version pulls in a cloud-call package, pin to the older version or replace with a SmartAgentics-owned splitter.

7. **Phase 3+ re-evaluation reserved** —
   - The policy reserves the right to adopt a framework in Phase 3+ **IF**:
     (a) A Phase 2+ evaluation demonstrates that the SmartAgentics-owned abstractions are insufficient (e.g., a complex multi-agent RAG use case that the thin abstraction cannot support).
     (b) The framework has shed its dependency-bloat / silent-fallback / breaking-change risk (e.g., LlamaIndex.TS publishes a "no-cloud-fallback" guarantee; LangChain.js publishes a stable LTS).
     (c) The framework's license is permissive (Apache-2.0 or MIT) with no model-weight licensing friction.
     (d) An ADR is drafted and accepted that supersedes this policy.
   - Until then, the thin SmartAgentics-owned abstractions are the contract.

8. **Patterns adopted from frameworks (reference use)** —
   - **From LangChain.js**: the markdown-aware recursive character splitter pattern (implemented via `@langchain/textsplitters`); the `Document` `{ pageContent, metadata }` shape (adapted to `KnowledgeChunk`); the parent-child retrieval pattern (ADR-026).
   - **From LlamaIndex.TS**: the `Retriever` + `RagGenerator` separation; the `PropertyGraphIndex` pattern (reserved for Phase 2+ KG augmentation, ADR-028 §9); the citation post-processor pattern (ADR-032).
   - **From Haystack**: the pipeline-DAG pattern (reserved for Phase 2+ complex pipelines, if needed).
   - **From AnythingLLM**: the "workspace" concept (a tenant's knowledge base is a workspace; ADR-028).
   - **From RAGFlow**: the batch-ingest workflow pattern (ADR-036 batch CLI).

9. **Extends Stream 2's framework-avoidance** —
   - Stream 2 (ADR-022/023/024/025/026/027) already chose SmartAgentics-owned abstractions for embeddings, vector store, retriever, reranker, chunker, multi-tenant isolation.
   - This ADR extends the same policy to the generation layer (`RagGenerator`, `CitationResolver`, `RagEvaluator`) and the ingestion layer (`DocumentParser`, `DocumentIngester`, `KnowledgeStore`).
   - The full Stream 3 SDK surface (`packages/sdk/src/ai/knowledge/` per ADR-028 §13.1) is SmartAgentics-owned.

10. **Feeds Stream 5 (Agent Runtime)** —
    - Agents use the SmartAgentics-owned `RagGenerator` as a tool, not a LangChain chain or LlamaIndex query engine.
    - The `RagResponse.citations` array (ADR-032) is what agents cite when explaining their reasoning.
    - The `RagResponse.confidence` (ADR-033) is what agents use to decide whether to ask a clarifying question or escalate to a human.
    - Stream 5's agent abstractions are also SmartAgentics-owned — no LangChain agents, no LlamaIndex agents.

## 5. Rationale

- **The LlamaIndex "silent OpenAI fallback" hazard is real and documented** — Reddit r/LocalLLaMA: "If you are building a Local-First RAG using LlamaIndex, double-check your dependency injections right now. There is a silent fallback mechanism [to OpenAI]..." — evidence that framework abstractions can violate offline-first guarantees. For an offline Windows installer targeting hotel-chain customers who may be air-gapped or have no-cloud-egress compliance requirements, this hazard is unacceptable (research §4.2, risk R-3.7).
- **SmartAgentics' RAG needs are narrow and well-defined** — Research §4.3: "the LangChain/LlamaIndex abstractions are valuable for prototyping but their full surface area (agents, chains, retrievers, memories, vector-store adapters, document-loaders) is a liability for an offline Windows installer: dependency bloat, silent-cloud-fallback risk, breaking-change churn. SmartAgentics' RAG needs are narrow and well-defined; a ~500-line TypeScript module suffices."
- **`@langchain/textsplitters` is small, focused, MIT-licensed** — The markdown-aware recursive splitter is a self-contained package with no transitive cloud-call risk. It is the exception to the no-LangChain-family rule. Must be pinned and audited on upgrade (research §4.3).
- **Build-vs-Buy Matrix lists "Knowledge Engine (likely LlamaIndex)" as Phase 2+** — Research FC-3.1: the AI-BOS directive reclassifies it as NOW, but the reclassification is about the _contract_ (NOW), not the _implementation_ (Phase 1 PoC acceptable). The SmartAgentics-owned abstractions are the contract; LlamaIndex is NOT adopted as the implementation (research §0 Executive Summary, §11 FC-3.1).
- **Thin owned abstraction mirrors Stream 1 and Stream 2 conclusions** — Stream 1's `LocalLLMRuntime` (ADR-015) wraps Ollama via HTTP (not linked as a library). Stream 2's `VectorStore` (ADR-023), `EmbeddingsRuntime` (ADR-022), `Retriever` (ADR-024), `Reranker` (ADR-025), `Chunker` (ADR-026) are SmartAgentics-owned interfaces with swappable implementations. Stream 3's `RagGenerator` / `CitationResolver` / `RagEvaluator` / `DocumentParser` / `DocumentIngester` / `KnowledgeStore` follow the same pattern (research §0, §13.1).
- **Fail-closed on `LocalLLMRuntime.isAvailable()`** — Risk R-3.7 mitigation: "SmartAgentics owns the abstraction; no framework that auto-falls-back; explicit `runtime.isAvailable()` check before each call; fail-closed (return error, never silently call cloud)." This is the architectural guarantee that the system never silently calls a cloud LLM.
- **Dependency audit obligation** — The `package.json` runtime dependencies must be audited on every PR. The audit is automated (CI check). This prevents accidental adoption of a framework via a transitive dependency or a copy-paste from a tutorial.
- **Patterns adopted from frameworks (reference use)** — LangChain's text-splitter pattern, LlamaIndex's `Retriever` + `RagGenerator` separation, AnythingLLM's workspace concept, RAGFlow's batch-ingest pattern. These inform the SmartAgentics-owned abstractions without adopting the frameworks as runtime dependencies (research §4.3, §3.5).
- **Phase 3+ re-evaluation reserved** — The policy is not dogmatic. If a Phase 2+ evaluation demonstrates that the SmartAgentics-owned abstractions are insufficient AND a framework has shed its risks, an ADR may supersede this policy. Until then, the thin abstractions are the contract (research §4.3).
- **Rejecting LangChain.js full runtime (Option A)** — Dependency bloat; silent-fallback risk (research §4.3).
- **Rejecting LlamaIndex.TS full runtime (Option B)** — Silent OpenAI fallback hazard (research §4.2); parity lag; dependency bloat.
- **Rejecting Haystack (Option C)** — Python-first; Node.js parity weak (research §4.3).
- **Rejecting AnythingLLM (Option D)** — GUI app, not a library (research §3.5).
- **Rejecting RAGFlow (Option E)** — Server-based, not embedded-friendly (research §3.5).

## 6. Consequences

**Positive**:

- No framework dependency bloat — the offline Windows installer stays minimal.
- No silent-cloud-fallback hazard — fail-closed on `LocalLLMRuntime.isAvailable()`; the system never silently calls a cloud LLM (risk R-3.7 mitigation).
- SmartAgentics-owned abstractions are the contract — parsers, stores, retrievers, generators, citation resolvers, evaluators are all swappable.
- `@langchain/textsplitters` is the only LangChain-family runtime dep — small, focused, MIT-licensed.
- Patterns adopted from frameworks (reference use) inform the abstractions without adopting the frameworks.
- Phase 3+ re-evaluation is reserved — the policy is not dogmatic.
- Dependency audit obligation (CI check) prevents accidental framework adoption.
- Feeds Stream 5 (Agent Runtime) — agents use the SmartAgentics-owned `RagGenerator` as a tool, not a LangChain chain or LlamaIndex query engine.

**Negative / obligations**:

- Phase 1 must implement `OllamaRagGenerator` + `ChunkIdCitationResolver` + `CoverageConfidence` + 6 Tier-1 parsers + `SqliteIngester` + `SqliteKnowledgeStore` + `ChokidarWatcher` — estimated 4–6 weeks total (research §13.3). This is the cost of owning the abstractions.
- The SmartAgentics-owned abstractions must be maintained — bug fixes, feature additions, performance tuning are SmartAgentics' responsibility, not the framework maintainers'.
- `@langchain/textsplitters` must be pinned and audited on upgrade — transitive dependencies must be reviewed; if a future version pulls in a cloud-call package, pin to the older version or replace with a SmartAgentics-owned splitter.
- The dependency audit CI check must be maintained — the denylist must be updated as new frameworks emerge.
- The fail-closed `LocalLLMRuntime.isAvailable()` check adds a small latency overhead per LLM call — negligible (a local HTTP health check).
- Stream 5 (Agent Runtime) must follow the same policy — no LangChain agents, no LlamaIndex agents. Stream 5's agent abstractions are also SmartAgentics-owned.
- Documentation must be clear that LangChain/LlamaIndex patterns are adopted as _reference_ — developers may be tempted to `npm install` the full framework; the CI check prevents this.
- The Phase 3+ re-evaluation criteria are subjective ("insufficient abstractions", "shed its risks") — an ADR draft is required to supersede this policy; the bar is intentionally high.
- The SmartAgentics-owned `RagGenerator` may lag behind framework features (e.g., LangChain's agent ecosystem, LlamaIndex's property-graph index) — Phase 2+ extensions (KG augmentation per ADR-028 §9) are SmartAgentics' responsibility.
- The ~500-line TypeScript module estimate is for Phase 1 PoC — production hardening (streaming, retries, timeout, observability) may grow it to ~1000–2000 lines.

**Dependencies on other ADRs**:

- Depends on ADR-015 (Local AI Runtime) — `LocalLLMRuntime` (Ollama HTTP API); `isAvailable()` fail-closed check; Phi-3.5-mini Phase 1 default.
- Depends on ADR-022 (Local Embeddings) — `EmbeddingsRuntime` (Stream 2 SmartAgentics-owned abstraction).
- Depends on ADR-023 (Vector Store) — `VectorStore` (Stream 2 SmartAgentics-owned abstraction; sqlite-vec).
- Depends on ADR-024 (Hybrid Search) — `Retriever` (Stream 2 SmartAgentics-owned abstraction; BM25 + vector + RRF).
- Depends on ADR-025 (Reranker) — `Reranker` (Stream 2 SmartAgentics-owned abstraction; Phase 2+ `bge-reranker-v2-m3`).
- Depends on ADR-026 (Document Chunking) — `Chunker` (Stream 2 SmartAgentics-owned abstraction; uses `@langchain/textsplitters`).
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` non-optional on every interface.
- Depends on ADR-028 (Knowledge Base Architecture) — `KnowledgeStore` + `DocumentIngester` (Stream 3 SmartAgentics-owned abstractions).
- Depends on ADR-029 (Parser Stack) — `DocumentParser` (Stream 3 SmartAgentics-owned abstraction; Tier-1/2/3 implementations).
- Depends on ADR-030 (RAG Pipeline) — `RagGenerator` (Stream 3 SmartAgentics-owned abstraction; `OllamaRagGenerator` reference impl).
- Depends on ADR-032 (Source Attribution & Citation) — `CitationResolver` (Stream 3 SmartAgentics-owned abstraction).
- Depends on ADR-033 (Confidence Scoring) — `RagEvaluator` (Stream 3 SmartAgentics-owned abstraction).
- Depends on ADR-001 (Reference Stack) — Next.js stack; Auth.js; Restate; the offline-first principle.
- Feeds Stream 5 (Agent Runtime) — agents use the SmartAgentics-owned `RagGenerator` as a tool, not a LangChain chain or LlamaIndex query engine. Stream 5's agent abstractions are also SmartAgentics-owned.
- Feeds Stream 6 (Multi-Agent Collaboration) — agents share `RetrievedChunk` objects with stable `chunkId`s; no framework-mediated message passing.
- Feeds Stream 8 (Security & Governance) — the fail-closed `isAvailable()` check is the architectural guarantee of no cloud egress; the dependency audit is a compliance surface.
- Compatible with ADR-013 (Observability Strategy) — every SmartAgentics-owned abstraction is traced (no framework-mediated opaque calls).
- Compatible with ADR-020 (Model Licensing) — no framework with non-permissive model-weight licensing (e.g., Surya RAIL-M weights, FC-3.4) is allowed.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A Phase 2+ evaluation demonstrates that the SmartAgentics-owned abstractions are insufficient** (e.g., a complex multi-agent RAG use case that the thin abstraction cannot support) — draft a superseding ADR evaluating framework adoption; verify the framework has shed its dependency-bloat / silent-fallback / breaking-change risk.
2. **LlamaIndex.TS publishes a "no-cloud-fallback" guarantee** (or LangChain.js publishes a stable LTS) — re-evaluate framework adoption for the generation layer.
3. **`@langchain/textsplitters` introduces a breaking change or unwanted transitive dependency** — pin to a stable version; evaluate forking the splitter or replacing with a SmartAgentics-owned implementation.
4. **A silent cloud-egress event is detected in production** (a framework auto-fell-back to a cloud LLM) — root-cause analysis; tighten the dependency audit; verify no framework is in the dependency tree; add an automated cloud-egress detection test.
5. **A new RAG framework** (e.g., a future TypeScript-first framework with no-cloud-fallback guarantee) becomes viable — evaluate against the Phase 3+ re-evaluation criteria.
6. **The SmartAgentics-owned abstractions' maintenance burden becomes unsustainable** (e.g., bug-fix backlog, feature-request backlog) — evaluate framework adoption; consider contributing the SmartAgentics-owned abstractions upstream to a framework.
7. **A customer demands a specific framework** (e.g., "we want LangChain because our team knows it") — evaluate the trade-off; the offline-first and no-silent-fallback guarantees are non-negotiable.
8. **Stream 5 (Agent Runtime) requires framework-mediated agent orchestration** (e.g., LangGraph-style state machines) — evaluate Stream 5's framework policy in coordination with this ADR.
9. **The dependency audit CI check fails** (a framework is accidentally adopted) — root-cause analysis; tighten the audit; verify no silent-fallback risk was introduced.
10. **Annually**, as part of the regular ADR review cycle.
