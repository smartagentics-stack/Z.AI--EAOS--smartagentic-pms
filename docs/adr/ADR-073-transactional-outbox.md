# ADR-073: Transactional Outbox — `SyncOutbox` Table + Restate `SyncRelayWorkflow` (At-Least-Once + Idempotent Consumers)

**ADR-ID:** ADR-073
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR-008 (Event-driven architecture) is a stub. It declares SmartAgentics event-driven but defines no outbox table, no relay mechanism, no ordering guarantee, no idempotent-consumer pattern. Stream 7 Foundational Conflict **FC-7.5** (NEW) flags this gap: the canonical event-driven pattern (transactional outbox) is not formalized in SmartAgentics governance. The EAOS Data Architecture (`/home/z/my-project/download/EAOS-Data-Architecture.md`) includes an `event_outbox` table in its canonical schema — confirming the pattern is already adopted at the EAOS layer — but SmartAgentics has not adopted it.

Stream 7 research (`/home/z/my-project/phase-c-stream7-offline-sync-report.md`, §15–§19) surveyed the transactional outbox pattern in depth. microservices.io's "Pattern: Transactional outbox" (`https://microservices.io/patterns/data/transactional-outbox.html`, Chris Richardson, read in full) defines the problem precisely: _"A service command typically needs to create/update/delete aggregates in the database and send messages/events to a message broker... The command must atomically update the database and send messages in order to avoid data inconsistencies and bugs. However, it is not viable to use a traditional distributed transaction (2PC) that spans the database and the message broker."_ The solution: _"The service that sends the message [first stores] the message in the database as part of the transaction that updates the business entities. A separate process then sends the messages to the message broker."_ The pattern's known issue: _"The Message relay might publish a message more than once... a message consumer must be idempotent."_

For SQLite specifically, the outbox pattern is particularly clean (per Stream 7 §15.3): the outbox table is in the **same single file** as the business data, so the transaction is a true ACID transaction (no 2PC needed). This is a significant advantage of SQLite over a separate message broker — the dual-write problem is solved by the database itself.

Stream 7 §16 (Selective Event Sourcing) clarified the relationship between the outbox and event sourcing: full event sourcing is rejected (SmartAgentics is CRUD + selective event sourcing for financial aggregates); the `SyncOutbox` is a **transient** queue (events deleted after delivery ACK + grace period), not a permanent event log. The permanent event log for financial aggregates (`FinancialEvent` table, 7-year retention per ADR-013) is a Phase 2+ addition; the two tables are distinct — `SyncOutbox` is transient transport; `FinancialEvent` is permanent audit + recomputation.

Stream 7 §17 (CDC) clarified the CDC strategy: outbox pattern (not trigger-based, not log-tailing) for Phase 1–2. The `SyncOutbox` IS the CDC stream — every business-data-change is captured in the outbox in the same transaction. Trigger-based CDC is rejected (triggers fire outside the application's control; can't be conditional on tenant/sync-mode). Transaction log tailing via SQLite session extension is reserved for Phase 3+ optimization.

