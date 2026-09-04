/**
 * SimpleChunker — markdown-aware `Chunker` (ADR-026).
 *
 * Splits documents on markdown headers (`#`…`######`) into parent chunks
 * (one per section) and further splits each section's body into child chunks
 * on paragraph boundaries. Paragraphs exceeding `chunkSize` are split into
 * overlapping windows. Parent chunks carry the full section text for LLM
 * context expansion; child chunks are the embedded / indexed units. Per
 * ADR-026, parent chunks have NO embedding — the `Chunker` produces no
 * embeddings at all (embeddings are added downstream by the embedder).
 *
 * Each chunk carries a SHA-256 `chunkHash` of its text for incremental
 * re-indexing (ADR-034): unchanged chunks (same hash) can be skipped on
 * re-ingestion. Chunk IDs are deterministic (`${docId}#p${n}` / `…#c${m}`) so
 * the same document structure yields stable IDs across runs.
 *
 * Defaults (overridable via the per-call `config` argument):
 *   strategy='markdown', chunkSize=1200, overlap=200, parentSize=1500,
 *   preserveHeaders=true, atomicBlocks=true.
 *
 * @see Chunker — implemented contract.
 */

import type {
  Chunker,
  ChunkerDocument,
  ChunkingConfig,
  Chunk,
  ParentChunk,
  ChildChunk,
  ChunkHash,
} from '@smartagentics/sdk';

/** Default chunking configuration (markdown strategy, ADR-026 defaults). */
const DEFAULT_CONFIG: ChunkingConfig = {
  strategy: 'markdown',
  chunkSize: 1200,
  overlap: 200,
  parentSize: 1500,
  preserveHeaders: true,
  atomicBlocks: true,
};

/** Header line regex — captures the `#` level (group 1) and title text (group 2). */
const HEADER_RE = /^(#{1,6})\s+(.*)$/;

/** Approximate characters-per-token ratio (≈4 chars/token for English text). */
const CHARS_PER_TOKEN = 4;

/** Constructor options for {@link SimpleChunker}. */
export interface SimpleChunkerOptions {
  /** `docVersion` stamped onto every emitted chunk (default 1). */
  readonly defaultDocVersion?: number;
}

/** Estimates token count from character length (≈4 chars/token heuristic). */
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/** Computes the SHA-256 hex digest of `text` using Web Crypto. */
async function sha256Hex(text: string): Promise<ChunkHash> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** A parsed markdown section: its ancestor header path, its own header line, and body text. */
interface MarkdownSection {
  readonly headerPath: string;
  readonly headerLine: string;
  readonly body: string;
}

/**
 * Splits markdown into sections delimited by headers. Each section carries
 * its ancestor header path (e.g. `"Front Desk › Check-in"`). Content before
 * the first header (if any) becomes a section whose `headerPath` is the
 * document title. If the document has no headers at all, the whole document
 * is a single title-rooted section.
 */
function splitMarkdownSections(document: ChunkerDocument): MarkdownSection[] {
  const lines = document.markdown.split('\n');
  const sections: MarkdownSection[] = [];
  const stack: { level: number; title: string }[] = [];
  let headerLine = '';
  let bodyLines: string[] = [];
  let sawHeader = false;

  const flush = (): void => {
    const body = bodyLines.join('\n').trim();
    if (headerLine || body) {
      const headerPath = sawHeader ? stack.map((h) => h.title).join(' › ') : document.title;
      sections.push({ headerPath, headerLine, body });
    }
    bodyLines = [];
    headerLine = '';
  };

  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      flush();
      const level = m[1].length;
      const title = m[2].trim();
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      stack.push({ level, title });
      headerLine = line;
      sawHeader = true;
    } else {
      bodyLines.push(line);
    }
  }
  flush();

  if (sections.length === 0) {
    sections.push({
      headerPath: document.title,
      headerLine: '',
      body: document.markdown.trim(),
    });
  }
  return sections;
}

