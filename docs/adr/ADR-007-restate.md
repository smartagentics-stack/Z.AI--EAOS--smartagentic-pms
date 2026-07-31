# ADR-007: Restate as Workflow Engine
**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office
## Decision
Restate for all durable workflow operations.
## Alternatives Rejected
Temporal (heavier), Inngest (cloud-first), No orchestration (no durability)
## Consequences
Exactly-once (EAOS: 663 workflows, 0 duplicates), journal replay, TypeScript SDK.
