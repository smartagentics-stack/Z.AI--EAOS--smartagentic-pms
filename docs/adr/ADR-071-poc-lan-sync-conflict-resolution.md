# ADR-071: PoC-01 LAN Sync + PoC-02 Conflict Resolution — Specification

**ADR-ID:** ADR-071
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR-001 line 66 (Risks) explicitly anticipates the SQLite-multi-user gap: _"SQLite limitations: Mitigated by PoC-01 (LAN sync) and PoC-02 (conflict resolution)."_ These two PoCs were referenced by ADR-001 as the risk-mitigation for SQLite's documented limitations but were **never defined, scheduled, or designed**. Stream 7 Foundational Conflict **FC-7.3** (NEW) flags this gap: a referenced mitigation that does not exist is not a mitigation.

Stream 7 research (`/home/z/my-project/phase-c-stream7-offline-sync-report.md`, §0.5, §2, §11, §14) confirmed two things:

1. **The architectural forcing function is real and verified.** sqlite.org's "Write-Ahead Logging" page (`https://www.sqlite.org/wal.html`) explicitly states: _"All processes using a database must be on the same host computer; WAL does not work over a network filesystem. This is because WAL requires all processes to share a small amount of memory and processes on separate host machines obviously cannot share memory with each other."_ sqlite.org's "Over a Network, Caveats and Considerations" (`https://www.sqlite.org/draft/useovernet.html`) goes further: _"SQLite relies on exclusive locks for write operations, and those have been known to operate incorrectly for some network filesystems. This has led to database corruption."_ and _"Rely upon it at your (and your customers') peril."_ SQLite forum reports from Feb 2025 ("once two or three people get on, we start running into SQLite errors such as the database is locked") and Sonarr's GitHub issue ("CIFS mounted host paths often fail with sqlite locking or corruption errors when using WAL") corroborate this from production. The hub-and-spoke proxy pattern (ADR-075) is sqlite.org's documented Recommendation 2; it must be PoC-validated before Phase 2 LAN_SYNCED deployment.

2. **The conflict-resolution policy (ADR-074) must be PoC-validated before Phase 2+ sync activation.** ADR-074 declares three tiers — LWW by HLC-tagged revision for non-financial fields; semantic override (server recomputes from event log) for financial fields; manual 3-way merge UI for unresolvable conflicts. Each tier has edge cases that must be exercised under realistic conditions: HLC clock skew across hotel machines; Tier 2 recomputation correctness when the event log itself diverged; Tier 3 manual-resolution backlog behavior. The established sync engines (PowerSync, Turso Sync, Replicache) each ship with extensive test suites; SmartAgentics' in-house SyncEngine must demonstrate equivalent reliability before activation.

This ADR specifies what each PoC tests, the success criteria, the test harness, the timeline, and the relationship to Phase 1 ship (PoCs run during Phase E engineering, before Phase 2 LAN_SYNCED activation). The PoCs are the gate between "architecture contract reserved" (Phase 1) and "sync activated" (Phase 2+).

## 2. Problem

Should SmartAgentics (a) skip the PoCs and trust the architectural pattern (low upfront cost; high activation risk), (b) defer the PoCs to Phase 2 (sync activation without prior PoC validation; high risk of activating an unvalidated sync), or (c) specify and execute PoC-01 (LAN sync) + PoC-02 (conflict resolution) during Phase E engineering before any Phase 2 sync activation?

## 3. Options

### Option A: Skip the PoCs; trust the architectural pattern

Rejected. The architectural pattern is well-established but SmartAgentics' in-house implementation is not. sqlite.org's explicit "Rely upon it at your (and your customers') peril" warning about network-filesystem SQLite is not a theoretical risk — it is a documented corruption risk that PoC-01 must demonstrate is mitigated by the hub-and-spoke proxy. The conflict-resolution policy (ADR-074) has edge cases (HLC clock skew, Tier 2 event-log divergence, Tier 3 backlog) that PoC-02 must exercise. Skipping the PoCs would mean Phase 2 sync activation is unvalidated — violating Stream 5's "AI failure must never become PMS failure" extended as "sync failure must never become PMS failure".

### Option B: Defer the PoCs to Phase 2 (run them after sync activation)

