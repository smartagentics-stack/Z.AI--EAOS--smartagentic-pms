// ADR-023 Vector Store — sqlite-vec default; LanceDB / pgvector / Qdrant reserved behind the interface.
// Per ADR-027: tenantId is MANDATORY on every query — there is no unscoped retrieval path.

/** Distance metric for KNN query. Default: cosine. */
export type DistanceMetric = 'cosine' | 'l2' | 'ip';

/** Index type hint — implementation-specific default if omitted. */
export type IndexType = 'bruteforce' | 'hnsw' | 'ivfflat';

/** Arbitrary key-value metadata attached to a vector (e.g., documentType, department, language). */
export type VectorMetadata = Readonly<Record<string, string | number | boolean | null>>;

/** Filter expression for partition-key pre-filtering and metadata scoping. */
export interface MetadataFilter {
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly documentType?: string;
  readonly department?: string;
  readonly language?: string;
  readonly custom?: Readonly<Record<string, string | number | boolean | null>>;
}

/** Entry to be inserted/upserted into the vector store. */
export interface VectorEntry {
  readonly id: string;
  readonly vector: readonly number[];
  readonly metadata: VectorMetadata;
  readonly tenantId: string;
  readonly propertyId?: string;
}

/** Batch insert payload (single transaction). */
export interface VectorInsert {
  readonly id: string;
  readonly vector: readonly number[];
  readonly metadata: VectorMetadata;
  readonly tenantId: string;
  readonly propertyId?: string;
}

/** Query parameters. `tenantId` is MANDATORY per ADR-027. */
export interface VectorQuery {
  readonly vector: readonly number[];
  readonly k: number;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly filter?: MetadataFilter;
  readonly indexType?: IndexType;
  readonly distanceMetric?: DistanceMetric;
}

/** A single scored result row. */
export interface VectorSearchResult {
  readonly id: string;
  readonly score: number;
  readonly metadata: VectorMetadata;
  readonly tenantId: string;
  readonly propertyId?: string;
}

/** Optional compaction / tenant-management hooks (no-op for sqlite-vec). */
export interface VectorStoreAdmin {
  compact?(): Promise<void>;
  createTenant?(tenantId: string): Promise<void>;
}

/**
 * Vector store contract per ADR-023. Hides the implementation difference between
 * sqlite-vec (Phase 1), LanceDB (Phase 2+ scale-out), pgvector (Phase 2+ cloud),
 * and Qdrant (Phase 3+ federated) behind a single interface.
 */
export interface VectorStore extends VectorStoreAdmin {
  upsert(entry: VectorEntry): Promise<void>;
  upsertBatch(items: readonly VectorInsert[]): Promise<void>;
  query(query: VectorQuery): Promise<readonly VectorSearchResult[]>;
  delete(id: string): Promise<void>;
  deleteByFilter(filter: MetadataFilter): Promise<void>;
  count(filter?: MetadataFilter): Promise<number>;
}
