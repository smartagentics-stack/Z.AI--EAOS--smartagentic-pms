/**
 * Integration tests for InMemoryMemoryStore (ADR-038 §4.1, CoALA 7-category
 * taxonomy ADR-039, four-dimensional scope model ADR-041, GDPR Art 15/17).
 *
 * Covers store/read (store/retrieve/query semantics), update, forgetUser
 * (GDPR Art 17 hard-delete path via soft-delete + grace period), exportUserMemory
 * (GDPR Art 15 data-portability), tenant isolation, and error handling.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMemoryStore } from '../in-memory-memory-store.js';
import type {
  MemoryStore,
  MemoryRecord,
  MemoryPermissions,
  MemoryProvenance,
} from '@smartagentics/sdk';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

/** Builds a minimal provenance payload. */
function makeProvenance(): MemoryProvenance {
  return {
    sourceKind: 'USER_STATED',
    sourceIdentity: 'user-1',
    sourceEventIds: [],
  };
}

/** Builds MemoryPermissions scoped to a tenant + user (USER_PRIVATE scope). */
function permsFor(tenantId: string, overrides: Partial<MemoryPermissions> = {}): MemoryPermissions {
  return {
    tenantId,
    userId: 'user-1',
    agentId: 'agent-1',
    sessionId: 'session-1',
    teamId: 'team-1',
    aclRoles: ['agent'],
    scope: 'TENANT_SHARED',
    ...overrides,
  };
}

/** Input shape accepted by write() (omits generated fields). */
type WriteInput = Parameters<MemoryStore['write']>[0];

/** Builds a base memory record input. */
function makeRecordInput(overrides: Partial<WriteInput> = {}): WriteInput {
  return {
    tenantId: TENANT_A,
    type: 'SEMANTIC',
    scope: 'TENANT_SHARED',
    content: 'Guest prefers a high floor.',
    contentHash: 'hash-placeholder',
    embedding: null,
    confidence: 0.9,
    importance: 0.8,
    lastConfirmedAt: null,
    expiresAt: null,
    retentionPolicy: 'NO_TTL',
    halfLifeDays: 90,
    sensitivity: 'INTERNAL',
    provenance: makeProvenance(),
    metadata: {},
    ...overrides,
  };
}