Stream 7 §18 (Inbox) clarified the consumer-side counterpart: `SyncInbox` table for incoming sync events (Phase 2+ cloud→property sync). Producer-side outbox + consumer-side inbox = reliable messaging (per the Burning Monk's "Inbox & Outbox patterns for reliable event processing").

Stream 7 §19 (Restate Journal as Outbox) clarified the relationship between Restate journal and `SyncOutbox`: complementary, not redundant. Restate journals **workflow execution** (crash recovery, AI agent decision audit, multi-agent delegation chain); `SyncOutbox` journals **business data changes** (sync propagation, conflict resolution). The two are distinct logs serving distinct purposes. The `SyncRelayWorkflow` is itself a Restate workflow; its steps are journaled in Restate (crash recovery); the events it delivers come from `SyncOutbox`. The Restate invocation ID is recorded in `SyncOutbox.restateInvocationId` for correlation.

This ADR formalizes: (1) the `SyncOutbox` table (schema in ADR-072); (2) the `SyncRelayWorkflow` Restate workflow as the Message relay; (3) the at-least-once + idempotent-consumer delivery semantics; (4) the ordering guarantee; (5) selective event sourcing for financial aggregates; (6) the CDC mechanism (outbox, not triggers); (7) the inbox pattern (Phase 2+); (8) the Restate journal integration. ADR-008 amendment (separately performed by the Phase D architect) formalizes the transactional outbox pattern as the mechanism for emitting sync events from business-data-change transactions.

## 2. Problem

Should SmartAgentics (a) use publish-then-commit or commit-then-publish (dual-write; phantom events or lost events), (b) use 2PC (two-phase commit; not viable; SQLite doesn't support 2PC), (c) use trigger-based CDC (fires outside application control; can't be conditional on tenant/sync-mode), (d) use full event sourcing (complete rewrite; loses Prisma CRUD simplicity), or (e) adopt the transactional outbox pattern with a Restate `SyncRelayWorkflow` relay and idempotent consumers?

## 3. Options

### Option A: Publish-then-commit (publish sync event, then commit DB transaction)

Rejected. If the publish succeeds but the commit fails, you have a phantom event (consumer applies a change that was rolled back). The dual-write problem (per microservices.io) is not solved.

### Option B: Commit-then-publish (commit DB transaction, then publish sync event)

Rejected. If the commit succeeds but the publish fails, you have a lost event (consumer never learns about the committed change). The dual-write problem is not solved.

### Option C: 2PC (two-phase commit) spanning SQLite and the message broker

Rejected. Not viable. SQLite does not support 2PC. Even if it did, 2PC couples the DB to the message broker (per microservices.io: "2PC is not an option"). Phase 1 has no message broker anyway (STANDALONE mode); the outbox is in-DB.

### Option D: Trigger-based CDC (SQLite `AFTER INSERT/UPDATE/DELETE` triggers writing to an events table)

Rejected. (1) Triggers fire outside the application's control — harder to reason about. (2) Triggers can't be conditional on tenant/sync-mode (every mutation triggers, even in STANDALONE mode where sync is off — would generate useless events). (3) The outbox pattern (application-layer writes the outbox row in the same transaction via Prisma middleware) is cleaner and more controllable. (4) Trigger-based CDC requires writing triggers for every mutable table; the Prisma middleware approach is table-agnostic.

### Option E: Full event sourcing (every state change is an immutable event; current state is a projection of the event log)

Rejected as the primary data model. SmartAgentics uses Prisma + SQLite for CRUD; full event sourcing would require a complete rewrite. Selective event sourcing for financial aggregates only (per §4 below) is the right balance: CRUD for most tables; event sourcing for the financial aggregates that need recomputation for Tier 2 conflict resolution (per ADR-074).

### Option F: Transactional outbox pattern + Restate `SyncRelayWorkflow` relay + idempotent consumers

Adopted. Every business-data-change Prisma transaction writes a `SyncOutbox` row in the same transaction. The `SyncRelayWorkflow` Restate workflow reads `SyncOutbox` and delivers to the transport (hub HTTP API in Phase 2; cloud PostgreSQL in Phase 2+) with at-least-once semantics + Restate retry/backoff. Consumers dedup via `@@unique([tenantId, idempotencyKey, revision])`. Ordering guarantee: per-tenant, by `createdAt`. Selective event sourcing for financial aggregates (Phase 2+). CDC = outbox (not triggers, not log-tailing for Phase 1–2). Inbox pattern for incoming cloud→property sync (Phase 2+). Restate journal and `SyncOutbox` are complementary.

## 4. Decision

Adopt **Option F** — transactional outbox + Restate `SyncRelayWorkflow` + idempotent consumers.

### §4.1 — `SyncOutbox` table (schema in ADR-072)

The `SyncOutbox` table is the transactional outbox. Its schema is defined in ADR-072 (additive columns + 3 new tables). Key fields: `id`, `tenantId`, `tableName`, `recordId`, `operation` (insert/update/delete), `payloadJson` (full snapshot for insert/delete; delta for update), `hlc` (Hybrid Logical Clock timestamp), `syncOrigin`, `restateInvocationId`, `createdAt`, `deliveredAt`, `deliveryAttempts`, `lastError`. Indexes: `@@index([tenantId, deliveredAt, createdAt])` (for the polling relay); `@@index([tenantId, tableName, recordId])` (for conflict lookup).

### §4.2 — Every business-data-change Prisma transaction writes `SyncOutbox` rows in the same transaction

Example (creating a reservation):

```typescript
await prisma.$transaction(async (tx) => {
  const reservation = await tx.reservation.create({ data: { ... } });
  await tx.room.update({ where: { id: roomId }, data: { status: 'occupied' } });
  await tx.auditEvent.create({ data: { ... } });
  await tx.syncOutbox.create({
    data: {
      tenantId,
      tableName: 'Reservation',
      recordId: reservation.id,
      operation: 'insert',
      payloadJson: JSON.stringify(reservation),
      hlc: hlcNow(),
      syncOrigin: clientId,
    }
  });
  // Additional SyncOutbox rows for Room, AuditEvent, etc.
});
```

**Prisma middleware auto-writes `SyncOutbox` rows** on sync-replicated model mutations — the developer does not have to remember. This is the Inversion-of-Control pattern (per Stream 7 §15.7): the framework writes the outbox, not the developer. The middleware intercepts `create`, `update`, `upsert`, `delete` (soft-delete per ADR-072), `updateMany`, `deleteMany` (soft-delete) on sync-replicated models and writes the corresponding `SyncOutbox` row(s) in the same transaction.

### §4.3 — Restate `SyncRelayWorkflow` is the Message relay

Two relay implementations supported (per microservices.io's "two patterns for implementing the Message relay"):

- **Polling publisher** (Phase 1–2 default; simpler): `SyncRelayWorkflow` polls `SyncOutbox WHERE deliveredAt IS NULL ORDER BY createdAt` every 5 seconds (configurable). For each row, deliver to transport; on success, set `deliveredAt = now()`. Restate journals progress (crash recovery). In Phase 1 STANDALONE mode, the relay is idle (no transport configured); `SyncOutbox` rows accumulate and are purged after 30 days (per ADR-072 R-7.10).
- **Transaction log tailing** (Phase 3+ optimization; for high-throughput): use SQLite's session extension to capture changes without polling. Higher complexity; defer to Phase 3+. Triggered if `SyncOutbox` polling becomes a bottleneck (very high write rate).

The `SyncRelayWorkflow` is a Restate workflow (per ADR-007). Restate's built-in retry with exponential backoff + pause-on-exhaustion (per Stream 5 §10) handles transient delivery failures. The Restate invocation ID is recorded in `SyncOutbox.restateInvocationId` for correlation (per §4.8 below).

### §4.4 — At-least-once delivery with idempotent consumers

Delivery semantics: **at-least-once** (the relay may deliver the same event more than once — e.g., crash after publish, before ACK; on restart, the relay re-delivers). True exactly-once is impossible without distributed consensus (per Stream 7 §14.5; matches PowerSync, Replicache, Turso industry consensus). At-least-once + idempotent consumers is the industry-standard equivalent.

**Idempotent consumers**: the consumer (hub in Phase 2; cloud PostgreSQL in Phase 2+) dedups via `@@unique([tenantId, idempotencyKey, revision])` constraint. If the relay delivers the same event twice (same `idempotencyKey` + `revision`), the consumer's second apply is a no-op (the unique constraint rejects the duplicate insert; the consumer catches the constraint violation and ACKs). This matches the microservices.io pattern's "Issues" note: _"a message consumer must be idempotent."_

### §4.5 — Ordering guarantee

Within a single tenant, events are delivered in `createdAt` order (the relay sorts by `createdAt`). Cross-tenant ordering is not guaranteed (and not needed — tenants are independent). Within a single Prisma transaction, multiple `SyncOutbox` rows share the same `createdAt` (transaction timestamp); their relative order is preserved by the `id` (cuid, monotonic).

### §4.6 — Selective event sourcing for financial aggregates (Phase 2+)

Full event sourcing is rejected (per §3 Option E). Selective event sourcing for financial aggregates only:

- The `Invoice`, `Payment`, `FolioBalance`, `Refund` tables have their state changes also written as immutable events in a `FinancialEvent` table (new, additive; Phase 2+ implementation; minimal synthetic version used in PoC-02 per ADR-071).
- The current state (e.g., folio balance) is recomputed from the event log on demand (Tier 2 conflict resolution per ADR-074 §4).
- The `FinancialEvent` table is a **permanent** event log (7-year retention per ADR-013 audit requirements); `SyncOutbox` is **transient** (deleted after delivery ACK + 7-day grace). The two are distinct.
- This is essentially the `WorkflowStepExecution` pattern already in place — each workflow step's result is an immutable event; the workflow's current state is a projection. The `FinancialEvent` table extends this pattern to financial aggregates.

### §4.7 — CDC mechanism: outbox pattern (NOT triggers, NOT log-tailing for Phase 1–2)

- **Phase 1–2**: `SyncOutbox` is the CDC stream. Every business-data-change Prisma transaction writes `SyncOutbox` rows in the same transaction. The `SyncRelayWorkflow` reads `SyncOutbox` and delivers to transport. No SQLite triggers needed; no log-tailing needed.
- **Phase 3+ optimization (transaction log tailing)**: if `SyncOutbox` polling becomes a bottleneck, switch to SQLite session-extension-based CDC. SQLite's session extension records changeset deltas that can be consumed by an external process. Higher complexity; defer to Phase 3+.
- **Trigger-based CDC is rejected** (per §3 Option D).
- **CDC via Debezium + Kafka is rejected for Phase 1–2** (per Stream 7 §16.5): adds Kafka + Kafka Connect + Debezium to the stack — heavy; conflicts with offline-first Windows installer. Phase 3+ may reconsider if cloud scale demands.

### §4.8 — Restate journal and `SyncOutbox` are complementary (NOT redundant)

- **Restate journal** (Stream 5): journals Restate workflow steps + service calls. Used for: crash recovery (replay incomplete workflows on restart); audit trail of AI agent decisions (Stream 5's `AIAuditEvent` correlation); multi-agent delegation chain (Stream 6's `MultiAgentTask` correlation).
- **`SyncOutbox`** (Stream 7): journals business-data-change events for sync propagation. Used for: sync to hub (Phase 2 LAN_SYNCED); sync to cloud (Phase 2+ CLOUD_SYNCED); conflict resolution (Tier 1/2/3 per ADR-074).
- **The two are distinct**: Restate journals _workflow execution_ (what did the workflow do?); `SyncOutbox` journals _business data changes_ (what changed in the database?). A single Restate workflow may produce many `SyncOutbox` events (e.g., a check-in workflow produces `SyncOutbox` events for `Reservation.update`, `Room.update`, `AuditEvent.create`, `FolioEntry.create`).
- **Integration**: the `SyncRelayWorkflow` is itself a Restate workflow. Its steps are journaled in Restate (crash recovery); the events it delivers come from `SyncOutbox` (business data changes). The Restate invocation ID is recorded in `SyncOutbox.restateInvocationId` for correlation (per Stream 6's 3-correlation-ID model: Restate invocation ID + W3C `traceparent` + application `correlationId`).

### §4.9 — Inbox pattern for incoming sync events (Phase 2+)

When the cloud pushes config changes (rate plans, room types) down to a property (Phase 2+ CLOUD_SYNCED), the property's SyncEngine receives the events and writes them to a `SyncInbox` table (new, additive; Phase 2+) in the same transaction as the application of the change. This ensures idempotent consumption — if the cloud re-delivers the same event (e.g., network retry), the property's SyncEngine detects the duplicate via `@@unique([tenantId, eventId])` and skips it.

`SyncInbox` schema (Phase 2+):

```prisma
model SyncInbox {
  id            String   @id @default(cuid())
  tenantId      String
  eventId       String   // cloud-assigned event ID
  tableName     String
  recordId      String
  operation     String
  payloadJson   String
  receivedAt    DateTime @default(now())
  appliedAt     DateTime?

  @@unique([tenantId, eventId])
  @@index([tenantId, appliedAt, receivedAt])
}
```

The SyncEngine consumer workflow: receive event → check `SyncInbox` for duplicate → if duplicate, ACK and skip → if new, apply to local SQLite + write `SyncInbox` row in same transaction → ACK. Producer-side outbox + consumer-side inbox = reliable messaging (per the Burning Monk's pattern).

### §4.10 — ADR-008 amendment (separately performed by the Phase D architect)

ADR-008 (Event-driven architecture) is amended to formalize the transactional outbox pattern as the mechanism for emitting sync events from business-data-change transactions. The amendment is separately performed by the Phase D architect; this ADR defines the mechanism that the amendment formalizes.

## 5. Rationale

- **FC-7.5 resolution**: ADR-008 is a stub with no outbox table. This ADR formalizes the transactional outbox pattern (per microservices.io) as the SmartAgentics sync-event publishing mechanism. The ADR-008 amendment (separately performed) formalizes it in ADR-008 itself.
- **microservices.io is the authoritative source**: Chris Richardson's pattern is the industry-standard solution to the dual-write problem. The pattern's "Issues" note (consumer must be idempotent) is addressed by `@@unique([tenantId, idempotencyKey, revision])` + `SyncInbox`.
- **SQLite's single-file property makes the outbox pattern particularly clean**: the outbox table is in the same single file as the business data, so the transaction is a true ACID transaction (no 2PC needed). This is a significant advantage of SQLite over a separate message broker.
- **At-least-once + idempotent consumers is the industry-standard equivalent of exactly-once**: true exactly-once is impossible without distributed consensus (per PowerSync, Replicache, Turso industry consensus). At-least-once + idempotent consumers is simpler and equally reliable.
- **Polling publisher is the Phase 1–2 default; transaction log tailing is the Phase 3+ optimization**: the polling publisher is simpler (no session-extension code; no external CDC tool); the log-tailing variant is reserved for high-throughput deployments where polling becomes a bottleneck. This matches microservices.io's "two patterns for implementing the Message relay".
- **Selective event sourcing for financial aggregates is the right balance**: full event sourcing is a complete rewrite (rejected); no event sourcing at all loses the recomputation capability for Tier 2 conflict resolution (rejected). Selective event sourcing for the 4 financial aggregates (`Invoice`, `Payment`, `FolioBalance`, `Refund`) provides the recomputation capability without the rewrite.
- **`SyncOutbox` is transient; `FinancialEvent` is permanent**: the two tables serve distinct purposes (transient transport vs. permanent audit + recomputation log). Confusing them is a common mistake; this ADR documents the distinction explicitly.
- **CDC = outbox pattern (not triggers, not log-tailing) for Phase 1–2**: the outbox pattern is database-agnostic, integrates cleanly with Prisma's `$transaction`, and is conditional on tenant/sync-mode (the middleware can skip `SyncOutbox` writes for non-replicated models). Triggers can't be conditional; log-tailing requires SQLite session-extension code that is awkward from Node.js.
- **Restate journal and `SyncOutbox` are complementary, not redundant**: a common mistake is to try to use Restate's journal as the sync event log — but Restate's journal is workflow-replay-oriented, not data-replication-oriented. `SyncOutbox` is the right abstraction for sync. The two logs serve distinct purposes.
- **Inbox pattern is the consumer-side counterpart**: producer-side outbox + consumer-side inbox = reliable messaging. The `SyncInbox` table ensures idempotent consumption of incoming cloud→property events (Phase 2+).
- **Prisma middleware auto-writes `SyncOutbox` rows**: the developer does not have to remember. This is the Inversion-of-Control pattern — the framework writes the outbox, not the developer. Eliminates the "developer forgets SyncOutbox row" risk.

## 6. Consequences

- New `SyncOutbox` table (additive; per ADR-072). Phase 1 ships with the table created; rows accumulate even in STANDALONE mode (purged after 30 days per ADR-072 R-7.10).
- New Restate workflow `SyncRelayWorkflow` (additive; doesn't affect existing workflows). Phase 1 ships with the workflow implemented but idle in STANDALONE mode.
- Prisma middleware extended to auto-write `SyncOutbox` rows on sync-replicated model mutations. The middleware is table-agnostic (intercepts all sync-replicated models); the developer does not have to remember.
- ADR-008 amendment (separately performed by the Phase D architect) formalizes the pattern.
- Phase 2+ adds `SyncInbox` table (incoming cloud→property sync) + `FinancialEvent` table (selective event sourcing for financial aggregates). Both additive.
- **R-7.12 risk (`SyncOutbox` grows if relay is down)**: mitigated by the relay being a Restate workflow (durable; survives crashes); alert if `SyncOutbox` > 10,000 rows; rows deleted after ACK + 7-day grace (Phase 2+ sync modes) or 30 days (Phase 1 STANDALONE).
- **R-7.8 risk (developer forgets `SyncOutbox` row in a new transaction)**: mitigated by Prisma middleware auto-writing rows (Inversion of Control).
- **R-7.11 risk (payload size — large rows make `SyncOutbox` `payloadJson` large)**: mitigated by `SyncOutbox` storing a delta (changed fields only) for `update` operations; full snapshot for `insert`/`delete`. Phase 2+ optimization.
- **R-7.13 risk (polling overhead — polling every 5 seconds adds 1 query per poll)**: mitigated by index on `(tenantId, deliveredAt, createdAt)` making the poll fast (indexed range scan); for high-write deployments, switch to long-poll (the `SyncRelayWorkflow` blocks on a SQLite notification). Phase 3+ optimization.
- **R-7.14 risk (confusion about which log to query — Restate journal or `SyncOutbox`)**: mitigated by §4.8 documenting the distinction; developer training; verifier rule flags misuse (e.g., querying Restate journal for data changes).
- Dependencies: ADR-007 (Restate), ADR-008 (Event-driven; amended separately), ADR-012 (Canonical Domain Model — `SyncRecord` is the canonical envelope for sync events), ADR-070 (umbrella architecture), ADR-072 (sync metadata schema — `SyncOutbox` table definition), ADR-074 (conflict resolution — uses `SyncOutbox` events), ADR-077 (failure recovery — uses `SyncRelayWorkflow` retry + `SyncOutbox` growth alerts), ADR-079 (SyncEngine SDK — the `SyncTransport` interface abstracts the relay's delivery target). **No new runtime dependencies** (Restate + Prisma + SQLite already in stack).
- Phase 3+ AI-BOS extension: the outbox pattern extends to AI events (`AgentDecisionMade`, `ToolCalled` per Stream 5/6). The same `SyncOutbox` table can carry AI events to the cloud for chain-wide AI observability (Stream 8's concern). The transaction log tailing variant (Phase 3+ optimization) supports higher AI-event throughput.

## 7. Review Conditions

- Review if Phase 2+ `SyncOutbox` polling becomes a bottleneck (e.g., sync-lag > 60 s under high write rate) — would trigger earlier adoption of the transaction-log-tailing relay variant (Phase 3+ optimization).
- Review if Phase 2+ `FinancialEvent` table grows faster than expected (e.g., high-volume properties generate > 1M financial events/year) — would justify earlier cold-storage archival (per ADR-013 7-year retention).
- Review if Phase 2+ `SyncInbox` table grows unbounded (cloud re-delivers events faster than the property can apply them) — would justify an earlier purge interval or a different consumer-side dedup strategy.
- Review if Phase 2+ Tier 2 recomputation performance is insufficient (recomputing a folio balance from 1000 events is slower than reading a stored balance) — would justify caching the recomputed balance in the `FolioBalance` row (recompute only on conflict or audit).
- Review if Phase 3+ multi-tenant cloud scale demands Debezium + Kafka for CDC — would trigger a Phase 3+ ADR comparing the in-house `SyncRelayWorkflow` against Debezium + Kafka.
- Review if a community outbox-pattern standard emerges (e.g., a standardized `SyncOutbox` schema from the SQLite sync ecosystem) that should replace the SmartAgentics-owned schema.
- Review if Phase 2+ operator feedback indicates the Prisma middleware auto-writing `SyncOutbox` rows has performance overhead (e.g., every mutation now writes 2 rows instead of 1) — would justify optimizing the middleware (e.g., batching `SyncOutbox` writes within a transaction).
- Review if Phase 3+ AI-BOS observability (Stream 8) requires the `SyncOutbox` to carry AI events (`AgentDecisionMade`, `ToolCalled`) in addition to business-data-change events — would extend the `SyncOutbox.tableName` enum to include AI event types.
- Review if the Restate journal + `SyncOutbox` dual-log pattern proves confusing in practice (e.g., developers query the wrong log for data changes) — would warrant additional verifier rules or a unified query API.
