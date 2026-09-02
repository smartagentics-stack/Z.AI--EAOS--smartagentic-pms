# ADR-077: Sync Failure Recovery — 6-Layer Defense (Idempotent Queue, Checkpoints, At-Least-Once, Conflict Backlog, Restate Retry, Circuit Breaker)

**ADR-ID:** ADR-077
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Stream 5 established the principle **"AI failure must never become PMS failure"** (per ADR-057 Failure Recovery & Degradation). Stream 7 extends this to sync: **"sync failure must never become PMS failure."** Phase B's gap assessment (B4) flagged sync failure recovery as one of the five gap reasons for Stream 7. The existing governance has no decision on: how sync failure recovers without blocking local PMS operation; how partial sync recovery works; how the conflict backlog is managed; how resumable sync works.

Stream 7 research (`/home/z/my-project/phase-c-stream7-offline-sync-report.md`, §14) surveyed the failure-recovery literature. Restate's error-handling pattern (`https://docs.restate.dev/ai/patterns/error-handling`): _"Restate will go through a limited set of retries with exponential backoff, after which the invocation will be paused. This gives you time to fix the issue, and then resume the invocation."_ OneUptime's idempotency-keys post (`https://oneuptime.com/blog/post/2026-07-21-deduplicate-idempotency-unique-constraint/view`): _"Use stable idempotency keys and PostgreSQL unique constraints to deduplicate concurrent message deliveries without race conditions."_ The Transactional Inbox Pattern (`https://dev.to/actor-dev/inbox-pattern-51af`, Nov 2025): _"The Inbox Pattern provides a mechanism for idempotent message consumption. The core idea is to treat your database as the primary, reliable log."_ Fivetran idempotence (`https://www.fivetran.com/blog/idempotence-failure-proofs-data-pipeline`): _"Idempotence means self-correction... recovery requires rolling back to some previous cursor, reintroducing some number of records to a destination."_ Luca Palmieri "An In-Depth Introduction To Idempotency" (`https://lpalmieri.com/posts/idempotency`, Mar 2022): _"Retries are a common recovery strategy, but they are only safe if the API is idempotent."_

The key insight (per Stream 7 §14.3) is that sync is **asynchronous and idempotent** — the local SQLite is the system of record; sync is a background process. If sync fails, the PMS keeps operating; sync recovers in the background. This is structurally different from synchronous distributed systems where failure blocks the calling operation. The Restate journal (per ADR-073 §4.8) is the durability layer for the `SyncRelayWorkflow`. Restate's pause-on-exhaustion behavior (per Stream 5 §10) gives operators time to inspect and decide — failed sync events don't crash the PMS; they pause and surface for human attention.

Stream 7 §14.2 specifies a **6-layer sync failure recovery** model. Each layer covers a distinct failure mode. The layers are defense-in-depth: a failure that escapes one layer is caught by the next. The layers are: (1) idempotent upload queue; (2) resumable checkpoints; (3) at-least-once delivery with idempotent consumers; (4) conflict backlog; (5) Restate retry/backoff; (6) circuit breaker on hub. The 6-layer model parallels Stream 6's 6-layer runaway-prevention model (per ADR-067) — the two patterns share Restate's pause-on-exhaustion behavior and the "never block live operation" principle.

This ADR formalizes: (1) the 6-layer model; (2) the resumable sync protocol; (3) conflict backlog management; (4) partial sync recovery (delta + snapshot fallback); (5) the relationship to Stream 5's failure-recovery principle. The 6-layer model is implemented in Phase 1 (idle in STANDALONE mode) and exercised in Phase 2+ sync activation. PoC-01 (per ADR-071) validates Layer 6 (hub failover); PoC-02 (per ADR-071) validates Layer 4 (conflict backlog).

## 2. Problem

Should SmartAgentics adopt at-most-once delivery (would lose events on failure), exactly-once delivery (impractical without distributed consensus), block live sync on conflict (would block the entire PMS for one conflict), manual retry only (operator burden), or a 6-layer defense-in-depth model with at-least-once + idempotent consumers + conflict backlog + Restate retry + circuit breaker?

