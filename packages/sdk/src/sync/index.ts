/**
 * Sync Engine SDK Contract (ADR-079) — transport-agnostic,
 * conflict-resolver-pluggable, Restate-integrated.
 *
 * Defines the five core interfaces for the in-house server-authoritative
 * event-log SyncEngine (per ADR-070 umbrella): `SyncEngine` (top-level),
 * `SyncSession` (per-session lifecycle), `SyncCursor` (resumable-sync
 * checkpoint), `SyncConflictResolver` (three-tier policy per ADR-074),
 * and `SyncTransport` (delivery abstraction for SQLite-only / LAN-hub /
 * cloud-PostgreSQL topologies). Phase 1 ships this contract + a
 * `NoopSyncEngine` reference implementation; Phase 2+ ships
 * `SqlitePostgresSyncEngine` with concrete transports; the Phase 3+
 * managed-sync-engine swap (PowerSync / ElectricSQL) is a new
 * `SyncTransport` implementation, not an SDK rewrite.
 *
 * This file contains TYPE DEFINITIONS ONLY — no implementation logic.
 */

/** Sync topology / mode (per ADR-070, ADR-072 `SyncCheckpoint`). */
export enum SyncMode {
  STANDALONE = 'STANDALONE',
  LAN_HUB = 'LAN_HUB',
  LAN_SPOKE = 'LAN_SPOKE',
  CLOUD_SYNCED = 'CLOUD_SYNCED',
}

/** Engine lifecycle state (per ADR-079 §4 `SyncEngineStatus`). */
export type SyncEngineState = 'idle' | 'syncing' | 'error' | 'paused';

/** Cursor lifecycle status (per ADR-072 `SyncCheckpoint.status`). */
export type SyncCursorStatus = 'active' | 'stale' | 'error';

/** Outbox row operation kind (per ADR-073 `SyncOutbox`). */
export type SyncOperation = 'insert' | 'update' | 'delete';

/** Conflict resolution tier outcome (per ADR-074 three-tier policy). */
export type SyncConflictOutcome = 'resolved-lww' | 'resolved-semantic' | 'escalated-manual';

/** Per-row record in the `SyncOutbox` table (ADR-073). */
export interface SyncOutboxEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly tableName: string;
  readonly recordId: string;
  readonly operation: SyncOperation;
  readonly payloadJson: string;
  readonly hlc: string;
  readonly syncOrigin?: string;
  readonly createdAt: string;
  readonly deliveredAt?: string | null;
  readonly lsn?: string | null;
  readonly revision?: number;
  readonly idempotencyKey?: string | null;
}

/** Push result returned by `SyncSession.push`. */
export interface SyncPushResult {
  readonly deliveredCount: number;
  readonly failedCount: number;
  readonly failures: readonly {
    readonly eventId: string;
    readonly error: string;
  }[];
}

/** Pull result returned by `SyncSession.pull`. */
export interface SyncPullResult {
  readonly events: readonly SyncOutboxEntry[];
  readonly nextLsn?: string;
  readonly hasMore: boolean;
}

/** Delivery outcome returned by `SyncTransport.deliver`. */
export interface SyncDeliveryResult {
  readonly deliveredCount: number;
  readonly failedCount: number;
  readonly failures: readonly {
    readonly eventId: string;
    readonly error: string;
    readonly retryable: boolean;
  }[];
}

/** Health of a transport endpoint (per ADR-077 §4 Layer 6 circuit breaker). */
export interface TransportHealth {
  readonly healthy: boolean;
  readonly latencyMs?: number;
  readonly lastError?: string;
}

/** Optional partial-sync predicate per table (per ADR-070 §4 partial sync). */
export type SyncFilter = Readonly<Record<string, string>>;

/** Parameters for opening a sync session. */
export interface SyncSessionParams {
  readonly tenantId: string;
  readonly propertyId: string;
  readonly clientId: string;
  readonly syncMode: SyncMode;
  readonly transport: SyncTransport;
  readonly conflictResolver: SyncConflictResolver;
  readonly syncFilter?: SyncFilter;
}

/** Snapshot of the engine's current state for a tenant. */
export interface SyncEngineStatus {
  readonly state: SyncEngineState;
  readonly lastSyncAt?: string;
  readonly pendingEventCount: number;
  readonly conflictBacklogCount: number;
  readonly lastError?: string;
  readonly restateInvocationId?: string;
}