Rejected. Activating sync before PoC validation means production data is at risk during the validation window. A PoC-01 failure (e.g., hub-and-spoke proxy cannot sustain target write throughput) discovered after Phase 2 sync activation would require rolling back to STANDALONE — a disruptive operation. A PoC-02 failure (e.g., Tier 2 recomputation produces incorrect folio balances under HLC skew) discovered after activation could corrupt accounting data. The PoCs must run during Phase E engineering so any failures surface before activation.

### Option C: Specify PoC-01 + PoC-02 and execute during Phase E engineering, before Phase 2 sync activation

Adopted. Both PoCs run during Phase E engineering (Phase 1 timeline). PoC-01 validates the hub-and-spoke LAN architecture under a 24-hour stress test. PoC-02 validates the three-tier conflict resolution policy under simulated concurrent edits, network partitions, and hub failover. Both PoCs use synthetic data (no real guest PII). Success criteria are quantitative (throughput, error rate, conflict-resolution latency, corruption-detection count). Failure of either PoC blocks Phase 2 sync activation until the architecture is revised.

## 4. Decision

Adopt **Option C** — specify and execute PoC-01 (LAN sync) + PoC-02 (conflict resolution) during Phase E engineering.

### PoC-01 — LAN Hub-and-Spoke Sync

**Objective**: validate that the hub-and-spoke LAN topology (ADR-075) sustains realistic hotel workloads for 24 hours without `SQLITE_BUSY` corruption, data loss, or sync-lag above threshold.

**Test harness**:

- 1 hub machine (Windows 10/11 or Linux) running: SQLite (WAL mode, `synchronous=NORMAL`, `busy_timeout=5000`); Next.js PMS UI; Restate instance; `SyncHubService` HTTP proxy; mDNS publisher (`bonjour-service`).
- 3 spoke machines on the same LAN: 1 front-desk PC (proxy-only mode), 1 housekeeping tablet (proxy-only mode), 1 back-office PC (proxy-only mode).
- Optional: 1 spoke in local-replica mode (Phase 2+ feature) to validate spoke-local-replica failover.
- Workload generator: synthetic hotel workload — 100 reservations/hour, 50 room-status updates/hour, 30 housekeeping tasks/hour, 20 payment posts/hour, 200 audit events/hour (peak-hour profile; matches Stream 7 §2.3 estimate of 100–1000 writes/hour at peak for a single hotel property).
- Network condition simulator: intermittent partitions (drop spoke→hub connectivity for 5 minutes every 2 hours); mDNS blocking simulation (one spoke falls back to manual hub-IP configuration).

**Success criteria** (all must be met):

1. **Zero `SQLITE_BUSY` errors surface to the application** over the 24-hour run (the `busy_timeout=5000` absorbs brief contention; sustained contention surfaces as a `SQLITE_BUSY` that the application logs as an error). Zero is the bar.
2. **Zero database corruption** detected by `PRAGMA integrity_check` (run hourly during the 24-hour test and at end). Zero is the bar.
3. **Sync lag** (time between SyncOutbox row creation on a spoke and delivery-ACK on the hub) p95 < 5 seconds, p99 < 30 seconds under the peak workload.
4. **Hub failover (Phase 2+ local-replica mode spoke)**: when the hub is killed, the local-replica spoke continues operating on its local SQLite for 60 minutes; on hub recovery, the spoke pushes its offline SyncOutbox events and the hub reconciles with zero data loss (verified by row-count comparison across all tenant-scoped tables).
5. **mDNS discovery**: all spokes auto-discover the hub within 10 seconds of spoke startup; manual-IP fallback works when mDNS is blocked.
6. **Network partition recovery**: after a 5-minute spoke→hub partition, the spoke reconnects, syncs its queued SyncOutbox events, and resumes normal operation with zero data loss.
7. **Conflict resolution integration**: any concurrent-edit conflicts (rare under the workload) are auto-resolved by LWW (Tier 1) or queued in `SyncConflict` for manual resolution (Tier 3); none block live sync.

**Failure handling**: any failure of criteria 1 or 2 (corruption / `SQLITE_BUSY` to application) blocks Phase 2 sync activation. Failure of criteria 3–7 triggers architecture revision (e.g., sync-lag too high → investigate SyncRelayWorkflow polling interval; hub failover data loss → investigate checkpoint protocol).

### PoC-02 — Conflict Resolution

