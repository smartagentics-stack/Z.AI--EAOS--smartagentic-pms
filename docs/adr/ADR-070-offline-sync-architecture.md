# ADR-070: Offline Sync Architecture — Server-Authoritative Event-Log Sync; Hub-and-Spoke Topology; PowerSync/Electric/Turso/Replicache Documented as Reference Designs

**ADR-ID:** ADR-070
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR-001 commits SmartAgentics to an **offline-first Hotel PMS** built on **SQLite via Prisma** with **PostgreSQL reserved as the future cloud database** ("For future cloud sync", ADR-001 line 25). ADR-006 (SQLite) is an 8-line stub; it does not specify a sync protocol, schema metadata, or conflict policy. ADR-008 (Event-driven architecture) is a stub and defines no outbox. ADR-001's own Risks section (line 66) anticipates the gap: _"SQLite limitations: Mitigated by PoC-01 (LAN sync) and PoC-02 (conflict resolution)"_ — but those PoCs were **never defined, scheduled, or designed**.

Phase B's gap assessment (B4) classified **Offline Sync & Data Architecture** as a Phase C research stream (Stream 7) for five reasons: (1) the official SQLite documentation states SQLite **does not work reliably over network filesystems** (verified at `https://www.sqlite.org/draft/useovernet.html`); (2) ADR-001 says "PostgreSQL — For future cloud sync" but defines no sync protocol; (3) no conflict-resolution policy exists when two clients edit the same reservation/folio/room; (4) no outbox reliability mechanism exists for intermittent networks; (5) no sync failure recovery model exists. Stream 5's principle **"AI failure must never become PMS failure"** is extended by Stream 7 to **"sync failure must never become PMS failure"**.

Stream 7's research (`/home/z/my-project/phase-c-stream7-offline-sync-report.md`, §4–§9) surveyed the established offline-sync literature. Ink & Switch's "Local-first software" essay (Onward! 2019, doi:10.1145/3359591.3359737) defines seven ideals for local-first software and identifies CRDTs as the candidate foundation — but cautions that "it is not yet advisable to replace a proven product like Firebase with an experimental project like Automerge in a production setting today" and notes CRDT history-accumulation performance problems. PowerSync v1.0 (Nov 2023) made a deliberate decision **not** to use CRDTs for transactional data, citing Figma's CTO: "Since Figma is centralized (our server is the central authority), we can simplify our system by removing this extra overhead and benefit from a faster and leaner implementation." Replicache, Turso Sync, and ElectricSQL all converge on the same **server-authoritative event-log sync** pattern (an authoritative server assigns a global order of operations; replicas converge by applying operations in that order; CRDTs are unnecessary when a central authority exists). Turso explicitly notes "Peer-to-peer. Fully distributed sync between devices is not supported. The remote Turso database is always the source of truth."

For SmartAgentics, the architectural forcing functions are: (a) offline-first commitment (PDD: "offline-first Hotel PMS for Nigerian/African hospitality markets"); (b) Windows desktop installer with no required server process (ADR-001: "SQLite is zero-config, offline-first, proven"); (c) SQLite's single-writer + WAL-does-not-work-over-network-filesystem constraint (verified, sqlite.org docs); (d) hotel PMS is business-critical transactional data where accounting precision matters (folios, payments) — LWW-merging a folio balance would be wrong. These forcing functions point to **server-authoritative event-log sync + hub-and-spoke LAN topology + SQLite-over-SMB explicitly forbidden**.

This ADR is the umbrella for Stream 7. ADR-071 (PoCs), ADR-072 (sync metadata schema), ADR-073 (transactional outbox), ADR-074 (conflict resolution policy), ADR-075 (LAN operation topology), ADR-076 (cloud sync boundary), ADR-077 (sync failure recovery), ADR-078 (per-property database strategy), and ADR-079 (SyncEngine SDK contract) elaborate specific aspects of the architecture defined here.

## 2. Problem

Should SmartAgentics adopt CRDTs as the primary sync mechanism, peer-to-peer mesh sync, a managed sync-engine SaaS (PowerSync / ElectricSQL / Turso Sync / Replicache) as a runtime dependency, Operational Transform, or an in-house server-authoritative event-log SyncEngine that adopts the architectural pattern of the established engines without the vendor runtime?

