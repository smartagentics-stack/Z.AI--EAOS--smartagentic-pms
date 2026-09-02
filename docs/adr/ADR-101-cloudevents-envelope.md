# ADR-101: CloudEvents v1.0 Event Envelope for Dynamic Entities

**ADR-ID:** ADR-101
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

The domain-neutral architecture (ADR-097/098) introduces dynamic entities — entity types defined at runtime by an administrator (Phase F+). The existing event architecture (ADR-008 Event-Driven + Amendment 1, ADR-070 Offline Sync, ADR-072 Sync Metadata Schema, ADR-073 Transactional Outbox) is built around fixed Prisma models with `SyncOutbox` per table. Dynamic entities need event types that don't exist at code-write time — when an admin creates entity `Bar`, the platform must emit `bar.inventory.updated` events without code change. The existing `SyncOutbox.payloadJson` is "JSON snapshot of the row (or delta for updates)" — an opaque shape with no standardized envelope.

Web research (Phase D Revision research report, Topic 5) confirms:

- **CloudEvents v1.0** (`https://cloudevents.io`) is the CNCF specification for standardized event metadata. On June 13, 2024 the CloudEvents SQL spec was approved for V1. The spec (`https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md`): "CloudEvents is a specification for describing event data in common formats to provide interoperability across services, platforms and systems."
- **CloudEvents is adopted by all major cloud providers**: AWS EventBridge (`https://aws.amazon.com/blogs/compute/sending-and-receiving-cloudevents-with-amazon-eventbridge`, Mar 2024), Azure Event Grid (`https://learn.microsoft.com/en-us/azure/event-grid/cloud-event-schema`, Feb 2026), Google Cloud Eventarc (`https://docs.cloud.google.com/eventarc/docs/cloudevents-json`).
- **CloudEvents mandatory attributes** (`id`, `source`, `specversion`, `type`, `time`, `datacontenttype`, `subject`, `data`) provide the standardized envelope SmartAgentics currently lacks. ADR-008 mandates "versioned domain events" but does not specify the envelope format.
- **Existing ADR-072 `SyncOutbox` payload structure** is JSON without a standardized envelope. Wrapping it in CloudEvents provides:
  - `source`: tenant URN (e.g., `urn:smartagentics:tenant:<tenantId>`)
  - `subject`: entity URN (e.g., `urn:smartagentics:domain:pms:entity:reservation:record:<recordId>`)
  - `type`: `<entityType>.<operation>` (e.g., `reservation.created`, `bar.inventory.updated`)
  - `datacontenttype`: `application/json`
  - `data`: the canonical record payload + `schemaVersion`
  - `time`: HLC timestamp (per ADR-074)

## 2. Problem

Should SmartAgentics (a) keep the existing opaque `SyncOutbox.payloadJson` JSON snapshot (works for fixed entities; no standardized envelope for dynamic entities or external integration), (b) define a SmartAgentics-owned envelope format (reinvents CloudEvents; loses CNCF interoperability), (c) adopt AMQP or Kafka wire protocols (operationally heavy; conflicts with offline-first), or (d) adopt CloudEvents v1.0 as the event envelope, wrapping existing `SyncOutbox` payloads, with `<entityType>.<operation>` event types that work for both typed and dynamic entities?

## 3. Options

### Option A: Keep the existing opaque `SyncOutbox.payloadJson` JSON snapshot

Rejected for dynamic entities. Without a standardized envelope, dynamic entity events have no consistent `type` — consumers can't filter or route them. External integrations (webhooks to government/school systems, AWS EventBridge, Azure Event Grid) require translation. The directive's "Event schema versioning for evolving entity definitions" (Topic 5, lines 859–871) is unanswerable without a versioned envelope.

### Option B: SmartAgentics-owned envelope format

Rejected. Reinvents CloudEvents. Loses CNCF interoperability — every external integration requires a custom adapter. The SmartAgentics-owned format would need its own spec, its own versioning, its own SDK; CloudEvents already provides all three.

