# ADR-002: Monorepo Structure
**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office
## Decision
Monorepo with pnpm workspaces and Turborepo. Structure: apps/ packages/ tests/ docs/ scripts/ .github/
## Alternatives Rejected
Polyrepo (overhead at Phase 1 scale), Hybrid (premature complexity)
## Consequences
Shared types, one CI, simpler deps. Negative: shared git history.
