# ADR-072: Sync Metadata Schema — Additive Columns (revision, deletedAt, syncOrigin, idempotencyKey, updatedAt) + New Tables (SyncOutbox, SyncCheckpoint, SyncConflict)

**ADR-ID:** ADR-072
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR-006 (SQLite) and the existing Prisma schema (`prisma/schema.prisma`) establish the foundation for the offline-first Hotel PMS: `tenantId` on every mutable table (NOT NULL, indexed), `idempotencyKey String?` on 4 of 10 models (Reservation, Room, HousekeepingTask, WorkflowRun) with `@@unique([tenantId, idempotencyKey])`, `correlationId` and `traceId` on WorkflowRun. Stream 7 Foundational Conflict **FC-7.4** (NEW) flags the gap: for sync, EVERY replicated mutable table needs `idempotencyKey` + `revision` + `updatedAt` (explicit) + `deletedAt` + `syncOrigin`. The existing schema has only 40% coverage of the required sync metadata.

Stream 7 research (`/home/z/my-project/phase-c-stream7-offline-sync-report.md`, §10) confirms the sync metadata schema is the foundation that makes sync possible. Without `revision` + `deletedAt` + `syncOrigin`, the SyncEngine (per ADR-079) cannot detect conflicts, propagate deletes, or attribute changes. Soft delete (`deletedAt`) is critical because a hard `DELETE` cannot be propagated as a delta — the row is gone; the sync engine cannot tell what was deleted. A soft delete (`deletedAt = now()`) is a regular update that flows through `SyncOutbox` like any other update (per Streamkap's CDC soft-delete guide and Fivetran's soft-delete mode, both cited in Stream 7 §10.1).

Three new tables are required:

- **`SyncOutbox`** — the transactional outbox (per ADR-073); every business-data-change Prisma transaction writes a row in the same transaction; the `SyncRelayWorkflow` Restate workflow delivers rows to the transport (hub HTTP API in Phase 2; cloud PostgreSQL in Phase 2+).
- **`SyncCheckpoint`** — resumable sync state per client; tracks the last ACK'd log-sequence-number (LSN); supports resume-from-last-ACK on sync interruption (per Nango Checkpoints and Airbyte Resumability patterns, cited in Stream 7 §10.1).
- **`SyncConflict`** — the conflict backlog; one row per conflict (auto-resolved Tier 1/2 OR queued-for-manual Tier 3, per ADR-074); never blocks live sync (per ADR-077).

The schema is **additive** — no existing column is modified, only new columns and new tables added. Prisma migration adds columns with defaults (`revision = 0`, `deletedAt = null`, `syncOrigin = null`); existing rows backfill cleanly. The `Tenant` model is extended with `syncMode`, `hubEndpoint`, `hubPublicKey` to control sync activation per tenant.

This ADR formalizes the additive columns, the three new tables, and the `Tenant` extension. It is the schema foundation that ADR-070 (umbrella), ADR-073 (transactional outbox), ADR-074 (conflict resolution), ADR-077 (failure recovery), and ADR-079 (SyncEngine SDK) build on.

## 2. Problem

Should SmartAgentics (a) defer the sync metadata schema to Phase 2 sync activation (schema migration at activation time; high migration risk on a live production database), (b) add the metadata columns only on tables that need them in Phase 2 (piecemeal; risks forgetting a table; breaks the forward-compatibility principle), or (c) add the additive columns + three new tables + `Tenant` extension in Phase 1 (forward-compatible; Phase 2 sync activation is a config change, not a schema migration)?

## 3. Options

### Option A: Defer the sync metadata schema to Phase 2 sync activation

Rejected. A schema migration on a live production SQLite file can be slow (SQLite ALTER TABLE for additive columns is fast; recreating indexes is the slow part). A migration at sync-activation time couples schema risk with activation risk — if the migration fails, sync cannot activate. Phase 1 ships with the metadata columns populated (`revision` increments on every update; `deletedAt` set on soft delete; `syncOrigin = "local"`) so Phase 2 sync activation is a config change (`Tenant.syncMode` flips from `STANDALONE` to `LAN_SYNCED`), not a schema migration.

### Option B: Add the metadata columns only on tables that need them in Phase 2 (piecemeal)

Rejected. Risks forgetting a table (the sync engine would silently miss changes to that table). Breaks the forward-compatibility principle (each Phase 2 sync feature would require a schema migration). The architecture-drift verifier rule (per ADR-070 Phase 1 scope) flags any mutable Prisma model missing `updatedAt + revision + deletedAt + tenantId` — piecemeal addition would fail this rule repeatedly. The schema is additive and low-cost; adding it once on all mutable tables in Phase 1 is simpler than tracking which tables need it when.

