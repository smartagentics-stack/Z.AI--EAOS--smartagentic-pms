# ADR-078: Per-Property Database Strategy — Phase 1 One SQLite per Deployment; Phase 2+ One per Property; Phase 3+ Per-Tenant SQLite for High-Security Cloud Tenants

**ADR-ID:** ADR-078
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR-006 (SQLite) is an 8-line stub. ADR-001 commits SmartAgentics to SQLite as the local database via Prisma. The existing Prisma schema (`prisma/schema.prisma`) has `tenantId` on every mutable table (NOT NULL, indexed), `idempotencyKey` on 4 of 10 models with `@@unique([tenantId, idempotencyKey])`. Phase B's gap assessment (B4) flagged the multi-tenant isolation question for SQLite as a Stream 7 research topic: how does multi-tenant isolation work in SQLite (which has no row-level security unlike PostgreSQL)? When does SmartAgentics shift from one-SQLite-per-deployment to one-SQLite-per-property to per-tenant-SQLite-files?

Stream 7 research (`/home/z/my-project/phase-c-stream7-offline-sync-report.md`, §3) surveyed the multi-tenant isolation literature. Azure SQL Database "Multitenant SaaS patterns" (`https://learn.microsoft.com/en-us/azure/azure-sql/database/saas-tenancy-app-design-patterns`, Aug 2025): _"A multitenant database necessarily sacrifices tenant isolation. The data of multiple tenants is stored together in one database."_ Redis blog "Data isolation in multi-tenant SaaS environments" (`https://redis.io/blog/data-isolation-multi-tenant-saas`, Feb 2026): three primary models — (1) shared database shared schema (tenant_id column); (2) shared database schema-per-tenant; (3) database-per-tenant. _"Each tenant gets a completely separate database instance. This offers strong isolation."_ Reddit r/laravel (`https://www.reddit.com/r/laravel/comments/1ujnh1f`, 2026): _"You probably don't need a database per tenant"_ — for most SaaS, shared-database-with-tenant_id is the right choice. Hacker News "Shardines: SQLite3 Database-per-Tenant with ActiveRecord" (`https://news.ycombinator.com/item?id=43811400`, Apr 2025): _"Postgres with row-based access control is a much better solution to database per tenant/strong isolation."_ — note: this is about PostgreSQL, not SQLite. SQLite has no row-level security (RLS) feature; tenant isolation in SQLite is enforced at the application layer (Prisma middleware).

The EAOS Data Architecture (`/home/z/my-project/download/EAOS-Data-Architecture.md`) documents the Prisma middleware pattern (mandatory tenant isolation):

```typescript
prisma.$use(async (params, next) => {
  if (TENANT_SCOPED_MODELS.includes(params.model) && params.action !== 'create') {
    if (!hasTenantFilter(params.args)) {
      throw new Error(`Query on ${params.model} missing tenantId filter`);
    }
  }
  return next(params);
});
```

Every tenant-scoped table has `tenantId`. System tables (no `tenantId`): `system_config`, `feature_flags`.

The "database-per-tenant vs shared-database" debate is settled differently for SQLite than for PostgreSQL (per Stream 7 §3.3):

- **PostgreSQL** has RLS, schema-per-tenant namespaces, mature multi-tenant tooling. Shared-database-with-RLS is the production-default for most SaaS.
- **SQLite** has none of these. The only isolation mechanisms are: (a) `tenantId` column + application-layer enforcement (Prisma middleware); or (b) separate SQLite files per tenant (physical isolation).
- For Phase 1 SmartAgentics (one tenant per deployment), the choice is trivial: shared-database-with-tenantId (which in practice has only one tenant per file). The `tenantId` column is forward-compatibility insurance.
- For Phase 2+ multi-property chains, the choice is between: (a) one SQLite file per property (per-tenant-database pattern, recommended); or (b) one SQLite file with multiple `tenantId`s (shared-database pattern, only if all properties are on the same physical machine — rare).
- For Phase 3+ cloud multi-tenant SaaS, the choice shifts to PostgreSQL (where RLS is available). SQLite-per-tenant remains for high-security opt-in tenants.

