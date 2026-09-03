/**
 * Domain-Neutral Meta-Model SDK interfaces (ADR-097 + ADR-098).
 *
 * Defines the canonical contracts for the three-layer hybrid persistence
 * strategy: Layer-1 platform core, Layer-2 typed domain reference data,
 * Layer-3 dynamic records. All entities carry ADR-006 Amendment 1 / ADR-072
 * sync metadata (updatedAt, revision, deletedAt, syncOrigin, idempotencyKey).
 *
 * This file contains TYPE DEFINITIONS ONLY — no implementation logic.
 */

/** JSON object map (avoids shadowing the `Record` interface below). */
export type JsonObject = Readonly<{ [key: string]: unknown }>;

/** JSON Schema 2020-12 document (canonical entity-definition format per ADR-097 §4). */
export type JsonSchema = {
  readonly $schema?: 'https://json-schema.org/draft/2020-12/schema';
  readonly type?: string;
  readonly properties?: JsonObject;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly [extension: string]: unknown;
};

/** Sync metadata shared by all three persistence layers (ADR-006 Am.1 / ADR-072). */
export interface SyncMetadata {
  readonly updatedAt: string;
  readonly revision: number;
  readonly deletedAt: string | null;
  readonly syncOrigin: string | null;
  readonly idempotencyKey: string | null;
}

/** Storage class distinguishing typed Prisma models from generic Record rows. */
export type StorageClass = 'typed' | 'dynamic';

/** Where a domain is in its lifecycle. */
export type DomainStatus = 'active' | 'deprecated' | 'disabled';

/**
 * Domain — top of the `domain → module → entity_type → record` hierarchy.
 * `tenantId === null` denotes a platform-wide baseline domain (e.g. "pms").
 */
export interface Domain {
  readonly id: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly status: DomainStatus;
  readonly configuration: JsonObject;
  readonly capabilities: readonly string[];
  readonly publishedAt: string;
  readonly deprecatedAt: string | null;
  readonly sync: SyncMetadata;
}

/**
 * Module — a logical grouping of entity types inside a domain
 * (e.g. "reservations", "housekeeping"). Optional; entity types may be
 * domain-direct.
 */
export interface Module {
  readonly id: string;
  readonly domainId: string;
  readonly name: string;
  readonly displayName: string;
  readonly version: string;
  readonly dependencies: readonly string[];
  readonly capabilities: readonly string[];
  readonly active: boolean;
  readonly sync: SyncMetadata;
}

/** Field-level visibility and AI access flags (x-smartagentics extensions per ADR-097 §4). */
export type FieldVisibility = 'public' | 'internal' | 'restricted' | 'pii';

/** Cardinality of a relationship between two entity types. */
export type RelationshipCardinality = 'one-to-one' | 'one-to-many' | 'many-to-many';

/** Ownership semantics for a relationship. */
export type RelationshipOwnership = 'parent' | 'child' | 'peer';

/** onDelete behavior for a relationship. */
export type RelationshipOnDelete = 'restrict' | 'cascade' | 'set-null';

/** Lifecycle stage of an entity record (drives approval / archive / restore flows). */
export type RecordLifecycleState =
  'draft' | 'pending-approval' | 'approved' | 'rejected' | 'active' | 'archived' | 'deleted';

/**
 * FieldDefinition — a single field inside an EntityType's schema with the
 * x-smartagentics metadata (indexed, searchable, aiReadable, aiWritable, ...).
 * Reflects one entry inside `EntityType.schemaJson.properties`.
 */
export interface FieldDefinition {
  readonly entityTypeId: string;
  readonly name: string;
  readonly jsonSchemaType: string;
  readonly dataType?: string;
  readonly required: boolean;
  readonly default?: unknown;
  readonly validation?: JsonObject;
  readonly indexed: boolean;
  readonly searchable: boolean;
  readonly filterable: boolean;
  readonly sortable: boolean;
  readonly aggregatable: boolean;
  readonly reportable: boolean;
  readonly visibility: FieldVisibility;
  readonly aiReadable: boolean;
  readonly aiWritable: boolean;
}

