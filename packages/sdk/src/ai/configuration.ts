/**
 * AI Configuration SDK interface (ADR-095 §4 + ADR-103 §4 — FC-F1-01 resolution).
 *
 * Per-tenant + per-domain AI policy configuration. ADR-095 defines the base
 * model with prompt injection, PII redaction, egress, approval, drift,
 * rate-limit, model, and audit sub-configs. ADR-103 amends it with `domainId`
 * (null = tenant-wide; non-null = domain-scoped override with inheritance).
 *
 * The `configJson` field holds the unified configuration validated against
 * AIConfigurationSchema (zod, strict mode) at load time per ADR-095 §4.
 * Sub-config fields are denormalized for queryability and Cedar policy
 * evaluation (ADR-099 §4 Layer 2 may reference AIConfiguration attributes).
 *
 * Sync metadata (updatedAt, revision, deletedAt, syncOrigin, idempotencyKey)
 * is mandatory per ADR-072/098 (all mutable tables carry sync metadata).
 *
 * This file contains TYPE DEFINITIONS ONLY — no implementation logic.
 * The zod validation schema (AIConfigurationSchema) will be implemented in
 * F14 (Security/Offline/Observability) where it is consumed at runtime.
 */

/** AI prompt-injection defense configuration (ADR-081). */
export interface PromptInjectionConfig {
  readonly inputRailEnabled: boolean;
  readonly outputRailEnabled: boolean;
  readonly allowlistedTerms: readonly string[];
}

/** PII redaction configuration (ADR-082). */
export interface PiiRedactionConfig {
  readonly locale: string;
  readonly redactionPatterns: readonly string[];
  readonly falsePositiveAllowlist: readonly string[];
}

/** Egress control configuration (ADR-094). */
export interface EgressConfig {
  readonly defaultPolicy: 'deny' | 'allow';
  readonly auditAllEgress: boolean;
}

/** Human approval configuration (ADR-087). */
export interface ApprovalConfig {
  readonly highTimeoutSec: number;
  readonly criticalTimeoutSec: number;
  readonly criticalWaitingPeriodSec: number;
  readonly dualControlRequiredRoles: readonly string[];
}

/** Drift evaluation configuration (ADR-090). */
export interface DriftConfig {
  readonly sampleRate: number;
  readonly driftThresholdPct: number;
  readonly anomalyZScoreThreshold: number;
  readonly nightlyEvalEnabled: boolean;
}

/** Rate-limit configuration per side-effect class (ADR-094). */
export interface RateLimitConfig {
  readonly perSideEffectClass: Readonly<
    Record<string, { readonly maxPerMinute: number; readonly maxPerHour: number }>
  >;
}

/** Model selection configuration (ADR-092/093). */
export interface ModelConfig {
  readonly defaultModelId: string;
  readonly allowedModelIds: readonly string[];
  readonly modelIsolationEnforced: boolean;
}

/** Audit configuration (ADR-084/085). */
export interface AuditConfig {
  readonly retentionYears: number;
  readonly merklePublicationIntervalMin: number;
  readonly coldStorageAfterDays: number;
}

/**
 * AIConfiguration — per-tenant + per-domain AI policy (ADR-095 §4 + ADR-103 §4).
 *
 * `domainId === null` denotes the tenant-wide default configuration.
 * `domainId === "pms"` denotes a domain-scoped override that inherits from
 * the tenant-wide default with override semantics (ADR-103 §4).
 */
export interface AIConfiguration {
  readonly id: string;
  readonly tenantId: string;
  readonly domainId: string | null; // null = tenant-wide; non-null = domain-scoped override (ADR-103)
  readonly version: number; // monotonic; incremented on each change
  readonly configJson: Readonly<Record<string, unknown>>; // validated against AIConfigurationSchema (zod)
  readonly promptInjectionConfig: PromptInjectionConfig;
  readonly piiRedactionConfig: PiiRedactionConfig;
  readonly egressConfig: EgressConfig;
  readonly approvalConfig: ApprovalConfig;
  readonly driftConfig: DriftConfig;
  readonly rateLimitConfig: RateLimitConfig;
  readonly modelConfig: ModelConfig;
  readonly auditConfig: AuditConfig;
  readonly changedBy: string; // admin userId
  readonly changedAt: string;
  readonly previousVersionId: string | null; // links to previous AIConfiguration row
  // Sync metadata per ADR-072/098 (mandatory on all mutable tables)
  readonly updatedAt: string;
  readonly revision: number;
  readonly deletedAt: string | null;
  readonly syncOrigin: string | null;
  readonly idempotencyKey: string | null;
}

/** Options for creating a new AIConfiguration version. */
export interface AIConfigurationCreateInput {
  readonly tenantId: string;
  readonly domainId: string | null;
  readonly configJson: Readonly<Record<string, unknown>>;
  readonly promptInjectionConfig: PromptInjectionConfig;
  readonly piiRedactionConfig: PiiRedactionConfig;
  readonly egressConfig: EgressConfig;
  readonly approvalConfig: ApprovalConfig;
  readonly driftConfig: DriftConfig;
  readonly rateLimitConfig: RateLimitConfig;
  readonly modelConfig: ModelConfig;
  readonly auditConfig: AuditConfig;
  readonly changedBy: string;
  readonly previousVersionId?: string | null;
  readonly idempotencyKey?: string | null;
}

/**
 * AIConfigurationService — CRUD + version-history boundary for AIConfiguration.
 * Implementations are responsible for: (1) zod validation of configJson +
 * sub-configs at load time, (2) version increment on each change,
 * (3) previousVersionId linkage, (4) audit event emission (AIAuditEvent
 * eventType=AI_CONFIG_CHANGED per ADR-095), (5) tenant + domain isolation.
 */
export interface AIConfigurationService {
  create(input: AIConfigurationCreateInput): Promise<AIConfiguration>;
  getActive(tenantId: string, domainId: string | null): Promise<AIConfiguration | null>;
  getVersion(
    tenantId: string,
    domainId: string | null,
    version: number,
  ): Promise<AIConfiguration | null>;
  listVersions(tenantId: string, domainId: string | null): Promise<readonly AIConfiguration[]>;
  listAll(tenantId: string): Promise<readonly AIConfiguration[]>;
}
