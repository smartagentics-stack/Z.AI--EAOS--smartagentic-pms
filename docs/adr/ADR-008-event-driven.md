# ADR-008: Event-Driven Architecture
**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office
## Decision
Event-driven with versioned domain events. Contracts defined first (SDK), bus implementation follows.
## Alternatives Rejected
Direct method calls (tight coupling), Request-response only (no audit), MQ (overkill)
## Consequences
Loose coupling, audit trail, enables offline sync. Negative: eventual consistency.
