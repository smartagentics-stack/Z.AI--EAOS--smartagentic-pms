/**
 * InMemoryMemoryStore — single-session, in-process implementation of the
 * `MemoryStore` contract (ADR-038 §4.1, CoALA 7-category taxonomy ADR-039).
 *
 * Records live in a tenant-scoped `Map` keyed by `(tenantId, recordId)`; raw
 * episodic events live in a separate `Map` keyed by `(tenantId, eventId)`.
 * Tenant isolation is enforced on EVERY operation: the `permissions.tenantId`
 * on each call MUST match the stored record's `tenantId`, and queries are
 * scoped by the four-dimensional scope model (ADR-041) — `permissions` is the
 * ONLY source of scoping.
 *
 * The seven categories (WORKING, CONVERSATIONAL, EPISODIC, SEMANTIC,
 * PROCEDURAL, USER, AGENT) are validated on write. Semantic recall uses
 * cosine similarity over stored embeddings (when present) — making this a
 * genuinely functional store for single-session / test use. The
 * SQLite-backed `SqliteMemoryStore` (later step) is the durable multi-session
 * replacement behind the SAME interface.
 *
 * GDPR compliance: `forgetUser` soft-deletes (sets `deletedAt`) all of a
 * user's records except those under legal-basis retention (`TAX_7Y`,
 * `ACCESS_LOG_7Y`, which are exempt from Art 17 erasure) and returns the
 * grace-period end at which the soft-deleted rows are eligible for hard
 * purge. `exportUserMemory` implements the Art 15 data-portability export.
 *
 * @see MemoryStore — implemented contract.
 */

import type {
  MemoryStore,
  MemoryRecord,
  MemoryQuery,
  MemoryPermissions,
  MemoryExport,
  MemoryEvent,
  MemoryCategory,
  MemoryRetentionPolicy,
} from '@smartagentics/sdk';

/** Retention policies exempt from GDPR Art 17 erasure (legal-basis retention). */
const LEGAL_HOLD_RETENTION: ReadonlySet<MemoryRetentionPolicy> = new Set([
  'TAX_7Y',
  'ACCESS_LOG_7Y',
]);

/** Default grace period (days) before soft-deleted records are hard-purged. */
const DEFAULT_GRACE_PERIOD_DAYS = 30;

/** The 7 CoALA memory categories mandated by ADR-039. */
const VALID_CATEGORIES: ReadonlySet<MemoryCategory> = new Set<MemoryCategory>([
  'WORKING',
  'CONVERSATIONAL',
  'EPISODIC',
  'SEMANTIC',
  'PROCEDURAL',
  'USER',
  'AGENT',
]);

/** Composite key for the records index. */
function recordKey(tenantId: string, id: string): string {
  return `${tenantId}::${id}`;
}

/** Composite key for the events index. */
function eventKey(tenantId: string, id: string): string {
  return `${tenantId}::${id}`;
}

/** Computes the SHA-256 hex digest of `text` using Web Crypto. */
async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Cosine similarity between two equal-length-ish vectors. Trailing dimensions
 * of the longer vector are ignored (defensive against embedding-model
 * mismatches). Returns 0 for zero-norm vectors.
 */
function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Enforces the four-dimensional scope model (ADR-041). A record is visible
 * only if it matches the caller's scope dimension:
 *  - SESSION → same `sessionId`
 *  - USER_PRIVATE → same `userId`
 *  - AGENT_PRIVATE → same `agentId`
 *  - TEAM_SHARED → same `teamId`
 *  - PROPERTY_SHARED → same `propertyId`
 *  - TENANT_SHARED → any record in the tenant
 */
function matchesScope(record: MemoryRecord, perms: MemoryPermissions): boolean {
  switch (perms.scope) {
    case 'SESSION':
      return !!perms.sessionId && record.sessionId === perms.sessionId;
    case 'USER_PRIVATE':
      return !!perms.userId && record.userId === perms.userId;
    case 'AGENT_PRIVATE':
      return !!perms.agentId && record.agentId === perms.agentId;
    case 'TEAM_SHARED':
      return !!perms.teamId && record.teamId === perms.teamId;
    case 'PROPERTY_SHARED':
      return !!perms.propertyId && record.propertyId === perms.propertyId;
    case 'TENANT_SHARED':
      return true;
    default:
      return false;
  }
}