/**
 * Relationship — a typed association between two EntityTypes
 * (e.g. `Reservation.guestId → Guest.id`).
 */
export interface Relationship {
  readonly id: string;
  readonly domainId: string;
  readonly name: string;
  readonly sourceEntityTypeId: string;
  readonly sourceFieldName: string;
  readonly targetEntityTypeId: string;
  readonly targetFieldName: string | null;
  readonly cardinality: RelationshipCardinality;
  readonly ownership: RelationshipOwnership;
  readonly onDelete: RelationshipOnDelete;
  readonly permissions: readonly string[];
  readonly sync: SyncMetadata;
}

/** Lifecycle transition definition for an EntityType (state-machine edges). */
export interface LifecycleTransition {
  readonly from: RecordLifecycleState;
  readonly to: RecordLifecycleState;
  readonly requiredRole: string;
  readonly requiredRelation: string;
  readonly auditMessage: string;
}

/** Lifecycle definition attached to an EntityType. */
export interface LifecycleDefinition {
  readonly initialState: RecordLifecycleState;
  readonly transitions: readonly LifecycleTransition[];
}

/**
 * EntityType — a JSON-Schema-2020-12 entity definition stored as data.
 * `storageClass = "typed"` denotes a Layer-2 Prisma model (typedTableName set);
 * `storageClass = "dynamic"` denotes Layer-3 generic Record rows.
 */
export interface EntityType {
  readonly id: string;
  readonly domainId: string;
  readonly moduleId: string | null;
  readonly name: string;
  readonly displayName: string;
  readonly schemaJson: JsonSchema;
  readonly schemaVersion: number;
  readonly storageClass: StorageClass;
  readonly typedTableName: string | null;
  readonly fields: readonly FieldDefinition[];
  readonly relationships: readonly Relationship[];
  readonly permissions: readonly string[];
  readonly lifecycle: LifecycleDefinition | null;
  readonly publishedAt: string;
  readonly deprecatedAt: string | null;
  readonly sync: SyncMetadata;
}

/**
 * Record — the single canonical envelope for Layer-3 dynamic records.
 * `dataJson` is validated against `EntityType.schemaJson` (AJV strict) before
 * every INSERT/UPDATE per ADR-097 §4.
 */
export interface Record {
  readonly id: string;
  readonly tenantId: string;
  readonly domainId: string;
  readonly entityTypeId: string;
  readonly recordId: string;
  readonly dataJson: JsonObject;
  readonly schemaVersion: number;
  readonly lifecycleState: RecordLifecycleState;
  readonly sync: SyncMetadata;
}

/** Sort direction for query results. */
export type SortDirection = 'asc' | 'desc';

/** A single sort clause in a RecordQuery. */
export interface SortClause {
  readonly field: string;
  readonly direction: SortDirection;
}

/** Cursor-based pagination token (opaque to callers). */
export type PaginationCursor = string;

/** Pagination options for a RecordQuery (offset OR cursor, not both). */
export interface PaginationOptions {
  readonly limit: number;
  readonly offset?: number;
  readonly cursor?: PaginationCursor;
}

/** Logical operator for combining filter predicates. */
export type FilterOperator = 'and' | 'or';

/** Comparison operators supported by the filter language. */
export type FilterComparison =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'not-in'
  | 'like'
  | 'contains'
  | 'starts-with'
  | 'ends-with'
  | 'is-null'
  | 'is-not-null';

/** A single leaf filter predicate (e.g. `{ field: 'amount', op: 'gt', value: 1000 }`). */
export interface FilterPredicate {
  readonly field: string;
  readonly op: FilterComparison;
  readonly value?: unknown;
}

/** A filter node — either a leaf predicate or a logical group of children. */
export interface FilterGroup {
  readonly op: FilterOperator;
  readonly children: readonly (FilterPredicate | FilterGroup)[];
}

/** Root filter expression of a RecordQuery. */
export type FilterExpression = FilterPredicate | FilterGroup;

