/**
 * Integration tests for SQLiteFeatureFlagProvider (ADR-102 OpenFeature-compatible
 * SQLite-backed provider).
 *
 * Uses an inline in-memory mock Prisma client (no real database) to verify
 * flag resolution, targeting, rollout-percentage (deterministic hash), the
 * getFlag / listByTier / setFlag surface, and the in-memory TTL cache.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SQLiteFeatureFlagProvider } from '../sqlite-feature-flag-provider.js';
import { CapabilityTier, type FeatureFlag, type FeatureFlagProvider } from '@smartagentics/sdk';

/** Shape of the prisma.featureFlag delegate the provider depends on. */
interface PrismaFeatureFlagDelegate {
  findUnique(args: { where: { key: string } }): Promise<FeatureFlag | null>;
  findMany(args: {
    where: { tier: CapabilityTier; tenantId?: string; domainId?: string };
  }): Promise<FeatureFlag[]>;
  create(args: { data: Omit<FeatureFlag, 'id' | 'changedAt'> }): Promise<FeatureFlag>;
  update(args: { where: { key: string }; data: Partial<FeatureFlag> }): Promise<FeatureFlag>;
}

interface PrismaLike {
  readonly featureFlag: PrismaFeatureFlagDelegate;
}

/** Builds a FeatureFlag with sensible defaults. */
function makeFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    id: 'flag-1',
    key: 'feature.pms.enabled',
    tier: CapabilityTier.FEATURE,
    tenantId: null,
    domainId: null,
    enabled: true,
    rolloutPct: 100,
    targetingJson: [],
    variantJson: null,
    schemaVersion: 1,
    defaultValue: true,
    changedBy: 'admin',
    changedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Creates an in-memory mock Prisma client backed by a Map. Tracks findUnique
 * and findMany call counts so cache behavior can be asserted.
 */
function makeMockPrisma(flags: FeatureFlag[] = []) {
  const store = new Map<string, FeatureFlag>();
  for (const f of flags) store.set(f.key, f);
  const calls = { findUnique: 0, findMany: 0, update: 0, create: 0 };
  const prisma: PrismaLike = {
    featureFlag: {
      async findUnique({ where }: { where: { key: string } }): Promise<FeatureFlag | null> {
        calls.findUnique += 1;
        return store.get(where.key) ?? null;
      },
      async findMany({
        where,
      }: {
        where: { tier: CapabilityTier; tenantId?: string; domainId?: string };
      }): Promise<FeatureFlag[]> {
        calls.findMany += 1;
        return Array.from(store.values()).filter((f) => {
          if (f.tier !== where.tier) return false;
          if (where.tenantId !== undefined && f.tenantId !== where.tenantId) return false;
          if (where.domainId !== undefined && f.domainId !== where.domainId) return false;
          return true;
        });
      },
      async create({
        data,
      }: {
        data: Omit<FeatureFlag, 'id' | 'changedAt'>;
      }): Promise<FeatureFlag> {
        calls.create += 1;
        const flag: FeatureFlag = {
          ...data,
          id: `flag-${store.size + 1}`,
          changedAt: new Date().toISOString(),
        };
        store.set(flag.key, flag);
        return flag;
      },
      async update({
        where,
        data,
      }: {
        where: { key: string };
        data: Partial<FeatureFlag>;
      }): Promise<FeatureFlag> {
        calls.update += 1;
        const existing = store.get(where.key);
        if (!existing) throw new Error(`flag ${where.key} not found`);
        const updated = { ...existing, ...data, key: where.key };
        store.set(where.key, updated);
        return updated;
      },
    },
  };
  return { prisma, calls, store };
}