**Objective**: validate the three-tier conflict resolution policy (ADR-074) under realistic concurrent edits, HLC clock skew, network partitions, and hub failover.

**Test harness**:

- 2 SQLite replicas (simulating two spokes with local-replica mode) + 1 cloud PostgreSQL instance (simulating the Phase 2+ cloud sync target).
- Conflict scenarios (synthetic data only; no real guest PII):
  - **Scenario A (Tier 1 LWW)**: two spokes edit the same `Reservation.notes` field concurrently. Verify the higher `(updatedAt, revision, syncOrigin)` wins; the loser is logged in `SyncConflict` with `resolutionStrategy="lww"`.
  - **Scenario B (Tier 2 semantic override — folio balance)**: two spokes post conflicting payments to the same folio. Verify the server recomputes `FolioBalance.balance` from the immutable event log (sum of charges − sum of payments); neither client-supplied "balance" value is used. Verify recomputation matches a pre-computed expected value.
  - **Scenario C (Tier 2 semantic override — reservation status transition)**: two spokes attempt conflicting `Reservation.status` transitions (e.g., one sets `CHECKED_IN`, the other sets `CANCELLED`). Verify the server enforces the transition-state machine (per ADR-012 canonical domain model) and rejects the invalid transition; the rejected transition is logged in `SyncConflict`.
  - **Scenario D (Tier 3 manual resolution)**: two spokes edit the same field with no clear winner (e.g., both change `GuestProfile.preferredName` to different values within the same HLC tick). Verify the conflict is queued in `SyncConflict` with `resolutionStrategy=null` (pending manual); verify a 3-way merge UI (base / ours / theirs) renders correctly; verify a human resolver's choice is propagated back to both spokes.
  - **Scenario E (HLC clock skew)**: one spoke's system clock is set 1 hour ahead; the other is set 1 hour behind. Verify the hub's HLC baseline (sent on connect) corrects the spoke's HLC; verify the skewed spoke is flagged for operator attention; verify no LWW resolution is incorrect due to skew.
  - **Scenario F (event-log divergence for Tier 2)**: two spokes have divergent `FinancialEvent` logs (e.g., one missed a payment event due to a network partition). Verify the Tier 2 recomputation detects the divergence and escalates to Tier 3 (manual resolution) rather than producing an incorrect recomputed balance.
  - **Scenario G (network partition mid-conflict)**: a spoke loses connectivity mid-conflict-resolution. Verify the conflict is finalized on hub recovery; verify no partial resolution is committed.
  - **Scenario H (conflict backlog growth)**: 100 unresolvable (Tier 3) conflicts are queued. Verify the dashboard widget shows the count; verify the Restate scheduled nag workflow fires; verify conflicts older than 7 days escalate to a senior manager.

**Success criteria** (all must be met):

1. **Tier 1 (LWW) correctness**: 100% of Scenario A conflicts resolve to the higher-HLC winner; 100% log a `SyncConflict` row with `resolutionStrategy="lww"` for audit.
2. **Tier 2 (semantic override) correctness**: 100% of Scenario B conflicts produce a recomputed `FolioBalance.balance` matching the pre-computed expected value (verified by an independent recomputation script). 100% of Scenario C conflicts enforce the transition-state machine.
3. **Tier 3 (manual resolution) correctness**: 100% of Scenario D conflicts queue in `SyncConflict` with `resolutionStrategy=null`; the 3-way merge UI renders; a human resolver's choice propagates to both spokes within 5 seconds.
4. **HLC clock skew handling**: Scenario E produces zero incorrect LWW resolutions; the skewed spoke is flagged in the dashboard.
5. **Event-log divergence handling**: Scenario F escalates to Tier 3 (manual) rather than producing an incorrect recomputed balance — 100% of cases.
6. **Conflict backlog management**: Scenario H's dashboard widget shows the count correctly; the nag workflow fires; 7-day escalation fires for the relevant subset.
7. **Audit trail**: every conflict (Tier 1, 2, or 3) has a `SyncConflict` row with full payload (local + remote), detectedAt, resolvedAt, resolutionStrategy, resolverUserId (for Tier 3), resolutionJson — sufficient for a 7-year audit reconstruction per ADR-013.