## 3. Options

### Option A: At-most-once delivery (each event delivered at most once; no retry)

Rejected. Would lose events on failure. A network partition mid-delivery loses the event permanently. Violates "sync failure must never become PMS failure" (sync failure would lose data).

### Option B: Exactly-once delivery (each event delivered exactly once)

Rejected as impractical. True exactly-once is impossible without distributed consensus (per Stream 7 §14.5; matches PowerSync, Replicache, Turso industry consensus). At-least-once + idempotent consumers is the industry-standard equivalent — simpler, equally reliable, no distributed-consensus overhead.

### Option C: Block live sync on conflict (the entire sync queue blocks until the conflict is resolved)

Rejected. Would block the entire PMS for one conflict. A single Tier 3 (manual resolution, per ADR-074) conflict would block all subsequent sync events until a human resolves it. Violates "sync failure must never become PMS failure" (a single conflict would block sync indefinitely). Conflicts must queue; live sync continues for other records (Layer 4 conflict backlog).

### Option D: Manual retry only (operator manually retries failed sync events)

Rejected. Operator burden; violates "sync failure must never become PMS failure" (operator must notice and act). Automated retry with pause-on-exhaustion (Layer 5 Restate retry/backoff) is the correct pattern — operators are notified only when retry is exhausted, not on every transient failure.

### Option E: 6-layer defense-in-depth model with at-least-once + idempotent consumers + conflict backlog + Restate retry + circuit breaker

Adopted. Six layers, each covering a distinct failure mode. Defense-in-depth: a failure that escapes one layer is caught by the next. The 6-layer model parallels Stream 6's 6-layer runaway-prevention model (per ADR-067). Sync is asynchronous and idempotent — the local SQLite is the system of record; sync failure does not block PMS operations.

## 4. Decision

Adopt **Option E** — 6-layer sync failure recovery model.

### The 6 layers

| Layer                                                   | Mechanism                                                                                                                             | Failure Mode Covered                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **1. Idempotent upload queue**                          | `SyncOutbox` table + `@@unique([tenantId, idempotencyKey, revision])` dedup on consumer                                               | Duplicate delivery (retries) — consumer dedups via unique constraint    |
| **2. Resumable checkpoints**                            | `SyncCheckpoint` table tracks last ACK'd LSN per client                                                                               | Sync interrupted mid-batch — resume from last ACK, not from scratch     |
| **3. At-least-once delivery with idempotent consumers** | `SyncRelayWorkflow` retries with exponential backoff (Restate); consumer dedups via `SyncInbox` (Phase 2+)                            | Network partition, hub restart, transient failure                       |
| **4. Conflict backlog**                                 | `SyncConflict` table queues unresolvable conflicts for manual resolution (per ADR-074 Tier 3)                                         | Conflict that can't be auto-resolved — never blocks live sync           |
| **5. Restate retry/backoff**                            | Restate's built-in retry with exponential backoff + pause-on-exhaustion                                                               | Persistent failure — pause + operator intervention                      |
| **6. Circuit breaker on hub**                           | Hub monitors sync health; failed hub → spokes continue on local SQLite (Phase 2+ local-replica mode); reconnect syncs on hub recovery | Hub failure — spokes operate autonomously; sync resumes on hub recovery |

### Layer 1 — Idempotent upload queue

The `SyncOutbox` table (per ADR-072) is the idempotent upload queue. Every business-data-change Prisma transaction writes a `SyncOutbox` row in the same transaction (per ADR-073 §4.2). The consumer (hub in Phase 2; cloud PostgreSQL in Phase 2+) dedups via `@@unique([tenantId, idempotencyKey, revision])` constraint. If the relay delivers the same event twice (e.g., crash after publish, before ACK), the consumer's second apply is a no-op (the unique constraint rejects the duplicate insert; the consumer catches the constraint violation and ACKs).

### Layer 2 — Resumable checkpoints

