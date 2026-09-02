# ADR-102: OpenFeature Feature Flags with SQLite Provider + Domain Capability Tiers

**ADR-ID:** ADR-102
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

The domain-neutral architecture (ADR-097/098) introduces domain packages as opt-in: a deployment that doesn't activate the School domain doesn't get the `Student` table. The directive's required capability tiers (lines 985–1002) enumerate six categories — Domain, Module, Feature, Agent, AI, Experimental — that must be toggled at runtime without code change or redeployment. Existing SmartAgentics has no feature-flag technology in the reference stack (ADR-001).

Web research (Phase D Revision research report, Topic 6) confirms:

- **OpenFeature** (`https://openfeature.dev`) is the CNCF specification for vendor-neutral feature flagging. `https://openfeature.dev/docs/reference/intro`: "OpenFeature provides a shared, standardized feature flagging client - an SDK - which can be plugged into various 3rd-party feature flagging providers." OpenFeature blog (Nov 2023): "OpenFeature is an open specification that provides a vendor-agnostic, community-driven API for feature flagging." SigNoz (Sep 2024), ConfigCat (May 2026), and the GitHub discussion #249 confirm the spec is vendor-neutral: "The OpenFeature specification describes a vendor-neutral API for flag evaluation. It does not describe a flag definition language, or a flag evaluation wire protocol."
- **OpenFeature is a SPECIFICATION, not a provider.** SmartAgentics uses the OpenFeature SDK API; the provider is pluggable. For offline-first Phase 1, the provider is an in-process SQLite-backed evaluator reading from a `FeatureFlag` Prisma table.
- **The directive's required capability tiers** (lines 985–1002): Domain capability, Module capability, Feature capability, Agent capability, AI capability, Experimental capability. These map naturally to OpenFeature flag categories with structured flag keys (`domain.pms.enabled`, `module.restaurant.enabled`, `agent.inventoryAI.experimental`, `feature.cloudSync.disabled`).
- **ADR-001 Build-vs-Buy principle**: feature flags are a BUY decision (Auth.js, Promptfoo, Langfuse pattern — buy the standard, own the integration). OpenFeature is the standard interface; the Phase 1 provider is local SQLite; Phase 2+ may swap in a managed provider (LaunchDarkly, ConfigCat, Flagsmith) behind the same interface.
- **ADR-078** mentions `feature_flags` as a system table exempt from `tenantId`, but the directive's per-domain/per-agent capability tiers require `tenantId` AND `domainId` scoping — a conflict requiring amendment.

## 2. Problem

Should SmartAgentics (a) build a SmartAgentics-owned feature-flag library (violates ADR-001 Build-vs-Buy; reinvents OpenFeature), (b) adopt a managed feature-flag SaaS (LaunchDarkly, ConfigCat) as the Phase 1 provider (conflicts with offline-first — no cloud dependency in STANDALONE mode), (c) use environment variables / config files for feature flags (no runtime toggling; no per-tenant/per-domain targeting), or (d) adopt the OpenFeature SDK API with a SmartAgentics-owned SQLite-backed provider for Phase 1, with domain/module/agent capability flag categories and per-tenant/per-domain targeting?

## 3. Options

### Option A: SmartAgentics-owned feature-flag library

Rejected. Violates ADR-001 Build-vs-Buy principle (the pattern established by Auth.js, Promptfoo, Langfuse — buy the standard, own the integration). Reinvents OpenFeature; loses the vendor-neutral SDK API that allows Phase 2+ provider swap.

### Option B: Managed feature-flag SaaS (LaunchDarkly, ConfigCat) as Phase 1 provider

Rejected for Phase 1. Conflicts with the directive's offline-first requirement — a managed SaaS requires cloud connectivity; STANDALONE mode has no cloud. Reserved as a Phase 2+ provider option behind the OpenFeature SDK API.

### Option C: Environment variables / config files for feature flags

Rejected. No runtime toggling (requires redeployment). No per-tenant/per-domain targeting (env vars are process-global). No rollout percentages (0/100 only). Insufficient for the directive's six capability tiers and per-domain activation.

### Option D: OpenFeature SDK API + SmartAgentics-owned SQLite-backed provider + domain/module/agent capability tiers

Adopted. The OpenFeature SDK API is the vendor-neutral interface; the Phase 1 provider is an in-process SQLite-backed evaluator reading from a `FeatureFlag` Prisma table. The directive's six capability tiers map to OpenFeature flag categories with structured flag keys. Per-tenant/per-domain targeting via OpenFeature `EvaluationContext`.

## 4. Decision

Adopt **Option D** — OpenFeature SDK + SQLite Provider + Domain/Module/Agent Capability Tiers.

### `FeatureFlag` Prisma model (extends ADR-078)

