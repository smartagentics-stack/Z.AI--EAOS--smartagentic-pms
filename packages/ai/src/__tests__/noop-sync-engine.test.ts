/**
 * Integration tests for NoopSyncEngine (ADR-070 / ADR-079 STANDALONE mode).
 *
 * The NoopSyncEngine is the trivially-correct Phase 1 SyncEngine: in
 * STANDALONE mode there is no upstream to sync with, so every operation is a
 * safe no-op that still satisfies the SyncEngine + SyncSession + SyncCursor
 * contracts. Conflict resolution is delegated to an injected SyncConflictResolver
 * that is NEVER invoked (STANDALONE has no remote to conflict with).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NoopSyncEngine } from '../noop-sync-engine.js';
import {
  SyncMode,
  type SyncEngine,
  type SyncSessionParams,
  type SyncTransport,
  type SyncConflictResolver,
  type SyncOutboxEntry,
  type SyncConflictInput,
  type SyncConflictResolution,
  type SyncSession,
} from '@smartagentics/sdk';

/** Builds a minimal stub SyncTransport (mode STANDALONE) — never invoked. */
function makeTransport(): SyncTransport {
  return {
    mode: SyncMode.STANDALONE,
    async deliver() {
      return { deliveredCount: 0, failedCount: 0, failures: [] };
    },
    async fetch() {
      return { events: [], hasMore: false };
    },
    async ack() {
      /* no-op */
    },
    async healthCheck() {
      return { healthy: true };
    },
  };
}

/** Builds a SyncConflictResolver that records calls and would throw if invoked. */
function makeRecordingResolver(calls: SyncConflictInput[]): SyncConflictResolver {
  return {
    resolve(conflict: SyncConflictInput): SyncConflictResolution {
      calls.push(conflict);
      throw new Error('conflict resolver should never be invoked in STANDALONE mode');
    },
  };
}

/** Builds valid SyncSessionParams for the given tenant/client. */
function makeParams(
  tenantId: string,
  clientId: string,
  resolver: SyncConflictResolver,
): SyncSessionParams {
  return {
    tenantId,
    propertyId: 'property-1',
    clientId,
    syncMode: SyncMode.STANDALONE,
    transport: makeTransport(),
    conflictResolver: resolver,
  };
}