describe('InMemoryMemoryStore', () => {
  let store: InMemoryMemoryStore;

  beforeEach(() => {
    store = new InMemoryMemoryStore();
  });

  describe('write (store)', () => {
    it('stores a record and returns it with generated id/writtenAt and zeroed counters', async () => {
      const stored = await store.write(makeRecordInput(), permsFor(TENANT_A));
      expect(stored.id).toEqual(expect.any(String));
      expect(stored.writtenAt).toEqual(expect.any(String));
      expect(stored.timesRetrieved).toBe(0);
      expect(stored.timesRetrievedAndConfirmed).toBe(0);
      expect(stored.content).toBe('Guest prefers a high floor.');
      expect(stored.type).toBe('SEMANTIC');
    });

    it('throws when permissions.tenantId is missing', async () => {
      await expect(store.write(makeRecordInput(), permsFor(''))).rejects.toThrow(
        /permissions\.tenantId is required/,
      );
    });

    it('throws when record.tenantId does not match permissions.tenantId', async () => {
      await expect(
        store.write(makeRecordInput({ tenantId: TENANT_A }), permsFor(TENANT_B)),
      ).rejects.toThrow(/record\.tenantId must match permissions\.tenantId/);
    });

    it('throws when the memory category is invalid', async () => {
      await expect(
        store.write(makeRecordInput({ type: 'BOGUS' as never }), permsFor(TENANT_A)),
      ).rejects.toThrow(/invalid memory category/);
    });

    it('accepts all 7 valid CoALA categories', async () => {
      const categories = [
        'WORKING',
        'CONVERSATIONAL',
        'EPISODIC',
        'SEMANTIC',
        'PROCEDURAL',
        'USER',
        'AGENT',
      ] as const;
      for (const type of categories) {
        const stored = await store.write(makeRecordInput({ type }), permsFor(TENANT_A));
        expect(stored.type).toBe(type);
      }
    });
  });

  describe('read (retrieve / query)', () => {
    it('retrieves a stored record by category under TENANT_SHARED scope', async () => {
      await store.write(makeRecordInput({ type: 'SEMANTIC' }), permsFor(TENANT_A));
      const results = await store.read({
        tenantId: TENANT_A,
        category: 'SEMANTIC',
        permissions: permsFor(TENANT_A, { scope: 'TENANT_SHARED' }),
      });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('SEMANTIC');
    });

    it('filters by category (excludes non-matching categories)', async () => {
      await store.write(makeRecordInput({ type: 'SEMANTIC' }), permsFor(TENANT_A));
      await store.write(makeRecordInput({ type: 'EPISODIC' }), permsFor(TENANT_A));
      const results = await store.read({
        tenantId: TENANT_A,
        category: 'EPISODIC',
        permissions: permsFor(TENANT_A),
      });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('EPISODIC');
    });

    it('filters by agentId via AGENT_PRIVATE scope', async () => {
      await store.write(
        makeRecordInput({ scope: 'AGENT_PRIVATE', agentId: 'agent-1' }),
        permsFor(TENANT_A, { scope: 'AGENT_PRIVATE', agentId: 'agent-1' }),
      );
      await store.write(
        makeRecordInput({ scope: 'AGENT_PRIVATE', agentId: 'agent-2' }),
        permsFor(TENANT_A, { scope: 'AGENT_PRIVATE', agentId: 'agent-2' }),
      );
      const results = await store.read({
        tenantId: TENANT_A,
        permissions: permsFor(TENANT_A, { scope: 'AGENT_PRIVATE', agentId: 'agent-1' }),
      });
      expect(results).toHaveLength(1);
      expect(results[0].agentId).toBe('agent-1');
    });

    it('filters by userId via USER_PRIVATE scope', async () => {
      await store.write(
        makeRecordInput({ scope: 'USER_PRIVATE', userId: 'user-1' }),
        permsFor(TENANT_A, { scope: 'USER_PRIVATE', userId: 'user-1' }),
      );
      const other = await store.write(
        makeRecordInput({ scope: 'USER_PRIVATE', userId: 'user-2' }),
        permsFor(TENANT_A, { scope: 'USER_PRIVATE', userId: 'user-2' }),
      );
      expect(other.userId).toBe('user-2');
      const results = await store.read({
        tenantId: TENANT_A,
        permissions: permsFor(TENANT_A, { scope: 'USER_PRIVATE', userId: 'user-1' }),
      });
      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe('user-1');
    });

    it('filters by keyword substring (case-insensitive)', async () => {
      await store.write(
        makeRecordInput({ content: 'Guest prefers a high floor.' }),
        permsFor(TENANT_A),
      );
      await store.write(
        makeRecordInput({ content: 'Loyalty tier is platinum.' }),
        permsFor(TENANT_A),
      );
      const results = await store.read({
        tenantId: TENANT_A,
        keyword: 'PREFERS',
        permissions: permsFor(TENANT_A),
      });
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('high floor');
    });

    it('filters by metadata filter', async () => {
      await store.write(makeRecordInput({ metadata: { region: 'APAC' } }), permsFor(TENANT_A));
      await store.write(makeRecordInput({ metadata: { region: 'EMEA' } }), permsFor(TENANT_A));
      const results = await store.read({
        tenantId: TENANT_A,
        filter: { region: 'APAC' },
        permissions: permsFor(TENANT_A),
      });
      expect(results).toHaveLength(1);
      expect(results[0].metadata.region).toBe('APAC');
    });

    it('respects the limit option', async () => {
      for (let i = 0; i < 5; i++) {
        await store.write(makeRecordInput({ content: `record ${i}` }), permsFor(TENANT_A));
      }
      const results = await store.read({
        tenantId: TENANT_A,
        limit: 2,
        permissions: permsFor(TENANT_A),
      });
      expect(results).toHaveLength(2);
    });

    it('returns empty when no records match', async () => {
      const results = await store.read({
        tenantId: TENANT_A,
        category: 'PROCEDURAL',
        permissions: permsFor(TENANT_A),
      });
      expect(results).toEqual([]);
    });

    it('returns null/empty for a wrong tenantId (tenant isolation)', async () => {
      await store.write(makeRecordInput({ tenantId: TENANT_A }), permsFor(TENANT_A));
      const results = await store.read({
        tenantId: TENANT_B,
        permissions: permsFor(TENANT_B),
      });
      expect(results).toEqual([]);
    });

    it('throws when permissions.tenantId is missing', async () => {
      await expect(
        store.read({
          tenantId: TENANT_A,
          permissions: permsFor(''),
        }),
      ).rejects.toThrow(/permissions\.tenantId is required/);
    });

    it('throws when query.tenantId does not match permissions.tenantId', async () => {
      await expect(
        store.read({
          tenantId: TENANT_A,
          permissions: permsFor(TENANT_B),
        }),
      ).rejects.toThrow(/query\.tenantId must match permissions\.tenantId/);
    });
  });

  describe('semantic recall (cosine similarity ranking)', () => {
    it('ranks records by cosine similarity to the query embedding and truncates to topK', async () => {
      await store.write(
        makeRecordInput({ embedding: [1, 0, 0], content: 'orthogonal y' }),
        permsFor(TENANT_A),
      );
      await store.write(
        makeRecordInput({ embedding: [1, 1, 0], content: 'similar to query' }),
        permsFor(TENANT_A),
      );
      await store.write(
        makeRecordInput({ embedding: [0.9, 0.9, 0], content: 'most similar' }),
        permsFor(TENANT_A),
      );
      const results = await store.read({
        tenantId: TENANT_A,
        semantic: { queryEmbedding: [1, 1, 0], topK: 2 },
        permissions: permsFor(TENANT_A),
      });
      expect(results).toHaveLength(2);
      // [0.9,0.9,0] is more similar to [1,1,0] than [1,1,0] itself? Both have
      // cosine similarity 1.0 (same direction). [1,0,0] is orthogonal → excluded.
      expect(results.map((r) => r.content)).not.toContain('orthogonal y');
    });
  });

  describe('update (merge/replace content)', () => {
    it('replaces content and recomputes the SHA-256 contentHash', async () => {
      const stored = await store.write(
        makeRecordInput({ content: 'old content' }),
        permsFor(TENANT_A),
      );
      const updated = await store.update(stored.id, 'new content', permsFor(TENANT_A));
      expect(updated.content).toBe('new content');
      expect(updated.contentHash).not.toBe('hash-placeholder');
      expect(updated.contentHash).toHaveLength(64);
      // other fields preserved
      expect(updated.type).toBe(stored.type);
      expect(updated.confidence).toBe(stored.confidence);
    });

    it('throws when the record does not exist in the tenant', async () => {
      await expect(store.update('nonexistent-id', 'x', permsFor(TENANT_A))).rejects.toThrow(
        /not found in tenant/,
      );
    });

    it('throws when permissions.tenantId is missing', async () => {
      await expect(store.update('any-id', 'x', permsFor(''))).rejects.toThrow(
        /permissions\.tenantId is required/,
      );
    });
  });

  describe('confirm', () => {
    it('sets lastConfirmedAt and increments timesRetrievedAndConfirmed', async () => {
      const stored = await store.write(makeRecordInput(), permsFor(TENANT_A));
      const confirmed = await store.confirm(stored.id, permsFor(TENANT_A));
      expect(confirmed.lastConfirmedAt).toEqual(expect.any(String));
      expect(confirmed.timesRetrievedAndConfirmed).toBe(1);
      const confirmed2 = await store.confirm(stored.id, permsFor(TENANT_A));
      expect(confirmed2.timesRetrievedAndConfirmed).toBe(2);
    });
  });

  describe('forgetUser (GDPR Art 17 erasure)', () => {
    it('soft-deletes a user records and returns the count + grace-period end', async () => {
      await store.write(
        makeRecordInput({ userId: 'user-x', retentionPolicy: 'NO_TTL' }),
        permsFor(TENANT_A),
      );
      await store.write(
        makeRecordInput({ userId: 'user-x', retentionPolicy: 'NO_TTL' }),
        permsFor(TENANT_A),
      );
      const result = await store.forgetUser('user-x', permsFor(TENANT_A));
      expect(result.deletedRecords).toBe(2);
      expect(result.gracePeriodEndsAt).toEqual(expect.any(String));
      // soft-deleted records are excluded from reads
      const remaining = await store.read({
        tenantId: TENANT_A,
        permissions: permsFor(TENANT_A),
      });
      expect(remaining).toHaveLength(0);
    });

    it('does NOT erase records under legal-basis retention (TAX_7Y / ACCESS_LOG_7Y)', async () => {
      await store.write(
        makeRecordInput({ userId: 'user-x', retentionPolicy: 'TAX_7Y' }),
        permsFor(TENANT_A),
      );
      await store.write(
        makeRecordInput({ userId: 'user-x', retentionPolicy: 'ACCESS_LOG_7Y' }),
        permsFor(TENANT_A),
      );
      const result = await store.forgetUser('user-x', permsFor(TENANT_A));
      expect(result.deletedRecords).toBe(0);
    });

    it('only affects the requesting tenant (tenant isolation)', async () => {
      await store.write(
        makeRecordInput({ tenantId: TENANT_A, userId: 'user-x' }),
        permsFor(TENANT_A),
      );
      await store.write(
        makeRecordInput({ tenantId: TENANT_B, userId: 'user-x' }),
        permsFor(TENANT_B),
      );
      const result = await store.forgetUser('user-x', permsFor(TENANT_A));
      expect(result.deletedRecords).toBe(1);
      // tenant B's record is untouched
      const remaining = await store.read({
        tenantId: TENANT_B,
        permissions: permsFor(TENANT_B),
      });
      expect(remaining).toHaveLength(1);
    });

    it('throws when permissions.tenantId is missing', async () => {
      await expect(store.forgetUser('user-x', permsFor(''))).rejects.toThrow(
        /permissions\.tenantId is required/,
      );
    });

    it('throws when userId is missing', async () => {
      await expect(store.forgetUser('', permsFor(TENANT_A))).rejects.toThrow(/userId is required/);
    });
  });

  describe('exportUserMemory (GDPR Art 15 data portability)', () => {
    it('returns all records and events for a user (including soft-deleted)', async () => {
      const rec = await store.write(makeRecordInput({ userId: 'user-x' }), permsFor(TENANT_A));
      await store.forgetUser('user-x', permsFor(TENANT_A)); // soft-deletes rec
      const exportResult = await store.exportUserMemory('user-x', permsFor(TENANT_A));
      expect(exportResult.userId).toBe('user-x');
      expect(exportResult.records).toHaveLength(1);
      expect(exportResult.records[0].id).toBe(rec.id);
      expect(exportResult.records[0].deletedAt).toEqual(expect.any(String));
      expect(exportResult.events).toEqual([]);
      expect(exportResult.exportedAt).toEqual(expect.any(String));
    });

    it('only returns records for the requesting tenant (tenant isolation)', async () => {
      await store.write(
        makeRecordInput({ tenantId: TENANT_A, userId: 'user-x' }),
        permsFor(TENANT_A),
      );
      await store.write(
        makeRecordInput({ tenantId: TENANT_B, userId: 'user-x' }),
        permsFor(TENANT_B),
      );
      const exportResult = await store.exportUserMemory('user-x', permsFor(TENANT_A));
      expect(exportResult.records).toHaveLength(1);
      expect(exportResult.records[0].tenantId).toBe(TENANT_A);
    });

    it('throws when permissions.tenantId is missing', async () => {
      await expect(store.exportUserMemory('user-x', permsFor(''))).rejects.toThrow(
        /permissions\.tenantId is required/,
      );
    });

    it('throws when userId is missing', async () => {
      await expect(store.exportUserMemory('', permsFor(TENANT_A))).rejects.toThrow(
        /userId is required/,
      );
    });
  });

  describe('logEvent', () => {
    it('appends an episodic event with a generated id', async () => {
      const event = await store.logEvent(
        {
          tenantId: TENANT_A,
          eventType: 'CHECKIN',
          eventTimestamp: new Date().toISOString(),
          payload: { kiosk: 'A1' },
          provenance: makeProvenance(),
          retentionPolicy: 'EPISODIC_180D',
        },
        permsFor(TENANT_A),
      );
      expect(event.id).toEqual(expect.any(String));
      expect(event.eventType).toBe('CHECKIN');
    });

    it('throws when event.tenantId does not match permissions.tenantId', async () => {
      await expect(
        store.logEvent(
          {
            tenantId: TENANT_A,
            eventType: 'CHECKIN',
            eventTimestamp: new Date().toISOString(),
            payload: {},
            provenance: makeProvenance(),
            retentionPolicy: 'EPISODIC_180D',
          },
          permsFor(TENANT_B),
        ),
      ).rejects.toThrow(/event\.tenantId must match permissions\.tenantId/);
    });
  });

  describe('full record lifecycle', () => {
    it('write → read → update → confirm → forget round-trips correctly', async () => {
      const stored: MemoryRecord = await store.write(
        makeRecordInput({ userId: 'user-lc' }),
        permsFor(TENANT_A),
      );
      const updated = await store.update(stored.id, 'updated content', permsFor(TENANT_A));
      expect(updated.content).toBe('updated content');
      await store.confirm(stored.id, permsFor(TENANT_A));
      const before = await store.read({
        tenantId: TENANT_A,
        permissions: permsFor(TENANT_A),
      });
      expect(before).toHaveLength(1);
      const result = await store.forgetUser('user-lc', permsFor(TENANT_A));
      expect(result.deletedRecords).toBe(1);
      const after = await store.read({
        tenantId: TENANT_A,
        permissions: permsFor(TENANT_A),
      });
      expect(after).toHaveLength(0);
    });
  });
});
