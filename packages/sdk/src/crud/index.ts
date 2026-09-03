/**
 * Generic CRUD / Query / Command Foundation SDK interfaces (directive E16).
 *
 * Defines a uniform generic service contract for create / read / update /
 * delete / list / search / filter / sort / aggregate / bulk operations and
 * a CQRS-style command surface for record lifecycle transitions. Both
 * Layer-2 typed entities and Layer-3 dynamic records implement the same
 * `CrudService<T>` contract, so tooling (and ADR-103 AI tools) can target
 * them uniformly.
 *
 * This file contains TYPE DEFINITIONS ONLY — no implementation logic.
 */

/** Identifier type — string for most entities, but allow branded IDs. */
export type EntityId = string;

/** A generic entity shape that any CRUD service operates on. */
export interface CrudEntity {
  readonly id: EntityId;
  readonly tenantId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly deletedAt?: string | null;
}

/** Comparison operator for query filters (mirrors domain filter language). */
export type QueryComparison =
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

/** Logical combinator for query filter groups. */
export type QueryLogicalOp = 'and' | 'or' | 'not';

/** A leaf predicate in a query filter. */
export interface QueryFilterPredicate {
  readonly field: string;
  readonly op: QueryComparison;
  readonly value?: unknown;
}

/** A logical group of filter predicates. */
export interface QueryFilterGroup {
  readonly op: QueryLogicalOp;
  readonly children: readonly (QueryFilterPredicate | QueryFilterGroup)[];
}

/** Root filter expression type. */
export type QueryFilter = QueryFilterPredicate | QueryFilterGroup;

/** Sort direction. */
export type SortDirection = 'asc' | 'desc';

/** A single sort clause. */
export interface SortClause {
  readonly field: string;
  readonly direction: SortDirection;
}

/** Cursor-based pagination token (opaque to callers). */
export type PaginationCursor = string;

/** Pagination options (offset OR cursor, not both). */
export interface PaginationOptions {
  readonly limit: number;
  readonly offset?: number;
  readonly cursor?: PaginationCursor;
}

/** Fields projection — restricts which fields are returned. */
export interface FieldsProjection {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

/** Relationship expansion options. */
export interface ExpandOptions {
  readonly expand: readonly string[];
  readonly depth?: number;
}

/**
 * QueryOptions — declarative read options shared by `CrudService.list`,
 * `search`, `filter`, and `aggregate`. Reusable across Layer-2 and Layer-3.
 */
export interface QueryOptions {
  readonly filter?: QueryFilter;
  readonly sort?: readonly SortClause[];
  readonly pagination?: PaginationOptions;
  readonly fields?: FieldsProjection;
  readonly expand?: ExpandOptions;
  readonly includeDeleted?: boolean;
}

/** Paginated result envelope returned by list / search / filter. */
export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset?: number;
  readonly nextCursor?: PaginationCursor;
  readonly hasMore: boolean;
}

/** Aggregation function names supported by `CrudService.aggregate`. */
export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'distinct';

/** A single aggregation clause in an aggregate query. */
export interface AggregateClause {
  readonly function: AggregateFunction;
  readonly field?: string;
  readonly alias?: string;
}

/** Group-by clause for an aggregate query. */
export interface AggregateGroupBy {
  readonly field: string;
  readonly alias?: string;
}

/** Aggregate query input. */
export interface AggregateQuery {
  readonly filter?: QueryFilter;
  readonly aggregates: readonly AggregateClause[];
  readonly groupBy?: readonly AggregateGroupBy[];
  readonly having?: QueryFilter;
}

/** A single row in an aggregate result set. */
export type AggregateRow = Readonly<Record<string, unknown>>;

/** Aggregate result envelope. */
export interface AggregateResult {
  readonly rows: readonly AggregateRow[];
  readonly total: number;
}

/** Options for export operations (CSV / JSON / XLSX). */
export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'parquet';

/** Export options. */
export interface ExportOptions {
  readonly format: ExportFormat;
  readonly query: QueryOptions;
  readonly chunkSize?: number;
  readonly onProgress?: (processed: number, total: number) => void;
}

/** Export result — a streamable blob id plus metadata. */
export interface ExportResult {
  readonly blobId: string;
  readonly format: ExportFormat;
  readonly rowCount: number;
  readonly sizeBytes: number;
  readonly url?: string;
}

