# ADR-074: Conflict Resolution Policy — LWW for Non-Financial; Semantic Override for Financial; Manual UI for Unresolvable

**ADR-ID:** ADR-074
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR-001 commits SmartAgentics to offline-first with SQLite as the local store and PostgreSQL as the future cloud sync target. ADR-001 does not define a conflict-resolution policy — what happens when two clients edit the same reservation, folio, or room concurrently. Phase B's gap assessment (B4) flagged this as one of the five gap reasons for Stream 7. Stream 7 Foundational Conflict **FC-7.1** (carry-forward) and the new gap reasons in §0.3 of the Stream 7 report all converge on the need for an explicit, deterministic, auditable conflict-resolution policy.

Stream 7 research (`/home/z/my-project/phase-c-stream7-offline-sync-report.md`, §5–§6) surveyed the established conflict-resolution literature. The CRDT-vs-server-authoritative debate has a clear winner for business-critical transactional data: PowerSync v1.0 made a deliberate decision **not** to use CRDTs, citing Figma's CTO ("Since Figma is centralized [our server is the central authority], we can simplify our system by removing this extra overhead"). Turso Sync's default is **Last-Push-Wins** at the row level, with a transform hook for custom conflict resolution; Turso explicitly notes "There is no built-in CRDT support". Replicache is server-authoritative. ElectricSQL reconciles via Postgres transaction id.

Last-Write-Wins (LWW) is the simplest deterministic strategy: the write with the latest timestamp wins; the losing write is discarded but logged. OneUptime's LWW guide (`https://oneuptime.com/blog/post/2026-01-30-last-write-wins/view`) notes that naive LWW with physical clocks is not monotonic — Hybrid Logical Clocks (HLC) fix this. HLC combines physical and logical time; used in CockroachDB and MongoDB (per Cracking Walnuts' vector-clocks post and Sergei Turukin's HLC post). Martin Fowler's "Hybrid Clock" pattern: "Use a combination of system timestamp and logical timestamp to have versions as date and time, which can be ordered."

Martin Fowler's "SemanticConflict" (`https://martinfowler.com/bliki/SemanticConflict.html`) defines the case LWW cannot handle: _"a situation where [two authors] make changes which can be safely merged on a textual level but cause the program to fail when run."_ For SmartAgentics, the canonical semantic conflict is a folio balance: two clients both post payments to the same folio; LWW-merging the "balance" field would produce an incorrect sum. The correct resolution is for the server to recompute the balance from the immutable event log (sum of charges − sum of payments) — never LWW-merge. This is **selective event sourcing for financial aggregates** (per ADR-073 §4.6).

Some conflicts cannot be auto-resolved at all — two clients edit the same field with no clear winner (e.g., both change `GuestProfile.preferredName` to different values within the same HLC tick). Ink & Switch's local-first essay notes: _"users surprisingly rarely encounter conflicts in their work when collaborating with others, and that generic resolution mechanisms work well"_ — but the rare unresolvable conflict must have a safety net. The safety net is a manual 3-way merge UI (base / ours / theirs, per VS Code's 3-way merge editor): the conflict is queued in `SyncConflict`; live sync continues for other records (the conflict does NOT block the queue, per ADR-077 §4 Layer 4); a human resolver (typically a manager) picks the winner; the resolution propagates back to both clients.

