/**
 * NoopSyncEngine — Phase 1 STANDALONE reference implementation of the
 * `SyncEngine` contract (ADR-070 / ADR-079).
 *
 * In STANDALONE mode (single-machine, offline-only deployment) there is no
 * upstream to sync with, so every operation is a safe no-op that still
 * satisfies the `SyncEngine` + `SyncSession` + `SyncCursor` type contracts.
 * `getStatus()` reports a healthy idle engine with zero pending events and
 * zero conflicts — the engine is trivially correct because there is nothing
 * to do. Conflict resolution is impossible by construction (STANDALONE has no
 * remote to conflict with), so any `SyncConflictResolver` wired into
 * `openSession` is simply never invoked.
 *
 * Phase 2+ replaces this with `SqlitePostgresSyncEngine` (LAN-hub /
 * cloud-synced topologies) behind the SAME interface — no consumer rewrite.
 *
 * @see SyncEngine — implemented contract.
 */

import type {
  SyncEngine,
  SyncEngineStatus,
  SyncSession,
  SyncSessionParams,
  SyncCursor,
  SyncPushResult,
  SyncPullResult,
  SyncOutboxEntry,
} from '@smartagentics/sdk';

/** Sentinel LSN used by the STANDALONE cursor — no real log sequence numbers exist. */
const STANDALONE_LSN = '0';

/**
 * In-memory cursor for a STANDALONE session. `save` / `reload` are no-ops
 * because there is no persisted checkpoint to maintain when nothing syncs.
 */
class NoopSyncCursor implements SyncCursor {
  public readonly tenantId: string;
  public readonly clientId: string;
  public readonly lastAckedLsn: string;
  public readonly status: 'active' | 'stale' | 'error';

  public constructor(tenantId: string, clientId: string) {
    this.tenantId = tenantId;
    this.clientId = clientId;
    this.lastAckedLsn = STANDALONE_LSN;
    this.status = 'active';
  }

  /** No-op — STANDALONE sessions do not persist checkpoints. */
  public async save(): Promise<void> {
    // Intentionally empty: no checkpoint store in STANDALONE mode.
  }

  /** No-op — STANDALONE sessions have no external checkpoint to reload. */
  public async reload(): Promise<void> {
    // Intentionally empty: nothing to reload.
  }
}

/**
 * STANDALONE sync session. `push` acknowledges all events as delivered
 * (nothing to deliver to); `pull` returns an empty batch with no more pages;
 * `ack` / `close` are no-ops. The session is "immediately complete" — opening
 * it performs all the (zero) work there is to do.
 */
class NoopSyncSession implements SyncSession {
  public readonly cursor: SyncCursor;
  private readonly tenantId: string;
  private closed = false;

  public constructor(params: SyncSessionParams) {
    this.tenantId = params.tenantId;
    this.cursor = new NoopSyncCursor(params.tenantId, params.clientId);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error(`NoopSyncSession[${this.tenantId}]: cannot operate on a closed session`);
    }
  }

  /**
   * Acknowledges all pushed events as delivered. In STANDALONE mode there is
   * no transport, so every event is trivially "delivered" (to nowhere).
   */
  public async push(events: readonly SyncOutboxEntry[]): Promise<SyncPushResult> {
    this.assertOpen();
    return {
      deliveredCount: events.length,
      failedCount: 0,
      failures: [],
    };
  }

  /**
   * Returns an empty pull result — STANDALONE mode has no upstream log to
   * pull from, so there are never any incoming events.
   */
  public async pull(_batchSize?: number): Promise<SyncPullResult> {
    this.assertOpen();
    return {
      events: [],
      hasMore: false,
    };
  }

  /** No-op acknowledgement — nothing to advance in STANDALONE mode. */
  public async ack(_lastLsn: string): Promise<void> {
    this.assertOpen();
    // Intentionally empty: the cursor's lastAckedLsn is a fixed sentinel.
  }

  /** Marks the session closed; subsequent operations throw. */
  public async close(): Promise<void> {
    this.closed = true;
  }
}

/**
 * `NoopSyncEngine` — Phase 1 STANDALONE `SyncEngine`.
 *
 * Use this implementation when no synchronization is required: single-machine
 * deployments, offline-only operation, or test harnesses. It is the
 * trivially-correct base case of the sync contract — every method either
 * returns an empty / success result or is a no-op, and `getStatus()` always
 * reports a healthy idle engine with zero pending events and zero conflicts.
 *
 * The STANDALONE mode is implied by the engine type itself (it is not a field
 * on `SyncEngineStatus`); consumers that need to branch on topology should
 * inspect the `syncMode` passed to `openSession` at the call site.
 */
export class NoopSyncEngine implements SyncEngine {
  /**
   * Opens a STANDALONE session. The session is immediately usable and
   * immediately "complete" — `push` succeeds, `pull` is empty, and no
   * background work is scheduled.
   *
   * @param params - Session parameters. `params.syncMode` SHOULD be
   *   `STANDALONE`; other modes are accepted (the engine is mode-agnostic)
   *   but will still behave as a no-op.
   * @throws {Error} if `tenantId` or `clientId` is missing.
   */
  public async openSession(params: SyncSessionParams): Promise<SyncSession> {
    if (!params.tenantId) {
      throw new Error('NoopSyncEngine.openSession: tenantId is required');
    }
    if (!params.clientId) {
      throw new Error('NoopSyncEngine.openSession: clientId is required');
    }
    return new NoopSyncSession(params);
  }

  /**
   * Reports the engine status for a tenant. STANDALONE engines are always
   * `idle` with no pending events and no conflict backlog. `lastSyncAt` is
   * omitted (no sync has ever occurred); `lastError` and
   * `restateInvocationId` are omitted (none applicable).
   *
   * @throws {Error} if `tenantId` is empty.
   */
  public getStatus(tenantId: string): SyncEngineStatus {
    if (!tenantId) {
      throw new Error('NoopSyncEngine.getStatus: tenantId is required');
    }
    return {
      state: 'idle',
      pendingEventCount: 0,
      conflictBacklogCount: 0,
    };
  }

  /** No-op — there is no sync loop to pause in STANDALONE mode. */
  public async pause(_tenantId: string): Promise<void> {
    // Intentionally empty.
  }

  /** No-op — there is no sync loop to resume in STANDALONE mode. */
  public async resume(_tenantId: string): Promise<void> {
    // Intentionally empty.
  }

  /** No-op — there is nothing to re-sync in STANDALONE mode. */
  public async forceResync(_tenantId: string): Promise<void> {
    // Intentionally empty.
  }
}