/** Options for import operations. */
export interface ImportOptions {
  readonly format: ExportFormat;
  readonly upsert: boolean;
  readonly onConflict: 'skip' | 'overwrite' | 'fail';
  readonly chunkSize?: number;
  readonly onProgress?: (processed: number, total: number, errors: number) => void;
}

/** Import result envelope. */
export interface ImportResult {
  readonly inserted: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly errors: readonly OperationError[];
}

/** Error detail for a single record-level failure in bulk / import operations. */
export interface OperationError {
  readonly code: string;
  readonly message: string;
  readonly index?: number;
  readonly recordId?: string;
  readonly field?: string;
}

/** Discriminated kind for bulk operations. */
export type BulkOperationKind = 'bulkCreate' | 'bulkUpdate' | 'bulkDelete';

/** Base fields for a bulk operation. */
export interface BulkOperationBase {
  readonly tenantId: string;
  readonly actorId: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly idempotencyKey: string;
}

/** Bulk create command. */
export interface BulkCreateOperation<TInput> extends BulkOperationBase {
  readonly kind: 'bulkCreate';
  readonly items: readonly TInput[];
}

/** Bulk update command (each item must carry `id` + patch). */
export interface BulkUpdateOperation<TPatch> extends BulkOperationBase {
  readonly kind: 'bulkUpdate';
  readonly items: readonly {
    readonly id: EntityId;
    readonly patch: TPatch;
    readonly expectedRevision?: number;
  }[];
}

/** Bulk delete command (soft-delete by default; hard if `permanent: true`). */
export interface BulkDeleteOperation extends BulkOperationBase {
  readonly kind: 'bulkDelete';
  readonly ids: readonly EntityId[];
  readonly permanent?: boolean;
}

/** Discriminated union of bulk operations. */
export type BulkOperation<TInput = unknown, TPatch = unknown> =
  BulkCreateOperation<TInput> | BulkUpdateOperation<TPatch> | BulkDeleteOperation;

/** Per-item result inside a bulk operation. */
export interface BulkItemResult<T = unknown> {
  readonly index: number;
  readonly success: boolean;
  readonly id?: EntityId;
  readonly record?: T;
  readonly error?: OperationError;
}

/** Outcome of a bulk operation. */
export interface OperationResult<T = unknown> {
  readonly operationId: string;
  readonly kind: BulkOperationKind;
  readonly accepted: boolean;
  readonly successCount: number;
  readonly failureCount: number;
  readonly affectedIds: readonly EntityId[];
  readonly items: readonly BulkItemResult<T>[];
  readonly errors: readonly OperationError[];
  readonly startedAt: string;
  readonly finishedAt: string;
}

/** Discriminated kind for record-lifecycle commands (CQRS write side). */
export type CommandKind =
  'create' | 'update' | 'delete' | 'archive' | 'restore' | 'approve' | 'reject';

/** Base fields shared by all command kinds. */
export interface CommandBase {
  readonly tenantId: string;
  readonly actorId: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly idempotencyKey: string;
  readonly auditMessage?: string;
}

/** CreateRecord command. */
export interface CreateRecordCommand<TInput = unknown> extends CommandBase {
  readonly kind: 'create';
  readonly entityTypeId: string;
  readonly data: TInput;
}

/** UpdateRecord command. */
export interface UpdateRecordCommand<TPatch = unknown> extends CommandBase {
  readonly kind: 'update';
  readonly entityTypeId: string;
  readonly recordId: EntityId;
  readonly patch: TPatch;
  readonly expectedRevision?: number;
}

/** DeleteRecord command (soft-delete by default). */
export interface DeleteRecordCommand extends CommandBase {
  readonly kind: 'delete';
  readonly entityTypeId: string;
  readonly recordId: EntityId;
  readonly permanent?: boolean;
  readonly expectedRevision?: number;
}

/** ArchiveRecord command (lifecycle → `archived`). */
export interface ArchiveRecordCommand extends CommandBase {
  readonly kind: 'archive';
  readonly entityTypeId: string;
  readonly recordId: EntityId;
  readonly reason?: string;
}

/** RestoreRecord command (lifecycle → `active`; reverses archive / delete). */
export interface RestoreRecordCommand extends CommandBase {
  readonly kind: 'restore';
  readonly entityTypeId: string;
  readonly recordId: EntityId;
  readonly reason?: string;
}

