// ADR-028 Knowledge Base Architecture — flat-document RAG on SQLite + FTS5 + sqlite-vec (Phase 1).
// Knowledge graph augmentation reserved as a Phase 2+ additive extension.
// Knowledge (externally authoritative docs) is a SIBLING subsystem to Memory (ADR-038) — distinct schemas, same SQLite file.

/** Document source channel per ADR-036 (offline ingestion). */
export type KnowledgeSourceType = 'UPLOAD' | 'WATCH' | 'BATCH' | 'LAN' | 'USB' | 'EMAIL';

/** Hotel-specific document-type taxonomy per ADR-028 §2.4. */
export type KnowledgeDocumentType =
  | 'SOP'
  | 'POLICY'
  | 'PROCEDURE'
  | 'MANUAL'
  | 'FAQ'
  | 'RATE_SHEET'
  | 'SERVICE_INFO'
  | 'ROOM_INFO'
  | 'CONTACT'
  | 'TRAINING'
  | 'COMPLIANCE'
  | 'ANNOUNCEMENT'
  | 'OTHER';

/** Hotel department enum per ADR-028 §2.4. */
export type KnowledgeDepartment =
  | 'FRONT_DESK'
  | 'HOUSEKEEPING'
  | 'MAINTENANCE'
  | 'FNB'
  | 'FINANCE'
  | 'SECURITY'
  | 'SALES_MARKETING'
  | 'REVENUE_MGMT'
  | 'IT'
  | 'HR'
  | 'MANAGEMENT'
  | 'ALL';

/** Root document record per ADR-028 §4.1. */
export interface KnowledgeDocument {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly sourcePath: string;
  readonly sourceType: KnowledgeSourceType;
  readonly documentType: KnowledgeDocumentType;
  readonly department: KnowledgeDepartment;
  readonly title: string;
  readonly language: string;
  readonly currentVersion: number;
  readonly contentHash: string;
  readonly rawFileHash: string;
  readonly fileSizeBytes: bigint;
  readonly pageCount?: number;
  readonly chunkCount: number;
  readonly freshnessTtlDays: number;
  readonly aclRoles: readonly string[];
  readonly lastVerifiedAt: string;
  readonly lastIngestedAt: string;
  readonly parserUsed: string;
  readonly parseWarnings?: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt?: string;
}

/** Chunk row per ADR-028 §4.1 (parentChunkId per ADR-026). */
export interface KnowledgeChunk {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly docId: string;
  readonly docVersion: number;
  readonly department: KnowledgeDepartment;
  readonly aclRoles: readonly string[];
  readonly headerPath: string;
  readonly chunkHash: string;
  readonly parentChunkId?: string;
  readonly chunkIndex: number;
  readonly text: string;
  readonly tokenCount: number;
  readonly createdAt: string;
  readonly deletedAt?: string;
}

/** 1:1 vector row per ADR-028 §4.1 (768-dim float32, nomic-embed-text-v1.5 per ADR-022). */
export interface KnowledgeChunkVector {
  readonly chunkId: string;
  readonly tenantId: string;
  readonly embedding: readonly number[];
  readonly embeddingModel: string;
  readonly embeddingDim: number;
  readonly createdAt: string;
}

/** Citation snapshot per ADR-028 §4.1 + ADR-032 (stable even after the doc is re-ingested). */
export interface KnowledgeCitation {
  readonly id: string;
  readonly queryId: string;
  readonly chunkId: string;
  readonly docId: string;
  readonly docVersion: number;
  readonly headerPath: string;
  readonly sourcePath: string;
  readonly pageNumber?: number;
  readonly citedAt: string;
}

/** KnowledgeQuery audit row per ADR-028 §4.1 + ADR-030. */
export interface KnowledgeQuery {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly propertyId?: string;
  readonly department?: KnowledgeDepartment;
  readonly question: string;
  readonly rewrittenQuery?: string;
  readonly answer: string;
  readonly answerRaw: string;
  readonly retrievedChunkIds: readonly string[];
  readonly citedChunkIds: readonly string[];
  readonly confidenceScore: number;
  readonly confidenceMethod: string;
  readonly modelUsed: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly latencyMs: number;
  readonly createdAt: string;
}

/** Ingestion request for a new or updated document. */
export interface KnowledgeIngestRequest {
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly sourcePath: string;
  readonly sourceType: KnowledgeSourceType;
  readonly documentType: KnowledgeDocumentType;
  readonly department: KnowledgeDepartment;
  readonly title: string;
  readonly language: string;
  readonly aclRoles: readonly string[];
  readonly content: string;
  readonly idempotencyKey: string;
}

/** Ingestion result. */
export interface KnowledgeIngestResult {
  readonly document: KnowledgeDocument;
  readonly chunksCreated: number;
  readonly chunksUpdated: number;
  readonly chunksDeleted: number;
  readonly vectorsUpserted: number;
  readonly warnings: readonly string[];
}

/** Retrieval request scoped by tenant + RBAC. tenantId is MANDATORY (ADR-031). */
export interface KnowledgeRetrievalRequest {
  readonly query: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly departments?: readonly KnowledgeDepartment[];
  readonly documentTypes?: readonly KnowledgeDocumentType[];
  readonly aclRoles: readonly string[];
  readonly topK: number;
}

/** Retrieved chunk with score + citation metadata. */
export interface KnowledgeRetrievedChunk {
  readonly chunk: KnowledgeChunk;
  readonly document: KnowledgeDocument;
  readonly score: number;
  readonly retrievalMethod: 'VECTOR' | 'KEYWORD' | 'HYBRID';
}

/**
 * KnowledgeStore contract per ADR-028 §4.1. The single entry point for knowledge base
 * ingestion and retrieval. Backed by SQLite + FTS5 + sqlite-vec (Phase 1).
 */
export interface KnowledgeStore {
  ingest(request: KnowledgeIngestRequest): Promise<KnowledgeIngestResult>;
  getDocument(docId: string, tenantId: string): Promise<KnowledgeDocument | null>;
  listDocuments(filter: {
    readonly tenantId: string;
    readonly propertyId?: string;
    readonly documentType?: KnowledgeDocumentType;
    readonly department?: KnowledgeDepartment;
  }): Promise<readonly KnowledgeDocument[]>;
  retrieve(request: KnowledgeRetrievalRequest): Promise<readonly KnowledgeRetrievedChunk[]>;
  deleteDocument(docId: string, tenantId: string): Promise<void>;
  verifyFreshness(
    tenantId: string,
  ): Promise<{ readonly stale: readonly KnowledgeDocument[]; readonly verified: number }>;
}
