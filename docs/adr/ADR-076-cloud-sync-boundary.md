# ADR-076: Cloud Sync Boundary — Phase 1 STANDALONE Only; Phase 2+ Optional CLOUD_SYNCED; Phase 3+ Multi-Property Aggregation

**ADR-ID:** ADR-076
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR-001 line 25 commits SmartAgentics to **PostgreSQL as the future cloud database** ("For future cloud sync; mature; supports pgvector if needed"). PDD defines the product as an **offline-first Hotel PMS for Nigerian/African hospitality markets** (per Phase B report §B1.2 RA-03). ADR-001 does not specify when cloud sync activates, what the activation boundary is, or how the SQLite↔PostgreSQL schema compatibility is handled. Stream 7 research (`/home/z/my-project/phase-c-stream7-offline-sync-report.md`, §12–§13) closes these gaps.

The cloud-is-optional principle is critical for SmartAgentics' offline-first commitment. Many hotel PMS vendors (Cloudbeds, Stayntouch, Agilysys — per Stream 7 §12.3 search results) are cloud-only; SmartAgentics differentiates by being **offline-first with optional cloud**. Stayntouch's "Best Multi-Property PMS for Hotel Chains in 2026" (`https://www.stayntouch.com/blog/best-multi-property-hotel-pms`) describes the cloud-only model: _"A multi-property PMS is a cloud-based property management platform that centralizes operations, data, and configuration across a distributed hotel portfolio."_ HotelManagement.net (`https://www.hotelmanagement.net/property-management/how-modern-cloud-pms-can-elevate-multi-property-management`, May 2024) notes the cloud-PMS advantage: _"A cloud PMS system allows hoteliers to forego installing and maintaining new on-site servers at each property."_ SmartAgentics inverts this: the on-site SQLite IS the system of record; cloud is a secondary replica for cross-property aggregation and off-site backup. This matches Ink & Switch's local-first Ideal 3 (network is optional) and Ideal 7 (ownership).

The SQLite↔PostgreSQL schema compatibility question is non-trivial. Prisma supports both SQLite and PostgreSQL as datasource providers, but a single `schema.prisma` targets ONE provider (SQLite OR PostgreSQL, not both simultaneously in the same client). Prisma's SQLite and PostgreSQL have different type systems: SQLite has no native `JSON` type (use `String`), no arrays, no enums (use `String` with validation), no `Decimal` (use `Float` or `String`). PostgreSQL has native `JSON`/`Jsonb`, arrays, enums, `Decimal`, `vector` (pgvector), native `UUID`, `TIMESTAMPTZ`. Stream 7 §13.2 recommends a **two-schema approach**: `schema.prisma` (SQLite, Phase 1) and `schema.cloud.prisma` (PostgreSQL, Phase 2+). The cloud schema is a **superset** of the local schema. The SyncEngine handles the type mapping on transport (Float→Decimal for money; String-JSON→Json; String-enum→enum; DateTime→TIMESTAMPTZ).

The `Float`→`Decimal` migration for money is the most critical mapping. SQLite has no native Decimal type; SmartAgentics stores money as `Float` locally (acceptable for a single-property PMS where amounts are small and Float precision is sufficient). Cloud PostgreSQL uses `Decimal` for chain-wide aggregation where Float drift would be unacceptable. The SyncEngine converts on transport with explicit rounding rules (`ROUND(amount, 2)`).

This ADR formalizes: (1) Phase 1 STANDALONE only (no cloud sync; optional manual backup to S3); (2) Phase 2 LAN_SYNCED (no cloud sync yet; optional Litestream continuous WAL streaming to S3 for DR); (3) Phase 2+ CLOUD_SYNCED optional per-tenant (per-property SQLite → cloud PostgreSQL via SyncEngine; cloud is secondary replica); (4) Phase 3+ multi-property aggregation (cloud PostgreSQL handles cross-property queries; per-property SQLite remains authoritative); (5) the two-schema approach (`schema.prisma` SQLite + `schema.cloud.prisma` PostgreSQL); (6) the type mapping (Float→Decimal, String-JSON→Json, String-enum→enum); (7) cloud sync is NEVER a prerequisite for core PMS operation. The `Tenant.syncMode` field (per ADR-072) controls activation per tenant.