### Option C: Add the additive columns + three new tables + `Tenant` extension in Phase 1; forward-compatible; Phase 2 sync activation is a config change

Adopted. The columns are added to every mutable table in Phase 1 (Prisma migration; additive; backfills with defaults). The three new tables are created in Phase 1 (idle in STANDALONE mode). The `Tenant` extension defaults to `syncMode = "STANDALONE"`. The Prisma middleware (extended per ADR-073) auto-writes `SyncOutbox` rows on every sync-replicated model mutation, even in STANDALONE mode — the rows accumulate but the schema is forward-compatible. Phase 2 sync activation is a config change.

## 4. Decision

Adopt **Option C** — additive columns on every mutable table + three new tables + `Tenant` extension in Phase 1; forward-compatible.

### Additive columns on every mutable Prisma model

Every mutable Prisma model (every model with `tenantId`) gains these additive columns in Phase 1:

| Column           | Type                  | Default                                                          | Purpose                                                                                                                                                                                                                                                       |
| ---------------- | --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updatedAt`      | `DateTime @updatedAt` | (Prisma-managed)                                                 | Explicit (Prisma's `@updatedAt` is implicit; making it explicit ensures it's always present and indexed). Required for LWW conflict resolution (Tier 1, per ADR-074).                                                                                         |
| `revision`       | `Int @default(0)`     | `0`                                                              | Monotonic per-row version counter, incremented on every update. The hub/cloud assigns the final `revision` on commit (server authority). Client-supplied `revision` is a hint; server overwrites. Required for LWW + idempotent consumer dedup.               |
| `deletedAt`      | `DateTime?`           | `null`                                                           | Tombstone for soft delete. Sync propagates deletes as `deletedAt = now()` updates, never as hard `DELETE`. Hard delete happens only after retention expiry (7 years for `audit_events` per ADR-013; 30 days for sync tombstones after delivery confirmation). |
| `syncOrigin`     | `String?`             | `null` (set to `"local"` for local writes in Phase 1 STANDALONE) | Which client/hub created this revision. Supports multi-write-origin tracking + audit. Required for HLC tiebreaking and conflict investigation.                                                                                                                |
| `idempotencyKey` | `String?`             | `null` (client-supplied)                                         | Client-supplied stable key for dedup. `@@unique([tenantId, idempotencyKey])` constraint. Already present on 4 of 10 models; extended to all mutable models.                                                                                                   |

Migration notes:

- Prisma migration adds the columns with defaults; existing rows backfill with `revision = 0`, `deletedAt = null`, `syncOrigin = null`, `idempotencyKey = null`.
- Indexes: `@@index([tenantId, updatedAt])` on every mutable model (for sync-pull queries); `@@index([tenantId, revision])` on financial models (for Tier 2 recomputation).
- The `@@unique([tenantId, idempotencyKey])` constraint is added on every mutable model. Existing rows with `idempotencyKey = null` are unaffected (SQL `NULL` is distinct in a unique constraint).

### Three new tables

```prisma
model SyncOutbox {
  id               String   @id @default(cuid())
  tenantId         String
  tableName        String   // "Reservation", "Room", etc.
  recordId         String   // the row's id
  operation        String   // "insert" | "update" | "delete"
  payloadJson      String   // JSON snapshot of the row (or delta for updates)
  hlc              String   // Hybrid Logical Clock timestamp (per ADR-074 §4)
  syncOrigin       String?  // originating client/hub
  restateInvocationId String? // Restate SyncRelayWorkflow invocation (per ADR-073 §8)
  createdAt        DateTime @default(now())
  deliveredAt      DateTime?
  deliveryAttempts Int      @default(0)
  lastError        String?

  @@index([tenantId, deliveredAt, createdAt])
  @@index([tenantId, tableName, recordId])
}

model SyncCheckpoint {
  id                String   @id @default(cuid())
  tenantId          String
  clientId          String   // spoke/hub identifier
  lastCheckpointLsn String   // log-sequence-number
  lastCheckpointAt  DateTime @default(now())
  status            String   @default("active") // active | stale | error

  @@unique([tenantId, clientId])
  @@index([tenantId, status])
}