This ADR formalizes: (1) Phase 1 one SQLite file per deployment with `tenantId` on every mutable table (NOT NULL, indexed); (2) Phase 2+ one SQLite file per property for multi-property chains with cloud PostgreSQL aggregation; (3) Phase 3+ per-tenant SQLite files for high-security cloud tenants (opt-in); (4) the `tenantId` column is mandatory on every mutable table from Phase 1 — even when only one tenant exists per file — to preserve forward compatibility; (5) Prisma middleware enforces the tenant filter on every query; (6) the verifier rule flags any mutable Prisma model missing `tenantId` column or index.

## 2. Problem

Should SmartAgentics (a) use PostgreSQL with RLS as the local DB (rejected by ADR-001 — requires server process), (b) use SQLite schema-per-tenant (SQLite has no schema namespaces like PostgreSQL; the closest is `ATTACH DATABASE` with separate files, which is just per-tenant-database under a different name), (c) use separate SQLite file per tenant in Phase 1 (adds operational complexity for no benefit when there is only one tenant per deployment), (d) use shared-database-with-tenantId in all phases (loses the physical-isolation option for high-security cloud tenants), or (e) use a phased approach — Phase 1 one SQLite per deployment with tenantId; Phase 2+ one per property; Phase 3+ per-tenant SQLite for high-security opt-in?

## 3. Options

### Option A: PostgreSQL with RLS as local DB

Rejected by ADR-001. SQLite is the local DB (zero-config, offline-first, proven; PostgreSQL requires a server process). PostgreSQL is reserved for the Phase 2+ cloud sync target (per ADR-076).

### Option B: SQLite schema-per-tenant

Rejected. SQLite has no schema namespaces like PostgreSQL. The closest is `ATTACH DATABASE` with separate files, which is just per-tenant-database under a different name (per Stream 7 §3.5). No benefit over Option E's per-tenant SQLite files.

### Option C: Separate SQLite file per tenant in Phase 1

Rejected for Phase 1. Adds operational complexity (multiple files to back up, multiple Prisma clients to manage) for no benefit when there is only one tenant per deployment. Reserved for Phase 3+ high-security opt-in (per Option E).

### Option D: Shared-database-with-tenantId in all phases (no per-tenant SQLite option)

Rejected. Loses the physical-isolation option for high-security cloud tenants (luxury brands, chains, regulated industries like casino hotels with gaming-compliance requirements). Stream 2/3/4's "Phase 2+ strong-isolation option" (per-tenant SQLite files) is the right reserved option for these tenants.

### Option E: Phased approach — Phase 1 one SQLite per deployment with tenantId; Phase 2+ one per property; Phase 3+ per-tenant SQLite for high-security opt-in

Adopted. Phase 1 ships one SQLite file per deployment (one hotel property = one tenant = one `.db` file). The `tenantId` column is mandatory on every mutable table from Phase 1 — even when only one tenant exists per file — to preserve forward compatibility. Phase 2+ uses one SQLite file per property for multi-property chains; cloud PostgreSQL aggregates. Phase 3+ uses per-tenant SQLite files for high-security cloud tenants (opt-in). Prisma middleware enforces the tenant filter on every query. The verifier rule flags any mutable Prisma model missing `tenantId` column or index.

## 4. Decision

Adopt **Option E** — phased per-property database strategy.

### Phase 1 — One SQLite file per deployment

- One SQLite database file per deployment (single hotel property = single tenant = single `.db` file), Prisma ORM, `better-sqlite3` driver with WAL mode + `busy_timeout`, `tenantId` on every mutable row, Prisma middleware enforcing tenant filter (existing pattern from ADR-006 + Streams 2/3/4).
- The `tenantId` column is mandatory (NOT NULL, indexed) on every mutable table — even when only one tenant exists per file. This future-proofs the schema for Phase 2+ multi-tenant cloud deployments and for the rare Phase 1 case where a single physical machine hosts multiple properties.
- Prisma middleware enforces the tenant filter on every query (existing pattern from EAOS Data Architecture):
  ```typescript
  prisma.$use(async (params, next) => {
    if (TENANT_SCOPED_MODELS.includes(params.model) && params.action !== 'create') {
      if (!hasTenantFilter(params.args)) {
        throw new Error(`Query on ${params.model} missing tenantId filter`);
      }
    }
    return next(params);
  });
  ```
  The middleware throws if any query on a tenant-scoped model lacks a `tenantId` filter (except `create`).
