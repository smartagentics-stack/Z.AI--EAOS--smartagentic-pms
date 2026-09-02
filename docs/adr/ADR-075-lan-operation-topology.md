# ADR-075: LAN Operation Topology — Hub-and-Spoke; mDNS/Bonjour Peer Discovery; SQLite-over-SMB FORBIDDEN (CRITICAL — verified by sqlite.org docs)

**ADR-ID:** ADR-075
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR-001 commits SmartAgentics to **offline-first** with SQLite as the local store. ADR-006 (SQLite) is an 8-line stub; it does not specify how multi-user LAN operation works. Stream 7 Foundational Conflict **FC-7.2** (NEW — CRITICAL) flags the gap: the simplest multi-user LAN architecture — "put the SQLite file on a Windows SMB share" — is **INVALIDATED** by sqlite.org's explicit documentation.

The verification is direct and unambiguous. sqlite.org's "Write-Ahead Logging" page (`https://www.sqlite.org/wal.html`, read in full during Stream 7 research) states: _"All processes using a database must be on the same host computer; **WAL does not work over a network filesystem. This is because WAL requires all processes to share a small amount of memory and processes on separate host machines obviously cannot share memory with each other.**"_ sqlite.org's "Over a Network, Caveats and Considerations" (`https://www.sqlite.org/draft/useovernet.html`, read in full) goes further: _"Generally, if your data is separated from the application by a network, you want to use a client/server database."_ and _"SQLite relies on exclusive locks for write operations, and those have been known to operate incorrectly for some network filesystems. **This has led to database corruption.**"_ and _"Rely upon it at your (and your customers') peril."_

This is not a theoretical risk. Production reports corroborate:

- SQLite forum (Feb 2025, `https://sqlite.org/forum/info/a6675453ecd9af62d13d55fb38562a2e93c434c57f7994b34a4fae91506a3214`): _"It works fine with one person in, but once two or three people get on, we start running into SQLite errors such as the database is locked."_
- Stack Overflow (`https://stackoverflow.com/questions/39235700`): _"No. SQLite isn't meant to be used by multiple clients at the same time (unless it is strictly read-only). You should use a server style [database]."_
- Sonarr GitHub (`https://github.com/Sonarr/Sonarr/issues/1886`): _"CIFS mounted host paths often fail with sqlite locking or corruption errors when using WAL with sqlite file on host shared paths. on a SMB/CIFS [share]."_
- GoToSocial docs (`https://docs.gotosocial.org/en/latest/advanced/sqlite-networked-storage`): _"It is in theory possible to run SQLite over Samba. Doing so puts you at risk of database corruption."_
- SkyPilot blog (Mar 2025, `https://skypilot.ai/blog/abusing-sqlite-to-handle-concurrency`): _"SQLite uses database-level locks that can counter-intuitively starve unlucky processes."_

sqlite.org's Recommendation 2 for remote-client scenarios is unambiguous: _"Host an SQLite database in WAL mode, but do all reads and writes from processes on the same machine that stores the database file. **Implement a proxy that runs on the database machine that relays read/write requests from remote machines.**"_ This is the **hub-and-spoke proxy pattern** — one machine hosts the SQLite database + a thin authenticated HTTP proxy; other terminals on the LAN talk to the hub.

Stream 7 research (`/home/z/my-project/phase-c-stream7-offline-sync-report.md`, §8, §11) confirmed hub-and-spoke is the only viable SQLite LAN architecture. The alternatives are: (a) shared SQLite over SMB/CIFS — REJECTED (corruption risk); (b) per-client SQLite with P2P mesh sync — REJECTED (no central authority → CRDTs required → overhead + complexity; hotel PMS needs a hub anyway); (c) PostgreSQL as local DB on the hub — REJECTED by ADR-001 (SQLite is the local DB); (d) LiteFS / rqlite / dqlite — REJECTED (designed for distributed SQLite in same-datacenter / Raft-consensus scenarios; require server processes; conflict with offline-first single-machine STANDALONE Phase 1).

