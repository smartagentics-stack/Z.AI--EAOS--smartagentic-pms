# ADR-008: Event-Driven Architecture

**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office

## Decision

Event-driven with versioned domain events. Contracts defined first (SDK), bus implementation follows.

## Alternatives Rejected

Direct method calls (tight coupling), Request-response only (no audit), MQ (overkill)

## Consequences

Loose coupling, audit trail, enables offline sync. Negative: eventual consistency.

---

## Amendment 1 — 2026-09-02 — Phase D Architecture Freeze

**Amendment Authority:** Phase D Architecture Freeze (per Senior Engineer Master Directive)

### Changes

1. **Transactional Outbox Pattern**: Formalized. Every business-data-change transaction MUST write its sync event to the `SyncOutbox` table in the same SQLite transaction. A Restate `SyncRelayWorkflow` delivers events with at-least-once semantics; consumers dedup via `(tenantId, idempotencyKey, revision)`. Reference: ADR-073 (Transactional Outbox for Sync).

2. **Restate as event delivery**: Restate workflows (not a separate message broker) handle event delivery, retry, and backoff. This aligns with ADR-007 (Restate) and ADR-049 (Agent Runtime) — Restate serves as both workflow orchestrator and event delivery layer.

3. **No separate message broker**: Kafka, RabbitMQ, Redis Pub/Sub, and NATS are NOT required for Phase 1. SQLite's single-file property makes the transactional outbox pattern clean (no two-phase commit needed). Reference: ADR-073.

### Rationale

ADR-008 was previously a stub. Phase C Stream 7 research established that the transactional outbox pattern is the canonical solution for reliable event delivery in a local-first SQLite architecture.

## Context

Phase 1 requires event-driven architecture for domain events, audit trails, and workflow triggers. Events are defined as SDK contracts first, with the bus implementation following. This approach was validated in the EAOS investigation and aligns with the transactional outbox pattern (ADR-073).
