# ADR-095: AI Configuration & Policy — AIConfiguration Extending BaseConfigSchema, Per-Tenant AI Policies

**ADR-ID:** ADR-095
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #32 ("AI configuration") flags the need for AI configuration management and policy enforcement. Stream 8 ADRs 080–094 establish many security controls with configurable parameters: rate limits per `(agentId, toolId, tenantId)` (ADR-094); approval timeouts per `AgentContract` (ADR-087); drift thresholds per tenant (ADR-090); egress allowlist per tenant (ADR-094); PII redaction locale per tenant (ADR-082); `decisionEffectClass` per `AgentContract` (ADR-082). None of these specifies a **unified AI configuration contract** that holds all per-tenant AI policy settings, validates them, and enforces them at runtime.

The Stream 8 research established the principle that per-tenant configuration is mandatory for a multi-tenant PMS: different hotels (tenants) have different operational policies (e.g., a boutique hotel may set CRITICAL approval timeout to 12h instead of 24h; a resort may allow external egress to a weather API; a city business hotel may disable `sendEmail` entirely). A unified `AIConfiguration` contract extending `BaseConfigSchema` (per ADR-010 dev-config-package) ensures: (a) every per-tenant AI policy is in one place; (b) configuration is validated at load time (zod schema); (c) changes are audited (`AIAuditEvent`); (d) the verifier rules (VERIFY-AI-SECURITY-01 through 06) can check configuration compliance.

The architectural insight is that `AIConfiguration` is **per-tenant**, not per-deployment. Phase 1 is single-tenant-per-deployment (per Stream 7 §0.2), so Phase 1 has one `AIConfiguration` row per deployment. Phase 2+ multi-tenant (hub-and-spoke) has one row per tenant. The contract is identical; the cardinality changes.

## 2. Problem

Should SmartAgentics adopt per-deployment configuration only, per-tenant configuration, per-agent configuration, or a unified `AIConfiguration` contract extending `BaseConfigSchema`? Should configuration be validated at load time or runtime? Should changes be audited?

## 3. Options

### Option A: Per-deployment configuration only (no per-tenant)

Rejected. Phase 2+ multi-tenant hub-and-spoke requires per-tenant policies (different hotels have different operational policies). Per-deployment would force all tenants to share the strictest policy, which is overly restrictive for low-risk tenants and insufficient for high-risk tenants.

### Option B: Per-agent configuration (no per-tenant)

Rejected. Per-agent configuration ignores the tenant dimension — a tenant's operational policy (e.g., CRITICAL approval timeout) applies to all agents in that tenant, not per-agent. Per-agent overrides are a Phase 3+ extension.

### Option C: Scattered configuration (each ADR's parameters stored separately)

Rejected. Scatters policy across `AgentContract`, `Tool`, `EgressAllowlist`, `DriftEvaluationResult` — no single source of truth for "what is this tenant's AI policy?" Auditors cannot answer the question; admins cannot change policy in one place.

### Option D: Unified `AIConfiguration` contract extending `BaseConfigSchema`, per-tenant, validated at load time, changes audited

Adopted. One contract holds all per-tenant AI policy settings; zod validation at load time; changes audited via `AIAuditEvent` `eventType=AI_CONFIG_CHANGED`.

## 4. Decision

Adopt **Option D** — the unified `AIConfiguration` contract.

### `AIConfiguration` Prisma model (new, per-tenant)

```prisma
model AIConfiguration {
  id                    String   @id @default(cuid())
  tenantId              String   @unique
  version               Int      @default(1)  // monotonic; incremented on each change
  configJson            Json                  // validated against AIConfigurationSchema (zod)
  promptInjectionConfig Json                  // { inputRailEnabled, outputRailEnabled, allowlistedTerms[] }
  piiRedactionConfig    Json                  // { locale, redactionPatterns[], falsePositiveAllowlist[] }
  egressConfig          Json                  // { defaultPolicy: "deny" | "allow", auditAllEgress: boolean }
  approvalConfig        Json                  // { highTimeoutSec, criticalTimeoutSec, criticalWaitingPeriodSec, dualControlRequiredRoles[] }
  driftConfig           Json                  // { sampleRate, driftThresholdPct, anomalyZScoreThreshold, nightlyEvalEnabled }
  rateLimitConfig       Json                  // per-sideEffectClass overrides
  modelConfig           Json                  // { defaultModelId, allowedModelIds[], modelIsolationEnforced }
  auditConfig           Json                  // { retentionYears, merklePublicationIntervalMin, coldStorageAfterDays }
  changedBy             String                // admin userId
  changedAt             DateTime @default(now())
  previousVersionId     String?               // links to previous AIConfiguration row

  @@index([tenantId, version])
}
```

