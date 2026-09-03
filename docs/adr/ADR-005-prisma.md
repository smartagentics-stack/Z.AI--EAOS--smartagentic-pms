# ADR-005: Prisma as ORM

**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office

## Decision

Prisma ORM for all database operations.

## Alternatives Rejected

Drizzle (less mature), TypeORM (less type-safe), raw SQL (no type safety)

## Consequences

Type-safe client, migration system, SQLite+PostgreSQL support. EAOS-proven.

## Context

Phase 1 requires a type-safe ORM that supports SQLite (local-first) and PostgreSQL (future cloud). The EAOS investigation validated Prisma with schema validation, migration management, and TypeScript type inference across all database operations.
