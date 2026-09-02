# ADR-079: Sync Engine SDK Contract — `SyncEngine` + `SyncSession` + `SyncCursor` + `SyncConflictResolver` + `SyncTransport` Interfaces

**ADR-ID:** ADR-079
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR-009 (Internal SDK) declares SmartAgentics' SDK framework-agnostic. ADR-011 claims "SDK interfaces provide sufficient extension points." Stream 7 Foundational Conflict **FC-7.6** (NEW) flags the gap: there is no `SyncEngine` interface in `packages/sdk/src/`. Stream 7 Foundational Conflict **FC-7.7** (NEW) flags the broader gap: ADR-011's claim "SDK interfaces provide sufficient extension points" remains INACCURATE for Offline Sync — verified by the absence of `SyncEngine`, `SyncOutbox`, `SyncCheckpoint`, `SyncConflict` interfaces in the current SDK. The ADR-011 amendment (separately performed by the Phase D architect) reclassifies Offline Sync as NOW and acknowledges the SDK gap.

Stream 7 research (`/home/z/my-project/phase-c-stream7-offline-sync-report.md`, §9, §0.5) confirmed the SDK contract is the single most important deliverable of Stream 7. The four established sync engines (PowerSync, ElectricSQL, Turso Sync, Replicache) each ship a client SDK with a well-defined interface. SmartAgentics' in-house SyncEngine (per ADR-070 — server-authoritative event-log sync; PowerSync/Electric/Turso/Replicache documented as reference designs) requires an equivalent SDK contract that:

- Is **transport-agnostic** (works for SQLite-only STANDALONE, LAN hub-and-spoke LAN_SYNCED, and cloud PostgreSQL CLOUD_SYNCED).
- Is **conflict-resolver-pluggable** (the three-tier policy per ADR-074 is the default; tenant-specific overrides are possible).
- Is **Restate-integrated** (the `SyncRelayWorkflow` per ADR-073 is a Restate workflow; the SDK exposes Restate's retry/backoff/pause-on-exhaustion semantics).
- Is **Phase 1 contract-only** (the interface ships in Phase 1; the reference implementation `SqlitePostgresSyncEngine` is Phase 2+; the Phase 1 STANDALONE deployment uses a `NoopSyncEngine` that satisfies the interface but does nothing).
- **Abstracts the Phase 3+ managed-sync-engine swap** (if Phase 3+ adopts PowerSync Open Edition or ElectricSQL as a runtime dependency per ADR-070 review condition, the swap is a new implementation of the same interface, not a rewrite).

This ADR formalizes the SDK contract: (1) the `SyncEngine` top-level interface; (2) the `SyncSession` interface (a single sync session's lifecycle); (3) the `SyncCursor` interface (the resumable-sync checkpoint abstraction); (4) the `SyncConflictResolver` interface (the three-tier policy per ADR-074); (5) the `SyncTransport` interface (the transport-agnostic delivery abstraction — SQLite-only / LAN hub / cloud PostgreSQL). The new SDK file is `packages/sdk/src/sync/index.ts` (additive; no existing SDK file modified). The reference implementation `SqlitePostgresSyncEngine` is Phase 2+; the Phase 1 `NoopSyncEngine` is the trivially-correct STANDALONE implementation.

## 2. Problem

Should SmartAgentics (a) skip the SDK contract and implement sync directly in application code (couples application to sync internals; no Phase 3+ swap abstraction), (b) adopt a managed sync engine SDK (PowerSync / ElectricSQL / Turso Sync / Replicache — rejected as runtime dependency per ADR-070), (c) define a minimal `SyncEngine` interface without the supporting types (`SyncSession`, `SyncCursor`, `SyncConflictResolver`, `SyncTransport` — insufficient for the Phase 2+ LAN_SYNCED and Phase 2+ CLOUD_SYNCED transports), or (d) define the full SDK contract (`SyncEngine` + 4 supporting interfaces) in Phase 1 with a `NoopSyncEngine` reference implementation?

## 3. Options

### Option A: Skip the SDK contract; implement sync directly in application code

Rejected. Couples application code to sync internals (the application would directly read `SyncOutbox`, call the hub HTTP API, handle conflicts). No abstraction for the Phase 3+ managed-sync-engine swap. Violates ADR-009 (Internal SDK framework-agnostic) and ADR-011 (SDK extension points).

### Option B: Adopt a managed sync engine SDK (PowerSync / ElectricSQL / Turso Sync / Replicache)

Rejected as runtime dependency for Phase 1–2 per ADR-070. The four engines are documented as reference designs; their runtime dependencies are not adopted. Phase 3+ may reconsider; the in-house SDK contract abstracts the swap.

### Option C: Define a minimal `SyncEngine` interface without supporting types

Rejected. Insufficient for the Phase 2+ LAN_SYNCED and Phase 2+ CLOUD_SYNCED transports. A minimal `SyncEngine` interface (e.g., just `sync()` and `getStatus()`) does not expose the resumable-sync checkpoint (`SyncCursor`), the conflict-resolution policy (`SyncConflictResolver`), or the transport abstraction (`SyncTransport`). Phase 2+ implementation would require extending the interface — breaking the Phase 1 contract. The full contract must be in place from Phase 1.

### Option D: Define the full SDK contract (`SyncEngine` + `SyncSession` + `SyncCursor` + `SyncConflictResolver` + `SyncTransport`) in Phase 1 with a `NoopSyncEngine` reference implementation

Adopted. The full contract is in place from Phase 1. The `NoopSyncEngine` is the trivially-correct STANDALONE implementation (satisfies the interface; does nothing — no sync active). The reference implementation `SqlitePostgresSyncEngine` is Phase 2+. The contract abstracts the Phase 3+ managed-sync-engine swap. No existing SDK file is modified; the new file is `packages/sdk/src/sync/index.ts` (additive).

## 4. Decision

Adopt **Option D** — full SDK contract in Phase 1 with `NoopSyncEngine` reference implementation.

### New SDK file: `packages/sdk/src/sync/index.ts` (additive)

The new SDK file exports five interfaces (`SyncEngine`, `SyncSession`, `SyncCursor`, `SyncConflictResolver`, `SyncTransport`) and supporting types. Pseudocode (contract only, NOT for Phase 1 production implementation — the `NoopSyncEngine` is the Phase 1 reference implementation; `SqlitePostgresSyncEngine` is Phase 2+):

```typescript
// packages/sdk/src/sync/index.ts — contract only, NOT for Phase 1 production implementation

// ============================================================================
// SyncEngine — top-level interface; transport-agnostic; conflict-resolver-pluggable
// ============================================================================

export interface SyncEngine {
  /** Open a sync session for a tenant. Returns a SyncSession that the caller drives. */
  openSession(params: SyncSessionParams): Promise<SyncSession>;

  /** Get the engine's current status (idle | syncing | error | paused). */
  getStatus(tenantId: string): SyncEngineStatus;

  /** Pause sync for a tenant (e.g., operator-initiated maintenance). */
  pause(tenantId: string): Promise<void>;

  /** Resume sync for a tenant (after pause or after Restate pause-on-exhaustion). */
  resume(tenantId: string): Promise<void>;

  /** Force a full re-sync from snapshot (rare; used when delta is too large per ADR-077 §4). */
  forceResync(tenantId: string): Promise<void>;
}

export interface SyncSessionParams {
  tenantId: string;
  propertyId: string;
  clientId: string; // spoke/hub identifier (per ADR-072 SyncCheckpoint.clientId)
  syncMode: SyncMode; // STANDALONE | LAN_HUB | LAN_SPOKE | CLOUD_SYNCED
  transport: SyncTransport; // the transport abstraction (SQLite-only / LAN hub / cloud PG)
  conflictResolver: SyncConflictResolver; // the three-tier policy (per ADR-074)
  syncFilter?: SyncFilter; // optional partial-sync predicate (per ADR-070 §4 partial sync)
}

export type SyncMode = 'STANDALONE' | 'LAN_HUB' | 'LAN_SPOKE' | 'CLOUD_SYNCED';

export interface SyncEngineStatus {
  state: 'idle' | 'syncing' | 'error' | 'paused';
  lastSyncAt?: Date;
  pendingEventCount: number; // SyncOutbox rows with deliveredAt IS NULL
  conflictBacklogCount: number; // SyncConflict rows with resolvedAt IS NULL
  lastError?: string;
  restateInvocationId?: string; // for correlation (per ADR-073 §4.8)
}

// ============================================================================
// SyncSession — a single sync session's lifecycle (opened by SyncEngine.openSession)
// ============================================================================

export interface SyncSession {
  /** The cursor for this session (resumable-sync checkpoint per ADR-077 §4 Layer 2). */
  readonly cursor: SyncCursor;

  /** Push local SyncOutbox events to the transport. At-least-once; idempotent consumer dedups. */
  push(events: SyncOutboxEvent[]): Promise<PushResult>;

  /** Pull remote events from the transport since the cursor's last ACK'd LSN. */
  pull(batchSize?: number): Promise<PullResult>;

  /** ACK received events (advances the cursor per ADR-077 §4 resumable sync protocol). */
  ack(lastLsn: string): Promise<void>;

  /** Close the session (saves checkpoint; releases resources). */
  close(): Promise<void>;
}

export interface SyncOutboxEvent {
  id: string;
  tenantId: string;
  tableName: string;
  recordId: string;
  operation: 'insert' | 'update' | 'delete';
  payloadJson: string;
  hlc: string; // Hybrid Logical Clock timestamp (per ADR-074 §4)
  syncOrigin?: string;
  createdAt: Date;
}

export interface PushResult {
  deliveredCount: number;
  failedCount: number;
  failures: Array<{ eventId: string; error: string }>;
}

export interface PullResult {
  events: SyncOutboxEvent[];
  nextLsn?: string; // null/undefined if no more events
  hasMore: boolean;
}

// ============================================================================
// SyncCursor — the resumable-sync checkpoint abstraction (per ADR-077 §4 Layer 2)
// ============================================================================

export interface SyncCursor {
  /** The tenant + client this cursor belongs to. */
  readonly tenantId: string;
  readonly clientId: string;

  /** The last ACK'd log-sequence-number (per ADR-072 SyncCheckpoint.lastCheckpointLsn). */
  lastAckedLsn: string;

  /** The checkpoint's status (per ADR-072 SyncCheckpoint.status). */
  status: 'active' | 'stale' | 'error';

  /** Persist the cursor to the SyncCheckpoint table. */
  save(): Promise<void>;

  /** Reload the cursor from the SyncCheckpoint table (e.g., after a crash). */
  reload(): Promise<void>;
}

// ============================================================================
// SyncConflictResolver — the three-tier conflict resolution policy (per ADR-074)
// ============================================================================

export interface SyncConflictResolver {
  /**
   * Resolve a conflict between local and remote payloads.
   * Tier 1: LWW by HLC-tagged (updatedAt, revision, syncOrigin) — non-financial fields.
   * Tier 2: Semantic override — server recomputes from event log — financial fields.
   * Tier 3: Manual resolution — queue in SyncConflict for 3-way merge UI — unresolvable.
   */
  resolve(conflict: SyncConflictInput): SyncConflictResolution;
}

export interface SyncConflictInput {
  tenantId: string;
  tableName: string;
  recordId: string;
  localPayloadJson: string;
  remotePayloadJson: string;
  detectedAt: Date;
}

export interface SyncConflictResolution {
  outcome: 'resolved-lww' | 'resolved-semantic' | 'escalated-manual';
  winnerPayloadJson?: string; // for resolved-lww / resolved-semantic
  rationale: string;
  recomputationFunction?: string; // for resolved-semantic (e.g., 'recomputeFolioBalance')
  syncConflictId?: string; // for escalated-manual (the queued SyncConflict row id)
}

// ============================================================================
// SyncTransport — the transport-agnostic delivery abstraction
// ============================================================================

export interface SyncTransport {
  /** The transport's mode (matches SyncMode). */
  readonly mode: SyncMode;

  /** Deliver events to the transport (hub HTTP API in Phase 2; cloud PostgreSQL in Phase 2+). */
  deliver(events: SyncOutboxEvent[], session: SyncSession): Promise<DeliveryResult>;

  /** Fetch events from the transport since the given LSN (long-poll). */
  fetch(sinceLsn: string, batchSize: number, session: SyncSession): Promise<PullResult>;

  /** ACK events to the transport (advances the transport's checkpoint for this client). */
  ack(lastLsn: string, session: SyncSession): Promise<void>;

  /** Health check (used by the circuit breaker per ADR-077 §4 Layer 6). */
  healthCheck(): Promise<TransportHealth>;
}

export interface DeliveryResult {
  deliveredCount: number;
  failedCount: number;
  failures: Array<{ eventId: string; error: string; retryable: boolean }>;
}

export interface TransportHealth {
  healthy: boolean;
  latencyMs?: number;
  lastError?: string;
}

// ============================================================================
// SyncFilter — optional partial-sync predicate (per ADR-070 §4 partial sync)
// ============================================================================

export interface SyncFilter {
  /** Per-table SQL-like predicate. E.g., housekeeping tablet syncs only HousekeepingTask + Room.status. */
  [tableName: string]: string; // SQL-like WHERE clause (without the "WHERE" keyword)
}

// ============================================================================
// NoopSyncEngine — Phase 1 trivially-correct STANDALONE reference implementation
// ============================================================================

export class NoopSyncEngine implements SyncEngine {
  async openSession(params: SyncSessionParams): Promise<SyncSession> {
    // Returns a NoopSyncSession that satisfies the interface but does nothing.
    // SyncOutbox rows accumulate (per ADR-072 R-7.10); no transport is configured.
    return new NoopSyncSession(params);
  }
  getStatus(_tenantId: string): SyncEngineStatus {
    return { state: 'idle', pendingEventCount: 0, conflictBacklogCount: 0 };
  }
  async pause(_tenantId: string): Promise<void> {
    /* no-op */
  }
  async resume(_tenantId: string): Promise<void> {
    /* no-op */
  }
  async forceResync(_tenantId: string): Promise<void> {
    /* no-op */
  }
}

// SqlitePostgresSyncEngine (Phase 2+ reference implementation) is NOT in Phase 1 scope.
// It implements SyncEngine with:
//   - SqliteLanHubTransport (Phase 2 LAN_SYNCED) — uses SyncHubService HTTP API per ADR-075
//   - SqliteCloudPostgresTransport (Phase 2+ CLOUD_SYNCED) — uses cloud PostgreSQL per ADR-076
//   - DefaultSyncConflictResolver — implements the three-tier policy per ADR-074
//   - RestateSyncRelayWorkflow — the Restate workflow per ADR-073 §4.3
```

### Phase 1 scope

Phase 1 ships:

- The new SDK file `packages/sdk/src/sync/index.ts` with the five interfaces + supporting types + `NoopSyncEngine` reference implementation.
- The `NoopSyncEngine` is the Phase 1 STANDALONE deployment's `SyncEngine`. It satisfies the interface; it does nothing (no sync active). `SyncOutbox` rows accumulate (per ADR-072 R-7.10) but are not delivered.
- The verifier rule (per ADR-070 Phase 1 scope) flags any mutable Prisma model missing `updatedAt + revision + deletedAt + tenantId`.

Phase 1 does NOT ship:

- The `SqlitePostgresSyncEngine` reference implementation (Phase 2+).
- The `SqliteLanHubTransport` (Phase 2 LAN_SYNCED).
- The `SqliteCloudPostgresTransport` (Phase 2+ CLOUD_SYNCED).
- The `DefaultSyncConflictResolver` (Phase 2+; the policy is documented in ADR-074 but the implementation is Phase 2+; a minimal synthetic version is used in PoC-02 per ADR-071).

### Phase 2+ scope

Phase 2 LAN_SYNCED activation implements:

- `SqlitePostgresSyncEngine` (the reference implementation).
- `SqliteLanHubTransport` — uses the `SyncHubService` HTTP API (per ADR-075).
- `DefaultSyncConflictResolver` — implements the three-tier policy (per ADR-074). Tier 1 (LWW) is exercised; Tier 2 (semantic override) requires the `FinancialEvent` table (Phase 2+ per ADR-073 §4.6); Tier 3 (manual UI) is exercised whenever unresolvable conflicts arise.
- `RestateSyncRelayWorkflow` — the Restate workflow (per ADR-073 §4.3) that reads `SyncOutbox` and delivers via the `SyncTransport`.

Phase 2+ CLOUD_SYNCED activation adds:

- `SqliteCloudPostgresTransport` — uses cloud PostgreSQL (per ADR-076).
- `SyncInbox` table (per ADR-073 §4.9) for incoming cloud→property sync.
- `FinancialEvent` table (per ADR-073 §4.6) for Tier 2 semantic override.

### Phase 3+ managed-sync-engine swap

If Phase 3+ adopts PowerSync Open Edition or ElectricSQL as a runtime dependency (per ADR-070 review condition), the swap is a new implementation of `SyncTransport` (e.g., `PowerSyncTransport`) — not a rewrite. The `SyncEngine`, `SyncSession`, `SyncCursor`, `SyncConflictResolver` interfaces remain unchanged. The application code that depends on `SyncEngine` is unaffected.

## 5. Rationale

- **FC-7.6 resolution**: there is no `SyncEngine` interface in `packages/sdk/src/`. This ADR creates the new SDK file `packages/sdk/src/sync/index.ts` with the `SyncEngine` top-level interface + 4 supporting interfaces.
- **FC-7.7 resolution**: ADR-011's claim "SDK interfaces provide sufficient extension points" is INACCURATE for Offline Sync. The ADR-011 amendment (separately performed by the Phase D architect) reclassifies Offline Sync as NOW and acknowledges the SDK gap. This ADR is the SDK contract that closes the gap.
- **Transport-agnostic** is the key property: the same `SyncEngine` interface works for SQLite-only STANDALONE (Phase 1), LAN hub-and-spoke LAN_SYNCED (Phase 2), and cloud PostgreSQL CLOUD_SYNCED (Phase 2+). The `SyncTransport` interface abstracts the delivery target. Phase 3+ managed-sync-engine swap is a new `SyncTransport` implementation, not a rewrite.
- **Conflict-resolver-pluggable** is the second key property: the `SyncConflictResolver` interface abstracts the three-tier policy (per ADR-074). The default implementation (`DefaultSyncConflictResolver`) is Phase 2+; tenant-specific overrides are possible (e.g., a hotel where housekeeping room-status decisions have higher authority than front-desk — per ADR-074 review condition).
- **Restate-integrated** is the third key property: the `SyncRelayWorkflow` (per ADR-073) is a Restate workflow. The `SyncEngineStatus.restateInvocationId` field exposes Restate's invocation ID for correlation (per ADR-073 §4.8 — the 3-correlation-ID model from Stream 6: Restate invocation ID + W3C `traceparent` + application `correlationId`).
- **Phase 1 contract-only** preserves the Phase 1 STANDALONE-only commitment (per ADR-070, ADR-076). The `NoopSyncEngine` is the trivially-correct STANDALONE implementation. The reference implementation `SqlitePostgresSyncEngine` is Phase 2+. Phase 2+ sync activation is a config change (`Tenant.syncMode` flip per ADR-072), not an SDK change.
- **Abstracts the Phase 3+ managed-sync-engine swap**: if Phase 3+ adopts PowerSync Open Edition or ElectricSQL, the swap is a new `SyncTransport` implementation. The application code that depends on `SyncEngine` is unaffected. This is the vendor-lock-in mitigation (per ADR-070 R-7.3).
- **Five interfaces (not minimal)** is the right granularity: `SyncEngine` (top-level), `SyncSession` (per-session lifecycle), `SyncCursor` (resumable-sync checkpoint), `SyncConflictResolver` (three-tier policy), `SyncTransport` (delivery abstraction). A minimal `SyncEngine` interface (per §3 Option C rejection) would require extending the interface in Phase 2+ — breaking the Phase 1 contract.
- **Additive SDK file** (no existing SDK file modified): the new file is `packages/sdk/src/sync/index.ts`. No existing SDK file is touched. The verifier rule (per ADR-070) flags any mutable Prisma model missing sync metadata, but does not modify existing SDK files.
- **Pseudocode is contract-only** (per the comment at the top of the code block): the `NoopSyncEngine` is the Phase 1 reference implementation; the `SqlitePostgresSyncEngine` is Phase 2+. The pseudocode documents the interface contract; the Phase D architect implements the `NoopSyncEngine` in Phase E engineering.
- **Matches the established sync-engine SDK pattern**: PowerSync, ElectricSQL, Turso Sync, and Replicache each ship a client SDK with a well-defined interface (per Stream 7 §9.1). SmartAgentics' SDK contract follows the same pattern — top-level engine + session + cursor + conflict resolver + transport. The convergence validates the contract design.

## 6. Consequences

- New SDK file `packages/sdk/src/sync/index.ts` (additive; no existing SDK file modified). Exports 5 interfaces + supporting types + `NoopSyncEngine` reference implementation.
- Phase 1 ships the `NoopSyncEngine` as the STANDALONE deployment's `SyncEngine`. The `SyncOutbox` rows accumulate (per ADR-072 R-7.10) but are not delivered.
- Phase 2+ LAN_SYNCED activation implements `SqlitePostgresSyncEngine` + `SqliteLanHubTransport` + `DefaultSyncConflictResolver` + `RestateSyncRelayWorkflow`.
- Phase 2+ CLOUD_SYNCED activation adds `SqliteCloudPostgresTransport` + `SyncInbox` + `FinancialEvent`.
- Phase 3+ managed-sync-engine swap (if triggered per ADR-070 review condition) is a new `SyncTransport` implementation. The `SyncEngine`, `SyncSession`, `SyncCursor`, `SyncConflictResolver` interfaces remain unchanged.
- ADR-011 amendment (separately performed by the Phase D architect) reclassifies Offline Sync as NOW and acknowledges the SDK gap closed by this ADR.
- **R-7.44 risk (SDK interface design is wrong and requires breaking changes in Phase 2+)**: mitigated by the interface being modeled on the established sync-engine SDK pattern (PowerSync, ElectricSQL, Turso Sync, Replicache — per Stream 7 §9.1); PoC-01 + PoC-02 (per ADR-071) validate the interface against real sync scenarios during Phase E engineering, before Phase 2+ implementation. If the interface needs changes, they are made before Phase 2+ implementation locks in the contract.
- **R-7.45 risk (the `NoopSyncEngine` accumulates `SyncOutbox` rows that are never delivered — wasted storage)**: mitigated by the 30-day purge (per ADR-072 R-7.10); the storage cost is negligible (an indexed row per business-data-change; ~100–1000 writes/hour at peak per Stream 7 §2.3 = ~24,000 rows/day = ~720,000 rows/month; purged after 30 days).
- **R-7.46 risk (the `SyncTransport` interface is insufficient for a Phase 3+ managed sync engine — e.g., PowerSync's Sync Rules partial-replication model does not fit the `SyncFilter` SQL-like predicate)**: mitigated by the `SyncFilter` being optional (a managed engine can ignore it and use its own Sync Rules); the `SyncTransport` interface is the minimal contract (deliver, fetch, ack, healthCheck); a Phase 3+ managed-engine transport implementation can extend the interface with engine-specific methods without breaking the base contract.
- **R-7.47 risk (the `SyncConflictResolver` interface is insufficient for tenant-specific overrides — e.g., a hotel where housekeeping room-status decisions have higher authority than front-desk)**: mitigated by the interface being pluggable (`SyncSessionParams.conflictResolver`); a tenant-specific `SyncConflictResolver` implementation can be injected per tenant. The `DefaultSyncConflictResolver` is the default; tenant overrides are Phase 2+ opt-in.
- **R-7.48 risk (the SDK contract is over-engineered for Phase 1 STANDALONE — the `NoopSyncEngine` does nothing)**: mitigated by the contract being the Phase 3+ swap abstraction (per ADR-070 R-7.3); the Phase 1 cost is the SDK file (~500 lines of TypeScript interface definitions + `NoopSyncEngine`); the Phase 3+ benefit is the managed-sync-engine swap without application-code rewrite.
- Dependencies: ADR-009 (Internal SDK framework-agnostic — the new SDK file is framework-agnostic), ADR-011 (SDK extension points — amended separately per FC-7.7), ADR-012 (Canonical Domain Model — `SyncRecord` is the canonical envelope for sync events; `SyncOutboxEvent.payloadJson` carries `SyncRecord` envelopes), ADR-070 (umbrella architecture — the SDK contract is the contract for the in-house SyncEngine), ADR-071 (PoC-01 + PoC-02 validate the interface against real sync scenarios), ADR-072 (sync metadata schema — `SyncOutbox`, `SyncCheckpoint`, `SyncConflict` tables; `SyncOutboxEvent` maps to `SyncOutbox` row), ADR-073 (transactional outbox — `RestateSyncRelayWorkflow` implements `SyncTransport.deliver` via the `SyncRelayWorkflow` Restate workflow), ADR-074 (conflict resolution — `SyncConflictResolver` implements the three-tier policy), ADR-075 (LAN operation topology — `SqliteLanHubTransport` uses `SyncHubService` HTTP API), ADR-076 (cloud sync boundary — `SqliteCloudPostgresTransport` uses cloud PostgreSQL), ADR-077 (failure recovery — `SyncEngineStatus` exposes the 6-layer model's state; `SyncCursor` is Layer 2). **No new runtime dependencies** (the SDK file is TypeScript interfaces + `NoopSyncEngine`; Phase 2+ adds Restate + `bonjour-service` per ADR-075 + cloud PostgreSQL per ADR-076).
- Phase 3+ AI-BOS extension: AI-BOS multi-tenant SaaS (directive File 2 §23) uses the same `SyncEngine` interface at cloud scale. The `syncOrigin` field (per ADR-072) becomes critical for attributing changes to specific cloud tenants or AI agents. The `SyncTransport` interface abstracts the cloud transport; the swap from in-house to managed sync engine (if triggered per ADR-070 review condition) is transparent to the application code.

## 7. Review Conditions

- Review if Phase 2+ PoC-01 or PoC-02 (per ADR-071) reveal the SDK interface is insufficient (e.g., `SyncSession.push` signature cannot batch efficiently; `SyncCursor.save` does not handle concurrent sessions) — would require extending the interface before Phase 2+ implementation locks in the contract.
- Review if Phase 2+ tenant-specific conflict-resolution overrides (e.g., a hotel where housekeeping room-status decisions have higher authority than front-desk) require a different `SyncConflictResolver` interface — would warrant a Phase 2+ tenant-override ADR.
- Review if Phase 3+ managed-sync-engine adoption (PowerSync Open Edition or ElectricSQL, per ADR-070 review condition) requires extending the `SyncTransport` interface (e.g., PowerSync's Sync Rules partial-replication model does not fit the `SyncFilter` SQL-like predicate) — would warrant a Phase 3+ managed-engine-transport ADR.
- Review if a community sync-engine SDK standard emerges (e.g., a standardized `SyncEngine` interface from the SQLite sync ecosystem) that should replace the SmartAgentics-owned contract.
- Review if Phase 2+ operator feedback indicates the `SyncEngineStatus` dashboard widget is insufficient (e.g., needs more granular metrics like per-table sync lag) — would warrant extending `SyncEngineStatus`.
- Review if Phase 3+ AI-BOS multi-agent collaboration requires extending the SDK contract for agent-recommendation sync (per ADR-064 — currently agent recommendations use the agent-recommendation `ConflictResolution` table, not the sync `SyncConflict` table; the two remain distinct) — would warrant a Phase 3+ unified-conflict-resolution ADR.
- Review if Phase 2+ `RestateSyncRelayWorkflow` integration reveals that the `SyncTransport.deliver` signature does not expose enough Restate-specific control (e.g., pause-on-exhaustion is not accessible via the interface) — would warrant extending the interface or adding a Restate-specific transport interface.
- Review if the SDK contract should be split into multiple files (`packages/sdk/src/sync/engine.ts`, `session.ts`, `cursor.ts`, `conflict-resolver.ts`, `transport.ts`) for navigability — currently a single `index.ts` file; the split is a Phase 2+ refactoring decision if the file grows too large.
- Review if Phase 2+ the `SyncFilter` SQL-like predicate proves insufficient for partial sync (e.g., a housekeeping tablet needs to sync only `HousekeepingTask` + `Room.status` + `Reservation.checkInDate` + `Reservation.checkOutDate` — a join-based filter that SQL-like predicates cannot express cleanly) — would warrant extending `SyncFilter` to support join-based predicates.
- Review if Phase 3+ multi-property aggregation requires a different `SyncEngine` deployment model (e.g., one `SyncEngine` instance per property vs. one instance per chain) — would warrant a Phase 3+ deployment-model ADR.
