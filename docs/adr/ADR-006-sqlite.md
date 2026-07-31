# ADR-006: SQLite as Phase 1 Database
**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office
## Decision
SQLite for Phase 1 local database. PostgreSQL is future cloud.
## Alternatives Rejected
PostgreSQL for local (server process), IndexedDB (browser only), DuckDB (analytical)
## Consequences
Zero-config, offline-first, EAOS-proven (6ms backup, 3ms restore). Single-writer mitigated by low PMS write rate.
