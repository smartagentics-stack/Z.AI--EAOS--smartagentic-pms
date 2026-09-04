/**
 * SQLiteFeatureFlagProvider — SQLite-backed reference implementation of FeatureFlagProvider (ADR-102)
 *
 * Reads flags from the FeatureFlag Prisma table. Caches in-memory with configurable TTL.
 * Production-grade for Phase 1 (flags stored in the same SQLite database as PMS data).
 *
 * @smartagentics/ai
 */

import type {
  FeatureFlag,
  FeatureFlagProvider,
  FeatureFlagEvaluation,
  CapabilityTier,
  FlagEvaluationContext,
  FlagVariant,
} from '@smartagentics/sdk';

export interface SQLiteFeatureFlagProviderConfig {
  readonly cacheTtlMs?: number;
}

interface CacheEntry {
  readonly flag: FeatureFlag | null;
  readonly expiresAt: number;
}

/**
 * SQLite-backed feature flag provider using Prisma.
 * Caches flags in-memory with configurable TTL to reduce database queries.
 */
export class SQLiteFeatureFlagProvider implements FeatureFlagProvider {
  private readonly prisma: {
    readonly featureFlag: {
      findUnique(args: { where: { key: string } }): Promise<FeatureFlag | null>;
      findMany(args: {
        where: { tier: CapabilityTier; tenantId?: string; domainId?: string };
      }): Promise<FeatureFlag[]>;
      create(args: { data: Omit<FeatureFlag, 'id' | 'changedAt'> }): Promise<FeatureFlag>;
      update(args: { where: { key: string }; data: Partial<FeatureFlag> }): Promise<FeatureFlag>;
    };
  };
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;

  constructor(
    prisma: SQLiteFeatureFlagProvider['prisma'],
    config?: SQLiteFeatureFlagProviderConfig,
  ) {
    this.prisma = prisma;
    this.cacheTtlMs = config?.cacheTtlMs ?? 60_000;
  }

  private isCacheValid(entry: CacheEntry): boolean {
    return Date.now() < entry.expiresAt;
  }

  private async getFlagInternal(key: string): Promise<FeatureFlag | null> {
    const cached = this.cache.get(key);
    if (cached && this.isCacheValid(cached)) return cached.flag;

    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    this.cache.set(key, { flag, expiresAt: Date.now() + this.cacheTtlMs });
    return flag;
  }

  private evaluateTargeting(
    flag: FeatureFlag,
    context?: FlagEvaluationContext,
  ): { matched: boolean; variant: FlagVariant } {
    if (!context || flag.targetingJson.length === 0) {
      return { matched: true, variant: flag.defaultValue };
    }

    for (const rule of flag.targetingJson) {
      const ctxValue =
        context.attributes?.[rule.field] ??
        (rule.field === 'tenantId'
          ? context.tenantId
          : rule.field === 'domainId'
            ? context.domainId
            : rule.field === 'userId'
              ? context.userId
              : rule.field === 'agentId'
                ? context.agentId
                : undefined);
      let matches = false;
      switch (rule.op) {
        case 'eq':
          matches = ctxValue === rule.value;
          break;
        case 'ne':
          matches = ctxValue !== rule.value;
          break;
        case 'in':
          matches = Array.isArray(rule.value) && rule.value.includes(ctxValue);
          break;
        case 'not-in':
          matches = Array.isArray(rule.value) && !rule.value.includes(ctxValue);
          break;
        case 'gt':
          matches =
            typeof ctxValue === 'number' && typeof rule.value === 'number' && ctxValue > rule.value;
          break;
        case 'gte':
          matches =
            typeof ctxValue === 'number' &&
            typeof rule.value === 'number' &&
            ctxValue >= rule.value;
          break;
        case 'lt':
          matches =
            typeof ctxValue === 'number' && typeof rule.value === 'number' && ctxValue < rule.value;
          break;
        case 'lte':
          matches =
            typeof ctxValue === 'number' &&
            typeof rule.value === 'number' &&
            ctxValue <= rule.value;
          break;
      }
      if (matches && flag.variantJson) {
        const variant = flag.variantJson[rule.variant];
        if (variant !== undefined) return { matched: true, variant };
      }
    }
    return { matched: false, variant: flag.defaultValue };
  }

