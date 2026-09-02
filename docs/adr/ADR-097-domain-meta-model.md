# ADR-097: Domain Meta-Model & Dynamic Schema (JSON Schema 2020-12 + Hybrid Persistence)

**ADR-ID:** ADR-097
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

The senior-engineer Phase D Revision directive re-targets SmartAgentics from "PMS with AI" to "configurable domain operating platform, PMS as first domain." The directive's DATA FLEXIBILITY RULE (lines 1372–1378) pre-decides the central question: **do not solve domain flexibility by making the entire platform an untyped JSON database** — instead preserve strong typing, validation, indexing, querying, reporting, auditability, security, and migration capability. The directive explicitly references `json-schema.org` (line 250) as the format for entity definitions and prescribes a hybrid diagram (lines 490–502) combining a typed core with schema-driven dynamic records.

Web research (Phase D Revision research report, Topic 1) confirms the architectural posture:

- **JSON Schema Draft 2020-12 is the canonical schema-description format** (`https://json-schema.org/specification`). It introduces `prefixItems`, `unevaluatedProperties`, and `dependentSchemas` (conditional validation) — sufficient for entity types, field constraints, conditional required fields, and relationship cardinality. The IETF draft `draft-bhutton-json-schema-01` (June 2022) formalizes the media type for cross-vendor interoperability. **AJV** (`https://ajv.js.org/json-schema.html`) is the de-facto TypeScript validator with full Draft 2020-12 support.
- **Prisma compiles its schema at build time** and does not natively support runtime-defined models (ZenStack blog, Nov 2024: "Prisma's JSON type provides a generic escape hatch"; Prisma discussion #11601 confirms shared-database multi-tenancy via `tenantId`, not schema-per-tenant). **Implication**: dynamic entity definitions live as data rows in an `EntityType` table with a `schemaJson` column, not as Prisma models.
- **EAV is universally rejected by practitioner communities.** Cybertec PostgreSQL (Nov 2021): "entity-attribute-value design — don't do it!" DBA StackExchange (Feb 2023): "Anything is better than EAV. Typically, the best approach is to have common attributes as regular columns and the oddballs [as JSON]." Evolveum midPoint (Apr 2022): "JSON with index takes less space than EAV + ext table with their indexes (4GB vs 7GB)." **Implication**: hybrid model — typed columns for platform core; a single `Record` table with `dataJson` for dynamic entities; an `EntityFieldIndex` hybrid-index table only for searchable field values.
- **SQLite JSON1 is mature and supports generated-column indexing** for near-column-speed queries (sqlite.org json1, Jul 2026; dbpro.app, Dec 2025; jamSQL). No need to migrate off SQLite (ADR-006) for Phase 1 of the domain-neutral architecture.
- **ERP platforms converge on the same pattern**: ERPNext/Frappe "Custom Fields" stored as metadata rows + JSON or dynamic-column values; Salesforce custom fields are real columns added at deployment. **Implication**: SmartAgentics supports BOTH (a) "Custom Field" pattern — an admin adds a field to an existing typed entity → field registered in `EntityField` metadata + stored in the entity's `customFieldsJson`; (b) "Custom Entity" pattern — an admin defines a brand-new entity → registered in `EntityType` metadata + records stored in the generic `Record` table.
- **Domain-Driven Design + metadata-driven architecture** is the established pattern (Microsoft .NET microservices e-book; dev.to, Nov 2025).

Phase E must establish the foundation contracts but must NOT ship the visual entity builder (Phase F+ per directive §19). This ADR defines the contracts only.

## 2. Problem

Should SmartAgentics (a) model every entity as a strongly-typed Prisma model (breaks domain-neutrality — no admin-defined entities possible), (b) make the entire platform an untyped JSON document store (violates the directive's DATA FLEXIBILITY RULE and the practitioner consensus against pure EAV), (c) adopt a pure EAV model (universally rejected for query performance, storage, and indexing reasons), or (d) adopt a hybrid meta-model: JSON Schema 2020-12 as canonical entity-definition format + strongly-typed Prisma models for platform core + a generic `Record` table with `Json` payload for dynamic entities?

## 3. Options

### Option A: Every entity is a strongly-typed Prisma model

Rejected. Breaks domain-neutrality. Admin-defined entities (e.g., a hotel defines a "Bar" entity; a school defines a "Student" entity) would require code generation + Prisma migration at runtime — unsupported and unsafe. The directive explicitly requires runtime-extensible entity definitions.

### Option B: Entire platform is an untyped JSON document store

Rejected. Violates the directive's DATA FLEXIBILITY RULE (lines 1372–1378) which mandates preservation of strong typing, validation, indexing, querying, reporting, auditability, security, and migration capability. Practitioner consensus (Cybertec, DBA StackExchange, Evolveum) is overwhelmingly against untyped dynamic storage as the sole strategy.

### Option C: Pure EAV model (one row per field-value)

Rejected. Universally rejected by PostgreSQL, SQLite, and ERP practitioner communities. Poor query performance (multi-join for every entity read), storage overhead (Evolveum: 7GB EAV vs 4GB JSON), no native indexing. ADR-006 Amendment 1's sync-metadata columns (`tenantId, updatedAt, revision, deletedAt, syncOrigin, idempotencyKey`) become per-row-per-field overhead — catastrophic for sync bandwidth.

### Option D: Hybrid meta-model — JSON Schema 2020-12 canonical entity-definition format + strongly-typed Prisma platform core + generic `Record` table for dynamic entities + `EntityFieldIndex` hybrid-index

Adopted. JSON Schema 2020-12 is the canonical entity-definition format, stored as data in an `EntityType` Prisma table (`schemaJson Json NOT NULL`), validated at load time by AJV. The platform core remains strongly-typed Prisma models. Dynamic entity records are stored in a generic `Record` table with `dataJson Json`, plus an `EntityFieldIndex` hybrid-index table for fields declared `indexed: true` or `searchable: true`. SQLite generated-column indexes provide column-speed queries on high-traffic dynamic fields.

## 4. Decision

Adopt **Option D** — the Hybrid Meta-Model.

### Canonical entity-definition format

**JSON Schema Draft 2020-12** (`https://json-schema.org/draft/2020-12/schema`) is the canonical entity-definition format. Every `EntityType.schemaJson` MUST:

- Declare `$schema: "https://json-schema.org/draft/2020-12/schema"`.
- Use `additionalProperties: false` (strict mode) unless the entity explicitly allows extension fields.
- Use `dependentSchemas` for conditional-required fields (e.g., `refund.reason` required when `refund.amount > 0`).
- Use `prefixItems` for ordered tuple fields.
- Embed SmartAgentics extension keywords under a `x-smartagentics` namespace: `indexed`, `searchable`, `filterable`, `sortable`, `aggregatable`, `reportable`, `aiReadable`, `aiWritable` (per directive E23, lines 916–925; consumed by ADR-103 schema-to-prompt compiler).

### AJV validation at load time

Every `EntityType` row is validated against the JSON Schema 2020-12 meta-schema by **AJV** (`ajv` + `ajv-formats`) at:

1. **Publish time** — when an admin (Phase F+) or a domain package declares an `EntityType`, the schema is compiled and cached; the publish fails fast on schema error.
2. **Boot time** — the SDK's `EntityTypeRegistry` compiles all `EntityType` schemas on process start; compilation errors are fatal (fail-fast).
3. **Write time** — every `Record` INSERT/UPDATE is validated against the EntityType's compiled AJV validator BEFORE the Prisma transaction commits. Invalid writes throw `SchemaValidationError` and never reach the database.

### SDK interfaces (extends ADR-009 `packages/sdk/src/domain/`)

```typescript
export interface Domain {
  id: string;
  tenantId: string | null; // null = platform-wide domain (e.g., "pms" baseline)
  name: string; // "pms", "school", "bar"
  displayName: string;
  version: string; // semver of the domain package
  active: boolean;
}

export interface Module {
  id: string;
  domainId: string;
  name: string; // "reservations", "housekeeping"
  displayName: string;
  active: boolean;
}

export interface EntityType {
  id: string;
  domainId: string;
  moduleId: string | null;
  name: string; // "Reservation", "Bar", "MenuItem"
  schemaJson: object; // JSON Schema 2020-12 document
  schemaVersion: Int; // monotonic; increments on schema change
  storageClass: 'typed' | 'dynamic'; // typed = Layer-2 Prisma model; dynamic = Layer-3 Record
  typedTableName: string | null; // for storageClass='typed', the Prisma model name
  publishedAt: DateTime;
  deprecatedAt: DateTime | null;
}

export interface FieldDefinition {
  // Reflects a field inside EntityType.schemaJson.properties with x-smartagentics metadata
  entityTypeId: string;
  name: string;
  jsonSchemaType: string; // "string" | "number" | "boolean" | ...
  indexed: boolean;
  searchable: boolean;
  filterable: boolean;
  sortable: boolean;
  aggregatable: boolean;
  reportable: boolean;
  aiReadable: boolean;
  aiWritable: boolean;
}

export interface Relationship {
  id: string;
  domainId: string;
  name: string; // "Reservation.guestId → Guest.id"
  sourceEntityTypeId: string;
  sourceFieldName: string;
  targetEntityTypeId: string;
  cardinality: 'one-to-one' | 'one-to-many' | 'many-to-many';
  onDelete: 'restrict' | 'cascade' | 'set-null';
}

export interface Record {
  // The single canonical envelope for Layer-3 dynamic records
  id: string;
  tenantId: string;
  domainId: string;
  entityTypeId: string;
  recordId: string; // domain-meaningful id (e.g., "RES-2026-001")
  dataJson: object; // validated against EntityType.schemaJson
  schemaVersion: Int; // EntityType.schemaVersion at write time
  // ADR-006 Amendment 1 / ADR-072 sync metadata (mandatory by construction)
  updatedAt: DateTime;
  revision: Int;
  deletedAt: DateTime | null;
  syncOrigin: string | null;
  idempotencyKey: string | null;
}
```

### Prisma models

```prisma
model Domain {
  id          String   @id @default(cuid())
  tenantId    String?  // null = platform-wide
  name        String   @unique
  displayName String
  version     String
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  // sync metadata per ADR-072
  revision      Int       @default(0)
  deletedAt     DateTime?
  syncOrigin    String?
  idempotencyKey String?
  modules     Module[]
  entityTypes EntityType[]
  @@unique([tenantId, name])
  @@index([tenantId, updatedAt])
}

model Module {
  id          String   @id @default(cuid())
  domainId    String
  name        String
  displayName String
  active      Boolean  @default(true)
  domain      Domain   @relation(fields: [domainId], references: [id])
  entityTypes EntityType[]
  // sync metadata per ADR-072
  updatedAt   DateTime @updatedAt
  revision      Int       @default(0)
  deletedAt     DateTime?
  syncOrigin    String?
  idempotencyKey String?
  @@unique([domainId, name])
}

model EntityType {
  id              String   @id @default(cuid())
  domainId        String
  moduleId        String?
  name            String
  schemaJson      Json     // JSON Schema 2020-12 document
  schemaVersion   Int      @default(1)
  storageClass    String   // "typed" | "dynamic"
  typedTableName  String?
  publishedAt     DateTime @default(now())
  deprecatedAt    DateTime?
  domain          Domain   @relation(fields: [domainId], references: [id])
  // sync metadata per ADR-072
  updatedAt       DateTime @updatedAt
  revision        Int      @default(0)
  deletedAt       DateTime?
  syncOrigin      String?
  idempotencyKey  String?
  records         Record[]
  @@unique([domainId, name])
  @@index([domainId, storageClass])
}

model Record {
  id            String   @id @default(cuid())
  tenantId      String
  domainId      String
  entityTypeId  String
  recordId      String              // domain-meaningful id
  dataJson      Json                // validated against EntityType.schemaJson
  schemaVersion Int                 // EntityType.schemaVersion at write time
  entityType    EntityType @relation(fields: [entityTypeId], references: [id])
  // sync metadata per ADR-072 (mandatory by construction)
  updatedAt     DateTime @updatedAt
  revision      Int      @default(0)
  deletedAt     DateTime?
  syncOrigin    String?
  idempotencyKey String?
  @@unique([tenantId, entityTypeId, recordId])
  @@index([tenantId, domainId, entityTypeId, updatedAt])
  @@index([tenantId, entityTypeId, deletedAt])
}

model EntityFieldIndex {
  // Hybrid-index table — one row per (recordId, fieldName) for fields declared
  // indexed:true or searchable:true in the entity schema. NOT an EAV store;
  // a denormalized B-tree-friendly index over Record.dataJson.
  id            String   @id @default(cuid())
  tenantId      String
  domainId      String
  entityTypeId  String
  recordId      String
  fieldName     String
  fieldValueJson Json    // value coerced to JSON for uniform storage
  // sync metadata per ADR-072
  updatedAt     DateTime @updatedAt
  revision      Int      @default(0)
  deletedAt     DateTime?
  syncOrigin    String?
  idempotencyKey String?
  @@unique([entityTypeId, recordId, fieldName])
  @@index([tenantId, entityTypeId, fieldName, fieldValueJson])
}
```

### SQLite generated-column indexes (high-traffic dynamic fields)

For fields declared `indexed: true` with high traffic volume, the platform additionally creates **SQLite generated-column indexes** directly on `Record.dataJson`:

```sql
-- Per-EntityType, per-field generated virtual column + index
ALTER TABLE Record ADD COLUMN res_status_virtual
  TEXT GENERATED ALWAYS AS (json_extract(dataJson, '$.status')) VIRTUAL;
CREATE INDEX idx_record_res_status ON Record(tenantId, entityTypeId, res_status_virtual);
```

Generated-column indexes are created lazily by the `EntityTypeRegistry` when it detects a high-traffic indexed field (heuristic: > 1000 reads/hour on that field's `EntityFieldIndex`). This avoids index bloat for rarely-queried fields.

### Phase E scope (foundation contracts only)

Phase E delivers: (a) the SDK interfaces above; (b) the Prisma models above; (c) the `EntityTypeRegistry` with AJV compilation; (d) the generic `Record` write/read path with AJV validation. **Phase E does NOT ship the visual entity builder** (Phase F+ per directive §19, lines 1012–1049). Domain packages (PMS first) ship pre-declared `EntityType` rows for their typed entities (`Reservation`, `Room`, `Guest`, `Invoice`, etc.) so that ADR-103 schema-to-prompt tooling has metadata to compile.

### Amendment / reference register

| Existing ADR                              | Relationship              | Change                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-012 (Canonical Domain Model)**      | AMENDED (HIGH — FC-DN-01) | "One canonical shape per entity" generalizes to "one canonical envelope per storage class." Layer-3 `Record` is a single canonical envelope whose `dataJson` payload varies per EntityType — the same pattern ADR-012 already uses for `SyncRecord` payload.                                                                                                                    |
| **ADR-005 (Prisma)**                      | REFERENCED, REAFFIRMED    | Prisma remains the ORM for platform-core (typed) models. Dynamic records use one generic `Record` Prisma model with `Json` column. No conflict at the Prisma-tooling level; only at the conceptual "every entity is a Prisma model" level (which ADR-005 never claimed).                                                                                                        |
| **ADR-006 (SQLite) + Amendment 1**        | REFERENCED, REINFORCED    | `Record` and `EntityFieldIndex` carry the mandatory sync-metadata columns (`tenantId, updatedAt, revision, deletedAt, syncOrigin, idempotencyKey`) by construction. The ADR-072 verifier rule is extended to flag any mutable table — including `Record` and `EntityFieldIndex` — missing these columns. SQLite JSON1 + generated columns support the Layer-3 pattern natively. |
| **ADR-009 (Internal SDK)**                | AMENDED (FC-DN-04)        | SDK extended with `packages/sdk/src/domain/` interfaces: `Domain`, `Module`, `EntityType`, `FieldDefinition`, `Relationship`, `Record`. Same pattern as existing SDK — interfaces only, no implementations.                                                                                                                                                                     |
| **ADR-098 (Hybrid Persistence Strategy)** | CROSS-REFERENCE           | ADR-097 defines the meta-model; ADR-098 defines the three-layer persistence strategy that uses it. Read together.                                                                                                                                                                                                                                                               |
| **ADR-103 (Domain-to-AI Context)**        | CROSS-REFERENCE           | ADR-103 consumes `EntityType.schemaJson` + `FieldDefinition.aiReadable`/`aiWritable` to auto-generate AI tools and prompt preambles.                                                                                                                                                                                                                                            |
| **ADR-072 (Sync Metadata Schema)**        | REFERENCED, REINFORCED    | `Record` and `EntityFieldIndex` mutations flow through `SyncOutbox` like any typed table (per FC-DN-08 / FC-DN-14). `SyncOutbox.tableName` carries the EntityType name for dynamic records.                                                                                                                                                                                     |
| **ADR-073 (Transactional Outbox)**        | REFERENCED                | The Prisma middleware auto-writes `SyncOutbox` rows on `Record` and `EntityFieldIndex` mutations — same pattern as for typed models.                                                                                                                                                                                                                                            |

### Conflicts resolved

- **FC-DN-01** (ADR-012 HIGH) — resolved by generalizing the canonical-shape principle to "one canonical envelope per storage class."
- **FC-DN-02** (ADR-005 MODERATE) — resolved by reaffirming Prisma for typed core and using one generic `Record` Prisma model for dynamic entities.
- **FC-DN-03** (ADR-006 + Amendment 1 MODERATE) — resolved by mandating sync metadata on `Record` and `EntityFieldIndex` by construction.
- **FC-DN-04** (ADR-009 MODERATE) — resolved by extending `packages/sdk/src/domain/` with domain meta-model interfaces.

## 5. Rationale

- **JSON Schema 2020-12 is the canonical format** (research Topic 1): it is an IETF-tracked, vendor-neutral specification; `additionalProperties: false` strict mode enforces field discipline; `dependentSchemas` enables conditional validation required for entity constraints. AJV is the de-facto TypeScript validator with full 2020-12 support and compile-time caching suitable for the hot path.
- **Hybrid meta-model is the only posture that satisfies the directive's DATA FLEXIBILITY RULE** (lines 1372–1378): validation (AJV strict mode at write time), indexing (`EntityFieldIndex` + SQLite generated columns), querying (B-tree-speed filtering via `EntityFieldIndex`; FTS5 for `searchable: true` fields), reporting (the `reportable` field flag drives ADR-103 analytics views), auditability (every `Record` mutation writes a `SyncOutbox` row + `AuditEvent` row per ADR-073/ADR-013), security (per-field `aiReadable`/`aiWritable` consumed by ADR-103), migration capability (`EntityType.schemaVersion` + `SchemaMigration` rules embedded in schema JSON).
- **Pure EAV is universally rejected** (Cybertec, DBA StackExchange, Evolveum) — 7GB vs 4GB storage, multi-join query plans, no native indexing. The `EntityFieldIndex` table is a hybrid EAV-INDEX only for searchable field values, NOT the storage strategy — storage remains JSON.
- **SQLite JSON1 + generated columns make dynamic records viable at hotel-PMS scale** (sqlite.org, dbpro.app, jamSQL) without migrating off ADR-006. PostgreSQL JSONB + GIN remains the Phase 2+/3+ cloud option (per ADR-098).
- **ERP platforms converge on this pattern** (ERPNext/Frappe, Salesforce) — both support (a) Custom Fields on existing entities and (b) Custom Entities. ADR-097 supports both: `customFieldsJson` on typed entities + generic `Record` for dynamic entities.
- **Domain-Driven Design + metadata-driven architecture** is the established pattern (Microsoft .NET microservices e-book; dev.to) — the meta-model is the architectural spine of any configurable domain platform.
- **Phase E foundation, Phase F+ builder**: the directive's PHASE BOUNDARY RULE (lines 1396–1408) and §19 (lines 1012–1049) require Phase E to establish contracts without shipping visual builders. ADR-097 delivers the SDK interfaces + Prisma models + AJV validation pipeline; the visual entity builder is Phase F+.

## 6. Consequences

- New Prisma models: `Domain`, `Module`, `EntityType`, `Record`, `EntityFieldIndex`. Migration is additive — no existing model is modified.
- New SDK module: `packages/sdk/src/domain/` with the six interfaces above.
- New runtime component: `EntityTypeRegistry` — boot-time AJV compiler of all `EntityType.schemaJson` documents; fail-fast on schema error.
- New Prisma middleware hook: validate `Record` writes against the EntityType's compiled AJV validator before transaction commit.
- **Risk: AJV compilation cost on hot path.** Mitigation: AJV validators are compiled once at publish time and cached; write-path validation is O(field-count), not O(recompile).
- **Risk: `EntityFieldIndex` write amplification.** Every `Record` write triggers N index-row writes (one per `indexed:true` field). Mitigation: index rows are written in the same Prisma transaction; for high-volume entities, the SQLite generated-column index replaces `EntityFieldIndex` (avoiding the row amplification).
- **Risk: schema-evolution migration.** When `EntityType.schemaVersion` increments, existing `Record` rows may violate the new schema. Mitigation: `SchemaMigration` table records field renames, type changes, defaults; records are lazily migrated on read or batch-migrated by a Restate workflow (per ADR-098 §4).
- **Risk: ADR-012 amendment may surprise developers** who read ADR-012 as "every entity is one TypeScript shape." Mitigation: ADR-097 §4 amendment register is explicit; the canonical-envelope-per-storage-class generalization preserves ADR-012's intent (no shape ambiguity within a storage class).
- Dependencies: ADR-005 (Prisma), ADR-006 (SQLite + Amendment 1), ADR-009 (Internal SDK), ADR-012 (Canonical Domain Model — amended), ADR-072 (Sync Metadata), ADR-073 (Transactional Outbox), ADR-098 (Hybrid Persistence — companion), ADR-103 (Domain-to-AI Context — consumer).
- Phase E effort: ~3 weeks for the meta-model SDK interfaces, Prisma models, `EntityTypeRegistry`, AJV validation pipeline, and the verifier rule extension.

## 7. Review Conditions

- Review if Phase 1 telemetry shows AJV write-path validation exceeds 5% of request latency — would move validation to publish time only with a deferred write-time check.
- Review if `EntityFieldIndex` write amplification proves to be a hot-path bottleneck for a high-volume EntityType — would migrate that EntityType to SQLite generated-column indexes (avoiding `EntityFieldIndex`).
- Review if a community standard for entity meta-models emerges (e.g., a JSON Schema profile for entity-relationship modeling) that should replace the SmartAgentics `x-smartagentics` extension namespace.
- Review if Phase 2+ cloud deployment requires PostgreSQL JSONB + GIN instead of SQLite generated-column indexes — would warrant a Phase 2+ persistence-engine ADR (the meta-model contracts are engine-agnostic).
- Review if the directive's §19 visual entity builder (Phase F+) requires additional `EntityType` fields (e.g., UI hints, validation-rule overlays) not anticipated by ADR-097 — would warrant a Phase F+ additive-column ADR.
- Review if schema-evolution migration (lazy vs batch) proves insufficient — would warrant an explicit `SchemaMigration` ADR with formal migration-rule DSL.
- Review if cross-domain `Relationship` references (e.g., a PMS `Reservation` referencing a Bar `Tab`) require denormalization or a join-service — would warrant a Phase 2+ relationship-resolution ADR.
