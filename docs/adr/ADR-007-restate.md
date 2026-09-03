# ADR-007: Restate as Workflow Engine

**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office

## Decision

Restate for all durable workflow operations.

## Alternatives Rejected

Temporal (heavier), Inngest (cloud-first), No orchestration (no durability)

## Consequences

Exactly-once (EAOS: 663 workflows, 0 duplicates), journal replay, TypeScript SDK.

## Context

Phase 1 requires durable workflow orchestration with exactly-once semantics. The EAOS investigation validated Restate with 663 workflows, 0 duplicates, and journal replay for crash recovery. Restate provides a TypeScript SDK compatible with the project's Node.js runtime.
