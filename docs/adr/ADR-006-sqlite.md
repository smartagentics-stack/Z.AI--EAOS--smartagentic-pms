# ADR-006: SQLite as Phase 1 Database

**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office

## Decision

SQLite for Phase 1 local database. PostgreSQL is future cloud.

## Alternatives Rejected

PostgreSQL for local (server process), IndexedDB (browser only), DuckDB (analytical)

## Consequences

Zero-config, offline-first, EAOS-proven (6ms backup, 3ms restore). Single-writer mitigated by low PMS write rate.

---

## Amendment 1 — 2026-09-02 — Phase D Architecture Freeze

**Amendment Authority:** Phase D Architecture Freeze (per Senior Engineer Master Directive)

### Changes

1. **WAL mode**: Mandatory configuration `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;` for all connections. WAL is required for concurrent read/write access.

2. **Driver**: `better-sqlite3` (synchronous, native, Node.js) is the required driver for production. Prisma's built-in SQLite connector is acceptable for development but `better-sqlite3` provides better control for WAL configuration and extensions.

3. **SQLite-over-SMB FORBIDDEN**: SQLite database files MUST NOT be stored on network filesystems (SMB/CIFS/NFS). WAL mode does not work reliably over network filesystems — verified by sqlite.org documentation and multiple 2024-2025 production corruption reports. Reference: ADR-075 (LAN Operation Topology). Multi-user access requires hub-and-spoke HTTP proxy topology, NOT shared file access.

4. **Sync metadata**: Every mutable table must have `tenantId` (NOT NULL, indexed), `updatedAt` (explicit Prisma `@updatedAt`), `revision Int @default(0)`, `deletedAt DateTime?` (tombstone for soft-delete). Reference: ADR-072 (Sync Metadata Schema).

5. **sqlite-vec extension**: The `sqlite-vec` loadable extension is approved for vector storage. Reference: ADR-023 (Vector Store). Pure-C, zero dependencies, runs anywhere SQLite runs.

### Rationale

Phase C Stream 7 research verified that SQLite-over-SMB causes database corruption (CRITICAL foundational conflict FC-7.2). This amendment formally documents the constraint and points to the approved hub-and-spoke alternative (ADR-075).