The `SyncCheckpoint` table (per ADR-072) tracks the last ACK'd log-sequence-number (LSN) per client (spoke/hub identifier). One row per `(tenantId, clientId)` via `@@unique([tenantId, clientId])`. On sync interruption (spoke crashes mid-batch, network partition mid-pull), the spoke resumes from the last ACK'd LSN — events may be re-delivered (Layer 1 idempotent consumer handles dedup). The `status` field (`active | stale | error`) tracks checkpoint health; a checkpoint older than 24 hours is marked `stale`; a checkpoint that has errored is marked `error` and surfaced in the dashboard.

This matches the Nango Checkpoints pattern (`https://nango.dev/docs/guides/functions/syncs/checkpoints`): _"If a sync fails mid-execution, the next run resumes from the last checkpoint instead of restarting from scratch."_ and the Airbyte Resumability pattern (`https://docs.airbyte.com/platform/understanding-airbyte/resumability`): _"'Resumable' in this context means that if something goes wrong in the first attempt of your sync, we will immediately try again with a subsequent attempt."_

### Layer 3 — At-least-once delivery with idempotent consumers

The `SyncRelayWorkflow` (per ADR-073 §4.3) is a Restate workflow that reads `SyncOutbox` and delivers to the transport. Delivery semantics: **at-least-once** (the relay may deliver the same event more than once — e.g., crash after publish, before ACK; on restart, the relay re-delivers). True exactly-once is impossible without distributed consensus (per §3 Option B rejection). At-least-once + idempotent consumers is the industry-standard equivalent.

**Idempotent consumers**:

- Phase 2 (LAN_SYNCED): the hub dedups via `@@unique([tenantId, idempotencyKey, revision])` on the hub's local SQLite.
- Phase 2+ (CLOUD_SYNCED): the cloud PostgreSQL dedups via `@@unique([tenantId, idempotencyKey, revision])` AND the property's `SyncInbox` table (per ADR-073 §4.9) dedups incoming cloud→property events via `@@unique([tenantId, eventId])`.

This matches the Transactional Inbox Pattern (`https://dev.to/actor-dev/inbox-pattern-51af`): _"The Inbox Pattern provides a mechanism for idempotent message consumption. The core idea is to treat your database as the primary, reliable log."_ and the Burning Monk: _"An idempotency key protects one business operation. Whereas the Inbox pattern protects message processing."_

### Layer 4 — Conflict backlog

Conflicts that can't be auto-resolved (Tier 3 per ADR-074) are written to the `SyncConflict` table (per ADR-072) with `resolutionStrategy=null` (pending manual). **Live sync continues for other records — the conflict does NOT block the queue.** This is the critical safety property: a single conflict does not block sync for the entire tenant.

**Conflict backlog management** (per ADR-074 §4 Tier 3):

- A dashboard widget shows unresolved conflict count; alert if > 10 unresolved.
- A Restate scheduled workflow nags the on-call manager via in-app notification + email if backlog grows.
- Conflicts older than 7 days escalate to a senior manager.
- PoC-02 Scenario H (per ADR-071) validates: 100 unresolvable conflicts queued; dashboard widget shows count; nag workflow fires; 7-day escalation fires.

### Layer 5 — Restate retry/backoff

The `SyncRelayWorkflow` is a Restate workflow (per ADR-007). Restate's built-in retry with exponential backoff + pause-on-exhaustion (per Stream 5 §10) handles transient delivery failures. Restate journals every workflow step + every service call; on crash, Restate replays the incomplete workflow from the last journaled step. On retry exhaustion, Restate pauses the invocation (per `https://docs.restate.dev/ai/patterns/error-handling`: _"Restate will go through a limited set of retries with exponential backoff, after which the invocation will be paused. This gives you time to fix the issue, and then resume the invocation."_). The pause surfaces the failure for operator attention without crashing the PMS.

This matches Luca Palmieri's principle (`https://lpalmieri.com/posts/idempotency`): _"Retries are a common recovery strategy, but they are only safe if the API is idempotent."_ Layer 1 (idempotent upload queue) makes the retries safe.

