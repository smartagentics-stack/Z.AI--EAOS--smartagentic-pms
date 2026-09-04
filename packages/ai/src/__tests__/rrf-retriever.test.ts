/**
 * Integration tests for RrfRetriever (ADR-024 hybrid search, RRF k=60 TREC default).
 *
 * Verifies single-provider passthrough (keyword-only / vector-only), RRF fusion
 * when both providers return results, the exact RRF formula
 * (score = Σ weightᵢ / (k + rankᵢ)), tenant isolation enforcement, and
 * error handling for missing tenantId / empty query / unconfigured providers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RrfRetriever, type ResultProvider } from '../rrf-retriever.js';
import type { Retriever, SearchResult, RetrievalOptions } from '@smartagentics/sdk';

const TENANT = 'tenant-1';

/** Builds a SearchResult. */
function makeResult(chunkId: string, score: number, tenantId = TENANT): SearchResult {
  return {
    chunkId,
    docId: 'doc-1',
    docVersion: 1,
    score,
    text: `text for ${chunkId}`,
    headerPath: 'Section',
    parentChunkId: 'doc-1#p0',
    tenantId,
    metadata: {},
  };
}

/** Builds RetrievalOptions (tenant-scoped). */
function opts(overrides: Partial<RetrievalOptions> = {}): RetrievalOptions {
  return { k: 10, tenantId: TENANT, ...overrides };
}

