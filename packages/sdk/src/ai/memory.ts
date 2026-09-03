// ADR-038 AI Memory Architecture — CoALA-aligned 7-category taxonomy (ADR-039).
// tenantId is NOT NULL on every memory record (ADR-041); four-dimensional scope model enforced
// via Prisma middleware. Memory lives in the SAME SQLite file as PMS data — no second DB process.

/** The 7 memory categories mandated by B4 #13 and aligned to CoALA (Sumers et al., arXiv:2309.02427). */
export type MemoryCategory =
  'WORKING' | 'CONVERSATIONAL' | 'EPISODIC' | 'SEMANTIC' | 'PROCEDURAL' | 'USER' | 'AGENT';

/** Four-dimensional scope model per ADR-041. */
export type MemoryScope =
  | 'SESSION'
  | 'USER_PRIVATE'
  | 'AGENT_PRIVATE'
  | 'TEAM_SHARED'
  | 'PROPERTY_SHARED'
  | 'TENANT_SHARED';

/** Memory record sensitivity classification (drives PII redaction + RBAC at the write gate). */
export type MemorySensitivity = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

/** Provenance sourceKind per ADR-047 — every record carries provenance for audit + GDPR cascading delete. */
export type MemoryProvenanceKind =
  'USER_STATED' | 'INFERRED' | 'ADMIN_DECLARED' | 'EXTRACTED' | 'SYSTEM';

/** Retention policy tag (tax-retention legal-basis exempts records from GDPR Art 17 erasure). */
export type MemoryRetentionPolicy =
  'SESSION_TTL' | 'EPISODIC_180D' | 'SUMMARY_365D' | 'NO_TTL' | 'TAX_7Y' | 'ACCESS_LOG_7Y';

/** Permissions envelope for a memory operation (RBAC per ADR-044 §3). */
export interface MemoryPermissions {
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly userId?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly teamId?: string;
  readonly aclRoles: readonly string[];
  readonly scope: MemoryScope;
}

/** Provenance payload carried on every MemoryRecord (ADR-047). */
export interface MemoryProvenance {
  readonly sourceKind: MemoryProvenanceKind;
  readonly sourceIdentity: string;
  readonly sourceEventIds: readonly string[];
  readonly extractorModelVersion?: string;
}

/** Unified envelope for working/conversational/semantic/user/agent memories (NOT episodic events). */
export interface MemoryRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly userId?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly teamId?: string;
  readonly type: MemoryCategory;
  readonly scope: MemoryScope;
  readonly department?: string;
  readonly content: string;
  readonly contentHash: string;
  readonly embedding: readonly number[] | null;
  readonly confidence: number;
  readonly importance: number;
  readonly writtenAt: string;
  readonly lastConfirmedAt: string | null;
  readonly expiresAt: string | null;
  readonly retentionPolicy: MemoryRetentionPolicy;
  readonly halfLifeDays: number;
  readonly timesRetrieved: number;
  readonly timesRetrievedAndConfirmed: number;
  readonly sensitivity: MemorySensitivity;
  readonly supersedes?: string;
  readonly supersededBy?: string;
  readonly provenance: MemoryProvenance;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
  readonly deletedAt?: string;
}

/** Append-only raw episodic event log (MemoryEvent Prisma model per ADR-040). */
export interface MemoryEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly agentId?: string;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly eventType: string;
  readonly eventTimestamp: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly provenance: MemoryProvenance;
  readonly retentionExpiresAt?: string;
  readonly retentionPolicy: MemoryRetentionPolicy;
  readonly deletedAt?: string;
}

/** Query against the memory store. `permissions` is the ONLY source of scoping. */
export interface MemoryQuery {
  readonly tenantId: string;
  readonly category?: MemoryCategory;
  readonly scope?: MemoryScope;
  readonly semantic?: { readonly queryEmbedding: readonly number[]; readonly topK: number };
  readonly keyword?: string;
  readonly filter?: Readonly<Record<string, string | number | boolean | null>>;
  readonly permissions: MemoryPermissions;
  readonly limit?: number;
}

