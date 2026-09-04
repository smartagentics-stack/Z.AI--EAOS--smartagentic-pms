/**
 * NoopReranker — Phase 1 default `Reranker` (ADR-025).
 *
 * Passes candidates through unchanged (identity rerank). This is the correct
 * default when reranking is unnecessary: small result sets, or when hybrid
 * retrieval quality is already sufficient. It introduces ZERO runtime
 * dependencies — the Phase 2+ `bge-reranker-v2-m3` cross-encoder is a
 * behind-the-interface swap (no consumer rewrite).
 *
 * The reranker is invoked by the Retriever (ADR-024) AFTER hybrid fusion and
 * BEFORE parent-child expansion. Because the noop reranker preserves order
 * and scores, the downstream pipeline behaves exactly as if no reranker were
 * present — but the contract is satisfied, so activating a real reranker
 * later is a single-line wiring change.
 *
 * @see Reranker — implemented contract.
 */

import type { Reranker, RerankerInput, RerankerOutput, ModelHealth } from '@smartagentics/sdk';

/** Stable identifier reported in `RerankerOutput.modelId` and `health()`. */
const NOOP_MODEL_ID = 'noop-reranker';

/** Semantic version reported by `health()` (the noop reranker has no artifact). */
const NOOP_MODEL_VERSION = '1.0.0';

/**
 * Phase 1 default reranker — identity passthrough.
 *
 * `rerank()` returns candidates in their original order (scores preserved).
 * `health()` is unconditionally healthy (no model to load). Convenience
 * accessors `isAvailable()` and `getName()` are provided for callers that
 * want a lightweight capability probe without awaiting `health()`; they are
 * not part of the `Reranker` contract but are safe additions.
 */
export class NoopReranker implements Reranker {
  /**
   * Returns candidates unchanged (passthrough). If `options.topK` is set,
   * the result is truncated to that many candidates; otherwise all
   * candidates are returned in their original order. Scores are preserved
   * as-is — the noop reranker makes no claim about relative quality.
   */
  public async rerank(input: RerankerInput): Promise<RerankerOutput> {
    const start = Date.now();
    const candidates = input.candidates;
    const topK = input.options?.topK;
    const reranked = topK != null && topK >= 0 ? candidates.slice(0, topK) : candidates;
    return {
      reranked,
      modelId: NOOP_MODEL_ID,
      strategy: 'noop',
      latencyMs: Date.now() - start,
    };
  }

  /**
   * Always reports healthy — the noop reranker has no model to load and no
   * runtime to probe, so it is unconditionally available. `loaded` is `true`
   * because there is nothing to load.
   */
  public async health(): Promise<ModelHealth> {
    return {
      modelId: NOOP_MODEL_ID,
      version: NOOP_MODEL_VERSION,
      loaded: true,
      healthy: true,
      latencyMs: 0,
      errorMessage: null,
    };
  }

  /**
   * Convenience accessor (not part of the `Reranker` contract): the noop
   * reranker is always available — there is no model or runtime to fail.
   */
  public isAvailable(): boolean {
    return true;
  }

  /**
   * Convenience accessor (not part of the `Reranker` contract): returns the
   * reranker's stable identifier, also reported in `RerankerOutput.modelId`.
   */
  public getName(): string {
    return NOOP_MODEL_ID;
  }
}
