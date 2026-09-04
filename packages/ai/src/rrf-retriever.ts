/**
 * RrfRetriever — hybrid-search `Retriever` using Reciprocal Rank Fusion
 * (ADR-024, RRF k=60 TREC default).
 *
 * The retriever is a fusion LAYER: it delegates keyword (BM25) and vector
 * (semantic) retrieval to two injectable upstream result providers, then
 * fuses their ranked lists via RRF (`score = Σ weightᵢ / (k + rankᵢ)`). This
 * realizes the "pre-computed results fused by the caller" intent through
 * dependency injection — the composition root supplies the keyword / vector
 * providers, and `retrieve()` orchestrates the fusion behind the standard
 * `Retriever` contract.
 *
 * Behaviour by strategy:
 *  - `'keyword'`  → returns the keyword provider's results (no fusion).
 *  - `'semantic'` → returns the vector provider's results (no fusion).
 *  - `'hybrid'` (default) → fuses both via RRF. If only one provider returns
 *    results, that side is returned as-is (no fusion needed).
 *
 * Tenant isolation is enforced: `options.tenantId` is mandatory (ADR-027 — no
 * unscoped retrieval path), and results are filtered to the requesting tenant
 * as defense-in-depth even if an upstream provider mis-scopes. Each provider
 * is asked for `k × candidateMultiplier` candidates before fusion so RRF has
 * headroom to surface deep-but-relevant hits.
 *
 * @see Retriever — implemented contract.
 */

import type { Retriever, SearchResult, RetrievalOptions } from '@smartagentics/sdk';

/** A function that produces ranked results for a query (keyword or vector). */
export type ResultProvider = (
  query: string,
  options: RetrievalOptions,
) => Promise<readonly SearchResult[]>;

/** Canonical TREC RRF constant. */
const DEFAULT_RRF_K = 60;

/** Default candidate multiplier (each provider fetches `k × multiplier` rows). */
const DEFAULT_CANDIDATE_MULTIPLIER = 3;

/** Default `k` when the caller does not supply a positive value. */
const DEFAULT_K = 10;

/** Constructor options for {@link RrfRetriever}. */
export interface RrfRetrieverOptions {
  /** BM25 / keyword result provider. Required for `'keyword'` / `'hybrid'`. */
  readonly keywordRetriever?: ResultProvider;
  /** Vector / semantic result provider. Required for `'semantic'` / `'hybrid'`. */
  readonly vectorRetriever?: ResultProvider;
  /** RRF `k` constant (default 60). Overridable per-call via `options.hybrid.rrf.k`. */
  readonly rrfK?: number;
  /** Candidate multiplier (default 3). */
  readonly candidateMultiplier?: number;
}

/**
 * Hybrid retriever that fuses keyword + vector results via Reciprocal Rank
 * Fusion. Configure with one or both upstream providers at construction time;
 * the per-call `options.strategy` selects which path(s) to run.
 */
export class RrfRetriever implements Retriever {
  private readonly keywordRetriever?: ResultProvider;
  private readonly vectorRetriever?: ResultProvider;
  private readonly rrfK: number;
  private readonly candidateMultiplier: number;

  public constructor(options: RrfRetrieverOptions = {}) {
    this.keywordRetriever = options.keywordRetriever;
    this.vectorRetriever = options.vectorRetriever;
    this.rrfK = options.rrfK ?? DEFAULT_RRF_K;
    this.candidateMultiplier = options.candidateMultiplier ?? DEFAULT_CANDIDATE_MULTIPLIER;
  }

