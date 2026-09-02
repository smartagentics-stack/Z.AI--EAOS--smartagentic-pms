# ADR-098: Hybrid Persistence Strategy (3-Layer: Platform Core / Domain Reference / Dynamic Records)

**ADR-ID:** ADR-098
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR-097 defines the domain meta-model (JSON Schema 2020-12 + `EntityType`/`Record`/`EntityFieldIndex`). This ADR defines **where each kind of data lives** — the three-layer persistence strategy that operationalizes the meta-model. The directive's hybrid diagram (lines 490–502) and DATA FLEXIBILITY RULE (lines 1372–1378) require that strong typing, validation, indexing, querying, reporting, auditability, security, and migration capability be preserved across all storage.

Web research (Phase D Revision research report, Topic 2) confirms the layered pattern is well-established:

- **PostgreSQL JSONB vs SQLite JSON**: JSONB is preferred for cloud-scale (dbVis: "jsonb wins the performance race"; Snowflake engineering blog documents TOAST overhead for large JSONB; Lumigo: GIN indexes are larger than B-tree). **Implication**: PostgreSQL JSONB + GIN is the Phase 2+/3+ cloud option; SQLite JSON + generated-column B-tree indexes is the Phase 1 option. The hybrid strategy works in both engines.
- **Migration strategy for schema evolution**: Prisma Migrate handles platform-core migrations (Model/Entity-first vs Database-first patterns per Prisma docs). Dynamic entities evolve via `EntityType.schemaVersion` + migration rules embedded in the schema JSON (`$schema` versioning + `additionalProperties: false` strict mode).
- **Multi-tenancy patterns** (ZenStack multi-tenant blog, Mar 2023): two primary approaches — physical-isolation (DB per tenant) vs logical-isolation (shared DB with `tenantId`). SmartAgentics uses logical isolation (per ADR-078) for Phase 1/2; physical isolation is reserved for Phase 3+ high-security tenants.
- **The hybrid pattern is well-established in production** — typed core tables for system entities (User, Tenant, AuditEvent) + JSON columns for tenant-defined custom fields. This matches ADR-012's existing pattern of storing `payload` as JSON in `SyncRecord`.

Phase E must establish the foundation contracts. Phase F+ ships the visual entity builder that populates Layer 3.

## 2. Problem