- SQLite has NO row-level security (RLS) (unlike PostgreSQL). Tenant isolation in SQLite is enforced at the application layer (Prisma middleware + Zod schema validation). This is acceptable because the application layer is the only access path — there is no direct SQL access from outside the app.
- In practice, Phase 1 deployments have only one tenant per file (one hotel property = one tenant = one `.db` file). The `tenantId` column is forward-compatibility insurance — it costs nothing (an indexed NOT NULL column) and preserves the Phase 2+ multi-property evolution path.

### Phase 2+ — One SQLite file per property for multi-property chains

- A hotel chain with 5 properties has 5 SQLite files (one per property), each with a single `tenantId` (= propertyId). Cloud PostgreSQL aggregates all 5 for chain-wide reporting (per ADR-076).
- This is the **per-tenant-database pattern** at the property level. Each property's SQLite file is physically isolated from other properties' files. A bug in one property's data does not affect another property's data.
- The hub-and-spoke LAN topology (per ADR-075) operates per-property: each property has its own hub; spokes sync to their property's hub. Cross-property sync is via the cloud star topology (per ADR-076), not via direct property-to-property sync.
- The `tenantId` column now has multiple distinct values across the chain's SQLite files (one value per file), but within each file there is still only one tenant. The Prisma middleware still enforces the tenant filter; the middleware is per-file (each Prisma client instance targets one file).

### Phase 3+ — Per-tenant SQLite files for high-security cloud tenants (opt-in)

- Stream 2/3/4's "Phase 2+ strong-isolation option" — a separate SQLite file per cloud tenant. Reserved for luxury brands, chains, or regulated industries (e.g., casino hotels with gaming-compliance requirements) that demand physical file isolation. Not the default; opt-in.
- In Phase 3+ cloud multi-tenant SaaS, the default shifts to PostgreSQL with RLS (where RLS is available). SQLite-per-tenant remains for high-security opt-in tenants.
- The `tenantId` column is still mandatory (NOT NULL, indexed) on every mutable table — even in PostgreSQL deployments — to preserve the application-layer tenant filter as defense-in-depth alongside PostgreSQL RLS.

### The `tenantId` column is mandatory from Phase 1

The `tenantId` column is mandatory (NOT NULL, indexed) on every mutable table from Phase 1 — even when only one tenant exists per file. Reasons:

1. **Forward compatibility**: Phase 2+ multi-property chains and Phase 3+ cloud multi-tenant SaaS both require `tenantId`. Adding it in Phase 1 (when the schema is small and the migration is cheap) avoids a costly migration later (when the schema is large and the migration touches every row).
2. **Defense-in-depth**: even in Phase 1 STANDALONE mode, the Prisma middleware enforces the tenant filter. A developer bug that forgets `tenantId` in a `WHERE` clause is caught by the middleware. This is defense-in-depth for the rare Phase 1 case where a single physical machine hosts multiple properties.
3. **Verifier rule enforcement**: the verifier rule (per ADR-070 Phase 1 scope) flags any mutable Prisma model missing `tenantId` column or index. The rule is in place from Phase 1; schema drift is caught in CI.
4. **Cost is negligible**: an indexed NOT NULL column on every mutable table costs negligible storage and negligible query overhead. The benefit (forward compatibility + defense-in-depth + verifier-rule enforcement) far exceeds the cost.

### System tables (no `tenantId`)

System tables (no `tenantId`): `system_config`, `feature_flags` (per EAOS Data Architecture). These are global configuration tables; they are not tenant-scoped. The Prisma middleware exempts them from the tenant-filter check.

## 5. Rationale