The hotel industry itself converges on hub-and-spoke: LinkedIn / Max Starkov (`https://www.linkedin.com/posts/maxstarkkov_why-the-hub-and-spoke-model-is-the-future-activity-7360998170081787909-yfIt`): _"Why the hub-and-spoke model is the future of hotel tech... This hub-and-spoke model ensures quick and painless integrations and allows guest, marketing and operational data to flow throughout the 'veins' of this tech ecosystem."_

Peer discovery on the LAN uses mDNS / Bonjour / Avahi (`https://avahi.org`: _"Avahi is a system which facilitates service discovery on a local network via the mDNS/DNS-SD protocol suite. Compatible technology is found in Apple MacOS X (Bonjour)."_). Works on Windows 10+ (with Bonjour Print Services). The `bonjour-service` NPM package (Node.js, MIT, pure JS) is the recommended implementation.

This ADR formalizes: (1) Phase 1 STANDALONE (no LAN sync); (2) Phase 2 LAN_SYNCED via hub-and-spoke (proxy-only mode for spokes); (3) Phase 2+ LAN_SYNCED with local-replica mode for spokes (true local-first at every terminal); (4) mDNS/Bonjour peer discovery; (5) the `SyncHubService` HTTP proxy API; (6) **SQLite-over-SMB/CIFS/network-share is EXPLICITLY FORBIDDEN** (CRITICAL — verified by sqlite.org docs); (7) hub failover; (8) P2P mesh is rejected. ADR-006 amendment (separately performed by the Phase D architect) clarifies the WAL config, the better-sqlite3 driver, and the LAN-via-proxy-not-via-SMB requirement.

## 2. Problem