```prisma
model FeatureFlag {
  id              String   @id @default(cuid())
  key             String   @unique  // e.g., "domain.pms.enabled", "agent.inventoryAI.experimental"
  category        String              // "domain" | "module" | "feature" | "agent" | "ai" | "experimental"
  tenantId        String?             // null = global; non-null = tenant-scoped
  domainId        String?             // null = cross-domain; non-null = domain-scoped
  enabled         Boolean  @default(false)
  rolloutPct      Int      @default(0)  // 0-100 percentage rollout
  targetingJson   Json                // OpenFeature targeting rules
  variantJson     Json?               // OpenFeature variants
  schemaVersion   Int      @default(1)
  changedBy       String
  changedAt       DateTime @default(now())
  @@index([category, tenantId, domainId])
  @@index([key, tenantId, domainId])
}
```

The OpenFeature SDK's `EvaluationContext` carries `{ tenantId, domainId, userId, agentId, sessionId }` so flag evaluation can target per-tenant, per-domain, per-user, or per-agent.

### Capability tier flag key convention

The directive's six capability tiers (lines 985–1002) map to OpenFeature flag categories with structured flag keys:

| Tier             | Flag key pattern                 | Example                                 | Default                                      |
| ---------------- | -------------------------------- | --------------------------------------- | -------------------------------------------- |
| **Domain**       | `domain.<name>.enabled`          | `domain.pms.enabled`                    | `true` (PMS is the baseline domain)          |
| **Module**       | `module.<domain>.<name>.enabled` | `module.pms.restaurant.enabled`         | `false` (opt-in)                             |
| **Feature**      | `feature.<name>.<state>`         | `feature.cloudSync.disabled`            | `false` (enabled by default unless flag set) |
| **Agent**        | `agent.<name>.<state>`           | `agent.inventoryAI.experimental`        | `false`                                      |
| **AI**           | `ai.<capability>.<state>`        | `ai.toolCalling.enabled`                | `true`                                       |
| **Experimental** | `experimental.<name>.enabled`    | `experimental.barEntityBuilder.enabled` | `false` (experimental defaults off)          |

### OpenFeature provider architecture

- **Phase 1 (offline-first STANDALONE)**: `SQLiteFeatureFlagProvider` — an in-process OpenFeature provider that reads from the `FeatureFlag` Prisma table. Flag evaluations are O(1) lookups with in-memory cache (cache invalidates on `FeatureFlag` mutation via Prisma middleware event). No network dependency; works in STANDALONE mode.
- **Phase 2+ (LAN_SYNCED / CLOUD_SYNCED)**: the provider may swap to a managed SaaS (LaunchDarkly, ConfigCat, Flagsmith) behind the same OpenFeature SDK API. The `FeatureFlag` table remains the source of truth for offline fallback; the managed provider is the primary evaluator when online.
- **Provider swap is config-driven**: `FEATURE_FLAG_PROVIDER=sqlite` (default) or `FEATURE_FLAG_PROVIDER=launchdarkly` (Phase 2+). The SDK API is unchanged; only the provider binding changes.

### Runtime capability registration

When an administrator enables a new domain (Phase F+), the platform registers a `domain.<name>.enabled` flag and cascades child flags for each module in the domain. Domain packages declare their flags in a `flags.config.ts` manifest:

```typescript
// packages/domains/pms/src/flags.config.ts
export const pmsFlags: FlagManifest = {
  domain: 'pms',
  flags: [
    { key: 'domain.pms.enabled', category: 'domain', defaultEnabled: true },
    { key: 'module.pms.reservations.enabled', category: 'module', defaultEnabled: true },
    { key: 'module.pms.housekeeping.enabled', category: 'module', defaultEnabled: true },
    { key: 'module.pms.restaurant.enabled', category: 'module', defaultEnabled: false },
    { key: 'module.pms.bar.enabled', category: 'module', defaultEnabled: false },
    { key: 'agent.inventoryAI.experimental', category: 'agent', defaultEnabled: false },
  ],
};
```

The platform auto-registers these flags on domain activation (when `domain.<name>.enabled` flips to `true`). Domain deactivation cascades child flags to `false`.

### Evaluation flow

```typescript
const client = openFeature.getClient('smartagentics');
const ctx: EvaluationContext = { tenantId, domainId, userId, agentId, sessionId };

// Domain activation check
const pmsEnabled = client.getBooleanValue('domain.pms.enabled', false, ctx);
if (!pmsEnabled) {
  throw new DomainNotEnabledError('pms');
}

// Module check
const restaurantEnabled = client.getBooleanValue('module.pms.restaurant.enabled', false, ctx);

// Agent experimental check
const inventoryAIExperimental = client.getBooleanValue(
  'agent.inventoryAI.experimental',
  false,
  ctx,
);

// Rollout percentage check (OpenFeature handles the bucketing)
const cloudSyncDisabled = client.getBooleanValue('feature.cloudSync.disabled', false, ctx);
```