**Failure handling**: any failure of criteria 1–4 (correctness) blocks Phase 2+ sync activation. Failure of criteria 5–7 triggers architecture revision (e.g., event-log divergence not detected → add a divergence-detection check to the Tier 2 recomputation; backlog nag not firing → fix the scheduled workflow).

### Timeline and relationship to Phase 1

- Both PoCs run during Phase E engineering (Phase 1 timeline, weeks 2–4 of the 3–4 week estimate).
- PoCs use synthetic data only — no real guest PII is exposed to the test harness.
- PoC-01 must pass before Phase 2 LAN_SYNCED activation.
- PoC-02 must pass before Phase 2+ CLOUD_SYNCED activation (Tier 2 semantic override is only exercised when cloud sync is active; Tier 1 LWW is exercised in Phase 2 LAN_SYNCED).
- PoC results are recorded in `/home/z/my-project/worklog.md` and surfaced in the Phase E engineering report. ADR-071 is updated (Status remains ACCEPTED; a "PoC Results" appendix is added) when both PoCs pass.

### Rejected PoC scopes

- **PoC for CRDT-based collaborative text (Yjs)**: deferred. The Yjs collaborative-text surface (guest-preference notes, housekeeping shift-handover log, AI agent scratchpad) is a Phase 2+ feature; its PoC runs in Phase 2+ alongside the Yjs integration. Not in Phase 1 scope.
- **PoC for managed sync engine (PowerSync / ElectricSQL) as runtime dependency**: not run. The in-house SyncEngine is the Phase 1–2 implementation (per ADR-070). If Phase 3+ reconsiders a managed engine, a Phase 3+ PoC would compare the managed engine against the in-house implementation; not in Phase 1 scope.
- **PoC for multi-property cloud aggregation**: deferred. Phase 3+ feature; not in Phase 1 scope.

## 5. Rationale

- **FC-7.3 resolution**: ADR-001 referenced PoC-01 and PoC-02 as SQLite risk mitigations but never defined them. This ADR defines both PoCs with objectives, test harnesses, success criteria, failure handling, and timeline. The referenced mitigations now exist as specified contracts.
- **Stream 5 principle extended**: "AI failure must never become PMS failure" → "sync failure must never become PMS failure". The PoCs are the empirical validation that sync failure does not become PMS failure.
- **sqlite.org's explicit warning is not theoretical**: the corruption risk from network-filesystem SQLite is documented by sqlite.org, corroborated by SQLite forum reports (Feb 2025) and Sonarr's GitHub issue. PoC-01 is the empirical proof that the hub-and-spoke proxy (ADR-075) mitigates this risk.
- **The conflict-resolution policy (ADR-074) has edge cases that require empirical validation**: HLC clock skew, Tier 2 event-log divergence, Tier 3 backlog behavior. PoC-02 exercises each edge case under realistic conditions.
- **PoCs run during Phase E engineering, not after Phase 2 sync activation**: this catches architecture failures before they reach production. A PoC-01 failure post-activation would require rolling back to STANDALONE; a PoC-02 failure post-activation could corrupt accounting data. The Phase E timing is the safe choice.
- **Synthetic data only** — no real guest PII is exposed to the test harness. This respects the privacy commitments (Ink & Switch Ideal 6) and avoids GDPR/NDPR risk during PoC execution.
- **Quantitative success criteria** — zero corruption, zero `SQLITE_BUSY` to application, p95 sync lag < 5 s, 100% Tier 1/2 correctness. The criteria are measurable; the PoC pass/fail is unambiguous.
- **Failure handling blocks activation** — a PoC failure is not a "we'll fix it later"; it blocks the next phase. This enforces the discipline that the architecture must work before it ships.
- **Phase 3+ PoC for managed sync engine is deferred** — the in-house implementation is the Phase 1–2 default. A managed-engine PoC is a Phase 3+ decision if cloud scale demands it.

## 6. Consequences