describe('SQLiteFeatureFlagProvider', () => {
  let provider: FeatureFlagProvider;
  let mock: ReturnType<typeof makeMockPrisma>;

  beforeEach(() => {
    mock = makeMockPrisma();
    provider = new SQLiteFeatureFlagProvider(mock.prisma);
  });

  describe('resolveBooleanValue — flag not found', () => {
    it('returns the supplied default with reason DEFAULT when the flag does not exist', async () => {
      const result = await provider.resolveBooleanValue('missing.flag', false);
      expect(result.value).toBe(false);
      expect(result.reason).toBe('DEFAULT');
      expect(result.flagKey).toBe('missing.flag');
      expect(result.variant).toBeNull();
    });
  });

  describe('resolveBooleanValue — enabled flag, no targeting', () => {
    // NOTE: the provider treats an empty targetingJson as "the default bucket
    // matches everyone" — evaluateTargeting returns matched=true with the
    // flag's defaultValue, so the reported reason is TARGETING_MATCH (not
    // STATIC). STATIC only occurs when targeting rules EXIST but none match.
    it('returns the flag defaultValue with reason TARGETING_MATCH (default bucket)', async () => {
      mock = makeMockPrisma([
        makeFlag({
          key: 'f.static',
          enabled: true,
          rolloutPct: 100,
          defaultValue: true,
          targetingJson: [],
        }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const result = await provider.resolveBooleanValue('f.static', false);
      expect(result.value).toBe(true);
      expect(result.reason).toBe('TARGETING_MATCH');
      expect(result.variant).toBe('true');
    });

    it('returns the flag defaultValue when no context is supplied', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.noctx', enabled: true, rolloutPct: 100, defaultValue: true }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const result = await provider.resolveBooleanValue('f.noctx', false);
      expect(result.value).toBe(true);
    });
  });

  describe('resolveBooleanValue — disabled flag', () => {
    it('returns the supplied default with reason DISABLED', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.disabled', enabled: false, rolloutPct: 100, defaultValue: true }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const result = await provider.resolveBooleanValue('f.disabled', false);
      expect(result.value).toBe(false);
      expect(result.reason).toBe('DISABLED');
    });
  });

  describe('resolveBooleanValue — rollout percentage (deterministic hash)', () => {
    it('rolloutPct=0 always returns the default with reason SPLIT (gates out everyone)', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.split0', enabled: true, rolloutPct: 0, defaultValue: true }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      for (const userId of ['u1', 'u2', 'u3', 'u4', 'u5']) {
        const result = await provider.resolveBooleanValue('f.split0', false, {
          tenantId: 't1',
          userId,
        });
        expect(result.value).toBe(false);
        expect(result.reason).toBe('SPLIT');
      }
    });

    it('rolloutPct=100 always returns the flag value (lets everyone through)', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.split100', enabled: true, rolloutPct: 100, defaultValue: true }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      for (const userId of ['u1', 'u2', 'u3', 'u4', 'u5']) {
        const result = await provider.resolveBooleanValue('f.split100', false, {
          tenantId: 't1',
          userId,
        });
        expect(result.value).toBe(true);
        // No targeting rules → default-bucket match → TARGETING_MATCH.
        expect(result.reason).toBe('TARGETING_MATCH');
      }
    });

    it('is deterministic: the same context yields the same result across calls', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.split50', enabled: true, rolloutPct: 50, defaultValue: true }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const ctx = { tenantId: 't1', userId: 'deterministic-user' };
      const first = await provider.resolveBooleanValue('f.split50', false, ctx);
      const second = await provider.resolveBooleanValue('f.split50', false, ctx);
      expect(second.value).toBe(first.value);
      expect(second.reason).toBe(first.reason);
    });

    it('varies the rollout decision by context (hash depends on tenantId/userId)', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.split50b', enabled: true, rolloutPct: 50, defaultValue: true }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const values = new Set<boolean>();
      for (let i = 0; i < 40; i++) {
        const result = await provider.resolveBooleanValue('f.split50b', false, {
          tenantId: 't1',
          userId: `user-${i}`,
        });
        values.add(result.value);
      }
      // With a 50% rollout and 40 distinct users, we expect BOTH outcomes.
      expect(values.size).toBe(2);
    });

    it('uses a stable hash input of `${key}:${tenantId}:${userId}` (anonymous fallback)', async () => {
      // Two calls with identical context but different keys may resolve differently;
      // here we assert the no-context path is deterministic and uses the
      // 'global'/'anonymous' fallback without throwing.
      mock = makeMockPrisma([
        makeFlag({ key: 'f.nofallback', enabled: true, rolloutPct: 50, defaultValue: true }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const a = await provider.resolveBooleanValue('f.nofallback', false);
      const b = await provider.resolveBooleanValue('f.nofallback', false);
      expect(a.value).toBe(b.value);
    });
  });

  describe('resolveBooleanValue — targeting rules', () => {
    it('returns the targeted variant when an eq rule matches the context', async () => {
      mock = makeMockPrisma([
        makeFlag({
          key: 'f.targeted',
          enabled: true,
          rolloutPct: 100,
          defaultValue: false,
          targetingJson: [{ field: 'tenantId', op: 'eq', value: 't1', variant: 'on' }],
          variantJson: { on: true },
        }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const matched = await provider.resolveBooleanValue('f.targeted', false, {
        tenantId: 't1',
      });
      expect(matched.value).toBe(true);
      expect(matched.reason).toBe('TARGETING_MATCH');
      // The reported `variant` is String(variantValue) — the VALUE selected
      // from variantJson (here `true`), not the variant KEY ('on').
      expect(matched.variant).toBe('true');
    });

    it('returns the flag default when no targeting rule matches', async () => {
      mock = makeMockPrisma([
        makeFlag({
          key: 'f.unmatched',
          enabled: true,
          rolloutPct: 100,
          defaultValue: false,
          targetingJson: [{ field: 'tenantId', op: 'eq', value: 'other', variant: 'on' }],
          variantJson: { on: true },
        }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const result = await provider.resolveBooleanValue('f.unmatched', false, {
        tenantId: 't1',
      });
      expect(result.value).toBe(false);
      expect(result.reason).toBe('STATIC');
    });
  });

  describe('resolve*Value (string / number / object)', () => {
    it('resolves a string flag', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.str', enabled: true, rolloutPct: 100, defaultValue: 'hello' }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const result = await provider.resolveStringValue('f.str', 'fallback');
      expect(result.value).toBe('hello');
      // No targeting rules → default-bucket match → TARGETING_MATCH.
      expect(result.reason).toBe('TARGETING_MATCH');
    });

    it('resolves a number flag', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.num', enabled: true, rolloutPct: 100, defaultValue: 42 }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const result = await provider.resolveNumberValue('f.num', 0);
      expect(result.value).toBe(42);
    });

    it('resolves an object flag', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.obj', enabled: true, rolloutPct: 100, defaultValue: { a: 1 } }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const result = await provider.resolveObjectValue('f.obj', {});
      expect(result.value).toEqual({ a: 1 });
    });
  });

  describe('getFlag', () => {
    it('returns the flag when it exists', async () => {
      const flag = makeFlag({ key: 'f.get' });
      mock = makeMockPrisma([flag]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const fetched = await provider.getFlag('f.get');
      expect(fetched).not.toBeNull();
      expect(fetched!.key).toBe('f.get');
    });

    it('returns null when the flag does not exist', async () => {
      const fetched = await provider.getFlag('does.not.exist');
      expect(fetched).toBeNull();
    });
  });

  describe('listByTier', () => {
    it('returns flags filtered by tier', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.feature', tier: CapabilityTier.FEATURE }),
        makeFlag({ key: 'f.domain', tier: CapabilityTier.DOMAIN }),
        makeFlag({ key: 'f.feature2', tier: CapabilityTier.FEATURE }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const featureFlags = await provider.listByTier(CapabilityTier.FEATURE);
      expect(featureFlags).toHaveLength(2);
      expect(featureFlags.every((f) => f.tier === CapabilityTier.FEATURE)).toBe(true);
    });

    it('further filters by tenantId when supplied', async () => {
      mock = makeMockPrisma([
        makeFlag({ key: 'f.t1', tier: CapabilityTier.FEATURE, tenantId: 't1' }),
        makeFlag({ key: 'f.t2', tier: CapabilityTier.FEATURE, tenantId: 't2' }),
      ]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const t1Flags = await provider.listByTier(CapabilityTier.FEATURE, 't1');
      expect(t1Flags).toHaveLength(1);
      expect(t1Flags[0].tenantId).toBe('t1');
    });

    it('returns an empty array when no flags match the tier', async () => {
      mock = makeMockPrisma([makeFlag({ key: 'f.feature', tier: CapabilityTier.FEATURE })]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      const experimental = await provider.listByTier(CapabilityTier.EXPERIMENTAL);
      expect(experimental).toEqual([]);
    });
  });

  describe('setFlag', () => {
    it('updates the stored flag via prisma.update and invalidates the cache entry', async () => {
      const existing = makeFlag({ key: 'f.set', enabled: false, defaultValue: false });
      mock = makeMockPrisma([existing]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      // Prime the cache with the disabled flag.
      const before = await provider.resolveBooleanValue('f.set', false);
      expect(before.value).toBe(false);
      expect(before.reason).toBe('DISABLED');
      // Update the flag to enabled.
      await provider.setFlag({ ...existing, enabled: true });
      expect(mock.calls.update).toBe(1);
      // After setFlag, the cache entry is invalidated → next read reflects the update.
      const after = await provider.resolveBooleanValue('f.set', false);
      expect(after.reason).not.toBe('DISABLED');
    });
  });

  describe('cache behavior', () => {
    it('serves a second call within the TTL from cache (no extra DB call)', async () => {
      mock = makeMockPrisma([makeFlag({ key: 'f.cached', enabled: true, defaultValue: true })]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      await provider.resolveBooleanValue('f.cached', false);
      expect(mock.calls.findUnique).toBe(1);
      await provider.resolveBooleanValue('f.cached', false);
      expect(mock.calls.findUnique).toBe(1); // still 1 — served from cache
    });

    it('re-queries the DB after the cache TTL expires', async () => {
      mock = makeMockPrisma([makeFlag({ key: 'f.ttl', enabled: true, defaultValue: true })]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma, { cacheTtlMs: 50 });
      await provider.resolveBooleanValue('f.ttl', false);
      expect(mock.calls.findUnique).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 60));
      await provider.resolveBooleanValue('f.ttl', false);
      expect(mock.calls.findUnique).toBe(2); // cache expired → DB re-queried
    });

    it('getFlag and resolveBooleanValue share the same cache entry', async () => {
      mock = makeMockPrisma([makeFlag({ key: 'f.shared', enabled: true, defaultValue: true })]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      await provider.getFlag('f.shared');
      expect(mock.calls.findUnique).toBe(1);
      await provider.resolveBooleanValue('f.shared', false);
      expect(mock.calls.findUnique).toBe(1); // served from cache populated by getFlag
    });

    it('listByTier clears the cache before querying', async () => {
      mock = makeMockPrisma([makeFlag({ key: 'f.clear', enabled: true, defaultValue: true })]);
      provider = new SQLiteFeatureFlagProvider(mock.prisma);
      await provider.resolveBooleanValue('f.clear', false); // populates cache
      expect(mock.calls.findUnique).toBe(1);
      await provider.listByTier(CapabilityTier.FEATURE);
      await provider.resolveBooleanValue('f.clear', false); // cache was cleared → re-query
      expect(mock.calls.findUnique).toBe(2);
    });

    it('invalidateCache() forces the next read to re-query the DB', async () => {
      mock = makeMockPrisma([makeFlag({ key: 'f.inv', enabled: true, defaultValue: true })]);
      const providerWithInvalidate = new SQLiteFeatureFlagProvider(mock.prisma);
      await providerWithInvalidate.resolveBooleanValue('f.inv', false);
      expect(mock.calls.findUnique).toBe(1);
      providerWithInvalidate.invalidateCache();
      await providerWithInvalidate.resolveBooleanValue('f.inv', false);
      expect(mock.calls.findUnique).toBe(2);
    });
  });

  describe('evaluation result envelope', () => {
    it('always stamps flagKey and evaluatedAt on the result', async () => {
      const result = await provider.resolveBooleanValue('any.flag', false);
      expect(result.flagKey).toBe('any.flag');
      expect(result.evaluatedAt).toEqual(expect.any(String));
    });
  });
});