This ADR formalizes the **three-tier conflict-resolution policy**: Tier 1 (LWW by HLC-tagged revision) for non-financial fields; Tier 2 (semantic override — server recomputes from event log) for financial fields; Tier 3 (manual 3-way merge UI) for unresolvable conflicts. The per-table mapping, the HLC implementation, and the audit trail (`SyncConflict` table) are specified. This ADR is the data-conflict counterpart to ADR-064 (Stream 6's agent-recommendation conflict resolution); the two are distinct (ADR-064 arbitrates _agent recommendations_; this ADR resolves _sync data conflicts_).

## 2. Problem

Should SmartAgentics adopt pure LWW for all fields (risks corrupting folio balances), full event sourcing for all tables (complete rewrite; loses Prisma CRUD simplicity), CRDT auto-merge for all fields (overhead; wrong for transactional data), manual resolution for all conflicts (would overwhelm staff), or a three-tier policy (LWW default + semantic override for financials + manual UI for unresolvable)?

## 3. Options

### Option A: Pure LWW for all fields

Rejected. LWW-merging a folio balance would produce incorrect accounting. The folio balance is not a value to be "merged" — it is a function of the event log. Pure LWW is acceptable for non-financial fields (Tier 1) but wrong for financial fields (Tier 2 requires semantic override).

### Option B: Full event sourcing for all tables

Rejected. SmartAgentics uses Prisma + SQLite for CRUD; full event sourcing would require a complete rewrite. Loses Prisma CRUD simplicity. Selective event sourcing for the 4 financial aggregates only (per ADR-073 §4.6) is the right balance.

### Option C: CRDT auto-merge for all fields

Rejected. CRDTs pay a commutativity overhead tax that is correct for decentralized systems and fine-grained collaborative editing but wrong for centralized transactional business data. PowerSync, Turso Sync, Replicache, and ElectricSQL all converge on server-authoritative (not CRDT) for transactional data. CRDTs (Yjs) are reserved for the narrow collaborative-text surface (per ADR-070).

### Option D: Manual resolution for all conflicts

Rejected. Would overwhelm staff. Ink & Switch's caveat ("users surprisingly rarely encounter conflicts") means the 99% case can be auto-resolved; manual is for the 1% that cannot. Auto-resolve the 99%; manual for the 1%.

### Option E: Three-tier policy — LWW default + semantic override for financials + manual UI for unresolvable

Adopted. Tier 1 (LWW by HLC-tagged revision) for most non-financial mutable tables. Tier 2 (semantic override — server recomputes from event log) for financial fields and inventory fields with state-machine constraints. Tier 3 (manual 3-way merge UI) for unresolvable conflicts. The per-table mapping is declared. The HLC implementation is specified. Every conflict (Tier 1, 2, or 3) logs a `SyncConflict` row for audit (per ADR-072).

## 4. Decision

Adopt **Option E** — three-tier conflict-resolution policy with per-table mapping and HLC implementation.

### Tier 1 — LWW by HLC-tagged revision (default for non-financial mutable tables)

**Applies to**: most non-financial mutable tables — `Reservation` (non-financial fields), `Room`, `HousekeepingTask`, `GuestProfile`, `KnowledgeDocument`, `MemoryRecord`, and similar.

**Strategy**: the row with the higher `(updatedAt, revision, syncOrigin)` HLC tuple wins. The loser is discarded but logged in `SyncConflict` with `resolutionStrategy="lww"` for audit.

**Rationale**: simple, deterministic, sufficient for low-contention fields. Hotel PMS workloads rarely have true concurrent edits to the same row — the reservation is typically "owned" by one agent at a time during check-in/out. Physical clock skew across hotel machines is bounded (NTP sync; Windows Time Service); HLC adds logical-clock tiebreaking for the rare skew case. Every LWW resolution logs a `SyncConflict` row (even auto-resolved ones) so an auditor can reconstruct what happened.

### Tier 2 — Semantic override (server recomputes from event log; for financial fields)

**Applies to**: financial fields (`Invoice`, `Payment`, `FolioBalance`, `Refund`) and inventory fields with state-machine constraints (`Room.lockedUntil`, `Reservation.status` transitions).

**Strategy**: the server recomputes the field from the immutable event log; never LWW-merges. Examples:

- **Folio balance**: `FolioBalance.balance` = sum of posted charges − sum of payments. The server recomputes from the `FinancialEvent` log (per ADR-073 §4.6), ignoring any client-supplied "balance" value. This is selective event sourcing for the `FolioBalance` aggregate.
- **Reservation status transition**: the server enforces the transition-state machine (per ADR-012 canonical domain model). E.g., a transition from `CHECKED_IN` to `CANCELLED` is invalid; the server rejects it. The rejected transition is logged in `SyncConflict`.

**Rationale**: LWW-merging a folio balance would produce incorrect accounting. Server recomputation from the event log is the only correct approach. This is essentially **event sourcing for financial aggregates** — a selective application of event sourcing, not a wholesale event-sourcing migration (per ADR-073 §4.6).

**Recomputation functions** (declared per financial aggregate; verifier rule flags any financial model lacking a recomputation function):

- `recomputeFolioBalance(folioId)`: sum of `FinancialEvent.amount` where `eventType IN ('CHARGE', 'PAYMENT', 'REFUND')` and `folioId = ?`.
- `recomputeInvoiceTotal(invoiceId)`: sum of `InvoiceLine.amount` where `invoiceId = ?`.
- `recomputePaymentAllocations(paymentId)`: sum of `PaymentAllocation.amount` where `paymentId = ?`.
- `recomputeRefundTotal(originalPaymentId)`: sum of `Refund.amount` where `originalPaymentId = ?`.

### Tier 3 — Manual resolution (3-way merge UI; for unresolvable conflicts)

**Applies to**: unresolvable conflicts — Tier 1 produced a "both sides edited the same field with no clear winner" (e.g., same HLC tick) AND Tier 2 cannot recompute because the event log itself diverged (e.g., two spokes missed each other's events due to a network partition).

**Strategy**: a `SyncConflict` row is created with `resolutionStrategy=null` (pending manual). The 3-way merge UI (base / ours / theirs) is surfaced to a human resolver (typically a manager). The resolver's choice is propagated back to both clients within 5 seconds (per ADR-071 PoC-02 success criteria). The `SyncConflict` row is updated with `resolutionStrategy="manual"`, `resolverUserId`, `resolutionJson`.

**Rationale**: some conflicts require human judgment. Queue them; never block live PMS operation (per ADR-077 §4 Layer 4 — conflict backlog never blocks live sync). Ink & Switch's caveat ("users surprisingly rarely encounter conflicts") means Tier 3 is rare in practice but must exist for the cases that cannot be auto-resolved.

**Backlog management** (per ADR-077 §4 Layer 4):

- Conflicts that can't be auto-resolved are written to `SyncConflict` with `resolutionStrategy=null`.
- Live sync continues for other records — the conflict does NOT block the queue.
- A dashboard widget shows unresolved conflict count; alert if > 10 unresolved.
- A Restate scheduled workflow nags the on-call manager via in-app notification + email if backlog grows.
- Conflicts older than 7 days escalate to a senior manager.

### HLC implementation

Each row has (per ADR-072):

- `revision Int @default(0)` — monotonic per-row counter, incremented on every update.
- `updatedAt DateTime @updatedAt` — physical time.
- `syncOrigin String?` — which client/hub created this revision.

**HLC tuple** = `(updatedAt, revision, syncOrigin)` — total order:

1. Compare `updatedAt` first (physical time).
2. Ties broken by `revision` (logical counter).
3. Further ties broken by `syncOrigin` (lexicographic, deterministic).

The hub/cloud assigns the final `revision` on commit (server authority). Client-supplied `revision` is a hint; server overwrites. This matches the PowerSync / Replicache / Turso server-authoritative pattern.

**HLC clock-skew handling**:

- On hub connect, the hub sends its current HLC; the client adopts `max(local, hub)` as its HLC baseline.
- A client with a wildly wrong clock (e.g., CMOS battery dead; clock off by > 1 hour) is flagged for operator attention in the dashboard. The hub still accepts the client's events (HLC tiebreaking handles the skew), but the operator is alerted.
- PoC-02 Scenario E (per ADR-071) validates this: a spoke with clock 1 hour ahead + a spoke with clock 1 hour behind produce zero incorrect LWW resolutions.

### Per-table mapping (declared; verifier rule enforces)

| Table                                          | Tier   | Strategy                         | Notes                                                                                          |
| ---------------------------------------------- | ------ | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Reservation` (non-financial fields)           | Tier 1 | LWW                              | `notes`, `guestId`, `roomId`, `checkInDate`, `checkOutDate`                                    |
| `Reservation.status`                           | Tier 2 | Semantic (state machine)         | Enforced transition-state machine per ADR-012                                                  |
| `Room` (non-financial fields)                  | Tier 1 | LWW                              | `floor`, `type`, `notes`                                                                       |
| `Room.lockedUntil`                             | Tier 2 | Semantic (lock expiry)           | Server checks current time vs. `lockedUntil`; expired locks auto-release                       |
| `HousekeepingTask`                             | Tier 1 | LWW                              |                                                                                                |
| `GuestProfile`                                 | Tier 1 | LWW                              | `preferredName` may escalate to Tier 3 on HLC tie (per Tier 3 example)                         |
| `Invoice`                                      | Tier 2 | Semantic (recompute total)       | `recomputeInvoiceTotal`                                                                        |
| `Payment`                                      | Tier 2 | Semantic (recompute allocations) | `recomputePaymentAllocations`                                                                  |
| `FolioBalance`                                 | Tier 2 | Semantic (recompute balance)     | `recomputeFolioBalance` — non-negotiable; LWW-merging a folio balance would corrupt accounting |
| `Refund`                                       | Tier 2 | Semantic (recompute total)       | `recomputeRefundTotal`                                                                         |
| `KnowledgeDocument`                            | Tier 1 | LWW                              | Knowledge chunks sync via the same SyncEngine                                                  |
| `MemoryRecord`                                 | Tier 1 | LWW                              | Memory records sync via the same SyncEngine                                                    |
| `AuditEvent`                                   | Tier 1 | LWW                              | Append-only; conflicts rare                                                                    |
| `MultiAgentTask`, `AgentDelegation` (Stream 6) | Tier 1 | LWW                              | Sync-replicated like any other mutable table                                                   |
| Yjs collaborative-text surfaces (Phase 2+)     | CRDT   | Yjs merge                        | NOT Tier 1/2/3; CRDT layer on top of SQL sync (per ADR-070)                                    |

### Audit trail (`SyncConflict` table; per ADR-072)

Every conflict (Tier 1, 2, or 3) logs a `SyncConflict` row with: `id`, `tenantId`, `tableName`, `recordId`, `localPayloadJson`, `remotePayloadJson`, `detectedAt`, `resolvedAt`, `resolutionStrategy` (`"lww"` | `"semantic"` | `"manual"` | `null` for pending), `resolverUserId` (for Tier 3), `resolutionJson`. This is sufficient for a 7-year audit reconstruction per ADR-013.

### Phase 1 trivially-correct behavior

Phase 1 ships with the conflict-resolution policy documented (this ADR) but not exercised (STANDALONE mode, no sync). The `revision` column is added to all mutable tables (forward compatibility, per ADR-072). The `SyncConflict` table is created (forward compatibility). The recomputation functions for Tier 2 are declared (verifier rule enforces their presence on financial models) but the `FinancialEvent` table itself is Phase 2+ (per ADR-073 §4.6). PoC-02 (per ADR-071) validates the policy under realistic conditions during Phase E engineering.

## 5. Rationale

- **B4 satisfaction + Stream 5 principle extended**: disagreements are resolved deterministically and auditably; never silently; never with corruption. "AI failure must never become PMS failure" → "sync failure must never become PMS failure" — sync conflicts never block live PMS operation (per ADR-077 §4 Layer 4).
- **Three-tier policy is the right Phase 1–2 choice**: hotel rules are mostly deterministic (Finance constraints > Hospitality gestures); LWW handles the 99% case; semantic override handles the financial-precision case; manual handles the 1% unresolvable case. The complexity is warranted by the rule complexity.
- **HLC is the correct timestamping mechanism**: combines physical time (close to wall clock; human-readable) with logical counter (total order under clock skew). Used in CockroachDB and MongoDB. The `(updatedAt, revision, syncOrigin)` tuple is total order — every conflict has a deterministic winner (Tier 1) or escalates to Tier 2/3.
- **Server-authoritative `revision` assignment**: the hub/cloud assigns the final `revision` on commit; client-supplied `revision` is a hint. This matches PowerSync / Replicache / Turso server-authoritative pattern (per ADR-070).
- **Tier 2 semantic override is non-negotiable for financial fields**: LWW-merging a folio balance would produce incorrect accounting. Server recomputation from the event log is the only correct approach. This is selective event sourcing (per ADR-073 §4.6) — not full event sourcing.
- **Tier 3 manual resolution is the safety net**: never blocks live sync (per ADR-077 §4 Layer 4 — conflict backlog never blocks the queue). Dashboard widget + nag workflow + 7-day escalation ensure the backlog does not grow unbounded.
- **Per-table mapping is declared and verifier-enforced**: every financial model has a declared recomputation function; the verifier rule flags any financial model lacking one. This catches schema drift in CI.
- **`SyncConflict` audit trail**: every conflict (Tier 1, 2, or 3) logs a row — sufficient for a 7-year audit reconstruction per ADR-013. Even auto-resolved Tier 1 conflicts log a row (the loser is discarded but logged).
- **CRDTs (Yjs) are reserved for collaborative-text surfaces** (per ADR-070) — NOT for transactional business data. The per-table mapping explicitly notes the Yjs exception.
- **Phase 1 ships the contract** (policy documented + `revision` column + `SyncConflict` table + recomputation-function declarations) but does not exercise it (STANDALONE mode). Phase 2+ sync activation exercises Tier 1; Phase 2+ CLOUD_SYNCED exercises Tier 2; Tier 3 is exercised whenever unresolvable conflicts arise (rare). PoC-02 (per ADR-071) validates all three tiers under realistic conditions.
- **Distinct from ADR-064 (Stream 6 agent-recommendation conflict resolution)**: ADR-064 arbitrates _agent recommendations_ (FrontDesk vs. Finance agent disagree on upgrade fee); this ADR resolves _sync data conflicts_ (two clients edited the same folio). The two are distinct; both ship in Phase 1 as contract; both exercise in Phase 2+.

## 6. Consequences

- The `revision` column is added to all mutable tables in Phase 1 (per ADR-072; forward compatibility).
- The `SyncConflict` table is created in Phase 1 (per ADR-072; forward compatibility).
- The recomputation functions for Tier 2 are declared on financial models (`recomputeFolioBalance`, `recomputeInvoiceTotal`, `recomputePaymentAllocations`, `recomputeRefundTotal`). The verifier rule flags any financial model lacking a recomputation function. The functions are implemented in Phase 2+ (along with the `FinancialEvent` table per ADR-073 §4.6); a minimal synthetic version is implemented for PoC-02 (per ADR-071).
- The HLC implementation is in-house (~100 lines of TypeScript; no runtime dependency). Phase 1 ships the HLC utility; Phase 2+ exercises it.
- The 3-way merge UI for Tier 3 is a Phase 2+ UI feature (surfaced in the PMS dashboard when `SyncConflict` rows with `resolutionStrategy=null` exist). Phase 1 ships the `SyncConflict` table; the UI is Phase 2+.
- The dashboard widget for conflict backlog count is a Phase 2+ UI feature. Phase 1 ships the `SyncConflict` table; the widget is Phase 2+.
- The Restate scheduled nag workflow for conflict backlog is a Phase 2+ Restate service. Phase 1 ships the contract; the workflow is Phase 2+.
- **R-7.15 risk (HLC clock skew if a client machine's clock is wildly wrong)**: mitigated by hub-sends-HLC-on-connect (client adopts `max(local, hub)`); dashboard flag for wildly-wrong clocks; PoC-02 Scenario E validates.
- **R-7.16 risk (Tier 2 recomputation requires a defined recomputation function per financial aggregate)**: mitigated by per-table mapping declaration; verifier rule enforcement; PoC-02 Scenario B validates recomputation correctness.
- **R-7.17 risk (Tier 3 manual-resolution backlog grows if staff ignore conflicts)**: mitigated by dashboard widget; nag workflow; 7-day escalation to senior manager; PoC-02 Scenario H validates.
- **R-7.18 risk (Tier 2 event-log divergence — Tier 2 cannot recompute because the event log itself diverged)**: mitigated by Tier 2 escalating to Tier 3 (manual) when divergence is detected (per ADR-071 PoC-02 Scenario F); the manual resolver reconciles the divergent event log.
- **R-7.19 risk (LWW loses data — the loser is discarded)**: mitigated by the loser being logged in `SyncConflict.localPayloadJson` / `remotePayloadJson` (full payload preserved for audit); the resolver can recover the loser's data if needed.
- Dependencies: ADR-006 (SQLite; amended separately), ADR-012 (Canonical Domain Model — transition-state machines for `Reservation.status` etc.), ADR-013 (Observability — 7-year audit retention for `SyncConflict`), ADR-070 (umbrella architecture), ADR-071 (PoC-02 validates this policy), ADR-072 (sync metadata schema — `revision`, `syncOrigin`, `SyncConflict` table), ADR-073 (transactional outbox — `FinancialEvent` table for Tier 2 recomputation), ADR-077 (failure recovery — Layer 4 conflict backlog), ADR-079 (SyncEngine SDK — `SyncConflictResolver` interface). **No new runtime dependencies** (HLC is in-house; Yjs is Phase 2+ for collaborative-text only).
- Phase 3+ AI-BOS extension: Tier 3 (manual resolution) extends to agent-recommendation conflicts (per ADR-064 — the AI Supervisor acts as the "human resolver" for low-stakes agent-recommendation conflicts, escalating to a human for high-stakes). The `SyncConflict` table and the agent-recommendation `ConflictResolution` table (per ADR-064) remain distinct.

## 7. Review Conditions

- Review if Phase 2+ conflict frequency is higher than expected (e.g., daily FrontDesk-vs-Finance conflicts over upgrade fees that surface as sync data conflicts) — would justify earlier adoption of negotiation or mediation patterns (reserved for Phase 3+ per ADR-064).
- Review if the per-table mapping proves insufficient for some hotel workflow (e.g., a hotel where housekeeping room-status decisions have higher authority than front-desk — currently `Room.status` is Tier 1 LWW; might need Tier 2 semantic for that hotel) — would require tenant-specific tier overrides.
- Review if Phase 2+ Tier 2 recomputation performance is insufficient (recomputing a folio balance from 1000 events is slower than reading a stored balance) — would justify caching the recomputed balance in the `FolioBalance` row (recompute only on conflict or audit).
- Review if Phase 2+ Tier 3 manual-resolution backlog grows faster than expected (e.g., > 100 unresolved conflicts at a property) — would justify additional Tier 1/2 auto-resolution to reduce Tier 3 load, or a dedicated conflict-resolver role.
- Review if HLC clock-skew handling proves insufficient (e.g., a property with consistently bad NTP sync) — would warrant a separate HLC-implementation ADR (e.g., mandatory NTP enforcement on spoke connect; tighter skew tolerance).
- Review if Phase 3+ AI-BOS agent-recommendation conflicts (per ADR-064) require a unified conflict-resolution table (merging `SyncConflict` and the agent-recommendation `ConflictResolution` table) — would warrant a Phase 3+ ADR.
- Review if a community conflict-resolution standard emerges (e.g., a standardized HLC + LWW + semantic-override schema from the SQLite sync ecosystem) that should replace the SmartAgentics-owned policy.
- Review if Phase 2+ Yjs collaborative-text surfaces accumulate history faster than expected (Ink & Switch's CRDT history-accumulation caveat) — would justify earlier Yjs GC compaction or a different collaborative-text library.
- Review if the verifier rule (financial models must have recomputation functions) proves too strict (e.g., flags a model that is financial in name only) — would warrant refining the verifier rule.
- Review if Phase 3+ multi-property aggregation introduces cross-property conflicts (e.g., two properties both claim the same central-reservation-office booking) — would warrant a Phase 3+ cross-property conflict-resolution ADR.
