# ADR-004: Turborepo for Build Orchestration
**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office
## Decision
Turborepo v2.
## Alternatives Rejected
Nx (overkill), Lerna (deprecated), Manual scripts (no caching)
## Consequences
Build caching, dependency-aware tasks. Fitness function: build time <60s.
