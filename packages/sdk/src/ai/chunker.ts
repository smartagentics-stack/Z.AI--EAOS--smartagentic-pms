// ADR-026 Document Chunking — markdown-header-aware recursive splitting + parent-child retrieval.
// Parent chunks have NO embedding (metadata + full text only); child chunks are embedded & indexed.
// At retrieval time, retrieve child chunks via hybrid search, then expand to parent chunks for LLM context.

/** Chunking strategy selector. Default: 'markdown'. */
export type ChunkingStrategy = 'fixed' | 'recursive' | 'markdown' | 'semantic';

/** A parsed document awaiting chunking. */
export interface ChunkerDocument {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly title: string;
  readonly markdown: string;
  readonly language: string;
  readonly documentType: string;
  readonly department: string;
}

/** Configuration for the Chunker. */
export interface ChunkingConfig {
  readonly strategy: ChunkingStrategy;
  /** Target child chunk size in characters (default: 800–1200). */
  readonly chunkSize: number;
  /** Overlap between adjacent child chunks in characters (default: 200). */
  readonly overlap: number;
  /** Parent chunk size ceiling in characters (default: 1500). */
  readonly parentSize: number;
  /** Whether to preserve markdown headers with their sections (default: true). */
  readonly preserveHeaders: boolean;
  /** Whether to treat tables and code blocks as atomic units (default: true). */
  readonly atomicBlocks: boolean;
}

/** SHA-256 of the chunk text — used for incremental re-indexing (ADR-034). */
export type ChunkHash = string;

/** Base fields shared by parent and child chunks. */
export interface ChunkBase {
  readonly id: string;
  readonly docId: string;
  readonly docVersion: number;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly department: string;
  readonly headerPath: string;
  readonly chunkHash: ChunkHash;
  readonly text: string;
  readonly tokenCount: number;
  readonly createdAt: string;
}

/** Parent chunk — large contextual unit, NO embedding. Retrieved via parent-child expansion. */
export interface ParentChunk extends ChunkBase {
  readonly kind: 'parent';
  readonly chunkIndex: number;
  readonly childCount: number;
}

/** Child chunk — small precise unit, IS embedded & indexed. */
export interface ChildChunk extends ChunkBase {
  readonly kind: 'child';
  readonly parentChunkId: string;
  readonly chunkIndex: number;
}

/** Discriminated union of parent and child chunks. */
export type Chunk = ParentChunk | ChildChunk;

/**
 * Chunker contract per ADR-026.
 * Transforms a parsed Document into a list of Chunks (parent + child) preserving markdown structure.
 */
export interface Chunker {
  chunk(document: ChunkerDocument, config?: Partial<ChunkingConfig>): Promise<readonly Chunk[]>;
}