/** GDPR Art 15/20 export result. */
export interface MemoryExport {
  readonly userId: string;
  readonly records: readonly MemoryRecord[];
  readonly events: readonly MemoryEvent[];
  readonly exportedAt: string;
}

/**
 * MemoryStore top-level interface per ADR-038 §4.1. The 7 sub-interfaces below
 * each carry their own lifecycle, write path, retention policy, and retrieval mode.
 */
export interface MemoryStore {
  read(query: MemoryQuery): Promise<readonly MemoryRecord[]>;
  write(
    record: Omit<
      MemoryRecord,
      'id' | 'writtenAt' | 'timesRetrieved' | 'timesRetrievedAndConfirmed'
    >,
    permissions: MemoryPermissions,
  ): Promise<MemoryRecord>;
  update(
    recordId: string,
    newContent: string,
    permissions: MemoryPermissions,
  ): Promise<MemoryRecord>;
  confirm(recordId: string, permissions: MemoryPermissions): Promise<MemoryRecord>;
  forgetUser(
    userId: string,
    permissions: MemoryPermissions,
  ): Promise<{ readonly deletedRecords: number; readonly gracePeriodEndsAt: string }>;
  exportUserMemory(userId: string, permissions: MemoryPermissions): Promise<MemoryExport>;
  logEvent(event: Omit<MemoryEvent, 'id'>, permissions: MemoryPermissions): Promise<MemoryEvent>;
}

/** Working memory — session-scoped scratchpad (Letta 4-block pattern, ADR-039 §2). */
export interface WorkingMemory extends MemoryStore {
  setPersona(
    sessionId: string,
    persona: string,
    permissions: MemoryPermissions,
  ): Promise<MemoryRecord>;
  setTask(sessionId: string, task: string, permissions: MemoryPermissions): Promise<MemoryRecord>;
}

/** Conversational memory — specialized episodic/working subtype for dialogue turns. */
export interface ConversationalMemory extends MemoryStore {
  appendTurn(
    sessionId: string,
    turn: { readonly role: string; readonly content: string },
    permissions: MemoryPermissions,
  ): Promise<MemoryRecord>;
}

/** Episodic memory — 180-day TTL, append-only event log, Ebbinghaus decay on retrieval score. */
export interface EpisodicMemory extends MemoryStore {
  recall(
    sessionId: string,
    permissions: MemoryPermissions,
    limit?: number,
  ): Promise<readonly MemoryRecord[]>;
}

/** Semantic memory — extracted facts, no TTL (governed by staleness/supersession). */
export interface SemanticMemory extends MemoryStore {
  promoteFromEpisodic(recordId: string, permissions: MemoryPermissions): Promise<MemoryRecord>;
}

/** Procedural memory — version-controlled files; promotion NEVER automatic (ADR-045). */
export interface ProceduralMemory extends MemoryStore {
  proposeProcedure(
    candidate: {
      readonly tenantId: string;
      readonly content: string;
      readonly validationGate: 'REPLAY' | 'REPETITION' | 'HUMAN_REVIEW';
    },
    permissions: MemoryPermissions,
  ): Promise<MemoryRecord>;
  promoteProcedure(
    recordId: string,
    approverRole: string,
    permissions: MemoryPermissions,
  ): Promise<MemoryRecord>;
}

/** User memory — preferences/facts about a user; never TTL'd (governed by supersession). */
export interface UserMemory extends MemoryStore {
  recordPreference(
    userId: string,
    key: string,
    value: string,
    permissions: MemoryPermissions,
  ): Promise<MemoryRecord>;
}

/** Agent memory — agent-authored observations; attributed to a specific agentId (ADR-055 identity). */
export interface AgentMemory extends MemoryStore {
  observe(
    agentId: string,
    observation: string,
    permissions: MemoryPermissions,
  ): Promise<MemoryRecord>;
}