- **B4 satisfaction + Stream 2/3/4 alignment**: Stream 2/3/4's "Phase 2+ strong-isolation option" (per-tenant SQLite files) is reserved as the Phase 3+ high-security opt-in. The Phase 1 shared-database-with-tenantId is the existing pattern; Phase 2+ per-property SQLite files is the natural evolution.
- **The "database-per-tenant vs shared-database" debate is settled differently for SQLite than for PostgreSQL**: PostgreSQL has RLS, schema-per-tenant namespaces, mature multi-tenant tooling. SQLite has none of these. The only SQLite isolation mechanisms are: (a) `tenantId` column + application-layer enforcement (Prisma middleware); or (b) separate SQLite files per tenant (physical isolation). SmartAgentics uses (a) for Phase 1–2+; (b) for Phase 3+ high-security opt-in.
- **Phase 1 one-SQLite-per-deployment is correct because each Phase 1 deployment is one hotel property = one tenant = one SQLite file**: there is only one tenant per database in practice, so the "multi-tenant isolation" question is moot for Phase 1 STANDALONE deployments. The `tenantId` column is forward-compatibility insurance.
- **Phase 2+ per-property SQLite files for multi-property chains is the per-tenant-database pattern at the property level**: each property's SQLite file is physically isolated. Cloud PostgreSQL aggregates for chain-wide reporting. This matches the Ink & Switch local-first Ideal 7 (ownership) — each property owns its SQLite file.
- **Phase 3+ per-tenant SQLite files for high-security cloud tenants is the strong-isolation opt-in**: reserved for luxury brands, chains, regulated industries. Not the default; opt-in. The default for Phase 3+ cloud multi-tenant SaaS shifts to PostgreSQL with RLS.
- **The `tenantId` column is mandatory from Phase 1**: forward compatibility + defense-in-depth + verifier-rule enforcement. Cost is negligible; benefit far exceeds cost.
- **SQLite has no RLS — application-layer enforcement is the only option**: Prisma middleware + Zod schema validation. This is acceptable because the application layer is the only access path — there is no direct SQL access from outside the app. Defense-in-depth (Prisma middleware + Zod schema + integration tests that verify cross-tenant queries return empty results).
- **Prisma middleware is the existing pattern from EAOS Data Architecture**: SmartAgentics adopts the EAOS pattern (per ADR-006). The middleware throws on missing `tenantId` filter; the verifier rule flags any mutable Prisma model missing `tenantId` column or index.
- **Phase 1 effort is zero** (the `tenantId` pattern is already in place per ADR-006 + Streams 2/3/4). Stream 7 only adds the explicit Phase 2+/3+ evolution path.

## 6. Consequences