/** Fields projection — restricts which fields are returned (`fields: ['id','name']`). */
export interface FieldsProjection {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

/** Relationship expansion (`expand: ['guest','room']` returns nested objects). */
export interface ExpandOptions {
  readonly expand: readonly string[];
  readonly depth?: number;
}

/**
 * RecordQuery — declarative read contract over Records (and Layer-2 entities
 * surfaced through the same query interface). Filter + sort + paginate +
 * project + expand.
 */
export interface RecordQuery {
  readonly tenantId: string;
  readonly domainId: string;
  readonly entityTypeId: string;
  readonly filter?: FilterExpression;
  readonly sort?: readonly SortClause[];
  readonly pagination?: PaginationOptions;
  readonly fields?: FieldsProjection;
  readonly expand?: ExpandOptions;
  readonly includeDeleted?: boolean;
  readonly lifecycleStates?: readonly RecordLifecycleState[];
}

/** Paginated result envelope returned by Record reads. */
export interface RecordPage<T = Record> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset?: number;
  readonly nextCursor?: PaginationCursor;
  readonly hasMore: boolean;
}

/** Discriminated union of record mutation commands (CQRS-style write side). */
export type RecordCommand =
  | CreateRecordCommand
  | UpdateRecordCommand
  | DeleteRecordCommand
  | ArchiveRecordCommand
  | RestoreRecordCommand;

/** Base fields shared by all record commands. */
export interface RecordCommandBase {
  readonly tenantId: string;
  readonly domainId: string;
  readonly entityTypeId: string;
  readonly recordId?: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly auditMessage?: string;
}

/** Create a new record (Layer-2 typed or Layer-3 dynamic). */
export interface CreateRecordCommand extends RecordCommandBase {
  readonly kind: 'create';
  readonly data: JsonObject;
  readonly initialLifecycleState?: RecordLifecycleState;
}

/** Update an existing record's `dataJson`. */
export interface UpdateRecordCommand extends RecordCommandBase {
  readonly kind: 'update';
  readonly recordId: string;
  readonly patch: JsonObject;
  readonly expectedRevision?: number;
}

/** Soft-delete a record (sets `deletedAt`; reversible by RestoreRecordCommand). */
export interface DeleteRecordCommand extends RecordCommandBase {
  readonly kind: 'delete';
  readonly recordId: string;
  readonly expectedRevision?: number;
}

/** Archive a record (lifecycle transition to `archived`). */
export interface ArchiveRecordCommand extends RecordCommandBase {
  readonly kind: 'archive';
  readonly recordId: string;
  readonly reason?: string;
}

/** Restore an archived or soft-deleted record to `active`. */
export interface RestoreRecordCommand extends RecordCommandBase {
  readonly kind: 'restore';
  readonly recordId: string;
  readonly reason?: string;
}

/** Outcome of executing a RecordCommand. */
export interface RecordCommandResult {
  readonly commandId: string;
  readonly accepted: boolean;
  readonly recordId: string | null;
  readonly revision: number | null;
  readonly errors: readonly RecordError[];
}

/** Error detail for a failed command. */
export interface RecordError {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
  readonly path?: string;
}

/**
 * EntityTypeRegistry — compiles all EntityType schemas at boot time via AJV
 * (per ADR-097 §4). Compilation errors are fatal (fail-fast).
 */
export interface EntityTypeRegistry {
  register(entityType: EntityType): Promise<void>;
  resolve(domainId: string, name: string): Promise<EntityType | null>;
  validate(entityTypeId: string, data: JsonObject): Promise<readonly RecordError[]>;
  list(domainId?: string): Promise<readonly EntityType[]>;
}

/**
 * RecordRepository — persistence boundary for Layer-3 dynamic records.
 * Implementations validate against the EntityType's compiled AJV validator
 * before any INSERT/UPDATE.
 */
export interface RecordRepository {
  query(query: RecordQuery): Promise<RecordPage>;
  get(tenantId: string, entityTypeId: string, recordId: string): Promise<Record | null>;
  execute(command: RecordCommand): Promise<RecordCommandResult>;
  bulkExecute(commands: readonly RecordCommand[]): Promise<readonly RecordCommandResult[]>;
}