### Option C: AMQP or Kafka wire protocols

Rejected. AMQP and Kafka are transport protocols, not envelope formats. They're operationally heavy (broker process, schema registry) and conflict with the directive's offline-first requirement (no broker in STANDALONE mode). CloudEvents is transport-agnostic — it works over HTTP, Kafka, AMQP, or in-process.

### Option D: CloudEvents v1.0 as the event envelope, wrapping `SyncOutbox` payloads

Adopted. `SyncOutbox.payloadJson` becomes `SyncOutbox.eventJson` (CloudEvents-encoded). Benefits: standardized event types for dynamic entities, event schema versioning, CNCF interoperability, backward compatibility with existing ADRs.

## 4. Decision

Adopt **Option D** — CloudEvents v1.0 as the event envelope.

### CloudEvents envelope shape

Every `SyncOutbox.eventJson` is a CloudEvents v1.0 document:

```json
{
  "specversion": "1.0",
  "id": "<syncOutboxRowId>",
  "source": "urn:smartagentics:tenant:<tenantId>",
  "type": "<entityType>.<operation>",
  "subject": "urn:smartagentics:domain:<domainId>:entity:<entityType>:record:<recordId>",
  "time": "<HLC timestamp per ADR-074>",
  "datacontenttype": "application/json",
  "dataschema": "https://smartagentics.dev/schemas/<domainId>/<entityType>/v<schemaVersion>",
  "data": {
    "tenantId": "<tenantId>",
    "domainId": "<domainId>",
    "entityTypeId": "<entityTypeId>",
    "recordId": "<recordId>",
    "schemaVersion": 3,
    "operation": "update",
    "payload": { ... canonical record dataJson ... },
    "delta": { ... changed fields only, for updates ... },
    "syncOrigin": "<client/hub id>",
    "revision": 42,
    "traceparent": "<W3C Trace Context per ADR-013 Amendment 1>"
  }
}
```

### Event type convention

The CloudEvents `type` attribute follows the convention **`<entityType>.<operation>`**:

- `reservation.created`, `reservation.updated`, `reservation.deleted`
- `bar.inventory.updated` (dynamic entity — entity type "Bar", operation "inventory.updated" sub-namespace)
- `menu.item.created`
- `guest.merged` (domain-specific operation beyond CRUD)
- `workflow.started`, `workflow.succeeded`, `workflow.failed` (workflow lifecycle events per ADR-100)
- `rule.matched` (rule evaluation events per ADR-100)

Entity types declared at runtime by an administrator automatically produce events with the correct type. No code change is required when a new entity is created — the event emitter is generic, parameterized by `EntityType.name` and `operation`.

### Event schema versioning

The CloudEvents `data.schemaVersion` attribute (and the `dataschema` URI) matches `EntityType.schemaVersion` (per ADR-097). Consumers can branch on schema version for backward compatibility:

```typescript
if (event.data.schemaVersion < 3) {
  // migrate old field names
  event.data.payload.guestName = event.data.payload.name;
}
```

This is the answer to the directive's "Event schema versioning for evolving entity definitions" (Topic 5, lines 859–871).

### OpenTelemetry trace propagation (resolves FC-DN-18)

Every CloudEvent carries a `traceparent` extension (W3C Trace Context) in the `data` attribute so events propagate OpenTelemetry trace IDs (per ADR-013 Amendment 1). The `SyncRelayWorkflow` (Restate, per ADR-073 §8) logs both the CloudEvent `id` and the OTel `traceId` for cross-correlation. This bridges CloudEvents and OpenTelemetry — the two were complementary but the bridge was previously unspecified (FC-DN-18).

### Backward compatibility with existing ADRs