Should SmartAgentics (a) share the SQLite file over SMB/CIFS (sqlite.org explicitly warns of corruption; INVALID), (b) use per-client SQLite with P2P mesh sync (no central authority → CRDTs required → overhead), (c) use PostgreSQL as the local hub DB (rejected by ADR-001), (d) use LiteFS / rqlite / dqlite (require server processes; conflict with offline-first STANDALONE Phase 1), or (e) adopt hub-and-spoke with mDNS peer discovery and a thin HTTP proxy on the hub (sqlite.org's documented Recommendation 2)?

## 3. Options

### Option A: Shared SQLite file over SMB/CIFS/network-share

**REJECTED — CRITICAL.** sqlite.org explicitly warns: _"SQLite relies on exclusive locks for write operations, and those have been known to operate incorrectly for some network filesystems. This has led to database corruption."_ and _"Rely upon it at your (and your customers') peril."_ Production reports (SQLite forum Feb 2025; Sonarr GitHub; GoToSocial docs) corroborate. This is not a tuning problem; it is a fundamental architectural mismatch (WAL requires shared memory; network filesystems cannot share memory across host machines). **SmartAgentics FORBIDS SQLite-over-SMB/CIFS/network-share.** The installer refuses to start if `DATABASE_URL` points to a network path.

### Option B: Per-client SQLite databases with P2P mesh sync

Rejected. No central authority → no global ordering → CRDTs required → overhead + complexity (per ADR-070). Hotel PMS needs a hub anyway (the hub is the natural central authority and the natural single writer for SQLite's single-writer model). P2P mesh is also rejected by every established sync engine (Turso: "Peer-to-peer. Fully distributed sync between devices is not supported").

### Option C: PostgreSQL as the local hub DB

Rejected by ADR-001. SQLite is the local DB (zero-config, offline-first, proven; PostgreSQL requires a server process). The hub-and-spoke pattern keeps SQLite as the hub's local DB; PostgreSQL is reserved for the Phase 2+ cloud sync target (per ADR-076).

### Option D: LiteFS / rqlite / dqlite (distributed SQLite)

Rejected. LiteFS (`https://fly.io/docs/litefs`) is for same-datacenter SQLite replication (Fly.io multi-region); requires FUSE filesystem driver (Windows compatibility uncertain). rqlite (`https://rqlite.io`) uses Raft consensus; adds a server process per node (conflicts with offline-first single-machine STANDALONE Phase 1). dqlite is similar. All three are designed for distributed SQLite in server-side scenarios; not for hotel LAN with Windows desktops.

### Option E: Hub-and-spoke with mDNS peer discovery and a thin HTTP proxy on the hub

Adopted. One machine hosts the SQLite database (WAL mode, per ADR-006 amendment) + a thin authenticated HTTP proxy (`SyncHubService`). Other terminals (spokes) on the LAN either proxy through the hub (Phase 2 proxy-only mode) or run a local SQLite replica that syncs from the hub (Phase 2+ local-replica mode). mDNS/Bonjour peer discovery via `bonjour-service` NPM package. The hub is the single writer (SQLite's single-writer constraint is naturally enforced by the hub architecture). SQLite-over-SMB is FORBIDDEN. P2P mesh is rejected.

## 4. Decision

Adopt **Option E** — hub-and-spoke with mDNS peer discovery and a thin HTTP proxy on the hub.

### Hub-and-spoke LAN architecture (Phase 2 LAN_SYNCED mode)

**1. One machine hosts the SQLite database** (the "hub"). Typically the front-desk PC or a small NUC. The hub runs:

- The SQLite database file (WAL mode, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON` — per ADR-006 amendment).
- A Next.js web app (the PMS UI for hub users).
- A Restate instance (for `SyncRelayWorkflow` per ADR-073 + Stream 5/6 workflows).
- A thin HTTP proxy service (`SyncHubService`) for spoke clients.
- An mDNS publisher (advertising `_smartagentics._tcp.local`).

**2. Spokes** (other terminals on the LAN — housekeeping tablet, restaurant POS, back-office PC):

- **Phase 2 proxy-only mode**: spokes run the PMS UI but proxy all DB reads/writes through the hub's `SyncHubService`. No local SQLite. Simple; depends on hub availability.
- **Phase 2+ local-replica mode**: spokes run a local SQLite replica that syncs from the hub. True local-first at every terminal. Spokes operate offline (hub down) on local replica; reconnect syncs on hub recovery.

**3. mDNS / Bonjour peer discovery**:

- Hub publishes `_smartagentics._tcp.local` via mDNS (Avahi on Linux; Bonjour on macOS/iOS; Bonjour Print Services for Windows).
- Spokes discover the hub automatically. Fall back to manual hub-IP configuration if mDNS is blocked (some enterprise networks block port 5353 UDP).
- The `bonjour-service` NPM package (Node.js, MIT, pure JS) is the recommended implementation.

**4. Hub HTTP proxy API (`SyncHubService`)**:

- `POST /sync/query` — read query proxy (spoke sends Prisma-like query; hub executes on SQLite; returns rows).
- `POST /sync/transact` — write transaction proxy (spoke sends transaction payload; hub executes atomically on SQLite; returns commit/abort).
- `POST /sync/push` — spoke pushes `SyncOutbox` events to hub.
- `GET /sync/pull?since=<lsn>` — spoke pulls `SyncOutbox` events from hub since last LSN (long-poll).
- `POST /sync/ack` — spoke ACKs received events (advances `SyncCheckpoint`).
- All endpoints require authentication (signed JWT per Stream 5's identity model; spoke-to-hub JWT scoped to `tenantId` + `propertyId`).

**5. Hub is single writer** — SQLite's single-writer constraint is naturally enforced by the hub architecture (only the hub writes to SQLite; spokes proxy through). No `SQLITE_BUSY` errors from cross-machine contention. The `busy_timeout=5000` absorbs brief contention from multiple hub processes (Next.js web app + Restate worker + `SyncHubService`) writing to the same SQLite file on the same machine.

**6. Hub failover (Phase 2+ local-replica mode)**:

- If hub is down, spokes continue operating on local SQLite replicas.
- A spoke can be promoted to hub (manual operator action; or automatic via Raft-style election in Phase 3+).
- On hub recovery, spokes push their offline `SyncOutbox` events to the recovered hub; hub reconciles via the conflict-resolution policy (per ADR-074).

### SQLite-over-SMB/CIFS/network-share is EXPLICITLY FORBIDDEN

This is the CRITICAL safety constraint of this ADR. sqlite.org's documentation is unambiguous (per §1). The SmartAgentics installer and runtime enforce the prohibition:

- The installer refuses to start if `DATABASE_URL` points to a network path (UNC path `\\server\share\...` on Windows; NFS mount on Linux; SMB mount on macOS).
- The runtime (`packages/sdk/src/db/index.ts` or equivalent) checks the SQLite file path on startup and exits with a clear error message if it detects a network filesystem.
- The verifier rule (per ADR-070 Phase 1 scope) flags any documentation or configuration that suggests SQLite-over-SMB is acceptable.
- The ADR-006 amendment (separately performed by the Phase D architect) explicitly documents the prohibition.

### Phase 1 scope

Phase 1 ships **STANDALONE only** (single SQLite, no LAN sync). The hub-and-spoke architecture is documented in this ADR but NOT implemented in Phase 1. The SDK `SyncEngine` interface (per ADR-079) is defined with `LAN_HUB` and `LAN_SPOKE` modes reserved. Phase 2 LAN_SYNCED activation implements:

- `SyncHubService` (new Restate service + Next.js API routes).
- `bonjour-service` dependency.
- (Phase 2+) spoke-local SQLite replica + SyncEngine client implementation.

### Topology summary across phases

| Phase                                    | Topology                                      | Source of Truth                                                                     | SQLite-over-SMB    |
| ---------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ |
| Phase 1 (STANDALONE)                     | Single-node (no sync)                         | Local SQLite                                                                        | FORBIDDEN (no LAN) |
| Phase 2 (LAN_SYNCED)                     | Hub-and-spoke (proxy-only spokes)             | Hub machine's SQLite                                                                | FORBIDDEN          |
| Phase 2+ (LAN_SYNCED with local-replica) | Hub-and-spoke (local-replica spokes)          | Hub machine's SQLite (spokes have local replicas)                                   | FORBIDDEN          |
| Phase 2+/3+ (CLOUD_SYNCED)               | Star (per-property SQLite → cloud PostgreSQL) | Cloud PostgreSQL for cross-property; per-property SQLite authoritative for live PMS | FORBIDDEN          |
| Phase 3+ (multi-property mesh)           | REJECTED                                      | N/A                                                                                 | N/A                |

## 5. Rationale

- **FC-7.2 resolution (CRITICAL)**: sqlite.org explicitly states SQLite does NOT work reliably over network filesystems (WAL requires shared memory; network filesystem sync/locking vary and can corrupt the database). The simplest multi-user LAN architecture ("put the SQLite file on a Windows SMB share") is INVALIDATED. This ADR documents the hub-and-spoke LAN architecture as the only viable alternative (sqlite.org's documented Recommendation 2) and explicitly FORBIDS SQLite-over-SMB.
- **sqlite.org's documentation is the authoritative source**: the official SQLite documentation is unambiguous. Production reports (SQLite forum Feb 2025; Sonarr GitHub; GoToSocial docs; SkyPilot blog) corroborate. This is not a tuning problem; it is a fundamental architectural mismatch.
- **Hub-and-spoke is sqlite.org's documented Recommendation 2**: _"Host an SQLite database in WAL mode, but do all reads and writes from processes on the same machine that stores the database file. Implement a proxy that runs on the database machine that relays read/write requests from remote machines."_ SmartAgentics adopts this recommendation directly.
- **Hub-and-spoke matches SQLite's single-writer model**: the hub is the single writer; spokes proxy through. No `SQLITE_BUSY` errors from cross-machine contention. The `busy_timeout=5000` absorbs brief contention from multiple hub processes on the same machine.
- **mDNS / Bonjour peer discovery is simple and works on Windows 10+**: the `bonjour-service` NPM package (Node.js, MIT, pure JS) is the recommended implementation. Manual hub-IP configuration is the fallback for networks that block mDNS (port 5353 UDP).
- **Hotel industry itself converges on hub-and-spoke**: LinkedIn / Max Starkov: _"Why the hub-and-spoke model is the future of hotel tech."_ SmartAgentics matches the industry model.
- **P2P mesh is rejected for three reasons**: (1) no central authority → CRDTs required → overhead + complexity; (2) hotel PMS needs a hub anyway (the hub is the natural single writer); (3) every established sync engine rejects P2P for transactional data (Turso: "Peer-to-peer. Fully distributed sync between devices is not supported").
- **LiteFS / rqlite / dqlite are rejected for Phase 1–2**: all three require server processes; conflict with offline-first single-machine STANDALONE Phase 1. LiteFS is for Fly.io multi-region same-app replication; rqlite/dqlite use Raft consensus (designed for distributed SQLite in server-side scenarios; not for hotel LAN with Windows desktops).
- **PostgreSQL as local hub DB is rejected by ADR-001**: SQLite is the local DB (zero-config, offline-first). PostgreSQL is reserved for the Phase 2+ cloud sync target (per ADR-076).
- **Phase 1 ships STANDALONE only**: per ADR-001 offline-first commitment. Hub-and-spoke is Phase 2 implementation. The architecture contract (SDK `SyncEngine` interface with `LAN_HUB` / `LAN_SPOKE` modes reserved) is in place so Phase 2 implementation is straightforward.
- **Hub is a soft single-point-of-failure for write availability**: mitigated by Phase 2+ local-replica mode (spokes operate read-only or read-write-on-local-replica during hub outage); manual hub failover (a spoke can be promoted to hub); documented operator runbook. PoC-01 (per ADR-071) validates hub failover with zero data loss.
- **The CRITICAL SQLite-over-SMB prohibition is enforced at three levels**: installer (refuses to start on network path), runtime (exits with clear error on network filesystem detection), verifier rule (flags documentation/config suggesting SQLite-over-SMB is acceptable). Defense-in-depth.

## 6. Consequences

- Phase 1 ships STANDALONE only. The `SyncHubService` and `bonjour-service` dependency are Phase 2. The SDK `SyncEngine` interface is defined with `LAN_HUB` and `LAN_SPOKE` modes reserved (per ADR-079).
- **SQLite-over-SMB is FORBIDDEN at three levels**: installer check, runtime check, verifier rule. ADR-006 amendment (separately performed) documents the prohibition explicitly.
- Phase 2 LAN_SYNCED activation adds: `SyncHubService` (new Restate service + Next.js API routes); `bonjour-service` dependency; the 5 HTTP proxy endpoints (`/sync/query`, `/sync/transact`, `/sync/push`, `/sync/pull`, `/sync/ack`).
- Phase 2+ local-replica mode adds: spoke-local SQLite replica; SyncEngine client implementation; hub-failover runbook.
- **R-7.20 risk (hub is single point of failure for write availability)**: mitigated by Phase 2+ local-replica mode (spokes continue operating on local SQLite during hub outage); manual hub failover (a spoke can be promoted to hub); documented operator runbook; PoC-01 (per ADR-071) validates hub failover with zero data loss.
- **R-7.21 risk (mDNS blocked on hotel networks — some enterprise networks block port 5353 UDP)**: mitigated by manual hub-IP configuration fallback; documented network requirements in the installer; PoC-01 validates manual-IP fallback.
- **R-7.22 risk (hub performance bottleneck under high spoke count)**: mitigated by WAL + serialized writes handling 10–20 spokes comfortably (hotel LAN typical); for > 50 spokes, recommend splitting by department (housekeeping hub, restaurant hub) — Phase 3+.
- **R-7.23 risk (Windows mDNS quirks — Bonjour Print Services for Windows required; some Windows firewall configurations block mDNS)**: mitigated by installer including Bonjour Print Services as a prerequisite; documented network requirements; manual-IP fallback.
- **R-7.24 risk (operator ignores the SQLite-over-SMB prohibition and puts the SQLite file on a network share anyway)**: mitigated by installer refusing to start on network path; runtime exiting with clear error; verifier rule flagging documentation/config suggesting SQLite-over-SMB is acceptable. If an operator bypasses these checks (e.g., manually editing config), database corruption is the expected outcome — documented in the operator runbook as a self-inflicted wound.
- **R-7.25 risk (hub machine hardware failure — disk crash, power supply failure)**: mitigated by Phase 2 optional Litestream continuous WAL streaming to S3 for disaster recovery (per ADR-076); manual backup to cloud (encrypted SQLite file to S3) in Phase 1 STANDALONE mode.
- Dependencies: ADR-001 (Reference Stack; PostgreSQL reserved for cloud), ADR-005 (Prisma), ADR-006 (SQLite; amended separately for WAL config + better-sqlite3 + LAN-via-proxy-not-via-SMB + sync metadata), ADR-007 (Restate — for `SyncHubService`), ADR-055 (signed-JWT agent identity — for spoke-to-hub auth), ADR-070 (umbrella architecture), ADR-071 (PoC-01 validates this topology), ADR-072 (sync metadata schema), ADR-073 (transactional outbox — `SyncHubService` reads `SyncOutbox`), ADR-076 (cloud sync boundary — Phase 2+ cloud activation), ADR-077 (failure recovery — Layer 6 circuit breaker on hub), ADR-079 (SyncEngine SDK — `LAN_HUB` / `LAN_SPOKE` transport). **No new runtime dependencies in Phase 1.** Phase 2 adds `bonjour-service` (MIT, pure JS).
- Phase 3+ AI-BOS extension: multi-property chains extend the hub-and-spoke pattern — each property has its own hub; cloud PostgreSQL is the chain-wide aggregator (per ADR-076). The hub-and-spoke + cloud-star topology scales to arbitrary property counts.

## 7. Review Conditions

- Review if Phase 2 PoC-01 (LAN sync stress test, per ADR-071) fails on the hub-failover criterion (data loss on hub recovery) — would trigger ADR-075 revision (alternative failover protocol or earlier adoption of Phase 2+ local-replica mode as the Phase 2 default).
- Review if Phase 2 PoC-01 fails on the mDNS-discovery criterion — would trigger earlier adoption of manual-IP configuration as the default discovery mechanism.
- Review if Phase 2 operator feedback indicates the SQLite-over-SMB prohibition is being circumvented (e.g., operators using symbolic links or junction points to network paths) — would warrant additional runtime checks (e.g., `os.statfs` to detect network filesystems) and stricter installer validation.
- Review if Phase 2+ hub performance becomes a bottleneck (e.g., > 20 spokes on a single hub) — would trigger earlier adoption of department-split hubs (Phase 3+).
- Review if Phase 3+ multi-property chains require a different LAN topology (e.g., multiple hubs per property for redundancy) — would warrant a Phase 3+ ADR.
- Review if a Windows mDNS alternative emerges (e.g., a Microsoft-shipped mDNS service that does not require Bonjour Print Services) — would simplify the Windows installer prerequisites.
- Review if a community hotel-PMS LAN-topology standard emerges (e.g., an HTNG LAN sync specification) that should replace the SmartAgentics-owned hub-and-spoke design.
- Review if Phase 3+ Raft-style automatic hub failover is warranted (currently manual operator action) — would warrant a Phase 3+ ADR adding a Raft consensus layer to the hub-and-spoke topology.
- Review if Phase 2+ operator feedback indicates the `SyncHubService` HTTP proxy API is insufficient (e.g., a spoke needs a different endpoint) — would warrant extending the API.
- Review if Phase 3+ AI-BOS multi-property collaboration requires direct spoke-to-spoke sync (bypassing the hub) for low-latency cross-property operations — would warrant re-evaluating the P2P-mesh rejection (currently the cloud star topology handles cross-property; direct P2P is rejected).