  /**
   * Retrieves ranked chunks for `query`. Honors `options.strategy`
   * (`'hybrid'` default), `options.k`, and `options.hybrid.rrf` (k + per-side
   * weights). Results are filtered to `options.tenantId` and truncated to `k`.
   *
   * @throws {Error} if `options.tenantId` is missing, if `query` is empty, or
   *   if the selected strategy's required provider is not configured.
   */
  public async retrieve(
    query: string,
    options: RetrievalOptions,
  ): Promise<readonly SearchResult[]> {
    if (!options.tenantId) {
      throw new Error(
        'RrfRetriever.retrieve: options.tenantId is required (ADR-027 — no unscoped retrieval)',
      );
    }
    if (!query || !query.trim()) {
      throw new Error('RrfRetriever.retrieve: query must be a non-empty string');
    }
    const strategy = options.strategy ?? 'hybrid';
    const k = options.k > 0 ? options.k : DEFAULT_K;
    const candidateK = Math.max(k, Math.ceil(k * this.candidateMultiplier));
    const candidateOptions: RetrievalOptions = { ...options, k: candidateK };

    if (strategy === 'keyword') {
      return this.runOne('keyword', query, candidateOptions, k);
    }
    if (strategy === 'semantic') {
      return this.runOne('semantic', query, candidateOptions, k);
    }
    return this.runHybrid(query, candidateOptions, options, k);
  }

  /** Runs a single provider (keyword or semantic) and returns its top-k results. */
  private async runOne(
    kind: 'keyword' | 'semantic',
    query: string,
    candidateOptions: RetrievalOptions,
    k: number,
  ): Promise<readonly SearchResult[]> {
    const provider = kind === 'keyword' ? this.keywordRetriever : this.vectorRetriever;
    if (!provider) {
      throw new Error(`RrfRetriever: ${kind} retriever not configured (strategy='${kind}')`);
    }
    const results = await provider(query, candidateOptions);
    return this.topK(this.filterTenant(results, candidateOptions.tenantId), k);
  }

  /** Runs both providers in parallel and fuses their results via RRF. */
  private async runHybrid(
    query: string,
    candidateOptions: RetrievalOptions,
    originalOptions: RetrievalOptions,
    k: number,
  ): Promise<readonly SearchResult[]> {
    const tenantId = candidateOptions.tenantId;
    const rrfK = originalOptions.hybrid?.rrf?.k ?? this.rrfK;
    const semW = originalOptions.hybrid?.rrf?.semanticWeight ?? 1;
    const kwW = originalOptions.hybrid?.rrf?.keywordWeight ?? 1;

    const [kwResults, semResults] = await Promise.all([
      this.keywordRetriever
        ? this.keywordRetriever(query, candidateOptions)
        : Promise.resolve([] as readonly SearchResult[]),
      this.vectorRetriever
        ? this.vectorRetriever(query, candidateOptions)
        : Promise.resolve([] as readonly SearchResult[]),
    ]);

    // If one side is empty, return the other as-is (no fusion needed).
    if (kwResults.length === 0) {
      return this.topK(this.filterTenant(semResults, tenantId), k);
    }
    if (semResults.length === 0) {
      return this.topK(this.filterTenant(kwResults, tenantId), k);
    }

    const scores = new Map<string, { score: number; result: SearchResult }>();
    this.accumulate(kwResults, kwW, rrfK, tenantId, scores);
    this.accumulate(semResults, semW, rrfK, tenantId, scores);

    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((entry) => ({ ...entry.result, score: entry.score }));
  }

  /** Accumulates RRF contributions from one ranked list into the score map. */
  private accumulate(
    results: readonly SearchResult[],
    weight: number,
    rrfK: number,
    tenantId: string,
    scores: Map<string, { score: number; result: SearchResult }>,
  ): void {
    results.forEach((result, idx) => {
      if (result.tenantId !== tenantId) return; // defense-in-depth
      const rank = idx + 1; // RRF ranks are 1-based
      const contribution = weight / (rrfK + rank);
      const existing = scores.get(result.chunkId);
      if (existing) {
        existing.score += contribution;
      } else {
        scores.set(result.chunkId, { score: contribution, result });
      }
    });
  }

  /** Filters results to the requesting tenant (defense-in-depth isolation). */
  private filterTenant(
    results: readonly SearchResult[],
    tenantId: string,
  ): readonly SearchResult[] {
    return results.filter((r) => r.tenantId === tenantId);
  }

  /** Truncates a (pre-sorted) result list to the first `k` entries. */
  private topK(results: readonly SearchResult[], k: number): readonly SearchResult[] {
    return results.slice(0, k);
  }
}