Should SmartAgentics (a) put everything in strongly-typed Prisma models (breaks domain-neutrality), (b) put everything in one untyped `Record` table (violates the directive's DATA FLEXIBILITY RULE; destroys type-safety for the platform spine), (c) use database-per-domain physical isolation (operationally heavy; conflicts with ADR-078 logical isolation), or (d) adopt a three-layer strategy: Layer 1 typed platform core, Layer 2 typed domain reference data, Layer 3 dynamic `Record` table — with sync metadata and validation on all three layers?

## 3. Options

### Option A: Everything as strongly-typed Prisma models

Rejected. Same rejection as ADR-097 Option A. Admin-defined entities become impossible without runtime Prisma migration.

### Option B: Everything as untyped `Record` rows

Rejected. Destroys type-safety for the platform spine (`Tenant`, `User`, `AgentContract`, `Tool`, `AuditEvent`, `SyncOutbox`). The directive's DATA FLEXIBILITY RULE explicitly forbids treating the platform as an untyped JSON database. Sync metadata, foreign keys, referential integrity, and Prisma's type-safe query builder are all lost.

### Option C: Database-per-domain physical isolation

Rejected for Phase 1. Operationally heavy (a deployment that activates 5 domains manages 5 SQLite files). Conflicts with ADR-078's logical-isolation strategy (one SQLite per Phase 1 deployment; per-property in Phase 2+; per-tenant SQLite for high-security in Phase 3+). The `tenantId` axis is already the primary isolation axis; adding `domainId` as a physical axis doubles the operational surface. Reserved as a Phase 2+ option if cross-domain query performance demands it.

### Option D: Three-layer hybrid persistence — Platform Core / Domain Reference / Dynamic Records

Adopted. Layer 1 strongly-typed Prisma (the platform spine); Layer 2 strongly-typed Prisma per opt-in domain package; Layer 3 generic `Record` table for admin-defined entities. All three layers carry ADR-006 Amendment 1 / ADR-072 sync metadata. Validation, indexing, auditability, and migration apply to all three layers with layer-appropriate mechanisms.

## 4. Decision

Adopt **Option D** — the Three-Layer Hybrid Persistence Strategy.

### Layer 1 — Platform Core (strongly-typed Prisma)

Reserved for cross-cutting concerns that no domain can override or extend:

`Tenant`, `Domain`, `Module`, `EntityType`, `EntityField` (metadata), `Relationship`, `User`, `Role`, `AgentContract`, `Tool`, `ToolPermission`, `AuditEvent`, `SyncOutbox`, `SyncCheckpoint`, `SyncConflict`, `FeatureFlag`, `WorkflowDefinition`, `RuleDefinition`, `SchemaMigration`.

- **Migrated via Prisma Migrate** — schema evolution is a code change + migration, reviewed and tested in CI.
- **Never stored as dynamic records** — these are the system's spine; compromising them compromises every domain.
- All Layer-1 models carry ADR-072 sync metadata (`updatedAt, revision, deletedAt, syncOrigin, idempotencyKey`).

### Layer 2 — Domain Reference Data (strongly-typed Prisma per domain package)

Each domain package ships its own strongly-typed Prisma models. PMS ships: `Reservation`, `Room`, `RoomType`, `Guest`, `Invoice`, `Payment`, `HousekeepingTask`, `Restaurant`, `Menu`, `MenuItem`, `FolioBalance`. The School domain (future) ships `Student`, `Course`, `Enrollment`, `Grade`.

- **Opt-in**: a deployment that doesn't activate the School domain doesn't get the `Student` table. Domain activation is gated by the ADR-102 `domain.<name>.enabled` feature flag.
- **Versioned with the domain package**: the PMS domain package has its own semver; a PMS v2.0.0 may add a `loyaltyTier` column to `Guest` via a Prisma migration shipped with the package.
- **`storageClass = "typed"` in `EntityType`**: each Layer-2 model has a corresponding `EntityType` row (metadata only — `typedTableName` points to the Prisma model). This lets ADR-103's schema-to-prompt compiler generate AI tools for typed entities uniformly with dynamic entities.
- **Custom Fields on Layer-2 entities**: a `customFieldsJson Json?` column on each Layer-2 model stores admin-added custom fields (the "Custom Field" pattern from ERPNext/Frappe). Custom field definitions live in `EntityField` metadata; values live in the entity's `customFieldsJson`.
- All Layer-2 models carry ADR-072 sync metadata.

### Layer 3 — Dynamic Records (generic `Record` table)

Used ONLY for entities defined at runtime by an administrator via the visual entity builder (Phase F+). Phase E reserves the table; it does not ship the builder.

- **`storageClass = "dynamic"` in `EntityType`**: the `EntityType.typedTableName` is null; records live in the generic `Record` table.
- **Canonical envelope** (per ADR-097 §4): `{ id, tenantId, domainId, entityTypeId, recordId, dataJson, schemaVersion, updatedAt, revision, deletedAt, syncOrigin, idempotencyKey }`. This is the single canonical shape for Layer 3 — ADR-012's canonical-shape principle is preserved per-storage-class.
- **Validation**: every write is validated against the EntityType's JSON Schema (AJV strict mode) before INSERT (per ADR-097 §4).
- **Indexing**: `EntityFieldIndex` table for fields declared `indexed: true`; SQLite generated-column indexes for high-traffic indexed fields (per ADR-097 §4).
- **Querying**: `EntityFieldIndex` provides B-tree-speed filtering; full-text search via FTS5 virtual table mirroring `searchable: true` fields.
- **Migration**: `EntityType.schemaVersion` increments on schema change; a `SchemaMigration` table records migrations (field renames, type changes, defaults); records are lazily migrated on read or batch-migrated by a Restate workflow.
- **Auditability**: every Record mutation writes a `SyncOutbox` row (per ADR-073) and an `AuditEvent` row referencing `(entityTypeId, recordId, schemaVersion)`.
- All Layer-3 records carry ADR-072 sync metadata by construction (the `Record` Prisma model includes the five mandatory columns).

### SchemaMigration table (Layer-3 evolution)

```prisma
model SchemaMigration {
  id              String   @id @default(cuid())
  entityTypeId    String
  fromVersion     Int
  toVersion       Int
  migrationJson   Json     // declarative migration rules: field renames, type coercions, defaults
  appliedAt       DateTime @default(now())
  appliedBy       String   // userId or "system"
  @@unique([entityTypeId, fromVersion, toVersion])
}
```

Migration rules are declarative (not code): `{ fieldRenames: [{from, to}], typeCoercions: [{field, fromType, toType, coerceFn}], defaults: [{field, value}] }`. A Restate workflow `SchemaMigrationWorkflow` batch-migrates records; lazy migration on read is a fallback for long-tail records.

### Sync integration (extends ADR-070 / ADR-072 / ADR-073)

`Record` and `EntityFieldIndex` mutations flow through `SyncOutbox` like any typed table. The Prisma middleware (per ADR-073 §8) is extended to intercept mutations on these generic tables:

- `SyncOutbox.tableName` carries the EntityType name (e.g., `"Bar"`) for dynamic records, or the Prisma model name (e.g., `"Reservation"`) for typed entities.
- `SyncOutbox.payloadJson` carries the CloudEvents-encoded envelope (per ADR-101) — uniform across all three layers.
- The verifier rule (per ADR-072 §6) is extended to flag any mutable table — including `Record` and `EntityFieldIndex` — missing the five sync-metadata columns.

### Isolation axes (extends ADR-078)

- **Primary axis**: `tenantId` (per ADR-078 logical isolation; one SQLite per Phase 1 deployment; per-property in Phase 2+; per-tenant SQLite for high-security in Phase 3+).
- **Secondary axis**: `domainId` — enforced at the application layer (Prisma middleware injects `domainId` filter on every query). NOT a physical partition key in Phase 1.
- **Future (Phase 2+)**: if cross-domain queries become a performance issue, a future ADR may add `domainId` as a partition key. Reserved; not needed for Phase 1.

### Amendment / reference register

| Existing ADR                                 | Relationship                            | Change                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-012 (Canonical Domain Model)**         | AMENDED (HIGH — FC-DN-01)               | "One canonical shape per entity" → "one canonical envelope per storage class." Layer-1 has one shape per system entity; Layer-2 has one shape per domain entity; Layer-3 has ONE canonical envelope (`Record`) whose payload shape varies per EntityType. Same pattern ADR-012 already uses for `SyncRecord` (one envelope, variable payload). |
| **ADR-005 (Prisma)**                         | REFERENCED, REAFFIRMED                  | Layer 1 and Layer 2 are Prisma models. Layer 3 is a single Prisma model (`Record`) with `Json` column. Prisma Migrate handles Layers 1–2; Layer-3 schema evolution is data, not migration.                                                                                                                                                     |
| **ADR-006 (SQLite) + Amendment 1**           | REFERENCED, REINFORCED                  | SQLite JSON1 + generated columns support the Layer-3 pattern. Sync metadata mandatory on `Record` and `EntityFieldIndex` by construction.                                                                                                                                                                                                      |
| **ADR-072 (Sync Metadata Schema)**           | AMENDED (MODERATE — FC-DN-09)           | Sync metadata columns extended to `Record` and `EntityFieldIndex`. The ADR-072 verifier rule is extended to flag any mutable table missing these columns.                                                                                                                                                                                      |
| **ADR-078 (Per-Property Database Strategy)** | AMENDED (MODERATE — FC-DN-15)           | `tenantId` remains the primary isolation axis; `domainId` is a secondary axis enforced at the application layer (Prisma middleware). A future ADR may add `domainId` as a partition key in Phase 2+ if cross-domain queries become a performance issue. No separate database-per-domain in Phase 1.                                            |
| **ADR-070 (Offline Sync)**                   | AMENDED (MODERATE — FC-DN-08, FC-DN-14) | `Record` and `EntityFieldIndex` mutations flow through `SyncOutbox`. The Prisma middleware (ADR-073) is extended to intercept mutations on these generic tables. `SyncOutbox.tableName` carries the EntityType name for dynamic records.                                                                                                       |
| **ADR-073 (Transactional Outbox)**           | REFERENCED                              | Outbox pattern unchanged; the Prisma middleware auto-writes `SyncOutbox` rows on `Record` and `EntityFieldIndex` mutations.                                                                                                                                                                                                                    |
| **ADR-097 (Domain Meta-Model)**              | CROSS-REFERENCE                         | ADR-097 defines the meta-model; ADR-098 defines the three-layer strategy that uses it. Read together.                                                                                                                                                                                                                                          |
| **ADR-101 (CloudEvents Envelope)**           | CROSS-REFERENCE                         | `SyncOutbox.payloadJson` becomes CloudEvents-encoded (per ADR-101) uniformly across all three layers.                                                                                                                                                                                                                                          |
| **ADR-102 (Feature Flags)**                  | CROSS-REFERENCE                         | Layer-2 domain activation is gated by the `domain.<name>.enabled` feature flag.                                                                                                                                                                                                                                                                |

### Conflicts resolved

- **FC-DN-01** (ADR-012 HIGH) — resolved by the canonical-envelope-per-storage-class generalization.
- **FC-DN-03** (ADR-006 + Amendment 1 MODERATE) — resolved by mandating sync metadata on Layer-3 tables by construction.
- **FC-DN-08** (ADR-070 MODERATE) — resolved by routing `Record` and `EntityFieldIndex` mutations through `SyncOutbox`.
- **FC-DN-09** (ADR-072 MODERATE) — resolved by extending sync metadata to Layer-3 tables + renaming `payloadJson` to `eventJson` (per ADR-101).
- **FC-DN-14** (ADR-070 FC-7.4 MODERATE) — resolved by extending Prisma middleware to intercept generic-table mutations.
- **FC-DN-15** (ADR-078 MODERATE) — resolved by clarifying `tenantId` primary + `domainId` secondary isolation axes.

## 5. Rationale

- **Three layers mirror production ERP architecture** (ERPNext/Frappe, Salesforce): system tables (typed) + domain tables (typed, opt-in) + custom entities (metadata-driven). Practitioner consensus supports this layering; neither pure-typed nor pure-dynamic is viable.
- **Layer 1 (Platform Core) must be typed**: the system's spine (Tenant, User, AgentContract, Tool, AuditEvent, SyncOutbox) cannot be admin-redefinable. Type-safety here is non-negotiable; a bug in `SyncOutbox` breaks sync for every domain.
- **Layer 2 (Domain Reference) is typed and opt-in**: each domain package owns its Prisma models + migrations. A deployment activating only PMS gets only PMS tables. This matches the directive's domain-package model and avoids the "every deployment has every domain's tables" anti-pattern.
- **Layer 3 (Dynamic Records) is the only escape hatch**: reserved for admin-defined entities (Phase F+). Phase E reserves the table but does not ship the builder — the directive's PHASE BOUNDARY RULE (lines 1396–1408) is respected.
- **Sync metadata is uniform across layers**: every mutable row — typed or dynamic — carries `updatedAt, revision, deletedAt, syncOrigin, idempotencyKey`. The sync engine (ADR-079) treats all layers uniformly; `SyncOutbox.tableName` disambiguates. This is the only way sync can be domain-neutral.
- **PostgreSQL JSONB + GIN is the Phase 2+ cloud path**: the three-layer contracts are engine-agnostic. Phase 1 uses SQLite JSON + generated columns (per ADR-006); Phase 2+ cloud deployments may use PostgreSQL JSONB + GIN with no contract change.
- **`domainId` as secondary axis (not physical isolation) for Phase 1**: physical isolation (database-per-domain) doubles the operational surface (backup, sync, migration per domain). The application-layer enforcement via Prisma middleware is sufficient at hotel-PMS scale; physical isolation is reserved for Phase 2+ if query performance demands it.

## 6. Consequences

- New Prisma models: `SchemaMigration` (Layer-3 evolution). Layer-1 models (`Domain`, `Module`, `EntityType`, `Record`, `EntityFieldIndex`) are defined in ADR-097. Layer-2 models ship per domain package.
- Prisma middleware extension: intercept mutations on `Record` and `EntityFieldIndex`; auto-write `SyncOutbox` rows; inject `domainId` filter on every query.
- Verifier rule extension (per ADR-072 §6): flag any mutable Prisma model — including `Record` and `EntityFieldIndex` — missing the five sync-metadata columns.
- `SchemaMigrationWorkflow` Restate workflow: batch-migrates Layer-3 records on `EntityType.schemaVersion` increment.
- **Risk: Prisma middleware injects `domainId` filter on every query — performance overhead.** Mitigation: the filter is a single indexed equality predicate; negligible vs the query itself. The middleware is opt-out per-model for system tables that are cross-domain by design (`Tenant`, `Domain`, `EntityType`).
- **Risk: Layer-3 `EntityFieldIndex` write amplification.** Mitigation: per ADR-097 §6 — high-volume entities migrate to SQLite generated-column indexes.
- **Risk: schema-evolution migration backlog.** When an admin changes an EntityType schema, existing records may need migration. Mitigation: `SchemaMigrationWorkflow` runs batch migration; lazy migration on read is the fallback; the migration rules are declarative (not code), so they survive across releases.
- **Risk: ADR-012 amendment may surprise developers** who read ADR-012 as "every entity is one TypeScript shape." Mitigation: ADR-098 §4 amendment register is explicit; the per-storage-class generalization preserves ADR-012's intent (no shape ambiguity within a storage class).
- **Risk: ADR-078 amendment introduces `domainId` as a second isolation axis — developers may forget to filter.** Mitigation: Prisma middleware auto-injects the filter; the verifier rule flags raw Prisma queries that bypass the middleware.
- Dependencies: ADR-005 (Prisma), ADR-006 (SQLite + Amendment 1), ADR-007 (Restate — `SchemaMigrationWorkflow`), ADR-009 (Internal SDK), ADR-012 (Canonical Domain Model — amended), ADR-070 (Offline Sync — amended), ADR-072 (Sync Metadata — amended), ADR-073 (Transactional Outbox), ADR-078 (Per-Property Database — amended), ADR-097 (Domain Meta-Model — companion), ADR-101 (CloudEvents Envelope), ADR-102 (Feature Flags — domain activation gating).
- Phase E effort: ~2 weeks for the Prisma middleware extension, verifier rule, `SchemaMigration` model, and `SchemaMigrationWorkflow` skeleton.

## 7. Review Conditions

- Review if Phase 1 telemetry shows Prisma middleware `domainId` filter injection exceeds 2% of query latency — would optimize the middleware or move filtering to a compile-time Prisma extension.
- Review if `EntityFieldIndex` write amplification becomes a hot-path bottleneck — would migrate the affected EntityType to SQLite generated-column indexes (per ADR-097 §6).
- Review if `SchemaMigrationWorkflow` batch migration proves insufficient for very large EntityType record sets (> 1M rows) — would warrant a parallel-migration strategy or a streaming-migration Restate service.
- Review if Phase 2+ cross-domain queries (e.g., a hotel dashboard joining PMS `Reservation` with Bar `Tab`) become a performance issue — would warrant a Phase 2+ ADR adding `domainId` as a physical partition key or a cross-domain materialized view.
- Review if a community standard for hybrid persistence (e.g., a metadata-driven ORM) emerges that should replace the SmartAgentics-owned three-layer strategy.
- Review if Phase 3+ multi-tenant cloud deployment requires a different Layer-3 storage engine (PostgreSQL JSONB + GIN, or a dedicated document store) — would warrant a Phase 3+ persistence-engine ADR; the three-layer contracts are engine-agnostic.
- Review if Layer-2 domain packages proliferate to the point that Prisma migration coordination becomes a release bottleneck — would warrant a domain-package schema-versioning ADR.
- Review if the directive's §19 visual entity builder (Phase F+) requires a different Layer-3 access pattern (e.g., a per-EntityType materialized view) not anticipated by ADR-098 — would warrant a Phase F+ ADR.
