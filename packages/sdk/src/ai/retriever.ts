// ADR-024 Hybrid Search — BM25 (SQLite FTS5) + Vector (sqlite-vec) + Reciprocal Rank Fusion.
// Default strategy: 'hybrid' with RRF k=60 (canonical TREC default).
// tenantId is MANDATORY on every retrieval call (ADR-027 — no unscoped retrieval path).

/** Retrieval strategy. Default: 'hybrid'. */
export type RetrievalStrategy = 'hybrid' | 'semantic' | 'keyword';

/** Ranked chunk returned by the retriever. */
export interface SearchResult {
  readonly chunkId: string;
  readonly docId: string;
  readonly docVersion: number;
  readonly score: number;
  readonly text: string;
  readonly headerPath: string;
  readonly parentChunkId: string | null;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly department?: string;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

/** Search query parameters. `tenantId` is MANDATORY. */
export interface SearchQuery {
  readonly query: string;
  readonly k: number;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly filter?: Readonly<Record<string, string | number | boolean | null>>;
  readonly strategy?: RetrievalStrategy;
  readonly rerank?: boolean;
}

/** Reciprocal Rank Fusion configuration per ADR-024 §4 (TREC default k=60). */
export interface RRFConfig {
  /** RRF constant; canonical default = 60. */
  readonly k: number;
  /** Candidate multiplier — each retriever fetches k * candidateMultiplier rows before fusion. */
  readonly candidateMultiplier: number;
  /** Optional per-retriever weight (default: equal weight). */
  readonly semanticWeight?: number;
  readonly keywordWeight?: number;
}

/** Hybrid search configuration passed to a HybridRetriever implementation. */
export interface HybridSearchConfig {
  readonly rrf: RRFConfig;
  readonly defaultStrategy: RetrievalStrategy;
  readonly defaultK: number;
}

/** Options controlling the retrieval pipeline (strategy, k, filter, RRF config). */
export interface RetrievalOptions {
  readonly k: number;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly filter?: Readonly<Record<string, string | number | boolean | null>>;
  readonly strategy?: RetrievalStrategy;
  readonly rerank?: boolean;
  readonly hybrid?: HybridSearchConfig;
}

/**
 * Retriever contract per ADR-024. Single entry point for query → ranked chunks.
 * Default strategy = hybrid (BM25 + vector + RRF k=60).
 */
export interface Retriever {
  retrieve(query: string, options: RetrievalOptions): Promise<readonly SearchResult[]>;
}