### Amendment / reference register

| Existing ADR                                 | Relationship                                    | Change                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-001 (Reference Stack)**                | AMENDED (MINOR/MODERATE — FC-DN-21)             | Add "OpenFeature SDK + SmartAgentics SQLite provider" as the feature-flag technology. The Build-vs-Buy principle is honored: OpenFeature is the BUY (vendor-neutral spec); the SQLite provider is the SmartAgentics-owned integration.                                                                                                                                                                        |
| **ADR-010 (Dev Config Package)**             | REFERENCED (NONE)                               | `packages/dev-config` is for build-time tooling; feature flags are runtime. They are complementary — dev-config may set default flag values for local development.                                                                                                                                                                                                                                            |
| **ADR-078 (Per-Property Database Strategy)** | AMENDED (MINOR — FC-DN-15 feature-flag portion) | The `FeatureFlag` table gains `tenantId` and `domainId` columns (both optional for global flags). System-wide flags (e.g., `feature.cloudSync.disabled`) remain with null `tenantId` and null `domainId`. The original ADR-078 statement that `feature_flags` is a "system table exempt from `tenantId`" is amended: global flags are exempt; tenant-scoped and domain-scoped flags carry the respective IDs. |
| **ADR-097 (Domain Meta-Model)**              | CROSS-REFERENCE                                 | Domain activation is gated by `domain.<name>.enabled`; module activation by `module.<domain>.<name>.enabled`. The `Domain` and `Module` Prisma models carry `active` boolean columns that mirror the flag state (the flag is the source of truth; the column is a denormalized cache).                                                                                                                        |
| **ADR-098 (Hybrid Persistence)**             | CROSS-REFERENCE                                 | Layer-2 domain package activation is gated by the `domain.<name>.enabled` flag. A deployment that doesn't activate the School domain doesn't get the `Student` table because the domain package's Prisma migration is gated on the flag.                                                                                                                                                                      |
| **ADR-049 (Agent Runtime)**                  | CROSS-REFERENCE                                 | Agent capability flags (`agent.<name>.<state>`) gate agent activation. An experimental agent (`agent.inventoryAI.experimental = false`) is not instantiated by the Agent Runtime.                                                                                                                                                                                                                             |
| **ADR-095 (AI Configuration Policy)**        | CROSS-REFERENCE                                 | AI capability flags (`ai.<capability>.<state>`) gate AI features. An AI configuration (per ADR-095) may reference a feature flag to toggle a capability without config change.                                                                                                                                                                                                                                |

### Conflicts resolved

- **FC-DN-15** (ADR-078 MODERATE, feature-flag portion) — resolved by amending ADR-078: the `FeatureFlag` table gains `tenantId` and `domainId` columns (both optional for global flags). System-wide flags remain with null `tenantId` and null `domainId`.
- **FC-DN-21** (ADR-001 MODERATE, feature-flag portion) — resolved by adding OpenFeature SDK + SQLite provider to the reference stack.

## 5. Rationale