## 3. Options

### Option A: CRDTs as the primary sync mechanism (Automerge / Yjs for all replicated data)

Rejected. CRDTs pay a commutativity overhead tax that is correct for **decentralized** systems with no central authority and for fine-grained collaborative editing (text, canvases) but wrong for **transactional business data** (folios, payments, reservations). Ink & Switch's own 2019 production-readiness caveat + the history-accumulation performance problem + the business-critical nature of hotel financial data make CRDTs unsuitable as the primary sync mechanism. CRDTs (Yjs) are reserved for the narrow collaborative-text surface (guest-preference notes, housekeeping shift-handover log, AI agent scratchpad) — layered on top of the SQL sync, exactly the PowerSync + Yjs pattern.

### Option B: Peer-to-peer mesh sync (no central authority)

Rejected. No central authority → no global ordering → CRDTs required → overhead + complexity (§Option A). Hotel PMS needs a hub anyway (per ADR-075 the hub-and-spoke LAN topology is the only viable SQLite LAN architecture). The hub is the natural central authority. P2P mesh is also rejected by every established sync engine (Turso: "Peer-to-peer. Fully distributed sync between devices is not supported.").

### Option C: Adopt PowerSync, ElectricSQL, Turso Sync, or Replicache as a Phase 1–2 runtime dependency

Rejected for Phase 1–2. (1) Offline-first Windows installer requirement — all four require either a hosted SaaS dependency or a self-hosted server process; SmartAgentics Phase 1 is a Windows desktop installer with no server process required (ADR-001). (2) License / cost — Replicache is commercial (paid per-user); Turso Sync requires Turso Cloud account (paid at scale); PowerSync Service Open Edition is source-available (not OSI-approved open source); ElectricSQL is Apache 2.0 but requires running their sync-engine process. (3) Architectural fit — all four target client→central-server sync; SmartAgentics' Phase 2 LAN_SYNCED is spoke→LAN-hub with no cloud yet, which none natively fit. (4) Vendor lock-in — adopting any as the primary sync mechanism couples SmartAgentics to that vendor's protocol, schema conventions, and roadmap. Phase 3+ may reconsider PowerSync Open Edition (self-hosted) or ElectricSQL (Apache 2.0) **if** cloud multi-tenant scale demands a managed sync engine; the SmartAgentics-owned `SyncEngine` interface (ADR-079) abstracts the swap.

### Option D: Operational Transform (OT)

Rejected. OT is famously hard to implement correctly (Turso guide); it requires a central server that sequences operations (which we have) but adds significant complexity versus server-authoritative event-log sync. CRDTs have superseded OT for new development. Reserved for never (no surface in a Hotel PMS requires OT specifically).

### Option E: In-house server-authoritative event-log SyncEngine; adopt the architectural pattern of the established engines without the vendor runtime; document PowerSync / ElectricSQL / Turso Sync / Replicache as reference designs

Adopted. The hub (Phase 2 LAN_SYNCED) or cloud PostgreSQL (Phase 2+ CLOUD_SYNCED) is the single source of truth. Clients download checkpoints; writes go through the server (or the hub) which applies them in a global order. Clients never resolve conflicts locally. The SDK defines a `SyncEngine` interface (transport-agnostic; works for SQLite-only, LAN hub-and-spoke, and cloud PostgreSQL). The reference implementation uses a transactional outbox (`SyncOutbox`), a Restate `SyncRelayWorkflow` (at-least-once + idempotent consumers), checkpoints (`SyncCheckpoint`), and the three-tier conflict policy (ADR-074: LWW default + semantic override for financials + manual UI for unresolvable). The four established engines are documented as reference designs whose architectural patterns are adopted; their runtime dependencies are not.

## 4. Decision

Adopt **Option E** — in-house server-authoritative event-log sync with the established engines documented as reference designs.

### Architectural pattern (adopted)

The SmartAgentics SyncEngine implements the convergence pattern shared by PowerSync, ElectricSQL, Turso Sync, and Replicache:

| Property                        | SmartAgentics SyncEngine                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Server-authoritative            | Yes — the hub (Phase 2) or cloud PostgreSQL (Phase 2+) is the single source of truth                                                       |
| Transactional outbox            | Yes — `SyncOutbox` table, written in the same Prisma transaction as the business-data change (per ADR-073)                                 |
| Checkpoints                     | Yes — `SyncCheckpoint` table tracks last ACK'd LSN per client; resumable sync (per ADR-072, ADR-077)                                       |
| Default conflict resolution     | LWW by HLC-tagged `(updatedAt, revision, syncOrigin)` for non-financial fields (per ADR-074)                                               |
| Semantic override               | Server recomputes financial fields (Invoice, Payment, FolioBalance, Refund) from the immutable event log — never LWW-merges (per ADR-074)  |
| Manual resolution               | `SyncConflict` table queues unresolvable conflicts for a 3-way merge UI; never blocks live sync (per ADR-074, ADR-077)                     |
| Idempotent consumers            | `@@unique([tenantId, idempotencyKey, revision])` dedup; consumer-side `SyncInbox` table (Phase 2+) for incoming cloud pushes (per ADR-073) |
| Client-side conflict resolution | Never — the client never resolves conflicts locally (matches PowerSync)                                                                    |

### Reference designs (documented, NOT runtime dependencies)

- **PowerSync v1.0** (`https://powersync.com/blog/introducing-powersync-v1-0-postgres-sqlite-sync-layer`, Nov 30, 2023) — Postgres↔SQLite bi-directional sync; server-authoritative; not CRDTs; dynamic partial replication via Sync Rules; upload queue (== outbox); causal+ checkpoints; client-side schema applied via SQLite views; PowerSync Service Open Edition is source-available (May 2024). Cited for the "not CRDTs; central authority enables global ordering" decision and for the partial-replication Sync Rules pattern.
- **ElectricSQL** (`https://electric.ax/blog/2024/07/17/electric-next`; `https://electric.ax/blog/2025/08/13/electricsql-v1.1-released`) — Postgres sync engine (read-path only); streams data via "Shapes" (filtered subsets); writes go through server functions; reconcile optimistically via Postgres transaction id; client store is PGlite (WASM Postgres). Apache 2.0. Cited for the read-path/streaming pattern and the "writes go through server functions" decision.
- **Turso Sync** (`https://turso.tech/blog/building-local-first-apps-the-complete-guide-to-offline-first-database-sync`, Jul 27, 2026) — CDC-based logical row-level mutations; Last-Push-Wins default at row level; transform hook for custom conflict resolution; no built-in CRDT support; "Peer-to-peer. Fully distributed sync between devices is not supported. The remote Turso database is always the source of truth." Cited for the LWW-default + transform-hook pattern and for the "no P2P" decision.
- **Replicache** (`https://doc.replicache.dev/concepts/how-it-works`) — client-side sync framework; server-authoritative; mutators run optimistically on client, then authoritatively on server; three endpoints (push, pull, poke). Commercial. Cited for the optimistic-UI + server-authoritative-commit pattern.
- **Ink & Switch "Local-first software"** (`https://www.inkandswitch.com/essay/local-first`, Onward! 2019) — seven ideals for local-first software; CRDT production-readiness caveats; "data ownership" ideal. Cited as the architectural north star.
- **microservices.io "Pattern: Transactional outbox"** (`https://microservices.io/patterns/data/transactional-outbox.html`, Chris Richardson) — cited as the authoritative source for the transactional outbox pattern adopted in ADR-073.

### Topology (elaborated in ADR-075 and ADR-076)

| Phase                          | Topology                                      | Source of truth                                                                                                    |
| ------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Phase 1 (STANDALONE)           | Single-node (no sync)                         | Local SQLite                                                                                                       |
| Phase 2 (LAN_SYNCED)           | Hub-and-spoke                                 | Hub machine's SQLite                                                                                               |
| Phase 2+/3+ (CLOUD_SYNCED)     | Star (per-property SQLite → cloud PostgreSQL) | Cloud PostgreSQL for cross-property aggregation; per-property SQLite remains authoritative for live PMS operations |
| Phase 3+ (multi-property mesh) | REJECTED                                      | N/A — no central authority → CRDTs required → overhead                                                             |

