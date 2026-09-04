/**
 * Integration tests for SimpleChunker (ADR-026 markdown-aware chunking).
 *
 * Verifies header-based section splitting, parent/child chunk emission,
 * SHA-256 chunkHash computation, deterministic IDs, graceful handling of
 * empty/whitespace documents, and chunkSize-driven paragraph windowing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SimpleChunker } from '../simple-chunker.js';
import type { Chunker, ChunkerDocument, ParentChunk, ChildChunk, Chunk } from '@smartagentics/sdk';

/** Builds a ChunkerDocument. */
function makeDoc(markdown: string, overrides: Partial<ChunkerDocument> = {}): ChunkerDocument {
  return {
    id: 'doc-1',
    tenantId: 'tenant-1',
    title: 'Front Desk Guide',
    markdown,
    language: 'en',
    documentType: 'sop',
    department: 'front-desk',
    ...overrides,
  };
}

/** SHA-256 hex digest via Web Crypto. */
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

describe('SimpleChunker', () => {
  let chunker: Chunker;

  beforeEach(() => {
    chunker = new SimpleChunker();
  });

  describe('header-based splitting', () => {
    const markdown = [
      '## Section A',
      '',
      'Content A.',
      '',
      '### Subsection A1',
      '',
      'Content A1.',
      '',
      '## Section B',
      '',
      'Content B.',
    ].join('\n');

    it('splits markdown by ## and ### headers into separate sections', async () => {
      const chunks = await chunker.chunk(makeDoc(markdown));
      const parents = chunks.filter((c): c is ParentChunk => c.kind === 'parent');
      expect(parents).toHaveLength(3);
      expect(parents.map((p) => p.headerPath)).toEqual([
        'Section A',
        'Section A › Subsection A1',
        'Section B',
      ]);
    });

    it('produces one child chunk per section paragraph', async () => {
      const chunks = await chunker.chunk(makeDoc(markdown));
      const children = chunks.filter((c): c is ChildChunk => c.kind === 'child');
      expect(children).toHaveLength(3);
      expect(children.map((c) => c.text)).toEqual(['Content A.', 'Content A1.', 'Content B.']);
    });

    it('emits parent chunks BEFORE their children in the result order', async () => {
      const chunks = await chunker.chunk(makeDoc(markdown));
      // Order should be: parent0, child0, parent1, child1, parent2, child2
      expect(chunks.map((c) => c.kind)).toEqual([
        'parent',
        'child',
        'parent',
        'child',
        'parent',
        'child',
      ]);
    });
  });

  describe('parent chunks (no embedding)', () => {
    it('parent chunks carry the header line + body text and have NO embedding field', async () => {
      const markdown = '## Section A\n\nContent A.';
      const chunks = await chunker.chunk(makeDoc(markdown));
      const parent = chunks.find((c): c is ParentChunk => c.kind === 'parent')!;
      expect(parent).toBeDefined();
      expect(parent.text).toBe('## Section A\nContent A.');
      expect('embedding' in parent).toBe(false);
      expect(parent.childCount).toBe(1);
      expect(parent.chunkIndex).toBe(0);
    });

    it('parent chunk id is deterministic: `${docId}#p${index}`', async () => {
      const markdown = '## A\n\nx\n\n## B\n\ny';
      const chunks = await chunker.chunk(makeDoc(markdown));
      const parents = chunks.filter((c): c is ParentChunk => c.kind === 'parent');
      expect(parents.map((p) => p.id)).toEqual(['doc-1#p0', 'doc-1#p1']);
    });

    it('stamps docVersion (default 1) on every chunk', async () => {
      const chunks = await chunker.chunk(makeDoc('## A\n\nx'));
      for (const c of chunks) expect(c.docVersion).toBe(1);
    });

    it('honors a custom defaultDocVersion passed to the constructor', async () => {
      const custom = new SimpleChunker({ defaultDocVersion: 7 });
      const chunks = await custom.chunk(makeDoc('## A\n\nx'));
      for (const c of chunks) expect(c.docVersion).toBe(7);
    });
  });

  describe('child chunks', () => {
    it('child chunks reference their parent via parentChunkId and carry a chunkIndex', async () => {
      const markdown = '## A\n\nfirst.\n\nsecond.';
      const chunks = await chunker.chunk(makeDoc(markdown));
      const children = chunks.filter((c): c is ChildChunk => c.kind === 'child');
      expect(children).toHaveLength(2);
      expect(children[0].parentChunkId).toBe('doc-1#p0');
      expect(children[1].parentChunkId).toBe('doc-1#p0');
      expect(children[0].chunkIndex).toBe(0);
      expect(children[1].chunkIndex).toBe(1);
      expect(children[0].id).toBe('doc-1#p0#c0');
      expect(children[1].id).toBe('doc-1#p0#c1');
    });

    it('child chunk text is the paragraph content', async () => {
      const markdown = '## A\n\nPara one.\n\nPara two.';
      const chunks = await chunker.chunk(makeDoc(markdown));
      const children = chunks.filter((c): c is ChildChunk => c.kind === 'child');
      expect(children.map((c) => c.text)).toEqual(['Para one.', 'Para two.']);
    });
  });

  describe('chunkHash (SHA-256)', () => {
    it('every chunk carries a 64-char hex chunkHash', async () => {
      const chunks = await chunker.chunk(makeDoc('## A\n\ncontent here'));
      for (const c of chunks) {
        expect(c.chunkHash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('parent chunkHash equals SHA-256 of the parent text', async () => {
      const markdown = '## A\n\ncontent here';
      const chunks = await chunker.chunk(makeDoc(markdown));
      const parent = chunks.find((c): c is ParentChunk => c.kind === 'parent')!;
      const expected = await sha256Hex(parent.text);
      expect(parent.chunkHash).toBe(expected);
    });

    it('child chunkHash equals SHA-256 of the child text', async () => {
      const markdown = '## A\n\ncontent here';
      const chunks = await chunker.chunk(makeDoc(markdown));
      const child = chunks.find((c): c is ChildChunk => c.kind === 'child')!;
      const expected = await sha256Hex(child.text);
      expect(child.chunkHash).toBe(expected);
    });

    it('identical text produces identical hashes across chunks', async () => {
      const markdown = '## A\n\nsame text\n\n## B\n\nsame text';
      const chunks = await chunker.chunk(makeDoc(markdown));
      const children = chunks.filter((c): c is ChildChunk => c.kind === 'child');
      expect(children[0].chunkHash).toBe(children[1].chunkHash);
    });
  });

  describe('determinism', () => {
    it('chunking the same document twice yields identical IDs and hashes', async () => {
      const markdown = '## A\n\none\n\n## B\n\ntwo';
      const first = await chunker.chunk(makeDoc(markdown));
      const second = await chunker.chunk(makeDoc(markdown));
      expect(second.map((c) => c.id)).toEqual(first.map((c) => c.id));
      expect(second.map((c) => c.chunkHash)).toEqual(first.map((c) => c.chunkHash));
    });
  });

  describe('empty / whitespace documents', () => {
    it('throws a clear error for an empty markdown string', async () => {
      await expect(chunker.chunk(makeDoc(''))).rejects.toThrow(/markdown must be non-empty/);
    });

    it('throws a clear error for a whitespace-only markdown string', async () => {
      await expect(chunker.chunk(makeDoc('   \n\n  \t  \n'))).rejects.toThrow(
        /markdown must be non-empty/,
      );
    });

    it('throws when document.id is missing', async () => {
      await expect(chunker.chunk(makeDoc('## A\n\nx', { id: '' }))).rejects.toThrow(
        /document\.id is required/,
      );
    });

    it('throws when document.tenantId is missing', async () => {
      await expect(chunker.chunk(makeDoc('## A\n\nx', { tenantId: '' }))).rejects.toThrow(
        /document\.tenantId is required/,
      );
    });
  });

  describe('chunkSize enforcement (paragraph windowing)', () => {
    it('splits a long paragraph into multiple overlapping windows when chunkSize is small', async () => {
      const longPara = 'word '.repeat(60).trim(); // ~300 chars
      const markdown = `## A\n\n${longPara}`;
      const chunks = await chunker.chunk(makeDoc(markdown), {
        chunkSize: 80,
        overlap: 0,
        parentSize: 1500,
      });
      const children = chunks.filter((c): c is ChildChunk => c.kind === 'child');
      expect(children.length).toBeGreaterThan(1);
      for (const c of children) {
        expect(c.text.length).toBeLessThanOrEqual(80);
      }
    });

    it('does not split a paragraph that fits within chunkSize', async () => {
      const markdown = '## A\n\nshort paragraph.';
      const chunks = await chunker.chunk(makeDoc(markdown), { chunkSize: 1200, overlap: 200 });
      const children = chunks.filter((c): c is ChildChunk => c.kind === 'child');
      expect(children).toHaveLength(1);
    });

    it('throws when chunkSize is non-positive', async () => {
      await expect(chunker.chunk(makeDoc('## A\n\nx'), { chunkSize: 0 })).rejects.toThrow(
        /chunkSize must be positive/,
      );
    });

    it('throws when overlap is negative', async () => {
      await expect(chunker.chunk(makeDoc('## A\n\nx'), { overlap: -1 })).rejects.toThrow(
        /overlap must be non-negative/,
      );
    });
  });

  describe('header-less documents', () => {
    it('treats a header-less document as a single title-rooted section', async () => {
      const markdown = 'Just a paragraph with no headers at all.';
      const chunks = await chunker.chunk(makeDoc(markdown));
      const parents = chunks.filter((c): c is ParentChunk => c.kind === 'parent');
      expect(parents).toHaveLength(1);
      expect(parents[0].headerPath).toBe('Front Desk Guide');
    });
  });

  describe('document metadata propagation', () => {
    it('propagates tenantId, propertyId, department onto every chunk', async () => {
      const chunks = await chunker.chunk(
        makeDoc('## A\n\nx', { tenantId: 't-99', department: 'housekeeping' }),
      );
      for (const c of chunks) {
        expect(c.tenantId).toBe('t-99');
        expect(c.department).toBe('housekeeping');
      }
    });
  });

  describe('full chunk set shape', () => {
    it('returns a non-empty readonly array of Chunk for a valid document', async () => {
      const chunks: readonly Chunk[] = await chunker.chunk(makeDoc('## A\n\nx\n\n## B\n\ny'));
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.every((c) => c.kind === 'parent' || c.kind === 'child')).toBe(true);
    });
  });
});
