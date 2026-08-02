# ADR-012: Canonical Domain Model

**Status:** ACCEPTED
**Date:** 2026-07-31
**Owner:** Architecture Office

## Context

SPIKE-01 Runs 1-6 experienced persistent data loss (4 records per 5-minute test, 59 records per 1-hour test). Six hypothesis-driven debugging attempts failed to identify the root cause. An evidence-driven observability phase (lifecycle tracing) revealed the exact failure point: `insertAttempted ✅ → insertComplete ❌`.

The root cause was a **data model mismatch**: the original `SyncRecord` had a nested `payload: { name, value, timestamp }` object. SQLite stored these as flat columns (`name`, `value`, `timestamp`). When `SELECT *` returned rows, the `payload` field was missing. The server's INSERT tried `record.payload.name` → `undefined.name` → crash. Records were lost because the INSERT threw an error that was silently caught.

## Decision

**One canonical `SyncRecord` model exists throughout the system. Multiple object shapes representing the same entity are prohibited.**

### Implementation

1. **Zod schema** (`SyncRecordSchema`) defines the canonical record shape
2. **JSON payload storage**: SQLite stores `payload` as a JSON TEXT column, not flat columns
3. **`serializeForSQLite()`**: converts canonical record to SQLite row (payload → JSON string)
4. **`deserializeFromSQLite()`**: converts SQLite row back to canonical record (JSON string → payload object), with Zod validation
5. **Validation at all boundaries**: every incoming record (from network, from SQLite) is validated with Zod before processing

### Schema

```typescript
export const SyncRecordSchema = z.object({
  id: z.string(),
  idempotencyKey: z.string(),
  payload: z.object({
    name: z.string(),
    value: z.number(),
    timestamp: z.number(),
  }),
  clientId: z.string(),
  sequenceNumber: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
```

## Alternatives Rejected

- **Support both formats (flat and nested)**: Rejected. Creates permanent technical debt — two record formats forever.
- **Store flat columns and reconstruct on read**: Rejected. Requires manual reconstruction at every read site, error-prone.
- **Use an ORM that handles nested objects**: Rejected for Phase 1. Prisma supports JSON columns, but adding Prisma to the spike is scope expansion. The spike uses raw better-sqlite3.

## Consequences

**Positive:**
- One record model everywhere — no ambiguity
- Zod validation catches shape mismatches before they reach the database
- Replay works correctly because records maintain their shape through SQLite
- Regression test prevents future shape changes

**Negative:**
- Slightly more storage (JSON string vs flat columns) — negligible for Phase 1
- JSON.parse on every SQLite read — negligible overhead at Phase 1 scale

## Evidence

- SPIKE-01 Run 7: 0 data loss (was 4 in Runs 2-6, was 59 in Run 1)
- Phase 1 evidence: 7-stage lifecycle trace showing payload disappears at SQLite storage
- Regression test: `canonical-model.test.ts` verifies round-trip equality

## Traceability

- Related: ADR-006 (SQLite), ADR-009 (Internal SDK)
- Implements: Senior Engineering Operating Rule 6 (No Placeholder Engineering)
- Evidence: `spikes/SPIKE-01/evidence-phase1.json`, `spikes/SPIKE-01/results-run7.json`
- Regression test: `spikes/SPIKE-01/src/regression-tests/canonical-model.test.ts`