- Phase E engineering includes a 3–4 week window for PoC-01 + PoC-02 execution. The PoCs require test hardware (1 hub + 3 spokes + 1 cloud PostgreSQL instance) and a workload generator (in-house script; ~500 lines of TypeScript).
- A PoC-01 pass is the gate for Phase 2 LAN_SYNCED activation. A PoC-01 failure blocks activation and triggers architecture revision (e.g., alternative LAN topology, alternative `busy_timeout` tuning, alternative proxy implementation).
- A PoC-02 pass is the gate for Phase 2+ CLOUD_SYNCED activation. A PoC-02 failure blocks activation and triggers conflict-resolution policy revision (e.g., additional Tier 2 recomputation functions, additional Tier 3 escalation rules).
- ADR-071 is updated (Status remains ACCEPTED; "PoC Results" appendix added) when both PoCs pass. The appendix records: hardware used, workload profile, success criteria met (with quantitative metrics), any architecture revisions triggered by PoC failures.
- **R-7.4 risk (PoC hardware availability)**: mitigated by using developer machines for the 1 hub + 3 spokes; cloud PostgreSQL via a free-tier provider (Supabase / Neon) for PoC-02. No special hardware purchase required.
- **R-7.5 risk (PoC workload not representative of real hotel workload)**: mitigated by basing the workload profile on Stream 7 §2.3 estimate (100–1000 writes/hour at peak for a single property) and on hotel-industry sources (Infor, revfine.com per Stream 6 research). The workload is conservative; real hotel workloads are unlikely to exceed it.
- **R-7.6 risk (PoC-02 Tier 2 recomputation functions not yet implemented in Phase 1)**: Tier 2 semantic override requires the `FinancialEvent` table (per ADR-073 §5) which is Phase 2+. PoC-02 implements a minimal `FinancialEvent` table + recomputation function as part of the PoC (synthetic; not production). The production `FinancialEvent` table ships in Phase 2+.
- Dependencies: ADR-070 (Offline Sync Architecture — the umbrella), ADR-072 (sync metadata schema — the columns/tables the PoCs exercise), ADR-073 (transactional outbox — the SyncRelayWorkflow the PoCs stress), ADR-074 (conflict resolution policy — the three-tier policy PoC-02 validates), ADR-075 (LAN operation topology — the hub-and-spoke architecture PoC-01 validates), ADR-077 (sync failure recovery — the 6-layer model the PoCs exercise), ADR-079 (SyncEngine SDK contract — the interface the PoCs implement against). **No new runtime dependencies** beyond the existing Phase 1 stack (SQLite, Prisma, Restate, Next.js, `bonjour-service` for Phase 2).
- Phase 3+ AI-BOS extension: if AI-BOS multi-tenant SaaS adoption triggers managed-sync-engine reconsideration (per ADR-070 review condition), a Phase 3+ PoC-03 (managed sync engine comparison) would be specified.

## 7. Review Conditions

- Review if PoC-01 fails on criteria 1 or 2 (corruption / `SQLITE_BUSY` to application) — would trigger ADR-075 revision (alternative LAN topology or proxy implementation) before Phase 2 LAN_SYNCED activation.
- Review if PoC-01 sync-lag criteria (3) fails — would trigger ADR-073 revision (SyncRelayWorkflow polling interval or relay variant) before Phase 2 activation.
- Review if PoC-02 Tier 2 recomputation produces incorrect values (criteria 2) — would trigger ADR-074 revision (recomputation function or Tier 2 scope) before Phase 2+ CLOUD_SYNCED activation.
- Review if PoC-02 Tier 3 manual-resolution backlog grows faster than expected (criteria 6) — would trigger ADR-074 revision (additional Tier 1/2 auto-resolution to reduce Tier 3 load) or ADR-077 revision (escalation thresholds).
- Review if HLC clock-skew handling (criteria 4) fails — would trigger a separate HLC-implementation ADR (e.g., NTP enforcement on spoke connect; tighter skew tolerance).
- Review if Phase 2+ Yjs collaborative-text surface warrants a PoC-03 (CRDT collaborative text) — would specify a Phase 2+ PoC for Yjs integration (deferred per §4 "Rejected PoC scopes").
- Review if a community hotel-PMS sync-test standard emerges (e.g., an HTNG sync conformance test suite) that should replace the SmartAgentics-owned PoC specifications.
- Review if Phase 3+ managed-sync-engine reconsideration (per ADR-070) requires a Phase 3+ PoC comparing the managed engine against the in-house implementation — would specify PoC-04 (managed sync engine comparison).
- Review if PoC results reveal the 3–4 week Phase E engineering estimate was insufficient — would warrant a Phase E timeline revision and a Phase 2 sync-activation delay.