/** Per-session resumable-sync checkpoint (per ADR-077 §4 Layer 2). */
export interface SyncCursor {
  readonly tenantId: string;
  readonly clientId: string;
  readonly lastAckedLsn: string;
  readonly status: SyncCursorStatus;
  save(): Promise<void>;
  reload(): Promise<void>;
}

/** Checkpoint record persisted to `SyncCheckpoint` (ADR-072). */
export interface SyncCheckpoint {
  readonly id: string;
  readonly tenantId: string;
  readonly clientId: string;
  readonly syncMode: SyncMode;
  readonly lastCheckpointLsn: string;
  readonly status: SyncCursorStatus;
  readonly updatedAt: string;
  readonly syncOrigin: string | null;
  readonly revision: number;
}

/** Per-session sync lifecycle: push / pull / ack / close. */
export interface SyncSession {
  readonly cursor: SyncCursor;
  push(events: readonly SyncOutboxEntry[]): Promise<SyncPushResult>;
  pull(batchSize?: number): Promise<SyncPullResult>;
  ack(lastLsn: string): Promise<void>;
  close(): Promise<void>;
}

/** Conflict input supplied to `SyncConflictResolver.resolve`. */
export interface SyncConflictInput {
  readonly tenantId: string;
  readonly tableName: string;
  readonly recordId: string;
  readonly localPayloadJson: string;
  readonly remotePayloadJson: string;
  readonly detectedAt: string;
}

/** Conflict resolution outcome (three-tier policy per ADR-074). */
export interface SyncConflictResolution {
  readonly outcome: SyncConflictOutcome;
  readonly winnerPayloadJson?: string;
  readonly rationale: string;
  readonly recomputationFunction?: string;
  readonly syncConflictId?: string;
}

/** Queued conflict record in the `SyncConflict` table (ADR-074 Tier 3). */
export interface SyncConflict {
  readonly id: string;
  readonly tenantId: string;
  readonly tableName: string;
  readonly recordId: string;
  readonly localPayloadJson: string;
  readonly remotePayloadJson: string;
  readonly basePayloadJson?: string;
  readonly detectedAt: string;
  readonly resolvedAt: string | null;
  readonly resolution: SyncConflictResolution | null;
  readonly syncOrigin: string | null;
  readonly revision: number;
}

/**
 * `SyncConflictResolver` — three-tier policy per ADR-074:
 * (1) LWW by HLC-tagged `(updatedAt, revision, syncOrigin)` for
 *     non-financial fields;
 * (2) semantic override (server recomputes from the immutable event log)
 *     for financial fields;
 * (3) manual escalation to `SyncConflict` for unresolvable cases (3-way
 *     merge UI; never blocks live sync).
 */
export interface SyncConflictResolver {
  resolve(conflict: SyncConflictInput): SyncConflictResolution;
}

/**
 * `SyncTransport` — delivery abstraction (SQLite-only / LAN-hub /
 * cloud-PostgreSQL). The Phase 3+ managed-sync-engine swap (PowerSync,
 * ElectricSQL) implements this interface without touching `SyncEngine`
 * consumers.
 */
export interface SyncTransport {
  readonly mode: SyncMode;
  deliver(events: readonly SyncOutboxEntry[], session: SyncSession): Promise<SyncDeliveryResult>;
  fetch(sinceLsn: string, batchSize: number, session: SyncSession): Promise<SyncPullResult>;
  ack(lastLsn: string, session: SyncSession): Promise<void>;
  healthCheck(): Promise<TransportHealth>;
}

/**
 * `SyncEngine` — top-level interface, transport-agnostic and
 * conflict-resolver-pluggable. The Phase 1 `NoopSyncEngine` is the
 * trivially-correct STANDALONE implementation (satisfies the contract;
 * no sync active). Phase 2+ ships `SqlitePostgresSyncEngine`.
 */
export interface SyncEngine {
  openSession(params: SyncSessionParams): Promise<SyncSession>;
  getStatus(tenantId: string): SyncEngineStatus;
  pause(tenantId: string): Promise<void>;
  resume(tenantId: string): Promise<void>;
  forceResync(tenantId: string): Promise<void>;
}