### Layer 6 — Circuit breaker on hub

The hub monitors sync health (per ADR-075). If the hub is down (or the cloud PostgreSQL is down for Phase 2+ CLOUD_SYNCED), the circuit breaker trips:

- **Phase 2 LAN_SYNCED (proxy-only spokes)**: spokes switch to read-only mode (no local SQLite; cannot write without the hub). Operators are alerted. Sync resumes on hub recovery.
- **Phase 2+ LAN_SYNCED (local-replica spokes)**: spokes continue operating on local SQLite replicas (read-write). The `SyncOutbox` accumulates offline events. On hub recovery, spokes push their offline `SyncOutbox` events to the recovered hub; hub reconciles via the conflict-resolution policy (per ADR-074).
- **Phase 2+ CLOUD_SYNCED**: property continues operating on local SQLite (the system of record). The `SyncOutbox` accumulates offline events. On cloud recovery, the `SyncRelayWorkflow` resumes delivery. Cloud is a secondary replica; cloud failure does not block PMS operations.

**Circuit breaker hysteresis** (per Stream 7 §14.7):

- Trip: N consecutive failures (default 5) before tripping.
- Reset: N consecutive successes (default 5) to reset.
- This prevents false positives (a brief hub unavailability does not trip the breaker) and false negatives (the breaker does not reset on a single success after a sustained outage).

### Resumable sync protocol

1. Spoke fetches from hub: `GET /sync/pull?since=<last_lsn>&batch_size=100` (per ADR-075 §4 `SyncHubService` API).
2. Hub returns events with `lsn > last_lsn` up to `batch_size`.
3. Spoke applies events to local SQLite (idempotently — dedup via `(tenantId, idempotencyKey, revision)`).
4. Spoke ACKs: `POST /sync/ack { last_lsn: <new_last_lsn> }`.
5. Hub updates `SyncCheckpoint.lastCheckpointLsn` for that spoke.
6. If spoke crashes mid-batch, on restart it fetches from `since=<last_acked_lsn>` — events may be re-delivered (Layer 1 idempotent consumer handles dedup).

### Partial sync recovery

If sync fails mid-batch, the spoke retries from the last ACK'd checkpoint (Layer 2; not from scratch). If the delta is too large (e.g., spoke offline > 7 days), the spoke falls back to snapshot + delta:

1. Hub creates a snapshot of the spoke's data slice (filtered by `SyncFilter` per ADR-070 §4 partial sync).
2. Spoke downloads snapshot, replaces local data.
3. Spoke fetches delta from snapshot's LSN onward.
   If the snapshot is too large (> 1 GB), the spoke prompts the operator to do a manual USB-stick restore from the hub (rare edge case).

### Phase 1 trivially-correct behavior

Phase 1 ships with the 6-layer model implemented but idle (STANDALONE mode):

- Layer 1: `SyncOutbox` table created; Prisma middleware auto-writes rows; rows accumulate and are purged after 30 days (per ADR-072 R-7.10).
- Layer 2: `SyncCheckpoint` table created; no checkpoints written (no sync active).
- Layer 3: `SyncRelayWorkflow` Restate workflow implemented; idle (no transport configured).
- Layer 4: `SyncConflict` table created; no conflicts (no sync active).
- Layer 5: Restate retry/backoff active for the idle `SyncRelayWorkflow` (no events to retry).
- Layer 6: Circuit breaker contract in place; not exercised (no hub in STANDALONE mode).

PoC-01 (per ADR-071) validates Layer 6 (hub failover with zero data loss). PoC-02 (per ADR-071) validates Layer 4 (conflict backlog management). Phase 2+ sync activation exercises all 6 layers.

## 5. Rationale