### Phase 1 scope

Phase 1 ships **STANDALONE mode only** (single SQLite, no sync active). The architecture contract is reserved:

- New SDK file `packages/sdk/src/sync/index.ts` (per ADR-079) — `SyncEngine` top-level + supporting types.
- Three new Prisma tables (additive): `SyncOutbox`, `SyncCheckpoint`, `SyncConflict` (per ADR-072).
- Additive columns on every mutable table: `updatedAt` (explicit), `revision`, `deletedAt`, `syncOrigin`, `idempotencyKey` (where not already present) (per ADR-072).
- One new Restate workflow: `SyncRelayWorkflow` (reads SyncOutbox, delivers, ACKs, retries) (per ADR-073).
- One new verifier rule: flag any mutable Prisma model missing `updatedAt + revision + deletedAt + tenantId`.
- Two PoCs: PoC-01 LAN hub-and-spoke PoC; PoC-02 conflict resolution PoC (per ADR-071).

Phase 1 effort estimate: 3–4 weeks of Phase E engineering (per Stream 7 §0.5).

### Rejected runtime dependencies for Phase 1–2

- PowerSync Service (source-available; requires self-hosted server process; conflicts with offline-first Windows installer).
- ElectricSQL (Apache 2.0; requires running their sync-engine process; read-path only — does not fit the spoke→LAN-hub topology).
- Turso Sync (requires Turso Cloud account; cloud-dependent; conflicts with offline-first).
- Replicache (commercial; paid per-user; requires developer to implement three server endpoints per mutator).
- LiteFS / rqlite / dqlite (rejected per ADR-075 §3 — designed for distributed SQLite in same-datacenter / Raft-consensus scenarios; require server processes; conflict with offline-first single-machine STANDALONE Phase 1).

## 5. Rationale

- **FC-7.1 resolution**: ADR-001 says "PostgreSQL — for future cloud sync" but defines no protocol, conflict policy, or schema metadata. This ADR defines the protocol (server-authoritative event-log), the conflict policy (ADR-074), and the schema metadata (ADR-072). The ADR-001 amendment (separately performed by the Phase D architect) clarifies the PoC-01/02 reference.
- **B4 satisfaction**: Phase B's gap assessment (B4) closed for Offline Sync & Data Architecture — every one of the five gap reasons is now addressed by an ADR.
- **Server-authoritative is the right pattern for transactional business data**: the four established sync engines converge on it. CRDTs are correct only for decentralized systems with no central authority and for fine-grained collaborative editing — neither applies to SmartAgentics' transactional business data.
- **In-house implementation avoids vendor coupling** and preserves the offline-first Windows installer requirement. The architectural pattern is well-established; re-implementing it in-house is low-risk because the in-house `SyncRelayWorkflow` (Restate workflow) reuses Restate's journaling + retry + exactly-once semantics (per ADR-007).
- **Reference designs are documented, not dropped**: PowerSync, ElectricSQL, Turso Sync, Replicache, and Ink & Switch are cited as the architectural sources. Their patterns are adopted; their runtime dependencies are deferred (Phase 3+ reconsideration if cloud scale demands).
- **Phase 1 ships STANDALONE only**: per ADR-001 offline-first commitment, per PDD ("offline-first Hotel PMS"), per the unreliable-internet reality of Nigerian/African hospitality markets. Sync activation is Phase 2+. The architecture contract is reserved now so Phase 2+ implementation is a config change, not a schema migration.
- **CRDTs reserved for collaborative-text surfaces** (Yjs on top of the SQL sync) — the documented PowerSync + Yjs pattern. NOT for transactional business data.
- **OT rejected** — superseded by CRDTs for new development; no SmartAgentics surface requires OT specifically.

## 6. Consequences