/** Builds a minimal outbox entry. */
function makeEntry(tenantId: string, id: string): SyncOutboxEntry {
  return {
    id,
    tenantId,
    tableName: 'Guest',
    recordId: `rec-${id}`,
    operation: 'insert',
    payloadJson: '{}',
    hlc: '2024-01-01T00:00:00.000000000',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('NoopSyncEngine', () => {
  let engine: SyncEngine;
  let resolverCalls: SyncConflictInput[];

  beforeEach(() => {
    engine = new NoopSyncEngine();
    resolverCalls = [];
  });

  describe('openSession', () => {
    it('returns a session that is immediately usable', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      expect(session).toBeDefined();
      expect(session.cursor).toBeDefined();
    });

    it('throws when tenantId is missing', async () => {
      await expect(
        engine.openSession(makeParams('', 'client-1', makeRecordingResolver(resolverCalls))),
      ).rejects.toThrow(/tenantId is required/);
    });

    it('throws when clientId is missing', async () => {
      await expect(
        engine.openSession(makeParams('tenant-1', '', makeRecordingResolver(resolverCalls))),
      ).rejects.toThrow(/clientId is required/);
    });
  });

  describe('session.push', () => {
    it('returns success with deliveredCount equal to the number of pushed events', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      const events = [
        makeEntry('tenant-1', 'e1'),
        makeEntry('tenant-1', 'e2'),
        makeEntry('tenant-1', 'e3'),
      ];
      const result = await session.push(events);
      expect(result.deliveredCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.failures).toEqual([]);
    });

    it('returns success with zero delivered when pushing nothing', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      const result = await session.push([]);
      expect(result.deliveredCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });
  });

  describe('session.pull', () => {
    it('returns an empty result with hasMore=false', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      const result = await session.pull();
      expect(result.events).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it('returns empty results regardless of requested batchSize', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      const result = await session.pull(500);
      expect(result.events).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('session.cursor', () => {
    it('exposes the sentinel LSN and active status', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      expect(session.cursor.tenantId).toBe('tenant-1');
      expect(session.cursor.clientId).toBe('client-1');
      expect(session.cursor.lastAckedLsn).toBe('0');
      expect(session.cursor.status).toBe('active');
    });

    it('save() and reload() are no-ops that resolve without error', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      await expect(session.cursor.save()).resolves.toBeUndefined();
      await expect(session.cursor.reload()).resolves.toBeUndefined();
      expect(session.cursor.lastAckedLsn).toBe('0');
    });
  });

  describe('session lifecycle', () => {
    it('ack() is a no-op that resolves without error', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      await expect(session.ack('12345')).resolves.toBeUndefined();
    });

    it('close() marks the session closed; subsequent operations throw', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      await session.close();
      await expect(session.push([])).rejects.toThrow(/closed session/);
      await expect(session.pull()).rejects.toThrow(/closed session/);
      await expect(session.ack('1')).rejects.toThrow(/closed session/);
    });
  });

  describe('getStatus', () => {
    it('reports idle state with no pending events and no conflicts', () => {
      const status = engine.getStatus('tenant-1');
      expect(status.state).toBe('idle');
      expect(status.pendingEventCount).toBe(0);
      expect(status.conflictBacklogCount).toBe(0);
    });

    it('does not report a lastSyncAt (no sync has ever occurred)', () => {
      const status = engine.getStatus('tenant-1');
      expect(status.lastSyncAt).toBeUndefined();
    });

    it('does not report a lastError or restateInvocationId', () => {
      const status = engine.getStatus('tenant-1');
      expect(status.lastError).toBeUndefined();
      expect(status.restateInvocationId).toBeUndefined();
    });

    it('throws when tenantId is empty', () => {
      expect(() => engine.getStatus('')).toThrow(/tenantId is required/);
    });
  });

  describe('control methods', () => {
    it('pause() is a no-op that resolves without error', async () => {
      await expect(engine.pause('tenant-1')).resolves.toBeUndefined();
    });

    it('resume() is a no-op that resolves without error', async () => {
      await expect(engine.resume('tenant-1')).resolves.toBeUndefined();
    });

    it('forceResync() is a no-op that resolves without error', async () => {
      await expect(engine.forceResync('tenant-1')).resolves.toBeUndefined();
    });
  });

  describe('conflict resolution (STANDALONE — no conflicts by construction)', () => {
    it('never invokes the injected SyncConflictResolver during push', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      await session.push([makeEntry('tenant-1', 'e1'), makeEntry('tenant-1', 'e2')]);
      expect(resolverCalls).toHaveLength(0);
    });

    it('never invokes the injected SyncConflictResolver during pull', async () => {
      const session = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      await session.pull();
      expect(resolverCalls).toHaveLength(0);
    });

    it('reports zero conflict backlog (no conflicts to resolve)', () => {
      const status = engine.getStatus('tenant-1');
      expect(status.conflictBacklogCount).toBe(0);
    });
  });

  describe('full STANDALONE session round-trip', () => {
    it('open → push → pull → ack → close completes without invoking the resolver', async () => {
      const session: SyncSession = await engine.openSession(
        makeParams('tenant-1', 'client-1', makeRecordingResolver(resolverCalls)),
      );
      const pushResult = await session.push([makeEntry('tenant-1', 'e1')]);
      expect(pushResult.failedCount).toBe(0);
      const pullResult = await session.pull();
      expect(pullResult.events).toHaveLength(0);
      await session.ack(session.cursor.lastAckedLsn);
      await session.close();
      expect(resolverCalls).toHaveLength(0);
    });
  });
});