model SyncConflict {
  id                  String   @id @default(cuid())
  tenantId            String
  tableName           String
  recordId            String
  localPayloadJson    String
  remotePayloadJson   String
  detectedAt          DateTime @default(now())
  resolvedAt          DateTime?
  resolutionStrategy  String?  // "lww" | "semantic" | "manual" (per ADR-074)
  resolverUserId      String?
  resolutionJson      String?

  @@index([tenantId, resolvedAt, detectedAt])
  @@index([tenantId, tableName, recordId])
}
```

Phase 2+ additions (NOT in Phase 1; specified here for forward-compatibility):

- `SyncInbox` table (per ADR-073 §7) — for incoming cloud→property sync events; idempotent consumption via `@@unique([tenantId, eventId])`.
- `FinancialEvent` table (per ADR-073 §5) — selective event sourcing for financial aggregates (Invoice, Payment, FolioBalance, Refund); 7-year retention; Tier 2 recomputation source. Phase 2+ implementation; minimal synthetic version used in PoC-02 (per ADR-071).

### Tenant model extension

```prisma
model Tenant {
  // ... existing fields ...
  syncMode     String   @default("STANDALONE") // STANDALONE | LAN_HUB | LAN_SPOKE | CLOUD_SYNCED
  hubEndpoint  String?  // URL of the LAN hub (for LAN_SPOKE mode)
  hubPublicKey String?  // for verifying hub responses (signed JWT per Stream 5)
}
```

The `syncMode` field defaults to `"STANDALONE"` in Phase 1. Phase 2 LAN_SYNCED activation flips it to `"LAN_HUB"` (on the hub machine) or `"LAN_SPOKE"` (on spoke machines). Phase 2+ CLOUD_SYNCED activation flips it to `"CLOUD_SYNCED"`.

### Soft-delete enforcement

Hard `DELETE` on sync-replicated models is **forbidden**. Prisma middleware intercepts `delete` and `deleteMany` on sync-replicated models and converts to soft-delete (`update` with `deletedAt = now()`). The verifier rule (per ADR-070 Phase 1 scope) flags raw `prisma.<model>.delete()` calls in code review.

### Migration safety

- The migration is **additive** — no existing column is modified, no existing row is deleted, no existing index is dropped.
- The migration runs during a maintenance window (Phase E engineering). For very large SQLite files, `PRAGMA wal_checkpoint(TRUNCATE)` runs before the migration to minimize WAL growth during migration.
- The migration is reversible (drop the additive columns + drop the three new tables + revert the `Tenant` extension) — though reversibility is not expected to be needed (the columns are populated even in STANDALONE mode and have no behavioral effect until sync activates).

## 5. Rationale

- **FC-7.4 resolution**: existing Prisma schema has `idempotencyKey` on only 4 of 10 models. For sync, EVERY replicated mutable table needs `idempotencyKey` + `revision` + `updatedAt` + `deletedAt` + `syncOrigin`. This ADR extends all five columns to all mutable tables.
- **Additive-only migration**: no existing column is modified, no existing row is deleted, no existing index is dropped. The migration is safe and reversible (though reversibility is not expected to be needed).
- **Forward-compatibility**: Phase 1 ships with the columns populated (`revision` increments on every update; `deletedAt` set on soft delete; `syncOrigin = "local"` for local writes). Phase 2 sync activation is a config change (`Tenant.syncMode` flip), not a schema migration. This avoids the migration risk at sync-activation time (per §3 Option A rejection).
- **Soft delete is the only correct delete model for sync**: a hard `DELETE` cannot be propagated as a delta (the row is gone; the sync engine cannot tell what was deleted). A soft delete (`deletedAt = now()`) is a regular update that flows through `SyncOutbox` like any other update. Hard delete happens only after retention expiry. This matches the industry consensus (Streamkap CDC soft-delete guide; Fivetran soft-delete mode; both cited in Stream 7 §10.1).
- **`syncOrigin` is non-negotiable for audit**: without it, the sync engine cannot attribute a change to a specific client/hub. Critical for conflict investigation and for the audit trail required by ADR-013.
- **Three new tables are minimal and well-scoped**: `SyncOutbox` (transient queue; deleted after ACK + grace), `SyncCheckpoint` (one row per (tenantId, clientId); tiny), `SyncConflict` (one row per conflict; rare in practice). The three tables are the smallest set that supports sync; no redundant tables.
- **`Tenant.syncMode` is the activation switch**: a single field controls sync mode per tenant. This makes Phase 2 activation a config change, not a code change. The default `"STANDALONE"` preserves Phase 1 behavior.
- **Verifier rule enforces the schema**: the new verifier rule (flag any mutable Prisma model missing `updatedAt + revision + deletedAt + tenantId`) catches schema drift in CI. A developer adding a new mutable model without the required columns fails CI.
- **Soft-delete middleware enforces the soft-delete discipline**: a developer writing `prisma.reservation.delete()` is intercepted by the middleware and converted to soft-delete. This eliminates the "developer forgets soft delete" risk.
- **Phase 2+ tables (`SyncInbox`, `FinancialEvent`) are specified but not created in Phase 1**: this preserves forward-compatibility (the Phase 2+ migration is well-defined) without paying the Phase 1 cost of unused tables.

## 6. Consequences

- Phase 1 Prisma migration adds 5 additive columns to every mutable model + creates 3 new tables + extends the `Tenant` model. The migration is additive, safe, and reversible.
- Phase 1 Prisma middleware is extended to: (a) auto-write `SyncOutbox` rows on sync-replicated model mutations (per ADR-073); (b) intercept hard `delete`/`deleteMany` and convert to soft-delete.
- Phase 1 verifier rule (per ADR-070) flags any mutable Prisma model missing `updatedAt + revision + deletedAt + tenantId` in CI.
- Phase 1 Populated even in STANDALONE mode: `revision` increments on every update; `deletedAt` set on soft delete; `syncOrigin = "local"` for local writes; `SyncOutbox` rows accumulate (idle in STANDALONE). The columns and tables have no behavioral effect until sync activates; the schema is forward-compatible.
- **R-7.7 risk (migration on a large production SQLite file is slow)**: mitigated by `PRAGMA wal_checkpoint(TRUNCATE)` before migration; maintenance-window scheduling; for very large files, additive ALTER TABLE is fast (SQLite supports additive columns without table rebuild for most types).
- **R-7.8 risk (developer forgets SyncOutbox row in a new transaction)**: mitigated by Prisma middleware auto-writing SyncOutbox rows (developer doesn't have to remember). This is the Inversion-of-Control pattern — the framework writes the outbox, not the developer.
- **R-7.9 risk (developer writes hard `delete` instead of soft delete)**: mitigated by Prisma middleware intercepting `delete`/`deleteMany` and converting to soft-delete; verifier rule flags raw `delete` calls in code review.
- **R-7.10 risk (SyncOutbox grows unbounded in STANDALONE mode)**: mitigated by a Restate scheduled workflow that purges SyncOutbox rows older than 30 days in STANDALONE mode (the rows are never delivered; they accumulate for forward-compatibility but are not needed indefinitely). In Phase 2+ sync modes, rows are deleted after delivery ACK + 7-day grace (per ADR-077).
- **R-7.11 risk (Payload size — large rows make SyncOutbox `payloadJson` large)**: mitigated by SyncOutbox storing a delta (changed fields only) for `update` operations; full snapshot for `insert`/`delete`. Phase 2+ optimization.
- Dependencies: ADR-006 (SQLite; amended separately for WAL config + sync metadata), ADR-070 (umbrella architecture), ADR-073 (transactional outbox — uses `SyncOutbox`), ADR-074 (conflict resolution — uses `SyncConflict` + `revision` + `syncOrigin`), ADR-077 (failure recovery — uses `SyncCheckpoint`), ADR-079 (SyncEngine SDK — uses all three tables). **No new runtime dependencies** (Prisma + SQLite already in stack).
- Phase 2+ adds `SyncInbox` + `FinancialEvent` tables (additive; specified here for forward-compatibility). Phase 3+ AI-BOS extension uses the same sync metadata schema at cloud scale; `syncOrigin` becomes critical for attributing changes to specific cloud tenants or AI agents.

## 7. Review Conditions

- Review if Phase 1 migration on a large production SQLite file takes longer than the maintenance window — would justify splitting the migration (additive columns first; indexes in a follow-up migration).
- Review if the SyncOutbox 30-day purge in STANDALONE mode proves insufficient (e.g., a property stays STANDALONE for > 1 year and the SyncOutbox grows despite the purge) — would justify an earlier purge interval or a different forward-compatibility strategy.
- Review if Phase 2+ `SyncInbox` or `FinancialEvent` table design needs to change based on PoC-02 results (per ADR-071) — would warrant a Phase 2+ ADR amendment.
- Review if a mutable Prisma model is added without the required sync metadata columns (verifier rule fires) — would require either adding the columns or marking the model as non-replicated (rare; e.g., a pure-cache table).
- Review if `syncOrigin` attribution proves insufficient for audit (e.g., a multi-agent change needs attribution to a specific agent, not just a client) — would extend `syncOrigin` with an agent-identifier subfield (per Stream 6's signed-JWT identity).
- Review if a community sync-metadata standard emerges (e.g., a standardized `revision`/`deletedAt` convention from the SQLite sync ecosystem) that should replace the SmartAgentics-owned schema.
- Review if Phase 2+ Tier 2 recomputation (per ADR-074) requires additional metadata columns on financial models (e.g., a `recomputedAt` timestamp) — would warrant a Phase 2+ additive-column ADR.
- Review if Phase 3+ multi-property aggregation requires a `propertyId` column on every mutable table (currently `tenantId` doubles as `propertyId` in Phase 1; Phase 2+ per-property databases per ADR-078 may change this) — would warrant a Phase 3+ additive-column ADR.