  private evaluateFlag(
    flag: FeatureFlag | null,
    key: string,
    defaultValue: FlagVariant,
    context?: FlagEvaluationContext,
  ): FeatureFlagEvaluation<typeof defaultValue> {
    const now = new Date().toISOString();

    if (!flag) {
      return {
        flagKey: key,
        value: defaultValue,
        reason: 'DEFAULT',
        variant: null,
        evaluatedAt: now,
      };
    }

    if (!flag.enabled) {
      return {
        flagKey: key,
        value: defaultValue,
        reason: 'DISABLED',
        variant: null,
        evaluatedAt: now,
      };
    }

    // Rollout percentage
    if (flag.rolloutPct < 100) {
      const hashInput = `${key}:${context?.tenantId ?? 'global'}:${context?.userId ?? 'anonymous'}`;
      const hash = this.simpleHash(hashInput);
      if (hash % 100 >= flag.rolloutPct) {
        return {
          flagKey: key,
          value: defaultValue,
          reason: 'SPLIT',
          variant: null,
          evaluatedAt: now,
        };
      }
    }

    const { matched, variant } = this.evaluateTargeting(flag, context);
    return {
      flagKey: key,
      value: matched ? variant : flag.defaultValue,
      reason: matched ? 'TARGETING_MATCH' : 'STATIC',
      variant: matched ? String(variant) : null,
      evaluatedAt: now,
    };
  }

  /** @inheritdoc */
  async resolveBooleanValue(
    key: string,
    defaultValue: boolean,
    context?: FlagEvaluationContext,
  ): Promise<FeatureFlagEvaluation<boolean>> {
    const flag = await this.getFlagInternal(key);
    return this.evaluateFlag(flag, key, defaultValue, context) as FeatureFlagEvaluation<boolean>;
  }

  /** @inheritdoc */
  async resolveStringValue(
    key: string,
    defaultValue: string,
    context?: FlagEvaluationContext,
  ): Promise<FeatureFlagEvaluation<string>> {
    const flag = await this.getFlagInternal(key);
    return this.evaluateFlag(flag, key, defaultValue, context) as FeatureFlagEvaluation<string>;
  }

  /** @inheritdoc */
  async resolveNumberValue(
    key: string,
    defaultValue: number,
    context?: FlagEvaluationContext,
  ): Promise<FeatureFlagEvaluation<number>> {
    const flag = await this.getFlagInternal(key);
    return this.evaluateFlag(flag, key, defaultValue, context) as FeatureFlagEvaluation<number>;
  }

  /** @inheritdoc */
  async resolveObjectValue(
    key: string,
    defaultValue: Readonly<Record<string, unknown>>,
    context?: FlagEvaluationContext,
  ): Promise<FeatureFlagEvaluation<Readonly<Record<string, unknown>>>> {
    const flag = await this.getFlagInternal(key);
    return this.evaluateFlag(flag, key, defaultValue, context) as FeatureFlagEvaluation<
      Readonly<Record<string, unknown>>
    >;
  }

  /** @inheritdoc */
  async getFlag(key: string): Promise<FeatureFlag | null> {
    return this.getFlagInternal(key);
  }

  /** @inheritdoc */
  async listByTier(
    tier: CapabilityTier,
    tenantId?: string,
    domainId?: string,
  ): Promise<readonly FeatureFlag[]> {
    this.cache.clear();
    return this.prisma.featureFlag.findMany({ where: { tier, tenantId, domainId } });
  }

  /** @inheritdoc */
  async setFlag(flag: Omit<FeatureFlag, 'id' | 'changedAt'>): Promise<FeatureFlag> {
    const updated = await this.prisma.featureFlag.update({ where: { key: flag.key }, data: flag });
    this.cache.delete(flag.key);
    return updated;
  }

  invalidateCache(): void {
    this.cache.clear();
  }

  private simpleHash(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