/**
 * In-memory `MemoryStore`. Stores records in a `Map` keyed by
 * `(tenantId, recordId)` and episodic events in a `Map` keyed by
 * `(tenantId, eventId)`. Every method enforces tenant isolation via the
 * `permissions` argument.
 */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly records: Map<string, MemoryRecord> = new Map();
  private readonly events: Map<string, MemoryEvent> = new Map();
  private readonly gracePeriodDays: number;

  /**
   * @param gracePeriodDays - Grace period (days) returned by `forgetUser`
   *   before soft-deleted records are eligible for hard purge. Default 30.
   */
  public constructor(gracePeriodDays: number = DEFAULT_GRACE_PERIOD_DAYS) {
    this.gracePeriodDays = gracePeriodDays;
  }

  /**
   * Reads memory records matching `query`. Scoping is driven ENTIRELY by
   * `query.permissions` (tenantId + four-dimensional scope). Soft-deleted
   * records are excluded. When `query.semantic` is present, results are
   * ranked by cosine similarity to `queryEmbedding` and truncated to `topK`;
   * otherwise keyword substring + metadata filters apply, truncated to
   * `query.limit`.
   *
   * @throws {Error} if `permissions.tenantId` is missing, or if
   *   `query.tenantId` does not match `permissions.tenantId`.
   */
  public async read(query: MemoryQuery): Promise<readonly MemoryRecord[]> {
    if (!query.permissions.tenantId) {
      throw new Error('InMemoryMemoryStore.read: permissions.tenantId is required');
    }
    if (query.tenantId !== query.permissions.tenantId) {
      throw new Error('InMemoryMemoryStore.read: query.tenantId must match permissions.tenantId');
    }
    const tenantId = query.tenantId;
    const keyword = query.keyword?.toLowerCase();
    const candidates: MemoryRecord[] = [];
    for (const rec of this.records.values()) {
      if (rec.tenantId !== tenantId) continue;
      if (rec.deletedAt) continue;
      if (query.category && rec.type !== query.category) continue;
      if (query.scope && rec.scope !== query.scope) continue;
      if (!matchesScope(rec, query.permissions)) continue;
      if (keyword && !rec.content.toLowerCase().includes(keyword)) continue;
      if (query.filter) {
        let ok = true;
        for (const [k, v] of Object.entries(query.filter)) {
          if (rec.metadata[k] !== v) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
      }
      candidates.push(rec);
    }

    if (query.semantic) {
      const { queryEmbedding, topK } = query.semantic;
      return candidates
        .map((r) => ({
          r,
          s:
            r.embedding && r.embedding.length > 0
              ? cosineSimilarity(queryEmbedding, r.embedding)
              : -Infinity,
        }))
        .filter((x) => x.s > -Infinity)
        .sort((a, b) => b.s - a.s)
        .slice(0, topK)
        .map((x) => x.r);
    }

    const limit = query.limit ?? candidates.length;
    return candidates.slice(0, Math.max(0, limit));
  }

  /**
   * Stores a new memory record. Generates `id`, `writtenAt`, and zeroed
   * retrieval counters. The caller supplies `contentHash`, `embedding`,
   * `confidence`, `importance`, `retentionPolicy`, etc. on the input record.
   *
   * @throws {Error} if `permissions.tenantId` is missing, if the record's
   *   `tenantId` does not match `permissions.tenantId`, or if `record.type`
   *   is not one of the 7 valid categories.
   */
  public async write(
    record: Omit<
      MemoryRecord,
      'id' | 'writtenAt' | 'timesRetrieved' | 'timesRetrievedAndConfirmed'
    >,
    permissions: MemoryPermissions,
  ): Promise<MemoryRecord> {
    if (!permissions.tenantId) {
      throw new Error('InMemoryMemoryStore.write: permissions.tenantId is required');
    }
    if (record.tenantId !== permissions.tenantId) {
      throw new Error('InMemoryMemoryStore.write: record.tenantId must match permissions.tenantId');
    }
    if (!VALID_CATEGORIES.has(record.type)) {
      throw new Error(`InMemoryMemoryStore.write: invalid memory category "${record.type}"`);
    }
    const now = new Date().toISOString();
    const stored: MemoryRecord = {
      ...record,
      id: crypto.randomUUID(),
      writtenAt: now,
      timesRetrieved: 0,
      timesRetrievedAndConfirmed: 0,
    };
    this.records.set(recordKey(record.tenantId, stored.id), stored);
    return stored;
  }

  /**
   * Replaces a record's content with `newContent`, recomputing `contentHash`
   * via SHA-256. All other fields (embedding, importance, provenance, …) are
   * preserved.
   *
   * @throws {Error} if no record with `recordId` exists in
   *   `permissions.tenantId`.
   */
  public async update(
    recordId: string,
    newContent: string,
    permissions: MemoryPermissions,
  ): Promise<MemoryRecord> {
    if (!permissions.tenantId) {
      throw new Error('InMemoryMemoryStore.update: permissions.tenantId is required');
    }
    const key = recordKey(permissions.tenantId, recordId);
    const existing = this.records.get(key);
    if (!existing) {
      throw new Error(
        `InMemoryMemoryStore.update: record ${recordId} not found in tenant ${permissions.tenantId}`,
      );
    }
    const contentHash = await sha256Hex(newContent);
    const updated: MemoryRecord = { ...existing, content: newContent, contentHash };
    this.records.set(key, updated);
    return updated;
  }

  /**
   * Marks a record as confirmed (still accurate). Sets `lastConfirmedAt` to
   * now and increments `timesRetrievedAndConfirmed`.
   *
   * @throws {Error} if no record with `recordId` exists in
   *   `permissions.tenantId`.
   */
  public async confirm(recordId: string, permissions: MemoryPermissions): Promise<MemoryRecord> {
    if (!permissions.tenantId) {
      throw new Error('InMemoryMemoryStore.confirm: permissions.tenantId is required');
    }
    const key = recordKey(permissions.tenantId, recordId);
    const existing = this.records.get(key);
    if (!existing) {
      throw new Error(
        `InMemoryMemoryStore.confirm: record ${recordId} not found in tenant ${permissions.tenantId}`,
      );
    }
    const updated: MemoryRecord = {
      ...existing,
      lastConfirmedAt: new Date().toISOString(),
      timesRetrievedAndConfirmed: existing.timesRetrievedAndConfirmed + 1,
    };
    this.records.set(key, updated);
    return updated;
  }

  /**
   * GDPR Article 17 erasure for a user. Soft-deletes (sets `deletedAt`) every
   * non-deleted record belonging to `userId` within `permissions.tenantId`,
   * EXCEPT records under legal-basis retention (`TAX_7Y`, `ACCESS_LOG_7Y`),
   * which are exempt from erasure. Returns the count of soft-deleted records
   * and the grace-period end at which they become eligible for hard purge.
   *
   * @returns `{ deletedRecords, gracePeriodEndsAt }` — the count of records
   *   soft-deleted in this call, and the ISO timestamp at which the grace
   *   period ends.
   * @throws {Error} if `permissions.tenantId` or `userId` is missing.
   */
  public async forgetUser(
    userId: string,
    permissions: MemoryPermissions,
  ): Promise<{ readonly deletedRecords: number; readonly gracePeriodEndsAt: string }> {
    if (!permissions.tenantId) {
      throw new Error('InMemoryMemoryStore.forgetUser: permissions.tenantId is required');
    }
    if (!userId) {
      throw new Error('InMemoryMemoryStore.forgetUser: userId is required');
    }
    const now = new Date();
    let count = 0;
    for (const [key, rec] of this.records) {
      if (rec.tenantId !== permissions.tenantId) continue;
      if (rec.userId !== userId) continue;
      if (rec.deletedAt) continue;
      if (LEGAL_HOLD_RETENTION.has(rec.retentionPolicy)) continue;
      const updated: MemoryRecord = { ...rec, deletedAt: now.toISOString() };
      this.records.set(key, updated);
      count += 1;
    }
    const graceEnd = new Date(now.getTime() + this.gracePeriodDays * 24 * 60 * 60 * 1000);
    return { deletedRecords: count, gracePeriodEndsAt: graceEnd.toISOString() };
  }

  /**
   * GDPR Article 15 data-portability export. Returns every record and
   * episodic event belonging to `userId` within `permissions.tenantId`
   * (including soft-deleted records not yet purged).
   *
   * @throws {Error} if `permissions.tenantId` or `userId` is missing.
   */
  public async exportUserMemory(
    userId: string,
    permissions: MemoryPermissions,
  ): Promise<MemoryExport> {
    if (!permissions.tenantId) {
      throw new Error('InMemoryMemoryStore.exportUserMemory: permissions.tenantId is required');
    }
    if (!userId) {
      throw new Error('InMemoryMemoryStore.exportUserMemory: userId is required');
    }
    const records: MemoryRecord[] = [];
    for (const rec of this.records.values()) {
      if (rec.tenantId !== permissions.tenantId) continue;
      if (rec.userId !== userId) continue;
      records.push(rec);
    }
    const events: MemoryEvent[] = [];
    for (const ev of this.events.values()) {
      if (ev.tenantId !== permissions.tenantId) continue;
      if (ev.userId !== userId) continue;
      events.push(ev);
    }
    return {
      userId,
      records,
      events,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Appends a raw episodic event to the append-only event log (ADR-040).
   * Generates `id`; all other fields (including `tenantId`, `eventType`,
   * `eventTimestamp`, `payload`, `provenance`, `retentionPolicy`) come from
   * the input.
   *
   * @throws {Error} if `permissions.tenantId` is missing or if
   *   `event.tenantId` does not match `permissions.tenantId`.
   */
  public async logEvent(
    event: Omit<MemoryEvent, 'id'>,
    permissions: MemoryPermissions,
  ): Promise<MemoryEvent> {
    if (!permissions.tenantId) {
      throw new Error('InMemoryMemoryStore.logEvent: permissions.tenantId is required');
    }
    if (event.tenantId !== permissions.tenantId) {
      throw new Error(
        'InMemoryMemoryStore.logEvent: event.tenantId must match permissions.tenantId',
      );
    }
    const stored: MemoryEvent = { ...event, id: crypto.randomUUID() };
    this.events.set(eventKey(event.tenantId, stored.id), stored);
    return stored;
  }
}