describe('RrfRetriever', () => {
  let keywordProvider: ResultProvider;
  let vectorProvider: ResultProvider;

  beforeEach(() => {
    keywordProvider = async () => [];
    vectorProvider = async () => [];
  });

  describe('single-provider passthrough', () => {
    it('strategy="keyword" returns the keyword provider results as-is (truncated to k)', async () => {
      const kwResults = [makeResult('a', 0.9), makeResult('b', 0.5)];
      keywordProvider = async () => kwResults;
      const retriever: Retriever = new RrfRetriever({ keywordRetriever: keywordProvider });
      const results = await retriever.retrieve('query', opts({ strategy: 'keyword', k: 10 }));
      expect(results.map((r) => r.chunkId)).toEqual(['a', 'b']);
    });

    it('strategy="semantic" returns the vector provider results as-is', async () => {
      const vecResults = [makeResult('x', 0.8), makeResult('y', 0.4)];
      vectorProvider = async () => vecResults;
      const retriever: Retriever = new RrfRetriever({ vectorRetriever: vectorProvider });
      const results = await retriever.retrieve('query', opts({ strategy: 'semantic' }));
      expect(results.map((r) => r.chunkId)).toEqual(['x', 'y']);
    });

    it('hybrid with only keyword results returns them as-is (no fusion needed)', async () => {
      keywordProvider = async () => [makeResult('a', 0.9), makeResult('b', 0.5)];
      vectorProvider = async () => [];
      const retriever: Retriever = new RrfRetriever({
        keywordRetriever: keywordProvider,
        vectorRetriever: vectorProvider,
      });
      const results = await retriever.retrieve('query', opts({ strategy: 'hybrid' }));
      expect(results.map((r) => r.chunkId)).toEqual(['a', 'b']);
      // scores preserved (no fusion applied)
      expect(results.map((r) => r.score)).toEqual([0.9, 0.5]);
    });

    it('hybrid with only vector results returns them as-is (no fusion needed)', async () => {
      keywordProvider = async () => [];
      vectorProvider = async () => [makeResult('x', 0.8), makeResult('y', 0.4)];
      const retriever: Retriever = new RrfRetriever({
        keywordRetriever: keywordProvider,
        vectorRetriever: vectorProvider,
      });
      const results = await retriever.retrieve('query', opts({ strategy: 'hybrid' }));
      expect(results.map((r) => r.chunkId)).toEqual(['x', 'y']);
      expect(results.map((r) => r.score)).toEqual([0.8, 0.4]);
    });
  });

  describe('RRF fusion (both providers return results)', () => {
    it('fuses keyword + vector via RRF (k=60) and sorts by fused score descending', async () => {
      // keyword ranks: A(1), B(2), C(3)
      keywordProvider = async () => [
        makeResult('A', 0.9),
        makeResult('B', 0.5),
        makeResult('C', 0.3),
      ];
      // vector ranks: C(1), A(2)
      vectorProvider = async () => [makeResult('C', 0.95), makeResult('A', 0.7)];
      const retriever: Retriever = new RrfRetriever({
        keywordRetriever: keywordProvider,
        vectorRetriever: vectorProvider,
      });
      const results = await retriever.retrieve('query', opts({ strategy: 'hybrid' }));

      // Expected fused scores (k=60, weights=1):
      // A = 1/(60+1) + 1/(60+2) = 1/61 + 1/62 ≈ 0.0325224749
      // C = 1/(60+3) + 1/(60+1) = 1/63 + 1/61 ≈ 0.0322664585
      // B = 1/(60+2) = 1/62 ≈ 0.0161290323
      expect(results.map((r) => r.chunkId)).toEqual(['A', 'C', 'B']);
    });

    it('applies the exact RRF formula score = Σ 1/(k + rank_i)', async () => {
      keywordProvider = async () => [
        makeResult('A', 0.9),
        makeResult('B', 0.5),
        makeResult('C', 0.3),
      ];
      vectorProvider = async () => [makeResult('C', 0.95), makeResult('A', 0.7)];
      const retriever: Retriever = new RrfRetriever({
        keywordRetriever: keywordProvider,
        vectorRetriever: vectorProvider,
      });
      const results = await retriever.retrieve('query', opts({ strategy: 'hybrid' }));
      const a = results.find((r) => r.chunkId === 'A')!;
      const expectedScoreA = 1 / (60 + 1) + 1 / (60 + 2); // rank1 keyword + rank2 vector
      expect(a.score).toBeCloseTo(expectedScoreA, 10);

      const c = results.find((r) => r.chunkId === 'C')!;
      const expectedScoreC = 1 / (60 + 3) + 1 / (60 + 1); // rank3 keyword + rank1 vector
      expect(c.score).toBeCloseTo(expectedScoreC, 10);

      const b = results.find((r) => r.chunkId === 'B')!;
      const expectedScoreB = 1 / (60 + 2); // rank2 keyword only
      expect(b.score).toBeCloseTo(expectedScoreB, 10);
    });

    it('honors a custom rrfK supplied via options.hybrid.rrf.k', async () => {
      keywordProvider = async () => [makeResult('A', 0.9)];
      vectorProvider = async () => [makeResult('A', 0.8)];
      const retriever: Retriever = new RrfRetriever({
        keywordRetriever: keywordProvider,
        vectorRetriever: vectorProvider,
      });
      const results = await retriever.retrieve(
        'query',
        opts({
          strategy: 'hybrid',
          hybrid: {
            rrf: { k: 10, candidateMultiplier: 1 },
            defaultStrategy: 'hybrid',
            defaultK: 10,
          },
        }),
      );
      // A appears at rank 1 in both → score = 1/(10+1) + 1/(10+1) = 2/11
      expect(results[0].score).toBeCloseTo(2 / 11, 10);
    });

    it('deduplicates by chunkId, summing contributions from both lists', async () => {
      keywordProvider = async () => [makeResult('shared', 0.9), makeResult('kw-only', 0.5)];
      vectorProvider = async () => [makeResult('shared', 0.95), makeResult('vec-only', 0.4)];
      const retriever: Retriever = new RrfRetriever({
        keywordRetriever: keywordProvider,
        vectorRetriever: vectorProvider,
      });
      const results = await retriever.retrieve('query', opts({ strategy: 'hybrid' }));
      const ids = results.map((r) => r.chunkId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain('shared');
      expect(ids).toContain('kw-only');
      expect(ids).toContain('vec-only');
      // 'shared' ranks #1 in both → highest fused score → first
      expect(results[0].chunkId).toBe('shared');
    });

    it('truncates the fused result list to k', async () => {
      keywordProvider = async () =>
        Array.from({ length: 8 }, (_, i) => makeResult(`kw${i}`, 1 - i * 0.1));
      vectorProvider = async () =>
        Array.from({ length: 8 }, (_, i) => makeResult(`vec${i}`, 1 - i * 0.1));
      const retriever: Retriever = new RrfRetriever({
        keywordRetriever: keywordProvider,
        vectorRetriever: vectorProvider,
      });
      const results = await retriever.retrieve('query', opts({ strategy: 'hybrid', k: 3 }));
      expect(results).toHaveLength(3);
    });
  });

  describe('tenant isolation', () => {
    it('throws when tenantId is missing (ADR-027 — no unscoped retrieval)', async () => {
      const retriever: Retriever = new RrfRetriever({ keywordRetriever: keywordProvider });
      await expect(retriever.retrieve('query', { k: 10, tenantId: '' })).rejects.toThrow(
        /options\.tenantId is required/,
      );
    });

    it('filters out results from other tenants (defense-in-depth)', async () => {
      keywordProvider = async () => [
        makeResult('a', 0.9, TENANT),
        makeResult('b', 0.8, 'tenant-OTHER'),
      ];
      const retriever: Retriever = new RrfRetriever({ keywordRetriever: keywordProvider });
      const results = await retriever.retrieve('query', opts({ strategy: 'keyword' }));
      expect(results.map((r) => r.chunkId)).toEqual(['a']);
    });
  });

  describe('empty inputs', () => {
    it('returns an empty array when both providers return nothing (hybrid)', async () => {
      const retriever: Retriever = new RrfRetriever({
        keywordRetriever: keywordProvider,
        vectorRetriever: vectorProvider,
      });
      const results = await retriever.retrieve('query', opts({ strategy: 'hybrid' }));
      expect(results).toEqual([]);
    });

    it('returns an empty array when the keyword provider returns nothing (keyword strategy)', async () => {
      const retriever: Retriever = new RrfRetriever({ keywordRetriever: keywordProvider });
      const results = await retriever.retrieve('query', opts({ strategy: 'keyword' }));
      expect(results).toEqual([]);
    });
  });

  describe('input validation', () => {
    it('throws when the query is empty', async () => {
      const retriever: Retriever = new RrfRetriever({ keywordRetriever: keywordProvider });
      await expect(retriever.retrieve('', opts())).rejects.toThrow(
        /query must be a non-empty string/,
      );
    });

    it('throws when the query is whitespace-only', async () => {
      const retriever: Retriever = new RrfRetriever({ keywordRetriever: keywordProvider });
      await expect(retriever.retrieve('   ', opts())).rejects.toThrow(
        /query must be a non-empty string/,
      );
    });

    it('throws when strategy="keyword" but no keyword provider is configured', async () => {
      const retriever: Retriever = new RrfRetriever({});
      await expect(retriever.retrieve('query', opts({ strategy: 'keyword' }))).rejects.toThrow(
        /keyword retriever not configured/,
      );
    });

    it('throws when strategy="semantic" but no vector provider is configured', async () => {
      const retriever: Retriever = new RrfRetriever({});
      await expect(retriever.retrieve('query', opts({ strategy: 'semantic' }))).rejects.toThrow(
        /semantic retriever not configured/,
      );
    });
  });

  describe('default strategy', () => {
    it('defaults to hybrid when no strategy is supplied', async () => {
      keywordProvider = async () => [makeResult('a', 0.9)];
      vectorProvider = async () => [makeResult('b', 0.8)];
      const retriever: Retriever = new RrfRetriever({
        keywordRetriever: keywordProvider,
        vectorRetriever: vectorProvider,
      });
      const results = await retriever.retrieve('query', opts());
      // both present → fusion → 2 distinct chunks
      expect(results).toHaveLength(2);
    });
  });
});