### `AIConfigurationSchema` (zod, in `packages/sdk/src/ai/`)

Validates the `configJson` and all sub-configs. `strict: true` — unknown keys rejected. Example:

```typescript
export const AIConfigurationSchema = z
  .object({
    promptInjectionConfig: z.object({
      inputRailEnabled: z.boolean().default(true),
      outputRailEnabled: z.boolean().default(true),
      allowlistedTerms: z.array(z.string()).default([]),
    }),
    piiRedactionConfig: z.object({
      locale: z.string().default('en-US'),
      redactionPatterns: z.array(
        z.enum(['passport', 'credit_card', 'email', 'phone', 'iban', 'national_id']),
      ),
      falsePositiveAllowlist: z.array(z.string()).default([]),
    }),
    egressConfig: z.object({
      defaultPolicy: z.enum(['deny', 'allow']).default('deny'),
      auditAllEgress: z.boolean().default(true),
    }),
    approvalConfig: z.object({
      highTimeoutSec: z.number().int().min(60).default(300),
      criticalTimeoutSec: z.number().int().min(3600).default(86400),
      criticalWaitingPeriodSec: z.number().int().min(0).default(86400),
      dualControlRequiredRoles: z.array(z.string()).default(['manager_on_duty', 'general_manager']),
    }),
    driftConfig: z.object({
      sampleRate: z.number().min(0).max(1).default(0.05),
      driftThresholdPct: z.number().min(0).max(100).default(10),
      anomalyZScoreThreshold: z.number().min(1).default(3),
      nightlyEvalEnabled: z.boolean().default(false), // Phase 2 impl
    }),
    rateLimitConfig: z.object({
      pureRead: z.number().int().default(100),
      writeInSession: z.number().int().default(30),
      writePersistent: z.number().int().default(10),
      writeIrreversible: z.number().int().default(2),
      externalEgress: z.number().int().default(5),
    }),
    modelConfig: z.object({
      defaultModelId: z.string(),
      allowedModelIds: z.array(z.string()),
      modelIsolationEnforced: z.boolean().default(true),
    }),
    auditConfig: z.object({
      retentionYears: z.number().int().min(6).default(7),
      merklePublicationIntervalMin: z.number().int().min(1).default(60),
      coldStorageAfterDays: z.number().int().default(90),
    }),
  })
  .strict();
```

### `AIConfiguration` SDK interface (new in `packages/sdk/src/ai/`)

```typescript
export interface AIConfiguration {
  get(tenantId: string): Promise<AIConfigurationRow>;
  update(
    tenantId: string,
    patch: Partial<AIConfigurationRow>,
    adminUserId: string,
  ): Promise<AIConfigurationRow>;
  validate(config: unknown): AIConfigurationRow; // throws on invalid
  diff(from: AIConfigurationRow, to: AIConfigurationRow): AIConfigurationDiff;
}
```

### Policy enforcement at runtime

Every Stream 8 ADR's runtime check reads from `AIConfiguration`:

- ADR-081 (Prompt injection): `promptInjectionConfig.inputRailEnabled`, `outputRailEnabled`.
- ADR-082 (Data exfiltration): `piiRedactionConfig.locale`, `redactionPatterns`.
- ADR-084 (Merkle audit): `auditConfig.merklePublicationIntervalMin`.
- ADR-087 (Human approval): `approvalConfig.highTimeoutSec`, `criticalTimeoutSec`, `criticalWaitingPeriodSec`.
- ADR-090 (Drift): `driftConfig.sampleRate`, `driftThresholdPct`, `anomalyZScoreThreshold`.
- ADR-094 (Egress control): `egressConfig.defaultPolicy`, `rateLimitConfig.*`.

### Change audit

Every `AIConfiguration.update()` writes an `AIAuditEvent` `eventType=AI_CONFIG_CHANGED` with the diff (before/after JSON), the admin userId, and the timestamp. The previous version is retained (`previousVersionId`) for rollback.

### Phase 1 scope