- **ADR-008 (Event-Driven) + Amendment 1**: CloudEvents v1.0 is the mandatory envelope format. The `SyncOutbox.payloadJson` field is renamed (additively — old field kept for one migration window) to `SyncOutbox.eventJson` containing a CloudEvents document.
- **ADR-070 (Offline Sync)**: the SyncEngine already serializes/deserializes JSON; CloudEvents is a stricter JSON shape. No behavior change for Phase 1 STANDALONE mode.
- **ADR-072 (Sync Metadata Schema)**: `SyncOutbox.eventJson` follows CloudEvents v1.0 shape. The existing `payloadJson` field is retained for backward compatibility with the Phase D architecture freeze; new code reads `eventJson`; a migration script backfills `eventJson` from `payloadJson`.
- **ADR-073 (Transactional Outbox)**: the outbox pattern is unchanged; only the payload envelope changes.

### `SyncOutbox` schema extension

```prisma
model SyncOutbox {
  id               String   @id @default(cuid())
  tenantId         String
  tableName        String   // "Reservation", "Room", or EntityType name for dynamic records
  recordId         String
  operation        String   // "insert" | "update" | "delete"
  eventJson        String   // NEW — CloudEvents v1.0 document (canonical)
  payloadJson      String   // RETAINED for backward compat (one migration window); deprecated
  eventType        String   // NEW — CloudEvents `type` (<entityType>.<operation>); indexed for routing
  hlc              String   // HLC timestamp (per ADR-074 §4) — also CloudEvents `time`
  syncOrigin       String?
  restateInvocationId String?
  traceId          String?  // NEW — W3C Trace Context (per ADR-013 Amendment 1)
  createdAt        DateTime @default(now())
  deliveredAt      DateTime?
  deliveryAttempts Int      @default(0)
  lastError        String?

  @@index([tenantId, deliveredAt, createdAt])
  @@index([tenantId, tableName, recordId])
  @@index([tenantId, eventType, createdAt])  // NEW — event-type-based routing
}
```

### Dynamic entity event emission

The Prisma middleware (per ADR-073 §8, extended per ADR-098) auto-writes `SyncOutbox` rows on every `Record` and `EntityFieldIndex` mutation. For dynamic records, the middleware:

1. Looks up the `EntityType` by `entityTypeId` (cached).
2. Constructs the CloudEvents envelope with `type = <EntityType.name>.<operation>` and `subject = urn:smartagentics:domain:<domainId>:entity:<EntityType.name>:record:<recordId>`.
3. Validates the envelope against the CloudEvents v1.0 JSON Schema (compiled once at boot).
4. Writes the `SyncOutbox` row with `eventJson`, `eventType`, `traceId`.

No code change is required when a new EntityType is created — the middleware is generic.

### Amendment / reference register

| Existing ADR                                       | Relationship                    | Change                                                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-008 (Event-Driven) + Amendment 1**           | AMENDED (MINOR — FC-DN-07)      | CloudEvents v1.0 is the mandatory envelope format. `SyncOutbox.payloadJson` is renamed to `SyncOutbox.eventJson` (additive — old field kept for one migration window). The Amendment 1 transactional-outbox pattern is unchanged; only the envelope is standardized.             |
| **ADR-013 (Observability Strategy) + Amendment 1** | AMENDED (MINOR — FC-DN-18)      | Every CloudEvent carries a `traceparent` extension (W3C Trace Context) so events propagate OpenTelemetry trace IDs. The `SyncRelayWorkflow` (Restate) logs both the CloudEvent `id` and the OTel `traceId` for cross-correlation. CloudEvents and OpenTelemetry are bridged.     |
| **ADR-070 (Offline Sync)**                         | REFERENCED (FC-DN-08, FC-DN-14) | The SyncEngine already serializes/deserializes JSON; CloudEvents is a stricter JSON shape. No behavior change for Phase 1 STANDALONE mode. `Record` and `EntityFieldIndex` mutations flow through `SyncOutbox` with CloudEvents envelopes (per ADR-098).                         |
| **ADR-072 (Sync Metadata Schema)**                 | AMENDED (MODERATE — FC-DN-09)   | `SyncOutbox.eventJson` follows CloudEvents v1.0 shape. The existing `payloadJson` field is retained for backward compatibility; new code reads `eventJson`; a migration script backfills `eventJson` from `payloadJson`. New `eventType` and `traceId` columns added (additive). |
| **ADR-073 (Transactional Outbox)**                 | REFERENCED (FC-DN-10 — NONE)    | The outbox pattern is unchanged; only the payload envelope changes.                                                                                                                                                                                                              |
| **ADR-074 (Conflict Resolution Policy)**           | REFERENCED                      | The CloudEvents `time` attribute carries the HLC timestamp (per ADR-074 §4) — the same HLC used for LWW conflict resolution.                                                                                                                                                     |
| **ADR-097 (Domain Meta-Model)**                    | CROSS-REFERENCE                 | `EntityType.schemaVersion` flows into the CloudEvents `data.schemaVersion` and `dataschema` URI.                                                                                                                                                                                 |
| **ADR-098 (Hybrid Persistence)**                   | CROSS-REFERENCE                 | CloudEvents envelopes are uniform across all three persistence layers (typed Layer-1/Layer-2 + dynamic Layer-3).                                                                                                                                                                 |
| **ADR-100 (Workflow & Rules Engine)**              | CROSS-REFERENCE                 | Workflow triggers and rule outputs use CloudEvents types (`<entityType>.<operation>` and `workflow.*` / `rule.*`).                                                                                                                                                               |

