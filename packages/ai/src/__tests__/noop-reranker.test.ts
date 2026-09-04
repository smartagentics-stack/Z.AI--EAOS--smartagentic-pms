/**
 * Integration tests for NoopReranker (ADR-025 Phase 1 default).
 *
 * The NoopReranker is an identity passthrough: it returns candidates in their
 * original order with scores preserved, and is unconditionally healthy.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NoopReranker } from '../noop-reranker.js';
import type { Reranker, SearchResult } from '@smartagentics/sdk';

/** Builds a SearchResult with the given chunkId and score. */
function makeResult(chunkId: string, score: number, tenantId = 'tenant-1'): SearchResult {
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

describe('NoopReranker', () => {
  let reranker: Reranker;

  beforeEach(() => {
    reranker = new NoopReranker();
  });

  describe('rerank', () => {
    it('returns candidates in the same order with scores preserved', async () => {
      const candidates = [makeResult('a', 0.9), makeResult('b', 0.5), makeResult('c', 0.1)];
      const output = await reranker.rerank({ query: 'hello', candidates });
      expect(output.reranked.map((r) => r.chunkId)).toEqual(['a', 'b', 'c']);
      expect(output.reranked.map((r) => r.score)).toEqual([0.9, 0.5, 0.1]);
    });

    it('returns empty output for empty input', async () => {
      const output = await reranker.rerank({ query: 'hello', candidates: [] });
      expect(output.reranked).toEqual([]);
    });

    it('preserves candidate object identity (passthrough)', async () => {
      const a = makeResult('a', 0.9);
      const output = await reranker.rerank({ query: 'hello', candidates: [a] });
      expect(output.reranked[0]).toBe(a);
    });

    it('truncates to options.topK when provided', async () => {
      const candidates = [makeResult('a', 0.9), makeResult('b', 0.5), makeResult('c', 0.1)];
      const output = await reranker.rerank({
        query: 'hello',
        candidates,
        options: { tenantId: 'tenant-1', topK: 2 },
      });
      expect(output.reranked).toHaveLength(2);
      expect(output.reranked.map((r) => r.chunkId)).toEqual(['a', 'b']);
    });

    it('returns all candidates when topK exceeds the candidate count', async () => {
      const candidates = [makeResult('a', 0.9), makeResult('b', 0.5)];
      const output = await reranker.rerank({
        query: 'hello',
        candidates,
        options: { tenantId: 'tenant-1', topK: 10 },
      });
      expect(output.reranked).toHaveLength(2);
    });

    it('reports the noop strategy in the output', async () => {
      const output = await reranker.rerank({ query: 'hello', candidates: [] });
      expect(output.strategy).toBe('noop');
    });

    it('reports the noop modelId in the output', async () => {
      const output = await reranker.rerank({ query: 'hello', candidates: [] });
      expect(output.modelId).toBe('noop-reranker');
    });

    it('reports a non-negative latency', async () => {
      const output = await reranker.rerank({ query: 'hello', candidates: [makeResult('a', 1)] });
      expect(output.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('health', () => {
    it('reports healthy with the noop model loaded', async () => {
      const health = await reranker.health!();
      expect(health.modelId).toBe('noop-reranker');
      expect(health.loaded).toBe(true);
      expect(health.healthy).toBe(true);
      expect(health.errorMessage).toBeNull();
    });
  });

  describe('isAvailable (convenience accessor)', () => {
    it('returns true (no model to load)', () => {
      const noop = reranker as NoopReranker;
      expect(noop.isAvailable()).toBe(true);
    });
  });

  describe('getName (convenience accessor)', () => {
    it("returns 'noop-reranker'", () => {
      const noop = reranker as NoopReranker;
      expect(noop.getName()).toBe('noop-reranker');
    });
  });
});