## 2. Problem

Should SmartAgentics (a) ship cloud-first with offline cache (rejected by ADR-001 + PDD), (b) make cloud sync mandatory (conflicts with offline-first; many target markets have unreliable internet), (c) ship cloud-only with no local SQLite (lose the differentiation vs. cloud-only competitors; conflicts with offline-first), or (d) ship Phase 1 STANDALONE only with optional cloud sync activation in Phase 2+ (per-tenant opt-in; cloud is secondary replica; per-property SQLite remains authoritative for live PMS operations)?

## 3. Options

### Option A: Cloud-first with offline cache

Rejected by ADR-001 + PDD. Conflicts with offline-first commitment. Cloud is secondary; local SQLite is primary (per Ink & Switch Ideal 7: "we treat the copy of the data on your local device... as the primary copy. Servers still exist, but they hold secondary copies").

### Option B: Mandatory cloud sync

Rejected. Conflicts with offline-first. Many target markets (Nigerian/African hospitality) have unreliable internet. A property without internet must operate fully autonomously (per Ink & Switch Ideal 3: "The network is optional").

### Option C: Cloud-only (no local SQLite)

Rejected. Conflicts with offline-first. Loses the differentiation vs. cloud-only competitors (Cloudbeds, Stayntouch, Agilysys). Loses the Windows-installer-with-no-server-process requirement (ADR-001).

### Option D: Phase 1 STANDALONE only; Phase 2+ optional CLOUD_SYNCED (per-tenant opt-in; cloud is secondary replica)

Adopted. Phase 1 ships STANDALONE only (single SQLite, no cloud sync). Phase 2 ships LAN_SYNCED (hub-and-spoke; no cloud sync yet; optional Litestream continuous WAL streaming to S3 for DR). Phase 2+ ships optional CLOUD_SYNCED (per-tenant opt-in via `Tenant.syncMode`; per-property SQLite → cloud PostgreSQL via SyncEngine; cloud is secondary replica; per-property SQLite remains authoritative for live PMS operations). Phase 3+ ships multi-property aggregation (cloud PostgreSQL handles cross-property queries; per-property SQLite remains authoritative). Cloud sync is NEVER a prerequisite for core PMS operation — a property without internet operates fully autonomously.

## 4. Decision

Adopt **Option D** — Phase 1 STANDALONE only; Phase 2+ optional CLOUD_SYNCED; Phase 3+ multi-property aggregation.

### Phase-by-phase cloud sync activation timeline

**Phase 1 (STANDALONE)**: No cloud sync. Each property runs autonomously on local SQLite. Optional: manual backup to cloud (encrypted SQLite file uploaded to S3-compatible storage on schedule). The `Tenant.syncMode` field defaults to `"STANDALONE"`.

**Phase 2 (LAN_SYNCED)**: No cloud sync yet (hub-and-spoke LAN only, per ADR-075). Optional: Litestream-style continuous WAL streaming to S3 for disaster recovery (`https://litestream.io` — open-source, MIT/Apache-2.0, runs as a background process replicating SQLite WAL to S3). Litestream is NOT a sync engine (it is byte-level WAL replication for DR); it does not enable cross-property queries or cloud-side AI. It is a Phase 2 DR option for properties that want off-site backup beyond manual SQLite-file upload.

**Phase 2+ (CLOUD_SYNCED)**: Optional cloud sync activation per tenant. The `Tenant.syncMode` field controls whether the tenant syncs to cloud. When activated:

- Per-property SQLite → cloud PostgreSQL via SyncEngine (per ADR-070, ADR-079).
- Cloud PostgreSQL aggregates for chain-wide reporting (occupancy, revenue, ADR, RevPAR).
- Cloud can push down config changes (rate plans, room types, loyalty tiers) to properties (via the `SyncInbox` pattern per ADR-073 §4.9).
- Cloud is a secondary replica; per-property SQLite remains the system of record for live PMS operations (per Ink & Switch Ideal 7).

**Phase 3+ (multi-property aggregation)**: Cloud PostgreSQL handles cross-property queries, chain-wide analytics, central reservation office (CRO) for chains, loyalty program aggregation. Per-property SQLite remains authoritative. pgvector (Stream 2's Phase 2+ upgrade path) added to cloud schema for cloud-side vector search.

### When cloud sync is appropriate

- Multi-property chains that need central reporting.
- Properties that want off-site backup beyond Litestream.
- Chains with a central reservation office that takes bookings for all properties.
- Properties that participate in a chain-wide loyalty program.
- Properties that use cloud-based AI services (Stream 1's cloud AI fallback — per directive File 2 §23).

### When cloud sync is NOT appropriate

- Single-property hotels with no chain affiliation (Phase 1 STANDALONE is sufficient).
- Properties with unreliable internet (offline-first is the priority).
- Properties with regulatory constraints on data residency (e.g., GDPR-mandated in-country storage; the cloud PostgreSQL must be in the right region — `Tenant.cloudRegion` field, Phase 2+).

### Two-schema approach (SQLite + PostgreSQL)

**Phase 1 (STANDALONE)**: Prisma schema targets SQLite. All types are SQLite-compatible (`String`, `Int`, `Float`, `Boolean`, `DateTime`, `Bytes`). JSON stored as `String` (with Zod validation at application layer). Enums stored as `String` (with Zod validation). Money stored as `Float` (acceptable for single-property PMS where amounts are small).

**Phase 2+ (CLOUD_SYNCED)**: A **second** Prisma schema (`schema.cloud.prisma`) targets PostgreSQL for the cloud database. The cloud schema is a **superset** of the local SQLite schema:

- JSON columns become `Json` (PostgreSQL native).
- Enum strings become PostgreSQL enums (where the enum is stable).
- `Float` for money becomes `Decimal` (PostgreSQL native) — **critical for financial precision**.
- `Bytes` for blobs stays `Bytes`.
- `DateTime` becomes `DateTime` (PostgreSQL `TIMESTAMPTZ`).
- Additive: `tenantId`, `propertyId`, `revision`, `deletedAt`, `syncOrigin`, `idempotencyKey` — same as SQLite schema (per ADR-072).
- pgvector columns added for cloud-side vector search (Stream 2's pgvector upgrade path).

### Data type mapping (SQLite → PostgreSQL)

| SQLite type                 | PostgreSQL type            | Notes                                                                                                             |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `String` (JSON)             | `Json` / `Jsonb`           | Parse on read; validate with Zod                                                                                  |
| `String` (enum)             | `enum`                     | Define PostgreSQL enum                                                                                            |
| `Float` (money)             | `Decimal`                  | **Critical**: Float→Decimal migration for financial precision; SyncEngine applies `ROUND(amount, 2)` on transport |
| `String` (UUID)             | `Uuid`                     | Native UUID                                                                                                       |
| `DateTime` (timezone-naive) | `DateTime` (`TIMESTAMPTZ`) | Timezone-aware; SyncEngine adds `+00:00` on transport (always store UTC)                                          |
| `Bytes`                     | `Bytes`                    | Same                                                                                                              |
| `Int`                       | `Int`                      | Same                                                                                                              |
| `Boolean`                   | `Boolean`                  | Same                                                                                                              |

The SyncEngine cloud-transport layer transforms SQLite-row JSON to PostgreSQL-row JSON before upserting into PostgreSQL. The `payloadJson` field in `SyncOutbox` is SQLite-row JSON; the cloud-transport layer applies the mapping.

### Schema evolution

When a new column is added to the local SQLite schema (Prisma migration), the same column is added to the cloud PostgreSQL schema (separate Prisma migration). The SyncEngine's schema-version field (per ADR-079) ensures sync is paused until both schemas are upgraded. The CI verifier rule checks both schemas are in sync (same columns, compatible types).

### Cloud sync is NEVER a prerequisite for core PMS operation

This is the foundational principle. A property without internet must operate fully autonomously:

- All PMS operations (reservation, check-in, check-out, payment, housekeeping, reporting) work on the local SQLite.
- Sync to cloud (when active) is a background process; failure does not block PMS operations (per ADR-077 §4 Layer 6 — circuit breaker on hub; failed cloud → property continues on local SQLite).
- Cloud sync activation mid-tenant-lifecycle is supported (a property starts STANDALONE and later activates CLOUD_SYNCED; the initial sync is a large snapshot + delta; PoC-02 per ADR-071 tests this scenario).

### `Tenant` model fields (per ADR-072 + Phase 2+ additions)

- `syncMode String @default("STANDALONE")` — STANDALONE | LAN_HUB | LAN_SPOKE | CLOUD_SYNCED.
- `hubEndpoint String?` — URL of the LAN hub (for LAN_SPOKE mode).
- `hubPublicKey String?` — for verifying hub responses (signed JWT per Stream 5).
- `cloudRegion String?` (Phase 2+) — cloud PostgreSQL region for data residency compliance.
- `cloudSyncActivatedAt DateTime?` (Phase 2+) — when CLOUD_SYNCED was activated (for audit).

## 5. Rationale

- **FC-7.1 resolution (partial)**: ADR-001 says "PostgreSQL — for future cloud sync" but defines no sync protocol, no conflict policy, no schema metadata. This ADR defines the activation timeline (Phase 1 STANDALONE → Phase 2 LAN_SYNCED → Phase 2+ CLOUD_SYNCED → Phase 3+ multi-property aggregation); ADR-070 defines the protocol; ADR-074 defines the conflict policy; ADR-072 defines the schema metadata.
- **PDD satisfaction**: PDD defines product as "offline-first Hotel PMS for Nigerian/African hospitality markets". Cloud sync is optional; a property without internet operates fully autonomously. This matches Ink & Switch Ideal 3 (network is optional) and Ideal 7 (ownership).
- **Cloud-is-optional is the differentiation vs. cloud-only competitors**: Cloudbeds, Stayntouch, Agilysys are cloud-only; SmartAgentics is offline-first with optional cloud. This is a market-positioning decision as well as an architectural one.
- **Two-schema approach preserves the best of both**: SQLite's zero-config local + PostgreSQL's native JSON, Decimal, enum, pgvector. A single Prisma schema targeting the SQLite-common-subset would lose PostgreSQL's native capabilities. Two schemas with SyncEngine transport-mapping is the cleanest approach.
- **`Float`→`Decimal` migration for money is the most critical mapping**: SQLite has no native Decimal; SmartAgentics stores money as `Float` locally (acceptable for single-property). Cloud PostgreSQL uses `Decimal` for chain-wide aggregation where Float drift would be unacceptable. The SyncEngine applies `ROUND(amount, 2)` on transport. One-time migration script converts historical Float values to Decimal with explicit rounding rules (Phase 2+).
- **Timezone handling**: SQLite `DateTime` is timezone-naive; PostgreSQL `TIMESTAMPTZ` is timezone-aware. Mitigation: always store UTC; the SyncEngine adds `+00:00` on transport.
- **Cloud sync activation is per-tenant opt-in**: the `Tenant.syncMode` field controls activation. A property can stay STANDALONE indefinitely; another property in the same chain can activate CLOUD_SYNCED. This respects the "cloud is optional" principle at the tenant level.
- **Cloud sync activation mid-tenant-lifecycle is supported**: a property starts STANDALONE and later activates CLOUD_SYNCED. The initial sync is a large snapshot + delta. PoC-02 (per ADR-071) tests this scenario.
- **Cloud is NEVER a prerequisite for core PMS operation**: this is the foundational principle. A property without internet operates fully autonomously. Sync to cloud (when active) is a background process; failure does not block PMS operations (per ADR-077 §4 Layer 6).
- **Phase 2 optional Litestream for DR**: Litestream (`https://litestream.io`) is open-source (MIT/Apache-2.0), runs as a background process, replicates SQLite WAL to S3. It is NOT a sync engine (byte-level WAL replication for DR; does not enable cross-property queries or cloud-side AI). It is a Phase 2 DR option for properties that want off-site backup beyond manual SQLite-file upload.
- **Phase 3+ multi-property aggregation uses cloud PostgreSQL for cross-property queries**: per-property SQLite remains authoritative for live PMS operations. Cloud is a secondary replica. This matches the Ink & Switch local-first Ideal 7 (ownership) and the hotel industry's hub-and-spoke model (per ADR-075 §1).

## 6. Consequences

- Phase 1 ships STANDALONE only. `Tenant.syncMode` defaults to `"STANDALONE"`. The optional manual backup to S3 is a Phase 1 installer feature (encrypted SQLite file upload on schedule). No cloud sync; no cloud PostgreSQL dependency.
- Phase 2 ships LAN_SYNCED (hub-and-spoke, per ADR-075). Optional Litestream continuous WAL streaming to S3 for DR. No cloud sync; no cloud PostgreSQL dependency.
- Phase 2+ ships optional CLOUD_SYNCED (per-tenant opt-in). Adds: SyncEngine cloud-transport implementation (in-house, per ADR-079); cloud PostgreSQL instance (vendor choice deferred to Phase 2+ ADR); `schema.cloud.prisma`; SyncEngine type-mapping layer; `Tenant.cloudRegion` and `Tenant.cloudSyncActivatedAt` fields; `SyncInbox` table (per ADR-073 §4.9).
- Phase 3+ ships multi-property aggregation. Cloud PostgreSQL handles cross-property queries, chain-wide analytics, central reservation office, loyalty program aggregation. pgvector added to cloud schema for cloud-side vector search.
- **R-7.26 risk (cloud sync activation mid-tenant-lifecycle — initial sync is a large snapshot)**: mitigated by SyncEngine supporting initial snapshot + delta; Phase 2+ PoC tests this scenario (per ADR-071 PoC-02); for very large snapshots, the property can do a manual USB-stick restore from the cloud (rare edge case).
- **R-7.27 risk (cloud vendor lock-in)**: mitigated by SyncEngine abstracting the cloud transport (per ADR-079); PostgreSQL is the cloud DB (standard, portable); the cloud vendor can be swapped with a SyncEngine transport implementation change.
- **R-7.28 risk (data residency compliance — GDPR, NDPR)**: mitigated by `Tenant.cloudRegion` field (Phase 2+); tenant's data stays in the chosen region; the cloud PostgreSQL region is configurable per tenant.
- **R-7.29 risk (schema drift between `schema.prisma` SQLite and `schema.cloud.prisma` PostgreSQL)**: mitigated by SyncEngine schema-version field pausing sync if schemas diverge; CI verifier rule checks both schemas are in sync (same columns, compatible types).
- **R-7.30 risk (Float→Decimal precision loss in historical data)**: mitigated by one-time migration script converting historical Float values to Decimal with explicit rounding rules (`ROUND(amount, 2)`) at Phase 2+ cloud activation.
- **R-7.31 risk (cloud sync failure blocks PMS operations)**: mitigated by ADR-077 §4 Layer 6 (circuit breaker on hub; failed cloud → property continues on local SQLite; reconnect syncs on recovery); cloud sync is a background process; failure does not block PMS operations.
- **R-7.32 risk (cloud PostgreSQL cost for small properties)**: mitigated by cloud sync being per-tenant opt-in; small properties stay STANDALONE; cloud PostgreSQL is provisioned only when CLOUD_SYNCED is activated; free-tier providers (Supabase, Neon) for small properties.
- Dependencies: ADR-001 (Reference Stack; PostgreSQL for cloud), ADR-005 (Prisma), ADR-006 (SQLite), ADR-070 (umbrella architecture), ADR-071 (PoC-02 validates cloud sync activation), ADR-072 (sync metadata schema), ADR-073 (transactional outbox + `SyncInbox` for cloud→property), ADR-074 (conflict resolution), ADR-077 (failure recovery — Layer 6 circuit breaker), ADR-078 (per-property database strategy — Phase 2+ per-property SQLite databases), ADR-079 (SyncEngine SDK — `CLOUD_SYNCED` transport). Phase 2+ adds: cloud PostgreSQL instance; `schema.cloud.prisma`; SyncEngine cloud-transport implementation. Phase 2 (optional DR) adds: Litestream (`https://litestream.io`, MIT/Apache-2.0).
- Phase 3+ AI-BOS extension: AI-BOS multi-tenant SaaS (directive File 2 §23) is the Phase 3+ realization of CLOUD_SYNCED at scale. Cloud AI fallback (directive File 2 §23) requires cloud sync to be active; the SyncEngine interface abstracts this. Multi-property chains (directive File 2 §40 "Multi-Industry Platform") extend the star topology to multi-industry (each industry-vertical = its own cloud-PG aggregation).

## 7. Review Conditions

- Review if Phase 2+ cloud sync activation proves operationally complex (e.g., initial snapshot takes > 24 hours for a large property) — would warrant a Phase 2+ ADR for snapshot optimization (e.g., parallel snapshot by table; resumable snapshot).
- Review if Phase 2+ `Float`→`Decimal` migration produces unexpected precision issues (e.g., historical data with rounding errors) — would warrant a Phase 2+ data-cleansing ADR.
- Review if Phase 2+ cloud vendor choice (Supabase vs. Neon vs. self-hosted PostgreSQL vs. cloud-provider-managed PostgreSQL) proves suboptimal — would warrant a Phase 2+ cloud-vendor ADR.
- Review if Phase 3+ multi-property aggregation query performance is insufficient (e.g., cross-property occupancy report takes > 30 seconds) — would warrant a Phase 3+ query-optimization ADR (e.g., materialized views; pre-aggregation).
- Review if Phase 3+ AI-BOS multi-tenant SaaS scale demands a managed sync engine (PowerSync Open Edition or ElectricSQL, per ADR-070 review condition) — would trigger a Phase 3+ managed-sync-engine ADR.
- Review if a community cloud-sync standard emerges (e.g., a standardized SyncRules schema; an HTNG cloud sync specification) that should replace the SmartAgentics-owned cloud-transport layer.
- Review if Phase 2+ data residency compliance (GDPR, NDPR) requires multi-region cloud PostgreSQL (currently single-region per tenant) — would warrant a Phase 2+ multi-region ADR.
- Review if Phase 2+ Litestream DR option proves insufficient (e.g., RPO > 1 minute) — would warrant a Phase 2+ DR ADR (e.g., synchronous replication to a secondary region).
- Review if Phase 3+ multi-industry AI-BOS extension (directive File 2 §40) requires a different cloud topology (e.g., per-industry cloud PostgreSQL) — would warrant a Phase 3+ multi-industry ADR.
- Review if Phase 2+ operator feedback indicates the two-schema approach is operationally burdensome (e.g., schema migrations must be applied twice) — would warrant re-evaluating the single-schema-with-mapping approach (currently rejected per §3 of this ADR's two-schema rationale).