- `AIConfiguration` Prisma model.
- `AIConfigurationSchema` zod validation.
- Runtime reads from `AIConfiguration` (all Stream 8 ADRs).
- Admin UI for editing `AIConfiguration` deferred to Phase 2.
- Phase 1 ships with a default `AIConfiguration` row per deployment (single-tenant-per-deployment per Stream 7 §0.2).

## 5. Rationale

- **B4 #32 closure**: AI configuration management and policy enforcement.
- **Unified contract**: one source of truth for "what is this tenant's AI policy?" — auditors, admins, and the verifier rules all read from `AIConfiguration`.
- **Per-tenant** matches Phase 2+ multi-tenant hub-and-spoke; Phase 1 single-tenant is a degenerate case (one row per deployment).
- **zod validation at load time** catches malformed configuration before it reaches runtime — a typo in `criticalTimeoutSec` is rejected, not silently applied.
- **Change audit** (`AIAuditEvent` `AI_CONFIG_CHANGED`) provides forensic reconstruction of policy changes — a regulator can ask "when did this tenant lower its CRITICAL approval timeout?" and get an answer.
- **Versioning** (`version` monotonic, `previousVersionId` link) supports rollback — a bad policy change can be reverted.
- **Extending `BaseConfigSchema`** (ADR-010) aligns with the existing dev-config-package pattern; `AIConfiguration` is the AI-specific extension.
- **Verifier rule compliance**: VERIFY-AI-SECURITY-02 can check that every `AgentContract` has a `tenantId` matching an `AIConfiguration` row.
- **Offline-first respected**: `AIConfiguration` is a local SQLite table; no cloud config service.

## 6. Consequences

- New `AIConfiguration` Prisma model (per-tenant, versioned).
- New `AIConfiguration` SDK interface in `packages/sdk/src/ai/`.
- New `AIAuditEvent` event type: `AI_CONFIG_CHANGED`.
- All Stream 8 ADR runtime checks read from `AIConfiguration` (additive — no existing interface broken).
- **Risk: a bad `AIConfiguration` change disables a critical control** (e.g., `promptInjectionConfig.inputRailEnabled = false`). Mitigation: zod schema enforces `inputRailEnabled` is boolean but cannot enforce "must be true"; the admin UI (Phase 2) warns on disabling critical controls; the `AI_CONFIG_CHANGED` audit event enables post-hoc detection.
- **Risk: `AIConfiguration` row is missing for a tenant** (onboarding bug). Mitigation: tenant onboarding script creates a default `AIConfiguration` row; verifier rule flags any tenant without a row.
- **Risk: configuration drift across deployments** (tenant A's config on hub 1 differs from hub 2). Mitigation: Stream 7 SyncEngine syncs `AIConfiguration` across hub-and-spoke (Phase 2+).
- **Risk: `configJson` grows unboundedly as new policy fields are added.** Mitigation: zod schema enforces structure; unknown keys rejected (`strict: true`); new fields require a schema version bump.
- **Risk: admin UI (Phase 2) exposes dangerous controls to non-senior admins.** Mitigation: admin UI requires `general_manager` role for `AIConfiguration.update()`; the role check is enforced by Stream 6 Cedar L1/L2/L3.
- Dependencies: ADR-010 (`BaseConfigSchema`); Stream 6 Cedar (role check on `update()`); Stream 7 SyncEngine (Phase 2+ cross-hub sync); all Stream 8 ADRs (runtime reads).
- Phase 1 effort: architecture contract only (no full impl); the contract is consumed by all other Stream 8 ADRs. Phase 1 ships with a default row per deployment.

## 7. Review Conditions

- Review if a bad `AIConfiguration` change disables a critical control in production — would require a Phase 2 admin UI with "dangerous control" warnings and senior-manager approval for disabling.
- Review if Phase 2+ multi-tenant hub-and-spoke requires cross-hub `AIConfiguration` sync — would activate Stream 7 SyncEngine sync.
- Review if a community AI-configuration standard emerges (e.g., a standardized per-tenant AI policy schema) that should replace the SmartAgentics-owned contract.
- Review if Phase 3+ requires per-agent configuration overrides (beyond per-tenant) — would extend `AIConfiguration` with a per-agent override layer.
- Review if a regulator demands proof of policy enforcement — the `AI_CONFIG_CHANGED` audit events + the runtime reads from `AIConfiguration` provide the audit evidence.
- Review if `configJson` grows too large for hot querying — would offload historical versions to cold storage.
- Review if a tenant demands self-service configuration UI (Phase 2+) — would require a senior-admin approval workflow for dangerous changes.