/** Splits a section body into paragraphs on blank-line boundaries. */
function splitParagraphs(body: string): string[] {
  if (!body) return [];
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Groups paragraphs into parent-sized buckets (each ≤ `parentSize` characters
 * including the prepended header line). A single paragraph larger than
 * `parentSize` becomes its own (oversized) bucket — paragraphs are not split
 * across parents. If `headerLine` is set and there are no paragraphs, a single
 * empty bucket is returned so a header-only section still yields a parent.
 */
function groupParagraphs(headerLine: string, paragraphs: string[], parentSize: number): string[][] {
  if (paragraphs.length === 0) {
    const empty: string[] = [];
    return headerLine ? [empty] : [];
  }
  const headerLen = headerLine ? headerLine.length + 1 : 0; // +1 for newline
  const groups: string[][] = [];
  let current: string[] = [];
  let currentLen = headerLen;
  for (const p of paragraphs) {
    const sep = current.length > 0 ? 2 : 0; // "\n\n" between paragraphs
    if (current.length > 0 && currentLen + sep + p.length > parentSize) {
      groups.push(current);
      current = [p];
      currentLen = headerLen + p.length;
    } else {
      current.push(p);
      currentLen += sep + p.length;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Splits `text` into windows of ≤ `size` characters with `overlap` overlap. */
function splitWithOverlap(text: string, size: number, overlap: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= size) return [trimmed];
  const step = Math.max(1, size - overlap);
  const chunks: string[] = [];
  for (let i = 0; i < trimmed.length; i += step) {
    chunks.push(trimmed.slice(i, i + size));
    if (i + size >= trimmed.length) break;
  }
  return chunks;
}

/**
 * Markdown-aware recursive chunker. Produces `ParentChunk`s (one per
 * header-delimited section, or per `parentSize`-sized bucket within an
 * oversized section) and `ChildChunk`s (one per paragraph, or per
 * `chunkSize`-window within an oversized paragraph). Parent and child IDs are
 * deterministic so re-chunking an unchanged document yields identical IDs.
 */
export class SimpleChunker implements Chunker {
  private readonly defaultDocVersion: number;

  public constructor(options: SimpleChunkerOptions = {}) {
    this.defaultDocVersion = options.defaultDocVersion ?? 1;
  }

  /**
   * Chunks a parsed markdown document into parent + child chunks.
   *
   * @param document - The document to chunk. Requires `id`, `tenantId`, and
   *   non-empty `markdown`.
   * @param configOverride - Per-call overrides merged over the defaults.
   * @throws {Error} if `document.id` / `document.tenantId` is missing, if
   *   `markdown` is empty, or if the (merged) config has non-positive
   *   `chunkSize` / `parentSize` or negative `overlap`.
   */
  public async chunk(
    document: ChunkerDocument,
    configOverride?: Partial<ChunkingConfig>,
  ): Promise<readonly Chunk[]> {
    if (!document.id) {
      throw new Error('SimpleChunker.chunk: document.id is required');
    }
    if (!document.tenantId) {
      throw new Error('SimpleChunker.chunk: document.tenantId is required');
    }
    if (!document.markdown || !document.markdown.trim()) {
      throw new Error('SimpleChunker.chunk: document.markdown must be non-empty');
    }
    const config: ChunkingConfig = { ...DEFAULT_CONFIG, ...configOverride };
    if (config.chunkSize <= 0) {
      throw new Error('SimpleChunker.chunk: chunkSize must be positive');
    }
    if (config.parentSize <= 0) {
      throw new Error('SimpleChunker.chunk: parentSize must be positive');
    }
    if (config.overlap < 0) {
      throw new Error('SimpleChunker.chunk: overlap must be non-negative');
    }

    const sections = splitMarkdownSections(document);
    const chunks: Chunk[] = [];
    const now = new Date().toISOString();
    let parentIndex = 0;

    for (const section of sections) {
      const paragraphs = splitParagraphs(section.body);
      const groups = groupParagraphs(section.headerLine, paragraphs, config.parentSize);
      for (const group of groups) {
        const parentText =
          (section.headerLine ? section.headerLine + '\n' : '') + group.join('\n\n');
        if (!parentText.trim()) continue;

        const parentId = `${document.id}#p${parentIndex}`;
        const parentHash = await sha256Hex(parentText);

        const childChunks: ChildChunk[] = [];
        let childIdx = 0;
        for (const para of group) {
          const windows = splitWithOverlap(para, config.chunkSize, config.overlap);
          for (const win of windows) {
            if (!win) continue;
            childChunks.push({
              kind: 'child',
              id: `${parentId}#c${childIdx}`,
              docId: document.id,
              docVersion: this.defaultDocVersion,
              tenantId: document.tenantId,
              propertyId: document.propertyId,
              department: document.department,
              headerPath: section.headerPath,
              chunkHash: await sha256Hex(win),
              text: win,
              tokenCount: estimateTokens(win),
              createdAt: now,
              parentChunkId: parentId,
              chunkIndex: childIdx,
            });
            childIdx += 1;
          }
        }

        const parent: ParentChunk = {
          kind: 'parent',
          id: parentId,
          docId: document.id,
          docVersion: this.defaultDocVersion,
          tenantId: document.tenantId,
          propertyId: document.propertyId,
          department: document.department,
          headerPath: section.headerPath,
          chunkHash: parentHash,
          text: parentText,
          tokenCount: estimateTokens(parentText),
          createdAt: now,
          chunkIndex: parentIndex,
          childCount: childChunks.length,
        };
        chunks.push(parent, ...childChunks);
        parentIndex += 1;
      }
    }
    return chunks;
  }
}