- **OpenFeature is the CNCF vendor-neutral specification** (openfeature.dev, SigNoz, ConfigCat, GitHub discussion #249) — the SDK API is standardized; providers are pluggable. SmartAgentics honors ADR-001 Build-vs-Buy by adopting the spec and owning only the SQLite provider integration.
- **SQLite-backed provider for Phase 1 offline-first** — no cloud dependency in STANDALONE mode; the `FeatureFlag` table is local SQLite. The OpenFeature SDK API is unchanged when Phase 2+ swaps to a managed provider.
- **Six capability tiers map to OpenFeature flag categories** (directive lines 985–1002) — structured flag keys (`domain.<name>.enabled`, `module.<domain>.<name>.enabled`, etc.) provide a clear taxonomy. The `category` column enables category-based queries (e.g., "list all experimental flags").
- **Per-tenant/per-domain targeting via `EvaluationContext`** — the OpenFeature SDK's `EvaluationContext` carries `{ tenantId, domainId, userId, agentId, sessionId }`, enabling per-tenant, per-domain, per-user, or per-agent flag evaluation. This is the OpenFeature-native way to do multi-dimensional targeting.
- **Runtime capability registration** — when a domain is activated, the platform auto-registers child flags from the domain package's `flags.config.ts` manifest. No code change; no redeployment. This is the directive's "Dynamic Capability Registration" (Topic 6).
- **Rollout percentages** — OpenFeature handles percentage rollouts via deterministic bucketing (hash of `EvaluationContext` → 0-99 bucket). `rolloutPct = 25` enables the flag for 25% of the targeted context. Environment variables / config files cannot do this.
- **Phase 2+ provider swap is config-driven** — `FEATURE_FLAG_PROVIDER=launchdarkly` swaps the provider behind the same SDK API. No code change in consumers; the `FeatureFlag` table remains the offline fallback.

## 6. Consequences

- New Prisma model: `FeatureFlag` (Layer-1 Platform Core, per ADR-098). The model extends ADR-078's `feature_flags` mention with `tenantId`, `domainId`, `category`, `rolloutPct`, `targetingJson`, `variantJson`, `schemaVersion`, `changedBy`, `changedAt`.
- New SDK module: `packages/sdk/src/featureflags/` with `FeatureFlagClient` (wrapping OpenFeature SDK), `SQLiteFeatureFlagProvider`, `FlagManifest` interfaces.
- New runtime dependency: `@openfeature/server-sdk` (OpenFeature SDK).
- New domain-package convention: `flags.config.ts` manifest declaring the domain's flags; auto-registered on domain activation.
- Prisma middleware: invalidates the in-memory flag cache on `FeatureFlag` mutation; emits a `featureflag.changed` CloudEvent (per ADR-101) for cross-service cache invalidation in Phase 2+.
- **Risk: in-memory flag cache staleness in Phase 2+ multi-instance deployments.** Mitigation: the `featureflag.changed` CloudEvent (per ADR-101) is broadcast to all instances; each instance invalidates its cache. In Phase 1 STANDALONE, there's only one instance — no staleness.
- **Risk: flag proliferation (> 1000 flags per tenant) degrades evaluation latency.** Mitigation: the in-memory cache is a `Map<key, Flag>`; lookups are O(1). The cache is per-process; flag count doesn't affect evaluation latency.
- **Risk: `targetingJson` complexity.** OpenFeature targeting rules can be complex (nested conditions, regex matchers). Mitigation: a targeting-rule linter in CI rejects invalid rules; the `SQLiteFeatureFlagProvider` enforces a 10ms evaluation timeout per flag.
- **Risk: ADR-078 amendment may surprise developers** who read ADR-078 as "`feature_flags` is a system table exempt from `tenantId`." Mitigation: the amendment is explicit — global flags are exempt; tenant-scoped and domain-scoped flags carry the respective IDs. The verifier rule flags `FeatureFlag` rows with `tenantId` set but `domainId` null for `category = "module"` (a module flag must specify its domain).
- **Risk: domain deactivation cascades child flags to `false`, but in-flight operations may have already read the flag as `true`.** Mitigation: flag reads are point-in-time; in-flight operations complete with the value they read. Domain deactivation is a graceful shutdown — new operations fail fast; in-flight operations complete.
- Dependencies: ADR-001 (Reference Stack — amended), ADR-010 (Dev Config Package — referenced), ADR-049 (Agent Runtime — cross-reference), ADR-078 (Per-Property Database — amended), ADR-095 (AI Configuration Policy — cross-reference), ADR-097 (Domain Meta-Model — cross-reference), ADR-098 (Hybrid Persistence — cross-reference), ADR-101 (CloudEvents Envelope — `featureflag.changed` event).
- Phase E effort: ~2 weeks for the SDK interfaces, `SQLiteFeatureFlagProvider`, `FeatureFlag` Prisma model, `flags.config.ts` convention, and the domain-activation cascade.

## 7. Review Conditions

- Review if Phase 1 telemetry shows flag evaluation latency exceeds 1ms (cache hit) — would investigate cache layout or move to a compiled-rule evaluator.
- Review if flag proliferation (> 1000 flags per tenant) proves unmanageable — would investigate a flag-namespace cleanup workflow or a flag-deprecation lifecycle.
- Review if `targetingJson` complexity proves unmanageable for administrators — would warrant a Phase F+ visual flag-builder ADR (per directive §19).
- Review if Phase 2+ multi-instance cache invalidation via `featureflag.changed` CloudEvents proves too latency-heavy — would move to a gossip protocol or a managed provider with native multi-instance sync.
- Review if a managed feature-flag SaaS (LaunchDarkly, ConfigCat, Flagsmith) becomes a Phase 2+ requirement — would warrant a Phase 2+ provider-swap ADR; the OpenFeature SDK API is unchanged.
- Review if the directive's six capability tiers prove insufficient (e.g., a new "compliance" tier emerges) — would extend the `category` enum additively.
- Review if a community standard for feature-flag categorization emerges (e.g., an OpenFeature extension for capability tiers) that should replace the SmartAgentics-owned `category` convention.
- Review if domain deactivation proves too disruptive (in-flight operations fail) — would investigate a graceful-drain workflow that waits for in-flight operations to complete before cascading child flags to `false`.
- Review if experimental flags (`category = "experimental"`) accumulate in production without cleanup — would enforce a 90-day TTL on experimental flags (auto-disable if not promoted to a stable category).