- The SmartAgentics-owned `SyncEngine` interface (ADR-079) is the single sync abstraction. Phase 1 ships the interface + idle infrastructure; Phase 2+ swaps in the LAN_HUB / LAN_SPOKE transport; Phase 2+/3+ swaps in the CLOUD_SYNCED transport. No interface changes between phases.
- Three new Prisma tables (`SyncOutbox`, `SyncCheckpoint`, `SyncConflict`) are added in Phase 1 (additive; per ADR-072). The Prisma middleware auto-writes `SyncOutbox` rows on every sync-replicated model mutation, even in STANDALONE mode — the rows accumulate but the schema is forward-compatible, so Phase 2 sync activation is a config change, not a schema migration.
- One new Restate workflow `SyncRelayWorkflow` (per ADR-073) is implemented in Phase 1 but idle in STANDALONE mode.
- PowerSync, ElectricSQL, Turso Sync, and Replicache are NOT added as runtime dependencies in Phase 1 or Phase 2. Phase 3+ may reconsider; the `SyncEngine` interface abstracts the swap.
- **R-7.1 risk (in-house sync implementation has bugs that established libraries have already fixed)**: mitigated by PoC-01 (LAN hub-and-spoke stress test, per ADR-071) + PoC-02 (conflict resolution edge cases, per ADR-071) + a Promptfoo-style golden test suite for sync semantics + comprehensive integration tests.
- **R-7.2 risk (Phase 3+ managed-sync-engine swap friction)**: mitigated by the `SyncEngine` interface abstraction (ADR-079). The swap is a new implementation of the same interface, not a rewrite.
- **R-7.3 risk (vendor lock-in if a reference design is later adopted as runtime dependency)**: mitigated by the in-house implementation being the default; the four reference designs are documented, not adopted.
- Dependencies: ADR-001 (Reference Stack; amended separately to reference PoCs), ADR-006 (SQLite; amended separately for WAL config + better-sqlite3 + LAN-via-proxy-not-via-SMB + sync metadata), ADR-007 (Restate), ADR-008 (Event-driven; amended separately to formalize transactional outbox), ADR-011 (SDK extension points; amended separately per FC-7.7), ADR-012 (Canonical Domain Model — `SyncRecord` is the canonical envelope for sync events). ADR-071 through ADR-079 elaborate this ADR. **No new runtime dependencies in Phase 1 or Phase 2.**
- Phase 3+ AI-BOS extension: multi-tenant SaaS at scale may demand a managed sync engine; the `SyncEngine` interface abstracts the swap. The architectural pattern (outbox + checkpoints + LWW + semantic override) is preserved regardless of implementation.

## 7. Review Conditions

- Review if Phase 2+ cloud multi-tenant scale demands a managed sync engine — would trigger reconsideration of PowerSync Open Edition (self-hosted) or ElectricSQL (Apache 2.0) as a Phase 3+ runtime dependency behind the existing `SyncEngine` interface.
- Review if PoC-01 (LAN sync stress test) or PoC-02 (conflict resolution edge cases) reveal the in-house implementation cannot meet the reliability bar — would trigger earlier managed-sync-engine adoption.
- Review if a Phase 2+ PMS workflow requires true peer-to-peer collaboration between properties with no cloud intermediary (e.g., sister-property direct rebooking) — would require re-evaluating the P2P-mesh rejection (currently the cloud star topology handles cross-property; direct P2P is rejected).
- Review if the Yjs collaborative-text surface (guest-preference notes, housekeeping shift-handover log) accumulates history faster than expected — would justify earlier Yjs GC compaction work or a different collaborative-text library.
- Review if a community hotel-PMS sync standard emerges (e.g., a standardized SyncRules schema, an HTNG sync specification) that should replace the SmartAgentics-owned SyncEngine contract.
- Review if Phase 2+ operator feedback indicates the in-house SyncRelayWorkflow reliability is insufficient (e.g., sync-lag > 60 s under load) — would justify earlier adoption of the transaction-log-tailing relay variant (deferred to Phase 3+ per ADR-073).
- Review if Phase 3+ AI-BOS multi-agent shared scratchpads require CRDT semantics for agent-recommendation merge (Stream 6 Scenario 4 overbooking resolution) — would extend the Yjs collaborative-text surface to agent scratchpads (currently server-authoritative `SessionContextService` per ADR-062).
- Review if Phase 2+ cloud schema drift between `schema.prisma` (SQLite) and `schema.cloud.prisma` (PostgreSQL) becomes an operational burden — would justify a single-schema-with-mapping approach instead of the two-schema approach (per ADR-076).