- **Stream 5 principle extended**: "AI failure must never become PMS failure" → "sync failure must never become PMS failure". The 6-layer model is the empirical realization: sync is asynchronous and idempotent; the local SQLite is the system of record; sync failure does not block PMS operations.
- **Defense-in-depth is the correct pattern for failure recovery**: each layer covers a distinct failure mode; a failure that escapes one layer is caught by the next. The 6-layer model parallels Stream 6's 6-layer runaway-prevention model (per ADR-067) — the two patterns share Restate's pause-on-exhaustion behavior and the "never block live operation" principle.
- **At-least-once + idempotent consumers is the industry-standard equivalent of exactly-once**: true exactly-once is impossible without distributed consensus (per PowerSync, Replicache, Turso industry consensus). At-least-once + idempotent consumers is simpler and equally reliable.
- **Conflict backlog never blocks live sync (Layer 4)**: this is the critical safety property. A single Tier 3 conflict does not block sync for the entire tenant. Conflicts queue; live sync continues for other records. Dashboard widget + nag workflow + 7-day escalation ensure the backlog does not grow unbounded.
- **Restate pause-on-exhaustion (Layer 5)** gives operators time to inspect and decide — failed sync events don't crash the PMS; they pause and surface for human attention. This matches Restate's documented behavior.
- **Circuit breaker on hub (Layer 6) with hysteresis**: prevents false positives (brief hub unavailability does not trip) and false negatives (sustained outage does not reset on a single success). Phase 2+ local-replica mode spokes continue operating on local SQLite during hub outage — true local-first at every terminal.
- **Resumable sync protocol (Layer 2)**: resume from last ACK'd LSN, not from scratch. Matches Nango Checkpoints and Airbyte Resumability patterns.
- **Partial sync recovery (snapshot + delta fallback)**: handles the rare case where the spoke is offline > 7 days and the delta is too large. Manual USB-stick restore is the last-resort fallback for > 1 GB snapshots.
- **Phase 1 ships the 6-layer model implemented but idle**: forward-compatible; Phase 2+ sync activation exercises all 6 layers without schema migration or code rewrite. PoC-01 and PoC-02 validate Layers 6 and 4 respectively during Phase E engineering.
- **Rejected alternatives are explicitly deferred**: at-most-once (loses events), exactly-once (impractical), block-on-conflict (blocks PMS), manual-retry-only (operator burden) — each is rejected with a clear reason.

## 6. Consequences

- Phase 1 ships with the 6-layer model implemented but idle (STANDALONE mode). The `SyncRelayWorkflow` Restate workflow is implemented; the `SyncOutbox` / `SyncCheckpoint` / `SyncConflict` tables are created (per ADR-072); the Prisma middleware auto-writes `SyncOutbox` rows (per ADR-073).
- Phase 2+ sync activation exercises all 6 layers. The `SyncHubService` (per ADR-075) implements the resumable sync protocol (`/sync/pull`, `/sync/ack`).
- Phase 2+ adds the dashboard widget for sync health + conflict backlog (UI feature). The Restate scheduled nag workflow for conflict backlog (Layer 4) is a Phase 2+ Restate service.
- **R-7.33 risk (`SyncOutbox` grows unbounded if delivery persistently fails)**: mitigated by the relay being a Restate workflow (durable; survives crashes); alert if `SyncOutbox` > 10,000 rows; rows deleted after ACK + 7-day grace (Phase 2+ sync modes) or 30 days (Phase 1 STANDALONE).
- **R-7.34 risk (`SyncConflict` backlog grows if staff ignore conflicts)**: mitigated by dashboard widget; nag workflow; 7-day escalation to senior manager; PoC-02 Scenario H validates.
- **R-7.35 risk (circuit breaker false positives — hub briefly unavailable triggers circuit breaker; spokes switch to local-replica mode unnecessarily)**: mitigated by circuit breaker requiring N consecutive failures (default 5) before tripping; hysteresis on recovery (N consecutive successes to reset).
- **R-7.36 risk (snapshot + delta fallback is slow for large properties)**: mitigated by the fallback being rare (spoke offline > 7 days); manual USB-stick restore for > 1 GB snapshots; PoC-01 validates hub failover with zero data loss (the common case).
- **R-7.37 risk (Restate pause-on-exhaustion surfaces too many failures for operator attention)**: mitigated by Layer 1-4 handling the vast majority of failures transparently; only persistent failures (Layer 5 exhaustion) surface for operator attention; the dashboard aggregates failures by tenant + table for triage.
- **R-7.38 risk (Layer 6 circuit breaker in Phase 2 proxy-only spokes — spokes are read-only during hub outage)**: mitigated by Phase 2+ local-replica mode being the recommended deployment for properties that cannot tolerate read-only spokes during hub outage. Phase 2 proxy-only mode is the simpler deployment; Phase 2+ local-replica mode is the resilient deployment.
- Dependencies: ADR-007 (Restate — for `SyncRelayWorkflow` durability + retry + pause-on-exhaustion), ADR-057 (Stream 5 Failure Recovery & Degradation — the principle this ADR extends), ADR-067 (Stream 6 Runaway Prevention — the parallel 6-layer model), ADR-070 (umbrella architecture), ADR-071 (PoC-01 validates Layer 6; PoC-02 validates Layer 4), ADR-072 (sync metadata schema — `SyncOutbox` / `SyncCheckpoint` / `SyncConflict` tables), ADR-073 (transactional outbox — `SyncRelayWorkflow` + `SyncInbox`), ADR-074 (conflict resolution — Tier 3 backlog), ADR-075 (LAN operation topology — `SyncHubService` + hub failover), ADR-076 (cloud sync boundary — Layer 6 circuit breaker on cloud), ADR-079 (SyncEngine SDK — `SyncSession` retry semantics). **No new runtime dependencies** (Restate + Prisma + SQLite already in stack).
- Phase 3+ AI-BOS extension: AI-BOS multi-agent failure recovery (Stream 6 §10 — 6-layer runaway prevention) parallels this 6-layer sync failure recovery. The two patterns share Restate's pause-on-exhaustion behavior and the "never block live operation" principle. Phase 3+ AI-BOS observability (Stream 8) correlates sync failure events with AI failure events for end-to-end failure analysis.