/** ApproveRecord command (lifecycle → `approved`; releases a pending-approval record). */
export interface ApproveRecordCommand extends CommandBase {
  readonly kind: 'approve';
  readonly entityTypeId: string;
  readonly recordId: EntityId;
  readonly approverId: string;
  readonly comment?: string;
}

/** RejectRecord command (lifecycle → `rejected`; refuses a pending-approval record). */
export interface RejectRecordCommand extends CommandBase {
  readonly kind: 'reject';
  readonly entityTypeId: string;
  readonly recordId: EntityId;
  readonly rejecterId: string;
  readonly reason: string;
}

/** Discriminated union of all record commands. */
export type RecordCommand<TInput = unknown, TPatch = unknown> =
  | CreateRecordCommand<TInput>
  | UpdateRecordCommand<TPatch>
  | DeleteRecordCommand
  | ArchiveRecordCommand
  | RestoreRecordCommand
  | ApproveRecordCommand
  | RejectRecordCommand;

/** Outcome of executing a single RecordCommand. */
export interface CommandResult<T = unknown> {
  readonly commandId: string;
  readonly kind: CommandKind;
  readonly accepted: boolean;
  readonly recordId: EntityId | null;
  readonly record?: T;
  readonly revision: number | null;
  readonly errors: readonly OperationError[];
}

/**
 * CommandService — CQRS write-side contract for record lifecycle transitions.
 * Implementations are responsible for: (1) AJV validation against the
 * EntityType's schema, (2) the 5-way permission intersection (ADR-099),
 * (3) sync-outbox emission (ADR-073), and (4) audit-event emission.
 */
export interface CommandService<TRecord = unknown, TInput = unknown, TPatch = unknown> {
  create(command: CreateRecordCommand<TInput>): Promise<CommandResult<TRecord>>;
  update(command: UpdateRecordCommand<TPatch>): Promise<CommandResult<TRecord>>;
  delete(command: DeleteRecordCommand): Promise<CommandResult<TRecord>>;
  archive(command: ArchiveRecordCommand): Promise<CommandResult<TRecord>>;
  restore(command: RestoreRecordCommand): Promise<CommandResult<TRecord>>;
  approve(command: ApproveRecordCommand): Promise<CommandResult<TRecord>>;
  reject(command: RejectRecordCommand): Promise<CommandResult<TRecord>>;
  execute(command: RecordCommand<TInput, TPatch>): Promise<CommandResult<TRecord>>;
}

/**
 * CrudService<T> — generic CRUD + query + bulk + import/export contract.
 * Implemented by both Layer-2 typed repositories and Layer-3 dynamic-record
 * repositories so that AI tools (ADR-103) and the visual entity builder
 * (Phase F+) target a single surface.
 */
export interface CrudService<
  TEntity extends CrudEntity = CrudEntity,
  TInput = Partial<TEntity>,
  TPatch = Partial<TEntity>,
> {
  create(input: TInput, context: CommandBase): Promise<TEntity>;
  read(id: EntityId, tenantId: string): Promise<TEntity | null>;
  update(id: EntityId, patch: TPatch, context: CommandBase): Promise<TEntity>;
  delete(id: EntityId, context: CommandBase): Promise<void>;
  list(options: QueryOptions, tenantId: string): Promise<PaginatedResult<TEntity>>;
  search(term: string, options: QueryOptions, tenantId: string): Promise<PaginatedResult<TEntity>>;
  filter(
    filter: QueryFilter,
    options: QueryOptions,
    tenantId: string,
  ): Promise<PaginatedResult<TEntity>>;
  sort(
    sort: readonly SortClause[],
    options: QueryOptions,
    tenantId: string,
  ): Promise<PaginatedResult<TEntity>>;
  aggregate(query: AggregateQuery, tenantId: string): Promise<AggregateResult>;
  bulk<TBulkInput = TInput, TBulkPatch = TPatch>(
    operation: BulkOperation<TBulkInput, TBulkPatch>,
  ): Promise<OperationResult<TEntity>>;
  export(options: ExportOptions, tenantId: string): Promise<ExportResult>;
  import(data: unknown, options: ImportOptions, tenantId: string): Promise<ImportResult>;
  commands: CommandService<TEntity, TInput, TPatch>;
}