- Phase 1 ships with the existing `tenantId` pattern (one SQLite file per deployment; `tenantId` NOT NULL indexed on every mutable table; Prisma middleware enforces tenant filter). No new tables, no new columns (the `tenantId` column is already in place per the existing Prisma schema). Phase 1 deployment is single-tenant-per-file in practice.
- Phase 2+ multi-property chains add: one SQLite file per property; cloud PostgreSQL aggregation (per ADR-076); per-property Prisma client instances (one per file). The Prisma middleware is per-file.
- Phase 3+ high-security cloud tenants add: per-tenant SQLite files (opt-in); the default for Phase 3+ cloud multi-tenant SaaS shifts to PostgreSQL with RLS.
- **R-7.39 risk (cross-tenant data leak via buggy query — a developer forgets `tenantId` in a `WHERE` clause)**: mitigated by Prisma middleware throwing on missing `tenantId` filter; the architecture-drift verifier rule (per ADR-070 Phase 1 scope) flags any mutable Prisma model missing `tenantId` column or index; integration tests verify cross-tenant queries return empty results.
- **R-7.40 risk (SQLite has no RLS — isolation is only as good as the application layer)**: mitigated by defense-in-depth (Prisma middleware + Zod schema + integration tests); the application layer is the only access path (no direct SQL access from outside the app).
- **R-7.41 risk (Phase 2+ per-property Prisma client instances add operational complexity — multiple clients to manage)**: mitigated by a `PrismaClientFactory` that returns the correct client per `tenantId` (propertyId); the factory abstracts the per-file routing. Phase 2+ implementation detail.
- **R-7.42 risk (Phase 3+ per-tenant SQLite files add operational complexity — multiple files to back up)**: mitigated by automated backup (Litestream continuous WAL streaming to S3 per ADR-076; or per-file encrypted SQLite upload); the operational complexity is the cost of the high-security opt-in. Tenants that don't need physical isolation stay on the default (PostgreSQL with RLS).
- **R-7.43 risk (a single physical machine hosts multiple properties in Phase 1 — rare but possible)**: mitigated by the `tenantId` column being NOT NULL from Phase 1; the Prisma middleware enforces the tenant filter; the multi-property deployment on a single machine is a supported (if rare) Phase 1 configuration.
- Dependencies: ADR-001 (Reference Stack; SQLite local + PostgreSQL cloud), ADR-005 (Prisma), ADR-006 (SQLite; amended separately for WAL config + better-sqlite3 + sync metadata), ADR-070 (umbrella architecture), ADR-072 (sync metadata schema — `tenantId` is part of the sync metadata), ADR-075 (LAN operation topology — per-property hubs), ADR-076 (cloud sync boundary — Phase 2+ cloud PostgreSQL aggregation). Stream 2 (sqlite-vec — `tenant_id` + `property_id` partition keys; per-tenant SQLite files Phase 2+ option). Stream 3 (Knowledge — tenant-scoped rows). Stream 4 (Memory — 4-dimensional scope `tenantId, propertyId, departmentId, userId/agentId`; per-tenant SQLite files Phase 2+ option). **No new runtime dependencies.**
- Phase 3+ AI-BOS extension: AI-BOS multi-tenant SaaS (directive File 2 §23) is the Phase 3+ realization. The Phase 1→2→3 evolution path (shared-SQLite → per-property-SQLite + cloud-PG → per-tenant-SQLite-for-high-security + cloud-PG-with-RLS) is the migration story. Cloud PostgreSQL with RLS is the Phase 3+ default for multi-tenant SaaS scale; per-tenant SQLite files remain for high-security opt-in.

## 7. Review Conditions

- Review if Phase 2+ multi-property chains require a different per-property isolation strategy (e.g., a property with multiple sub-tenants like a hotel-within-a-hotel) — would warrant a Phase 2+ sub-tenant ADR.
- Review if Phase 3+ per-tenant SQLite files prove operationally burdensome (e.g., a chain with 100 properties demands per-property SQLite files for compliance) — would warrant a Phase 3+ tooling ADR (automated per-tenant SQLite lifecycle management).
- Review if Phase 3+ cloud multi-tenant SaaS scale demands PostgreSQL with RLS earlier than Phase 3+ (e.g., a Phase 2+ deployment with > 50 properties on a single cloud PostgreSQL) — would warrant a Phase 2+ early-PostgreSQL-RLS ADR.
- Review if the `tenantId` column proves insufficient for Phase 3+ multi-property aggregation (e.g., a query needs to distinguish property-level vs. chain-level data) — would warrant a Phase 3+ `propertyId`-vs-`tenantId` clarification ADR (currently `tenantId` doubles as `propertyId` in Phase 1; Phase 2+ per-property databases may change this).
- Review if a community multi-tenant-SQLite standard emerges (e.g., a standardized Prisma middleware pattern from the SQLite multi-tenant ecosystem) that should replace the SmartAgentics-owned pattern.
- Review if Phase 2+ Prisma middleware performance overhead proves significant (the middleware runs on every query) — would warrant optimizing the middleware (e.g., short-circuit for known-single-tenant deployments).
- Review if Phase 3+ AI-BOS multi-tenant SaaS requires a different tenant-isolation strategy for AI data (e.g., AI agent memory isolation per Stream 4) — would warrant a Phase 3+ AI-tenant-isolation ADR.
- Review if Phase 2+ operator feedback indicates the per-property SQLite file approach is confusing (e.g., operators expect a single database for the chain) — would warrant documentation improvements or a different Phase 2+ deployment default.
- Review if Phase 3+ regulatory compliance (e.g., GDPR right-to-be-forgotten across per-tenant SQLite files) requires a different strategy — would warrant a Phase 3+ data-deletion-across-files ADR.