## 7. Review Conditions

- Review if Phase 2+ PoC-01 (per ADR-071) reveals Layer 6 hub-failover data loss — would trigger ADR-075 + ADR-077 revision (alternative failover protocol or earlier adoption of Phase 2+ local-replica mode as the Phase 2 default).
- Review if Phase 2+ PoC-02 reveals Layer 4 conflict-backlog growth faster than expected — would trigger ADR-074 revision (additional Tier 1/2 auto-resolution to reduce Tier 3 load) or ADR-077 revision (escalation thresholds).
- Review if Phase 2+ operator feedback indicates Restate pause-on-exhaustion surfaces too many failures (Layer 5 operator fatigue) — would warrant tuning the retry/backoff parameters or adding failure-aggregation logic.
- Review if Phase 2+ circuit breaker false positives prove disruptive (Layer 6) — would warrant tuning the N-consecutive-failures threshold or adding smarter failure detection (e.g., distinguishing hub-down from hub-slow).
- Review if Phase 3+ multi-property scale demands a 7th layer (e.g., cross-property sync failure recovery) — would warrant a Phase 3+ ADR extending the 6-layer model.
- Review if a community sync-failure-recovery standard emerges (e.g., a standardized circuit-breaker pattern from the SQLite sync ecosystem) that should replace the SmartAgentics-owned 6-layer model.
- Review if Phase 2+ `SyncOutbox` growth proves unmanageable despite the 30-day purge (Layer 1) — would warrant an earlier purge interval or a different forward-compatibility strategy.
- Review if Phase 2+ partial sync recovery (snapshot + delta fallback) is invoked more frequently than expected — would indicate a deeper issue (e.g., spokes frequently offline > 7 days) warranting investigation.
- Review if Phase 3+ AI-BOS multi-agent failure recovery (Stream 6 §10) and this 6-layer sync failure recovery should be unified into a single failure-recovery model — would warrant a Phase 3+ unified-failure-recovery ADR.
- Review if Phase 2+ operator feedback indicates the dashboard widget for sync health + conflict backlog is insufficient (e.g., needs more granular metrics) — would warrant extending the dashboard.