### Conflicts resolved

- **FC-DN-07** (ADR-008 MINOR) — resolved by mandating CloudEvents v1.0 as the envelope format and renaming `payloadJson` → `eventJson` (additive).
- **FC-DN-09** (ADR-072 MODERATE) — resolved by specifying the CloudEvents v1.0 shape for `eventJson` + adding `eventType` and `traceId` columns.
- **FC-DN-10** (ADR-073 NONE) — no conflict; the outbox pattern is unchanged.
- **FC-DN-18** (ADR-013 Amendment 1 MINOR) — resolved by carrying `traceparent` in every CloudEvent and logging CloudEvent `id` + OTel `traceId` in `SyncRelayWorkflow`.

## 5. Rationale

- **CloudEvents v1.0 is the CNCF standard** (cloudevents.io; AWS EventBridge; Azure Event Grid; Google Cloud Eventarc) — adopted by all major cloud providers. SmartAgentics inherits interoperability for free.
- **`<entityType>.<operation>` event types work for dynamic entities** without code change — the event emitter is generic, parameterized by `EntityType.name` and `operation`. This is the only way dynamic entities can produce events without runtime code generation.
- **Event schema versioning via `data.schemaVersion` + `dataschema` URI** answers the directive's "Event schema versioning for evolving entity definitions" (Topic 5, lines 859–871) — consumers branch on schema version for backward compatibility.
- **CloudEvents is transport-agnostic** — works over HTTP, Kafka, AMQP, or in-process. No broker required for Phase 1 STANDALONE mode; Phase 2+ cloud sync uses the same envelope over HTTP.
- **Backward compatibility is preserved** — `payloadJson` is retained for one migration window; new code reads `eventJson`; a migration script backfills. No Phase 1 STANDALONE behavior change.
- **OpenTelemetry bridge via `traceparent`** (FC-DN-18) closes the gap between CloudEvents and OpenTelemetry — the two were complementary but the bridge was unspecified. Every event now carries a trace ID; the `SyncRelayWorkflow` logs both for cross-correlation.
- **CloudEvents SQL (V1, June 2024)** enables future event-stream querying (e.g., "find all `bar.inventory.updated` events in the last 24 hours where `data.delta.quantity < 0`") without a custom query language.

## 6. Consequences

