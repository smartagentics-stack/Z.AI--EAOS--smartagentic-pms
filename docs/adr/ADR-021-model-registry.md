# ADR-021: Model Registry

**ADR-ID:** ADR-021
**Status:** ACCEPTED
**Context:** 2026-08-04
**Owner:** Architecture Office

---

## 1. Context

The AI-BOS directive (File 2 §2) classifies **Local AI Model Management** as an "Architecture Contract — NOW" capability, listing 17 required sub-capabilities: model registry, installed models, model metadata, model versions, model capabilities, model compatibility, model status, model loading, model unloading, model selection, model fallback, model health, model resource requirements, model lifecycle, model update mechanism, model rollback, model licensing metadata. Phase B B4 item #2 confirmed that the SmartAgentics SDK currently has NO `ModelRegistry` interface and the Prisma schema has NO `Model` table. ADR-011 currently classifies "Local Model Management" as a "Future Vision" capability (per Phase B report B3 GOV-CONFLICT-011).

Phase C Stream 1 research (`/home/z/my-project/phase-c-stream1-local-ai-runtime-report.md`, Foundational Conflict #2) established that Ollama already implements most of these sub-capabilities at the runtime level (content-addressable blob registry, manifest with versioning, `ollama run`/`ollama stop` for load/unload, `ollama ps` for health). The building blocks exist; SmartAgentics needs to add the application-layer ModelRegistry that wraps and audits them. Without a `ModelRegistry` interface and `Model` table in Phase 1, every downstream capability (Stream 2 Embeddings, Stream 3 RAG, Stream 5 Agent Runtime) has no way to reference "which model to use for what" — each consumer would hard-code model selection, making model updates, rollback, and tenant-specific model assignment impossible without rewriting each consumer.

## 2. Problem

The architectural problem: **define a `ModelRegistry` SDK interface and a `Model` Prisma schema entity that (a) is the single source of truth for "which models are installed and what they can do", (b) persists state across the ADR-019 lifecycle, (c) enforces ADR-018 version pinning by SHA256, (d) enforces ADR-020 license acceptability, (e) exposes activation / deactivation / list / get / rollback operations for use by `LocalLLMRuntime` (ADR-015) and downstream consumers, and (f) is additive to the existing Prisma schema (no breaking changes).** This ADR resolves Foundational Conflict #2 by creating the missing registry; a separate ADR-011 amendment should reclassify "Local Model Management" from "Future Vision" to "Architecture Contract — NOW".

## 3. Options

### Option A: Let Ollama's blob store be the registry (no SmartAgentics layer)

Use Ollama's `~/.ollama/models/manifests/` and `~/.ollama/models/blobs/` as the only registry. Rejected — Ollama has no concept of tenants, no audit trail, no version pinning (tags move), no license enforcement, no capability vocabulary, no compatibility tracking, no lifecycle state machine. Foundational Conflict #2 specifically calls out this gap (research Section 17, "Rejected alternatives"; Section 18, "Rejected alternatives").

### Option B: External KV store (e.g., Redis, etcd) as the registry

High-performance, distributed-ready. Rejected — adds a runtime dependency incompatible with ADR-001's SQLite-first / offline-first principle (per ADR-006); SmartAgentics hotels run offline; a Redis dependency breaks the offline contract. Overkill for 1–10 models per hotel.

### Option C: SmartAgentics `ModelRegistry` SDK interface backed by SQLite (per ADR-006), with a `Model` Prisma schema entity; Ollama's blob store remains the runtime-level store, but SmartAgentics' SQLite registry is the application-level source of truth

Define a `ModelRegistry` interface in `packages/sdk/src/ai/` backed by SQLite (ADR-006) via Prisma (ADR-005). The registry is the application-layer source of truth for model identity, version, capabilities, license, status, and installed location. Ollama's blob store remains the runtime-level file store; the SmartAgentics registry references blobs by SHA256 and reconciles drift on startup (per ADR-019 §7). Per research Foundational Conflict #2 and Phase E recommendations #1, #2, #5.

## 4. Decision

Adopt **Option C**. The Model Registry architectural contract is:

1. **SDK interface** — A `ModelRegistry` interface in `packages/sdk/src/ai/`:

   ```
   ModelRegistry {
     register(bundle: ModelBundle): Promise<ModelId>        // DISCOVERED → REGISTERED
     activate(modelId: ModelId, version: Version): Promise<void>   // REGISTERED → ACTIVATED
     deactivate(modelId: ModelId, version: Version): Promise<void> // ACTIVATED → DEACTIVATED
     list(filter?: ModelFilter): Promise<Model[]>           // query installed models
     get(modelId: ModelId, version: Version): Promise<Model> // fetch one
     rollback(modelId: ModelId, toVersion: Version): Promise<void> // ACTIVATED → ROLLED_BACK (Phase 2)
     remove(modelId: ModelId, version: Version): Promise<void>     // → REMOVED
     health(modelId: ModelId, version: Version): Promise<ModelHealth> // health probe
   }
   ```

2. **`Model` Prisma schema entity** (per B4 item #2 evidence — ID, Name, Version, Provider, Runtime, ModelType, ContextSize, Quantization, HardwareRequirements, Capabilities, Status, InstalledLocation, SecurityTrustMetadata):

   ```
   model Model {
     id                  String   @id @default(cuid())   // SmartAgentics internal ID
     modelId             String                          // e.g., "qwen2.5-7b-instruct" (matches manifest.modelId)
     name                String                          // human-readable
     version             String                          // semantic version (ADR-018)
     upstreamVersion     String?                         // upstream model version (informational)
     provider            String                          // e.g., "alibaba", "microsoft", "meta"
     runtime             String                          // "ollama" | "llama-server" | "localai" (ADR-015)
     modelType           String                          // "text-generation" | "embeddings" | "reranking" | "vision" | ...
     contextLength       Int                             // max context tokens
     quantization        String                          // "Q4_K_M" | "Q5_K_M" | "Q8_0" | ... (ADR-017)
     parameterCount      BigInt
     fileSizeBytes       BigInt
     sha256              String   @unique                // content-addressable pin (ADR-018)
     capabilities        Json                            // ["text-generation", "tool-calling", ...] (ADR-018)
     hardwareRequirements Json                          // { minRamGb, minVramGb, recommendedRamGb } (ADR-017)
     compatibility      Json                            // { minRuntimeVersion, maxRuntimeVersion, runtimeEngine, ggufVersion } (ADR-018)
     license             String                          // SPDX id or license name (ADR-020)
     licenseUrl          String?
     attribution         String?
     status              String                          // lifecycle state (ADR-019)
     installedLocation   String                          // path to GGUF file or Ollama tag
     securityTrustMetadata Json?                         // trust/signing metadata (Stream 8)
     installedAt         DateTime
     lastUsedAt          DateTime?
     lastHealthCheckAt   DateTime?
     createdAt           DateTime @default(now())
     updatedAt           DateTime @updatedAt

     @@unique([modelId, version])
     @@index([modelId])
     @@index([status])
     @@index([modelType])
   }
   ```

3. **`ModelFilter`** for `list(filter)`:

   ```
   ModelFilter {
     modelId?: string
     modelType?: string
     capabilities?: string[]       // any-of match
     status?: string               // lifecycle state
     runtime?: string
   }
   ```

4. **`ModelHealth`** value object (returned by `health()`):

   ```
   ModelHealth {
     state: 'healthy' | 'degraded' | 'unloaded' | 'corrupted' | 'unknown'
     loaded: boolean
     vramUsageBytes?: number
     ramUsageBytes?: number
    throughputTokPerSec?: number
     lastError?: string
     checkedAt: ISO8601
   }
   ```

5. **Pinning policy** (per ADR-018 §2) — The registry MUST pin specific SHA256 digests. The `@@unique([modelId, version])` constraint plus `sha256 @unique` enforces that one `(modelId, version)` tuple maps to exactly one SHA256. Floating tags like `:latest` are NEVER stored as the registry key.

6. **License enforcement** (per ADR-020) — `register(bundle)` MUST reject bundles whose `license` is not on the acceptable list (MIT, Apache 2.0, Llama Community, Gemma Terms). License drift across versions is enforced by re-checking on every `register()`.

7. **Hardware gating** (per ADR-016, ADR-017) — `activate(modelId, version)` SHOULD check the current `HardwareProfile` against the model's `hardwareRequirements` and refuse activation (with a clear error) if the hardware floor is not met. Phase 1 may warn; Phase 2 should enforce.

8. **Reconciliation** — On SmartAgentics startup, the registry runs a reconciliation job (per ADR-019 §7):
   - Compares registry state to Ollama's actual loaded/available models (`ollama list`, `ollama ps`).
   - Detects drift (manual `ollama rm` outside SmartAgentics → registry marks REMOVED; orphaned Ollama models → registry imports as REGISTERED with status `imported_orphan` for admin review).
   - Updates `status` field accordingly.

9. **Audit trail** — Every state transition (`register`, `activate`, `deactivate`, `rollback`, `remove`) writes an audit row recording: timestamp, operator (admin / system / automated), from-state, to-state, `sha256`, manifest snapshot. The audit table is a separate Prisma entity `ModelAuditEvent` (schema to be finalized in Phase E, but the interface commitment is made here).

10. **Tenant scoping** — Ollama has no concept of tenants (per ADR-015 §10); tenant isolation is enforced at the SmartAgentics application layer. The `Model` table does NOT have a `tenantId` column because models are shared physical artifacts (one GGUF file serves all tenants). Tenant-specific model _assignment_ (which tenant uses which model for which task) is handled by a separate `TenantModelAssignment` table (to be specified by Stream 8 — AI Security & Governance).

11. **`Model` is additive to the existing Prisma schema** — No existing tables are modified. The migration is `CREATE TABLE`, no `ALTER` or `DROP`. This satisfies Foundational Conflict #2's migration-impact requirement ("Low cost. New Prisma model entity (additive migration, no breaking changes)").

## 5. Rationale

- **SQLite-backed (ADR-006)** preserves the offline-first principle — hotels run offline; no Redis/etcd dependency (Option B rejected). SQLite is proven in EAOS (6 ms backup, 3 ms restore per ADR-001).
- **Prisma (ADR-005)** for schema management — type-safe, migration-friendly, already in use.
- **Application-layer source of truth over Ollama's blob store** — Ollama lacks audit trail, version pinning, license enforcement, capability vocabulary, compatibility tracking, lifecycle state machine (research Section 18, "Rejected alternatives"; Foundational Conflict #2). SmartAgentics adds these.
- **Pinning by SHA256** — reproducibility and rollback require content-addressed identity (per ADR-018). The `@@unique([modelId, version])` + `sha256 @unique` constraints enforce this at the schema level.
- **The 17 directive sub-capabilities map cleanly** to the registry interface and `Model` entity:
  - model registry → `ModelRegistry` interface + `Model` table.
  - installed models → `list(filter)`.
  - model metadata → `Model` columns (provider, runtime, modelType, contextLength, parameterCount, fileSizeBytes).
  - model versions → `version` + `upstreamVersion` + `@@unique([modelId, version])` (per ADR-018).
  - model capabilities → `capabilities` JSON column (per ADR-018).
  - model compatibility → `compatibility` JSON column (per ADR-018).
  - model status → `status` column (lifecycle state, per ADR-019).
  - model loading → `activate()`.
  - model unloading → `deactivate()`.
  - model selection → `list(filter)` + `LocalLLMRuntime.selectModel(task, hardwareProfile)` (ADR-015).
  - model fallback → cloud fallback per directive "Optional cloud AI fallback" (deferred Phase 2+); local fallback = re-activate prior version (per ADR-019).
  - model health → `health()` method + `ModelHealth` value object.
  - model resource requirements → `hardwareRequirements` JSON column (per ADR-017).
  - model lifecycle → `status` column transitions (per ADR-019).
  - model update mechanism → `register()` of a new version (per ADR-019 UPDATED state).
  - model rollback → `rollback()` method (per ADR-019 ROLLED_BACK state).
  - model licensing metadata → `license`, `licenseUrl`, `attribution` columns (per ADR-020).
- **Additive migration** — no breaking changes to existing tables; low migration cost (research Foundational Conflict #2: "Estimated effort: 2-3 days for schema + interface design").
- **Tenant isolation at the application layer** — the `Model` table is tenant-agnostic (one physical model serves all tenants); tenant-specific assignment is a separate concern for Stream 8 (research Section 3 "Multi-tenant: Ollama has no concept of tenants — model isolation is non-existent. Mitigation: SmartAgentics must enforce tenant isolation at the application layer").
- **Rejecting external KV store (Option B)** — incompatible with offline-first / SQLite-first (ADR-001, ADR-006).
- **Rejecting Ollama-alone (Option A)** — fails every directive sub-capability that requires audit, pinning, license, capability, compatibility (research Foundational Conflict #2).

## 6. Consequences

**Positive**:

- Single source of truth for installed models — every downstream consumer (Stream 2 Embeddings, Stream 3 RAG, Stream 5 Agent Runtime) programs against `ModelRegistry`, not against hardcoded model names.
- Version pinning by SHA256 enables reproducible deployments and rollback (per ADR-019).
- License enforcement at registration time prevents accidental non-commercial model activation (per ADR-020).
- Capability-based selection (`list(filter: { capabilities: ['tool-calling'] })`) enables per-task model routing.
- Audit trail supports compliance and incident response.
- Additive migration — no breaking changes; low risk.
- Resolves Foundational Conflict #2 — provides the missing `ModelRegistry` interface and `Model` table.

**Negative / obligations**:

- Phase 1 must include the `Model` Prisma entity and `ModelRegistry` interface — estimated 1–2 weeks of Phase E engineering (research Foundational Conflict #2: "1-2 weeks of engineering for schema, interface, and basic CRUD").
- Full lifecycle implementation is incremental:
  - **Phase 1**: schema + interface + basic CRUD (`register`, `list`, `get`, `activate`, `deactivate`, `remove`).
  - **Phase 2**: `rollback`, `health` monitoring, automated reconciliation, fleet-wide rollback.
- Reconciliation job must be fast (SQLite scan, not full disk scan) — adds startup latency.
- Audit table (`ModelAuditEvent`) schema must be finalized in Phase E.
- Tenant-specific model assignment (`TenantModelAssignment`) is deferred to Stream 8 — but the `Model` table is designed to support it (no tenant column on `Model` itself).
- SmartAgentics admin UI must surface model list, status, license, attribution, hardware fit — additional UI work.
- Disk bloat from retaining 3 versions per model (per ADR-019 §8) — must be monitored.

**Dependencies on other ADRs**:

- Depends on ADR-005 (Prisma) for schema management.
- Depends on ADR-006 (SQLite) for persistence.
- Depends on ADR-015 (Local AI Runtime) — `LocalLLMRuntime.selectModel` and `load`/`unload` use the registry.
- Depends on ADR-016 (Hardware Capability Detection) — `activate` checks `HardwareProfile` against `hardwareRequirements`.
- Depends on ADR-017 (Model Packaging) — `register(bundle)` consumes the Model Bundle manifest.
- Depends on ADR-018 (Model Versioning) — `version`, `capabilities`, `compatibility` fields are specified by ADR-018; pinning by SHA256 is mandatory.
- Depends on ADR-019 (Model Lifecycle) — `status` field transitions follow the ADR-019 state machine; reconciliation handles drift.
- Depends on ADR-020 (Model Licensing) — `license`, `licenseUrl`, `attribution` fields and acceptability enforcement are specified by ADR-020.
- Compatible with ADR-013 (Observability Strategy) — registry operations are traced.
- ADR-011 should be amended (separate ADR-011 amendment, NOT this ADR) to reclassify "Local Model Management" from "Future Vision" to "Architecture Contract — NOW".

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Stream 8 (AI Security & Governance) specifies the `TenantModelAssignment` table** — finalize the tenant-scoping design and any registry interface extensions.
2. **Rollback automation is designed (Phase 2)** — finalize the `rollback()` interface semantics and audit trail.
3. **Health monitoring (Phase 2)** reveals that the `ModelHealth` value object is insufficient — extend with additional metrics (e.g., GPU utilization, queue depth).
4. **A new model type** (e.g., audio, image-generation) becomes relevant — extend the `modelType` vocabulary.
5. **A multi-property cloud sync service is designed** — re-evaluate whether the registry should sync across properties (potentially requiring a server-side registry, not just local SQLite).
6. **Reconciliation job startup latency becomes painful** (e.g., >2 s on slow hotel disks) — optimize or move to background.
7. **The audit table grows unbounded** — define a retention policy for `ModelAuditEvent` rows.
8. **A model signing / trust mechanism** (e.g., Sigstore for models) becomes a SmartAgentics requirement — extend `securityTrustMetadata` and the `register()` verification flow.
9. **Annually**, as part of the regular ADR review cycle.
