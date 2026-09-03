/**
 * Feature Flag SDK interfaces (ADR-102) — OpenFeature-compatible provider
 * API with a SmartAgentics-owned SQLite-backed provider for Phase 1.
 *
 * The OpenFeature SDK API is the vendor-neutral interface; the Phase 1
 * provider is an in-process SQLite-backed evaluator reading from a
 * `FeatureFlag` Prisma table (extends ADR-078). Phase 2+ may swap in a
 * managed provider (LaunchDarkly, ConfigCat, Flagsmith) behind the same
 * interface. The directive's six capability tiers (Domain / Module /
 * Feature / Agent / AI / Experimental) map to OpenFeature flag categories
 * with structured flag keys.
 *
 * This file contains TYPE DEFINITIONS ONLY — no implementation logic.
 */

/** Capability tier (per ADR-102; directive lines 985–1002). */
export enum CapabilityTier {
  DOMAIN = 'domain',
  MODULE = 'module',
  FEATURE = 'feature',
  AGENT = 'agent',
  AI = 'ai',
  EXPERIMENTAL = 'experimental',
}

/** OpenFeature flag-evaluation reason codes. */
export type FlagEvaluationReason =
  'STATIC' | 'DEFAULT' | 'TARGETING_MATCH' | 'SPLIT' | 'CACHED' | 'DISABLED' | 'ERROR';

/** OpenFeature evaluation context — drives per-tenant / per-domain / per-agent targeting. */
export interface FlagEvaluationContext {
  readonly tenantId?: string;
  readonly domainId?: string;
  readonly userId?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/** Structured flag key — e.g. `domain.pms.enabled`, `agent.inventoryAI.experimental`. */
export interface FlagKey {
  readonly tier: CapabilityTier;
  readonly segments: readonly string[];
  readonly state?: string;
  readonly raw: string;
}

/** OpenFeature variant value. */
export type FlagVariant = boolean | string | number | Readonly<Record<string, unknown>>;

/** OpenFeature targeting rule. */
export interface FlagTargetingRule {
  readonly field: string;
  readonly op: 'eq' | 'ne' | 'in' | 'not-in' | 'gt' | 'gte' | 'lt' | 'lte';
  readonly value: unknown;
  readonly variant: string;
}

/** Feature flag definition (extends ADR-078 `FeatureFlag` model). */
export interface FeatureFlag {
  readonly id: string;
  readonly key: string;
  readonly tier: CapabilityTier;
  readonly tenantId: string | null;
  readonly domainId: string | null;
  readonly enabled: boolean;
  readonly rolloutPct: number;
  readonly targetingJson: readonly FlagTargetingRule[];
  readonly variantJson: Readonly<Record<string, FlagVariant>> | null;
  readonly schemaVersion: number;
  readonly defaultValue: FlagVariant;
  readonly description?: string;
  readonly changedBy: string;
  readonly changedAt: string;
}

/** OpenFeature evaluation result. */
export interface FeatureFlagEvaluation<T extends FlagVariant = FlagVariant> {
  readonly flagKey: string;
  readonly value: T;
  readonly variant: string | null;
  readonly reason: FlagEvaluationReason;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly evaluatedAt: string;
}

/**
 * `FeatureFlagProvider` — OpenFeature-compatible provider interface (per
 * ADR-102 §4 Option D). Phase 1 implementation is an in-process
 * SQLite-backed evaluator; Phase 2+ may swap in a managed provider
 * (LaunchDarkly / ConfigCat / Flagsmith) behind the same interface.
 */
export interface FeatureFlagProvider {
  resolveBooleanValue(
    key: string,
    defaultValue: boolean,
    context?: FlagEvaluationContext,
  ): Promise<FeatureFlagEvaluation<boolean>>;
  resolveStringValue(
    key: string,
    defaultValue: string,
    context?: FlagEvaluationContext,
  ): Promise<FeatureFlagEvaluation<string>>;
  resolveNumberValue(
    key: string,
    defaultValue: number,
    context?: FlagEvaluationContext,
  ): Promise<FeatureFlagEvaluation<number>>;
  resolveObjectValue(
    key: string,
    defaultValue: Readonly<Record<string, unknown>>,
    context?: FlagEvaluationContext,
  ): Promise<FeatureFlagEvaluation<Readonly<Record<string, unknown>>>>;
  getFlag(key: string): Promise<FeatureFlag | null>;
  listByTier(
    tier: CapabilityTier,
    tenantId?: string,
    domainId?: string,
  ): Promise<readonly FeatureFlag[]>;
  setFlag(flag: Omit<FeatureFlag, 'id' | 'changedAt'>): Promise<FeatureFlag>;
}