- `SyncOutbox` schema extended (additive): `eventJson` (new, canonical), `eventType` (new, indexed), `traceId` (new); `payloadJson` retained for one migration window, then deprecated.
- New SDK module: `packages/sdk/src/events/` with `CloudEventEnvelope`, `EventType` constants, `EventEmitter` interface.
- Prisma middleware (per ADR-073 §8, extended per ADR-098) constructs CloudEvents envelopes for `Record` and `EntityFieldIndex` mutations.
- `SyncRelayWorkflow` (Restate) logs CloudEvent `id` + OTel `traceId` for cross-correlation (per ADR-013 Amendment 1).
- Migration script: backfill `SyncOutbox.eventJson` from `payloadJson` for existing rows; populate `eventType` and `traceId` where reconstructible.
- **Risk: CloudEvents envelope size on large records.** A `Record` with a large `dataJson` produces a large CloudEvent. Mitigation: `SyncOutbox.eventJson` stores a delta (changed fields only) for `update` operations; full snapshot for `insert`/`delete`. Phase 2+ optimization (per ADR-072 §6 R-7.11).
- **Risk: CloudEvents v1.0 spec evolution.** CloudEvents may release v1.1 or v2.0. Mitigation: `specversion: "1.0"` is pinned in every envelope; a future ADR may upgrade to a newer spec version with a migration script. CloudEvents v1.0 is stable (CNCF graduated).
- **Risk: `eventType` proliferation.** Dynamic entities produce unbounded event types. Mitigation: the `eventType` index supports efficient routing; consumers filter by `eventType` prefix (e.g., `bar.*` for all Bar entity events). A registry of known event types is maintained for documentation; unknown types are tolerated (forward-compatible).
- **Risk: `payloadJson` deprecation window creates dual-write complexity.** Mitigation: the migration script is one-shot; after backfill, `payloadJson` is write-only-null (new code never writes it); after one release, a migration drops the column.
- **Risk: `traceparent` propagation breaks if the originating request has no trace.** Mitigation: the middleware creates a trace if none exists (per ADR-013 Amendment 1); `traceId` is always populated.
- Dependencies: ADR-008 (Event-Driven — amended), ADR-013 (Observability — amended), ADR-070 (Offline Sync — referenced), ADR-072 (Sync Metadata — amended), ADR-073 (Transactional Outbox — referenced), ADR-074 (Conflict Resolution — referenced for HLC), ADR-097 (Domain Meta-Model — cross-reference), ADR-098 (Hybrid Persistence — cross-reference), ADR-100 (Workflow & Rules — cross-reference).
- Phase E effort: ~2 weeks for the SDK interfaces, Prisma schema extension, Prisma middleware envelope construction, `SyncRelayWorkflow` trace logging, and the migration script.

## 7. Review Conditions

- Review if Phase 1 telemetry shows CloudEvents envelope construction exceeds 1% of write-path latency — would cache envelope templates per EntityType.
- Review if `payloadJson` deprecation window (one release) proves too short for downstream consumers to migrate — would extend to two releases.
- Review if `eventType` proliferation (> 10,000 distinct types per tenant) degrades the `eventType` index — would investigate partitioning or a type-registry cleanup workflow.
- Review if CloudEvents v1.1 or v2.0 is released with breaking changes — would warrant a spec-version-upgrade ADR with a migration script.
- Review if a community standard for event-schema versioning emerges (e.g., a CloudEvents extension for schema evolution) that should replace the SmartAgentics `data.schemaVersion` + `dataschema` URI convention.
- Review if Phase 2+ cloud sync requires a different transport (Kafka, AMQP) — would warrant a Phase 2+ transport ADR; the CloudEvents envelope is transport-agnostic.
- Review if CloudEvents SQL proves useful for event-stream querying in production — would warrant a Phase 2+ event-query ADR.
- Review if the directive's §19 visual event-flow builder (Phase F+, if any) requires additional CloudEvents extension attributes (e.g., UI hints for event routing) not anticipated by ADR-101 — would warrant a Phase F+ additive-attribute ADR.
- Review if external integrations (government/school system webhooks) require CloudEvents profile conformance (e.g., a specific dataschema URI format) — would warrant an integration-profile ADR.
