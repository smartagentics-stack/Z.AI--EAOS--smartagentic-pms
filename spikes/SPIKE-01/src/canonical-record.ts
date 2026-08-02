/**
 * SPIKE-01 Phase 3: Canonical SyncRecord model with Zod validation
 *
 * One canonical record model. No alternate formats.
 * Every boundary validates against this schema.
 */

import { z } from 'zod';

// ─── Canonical SyncRecord Schema ─────────────────────────────────────────────
// This is the ONE record model used everywhere: client, server, replay, SQLite.

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

export type SyncRecord = z.infer<typeof SyncRecordSchema>;

// ─── Validation helper ───────────────────────────────────────────────────────

export function validateRecord(data: unknown): { success: true; data: SyncRecord } | { success: false; error: string } {
  const result = SyncRecordSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
  };
}

// ─── SQLite serialization helpers ────────────────────────────────────────────
// Store payload as JSON string in SQLite. Reconstruct on read.
// This eliminates the flat-vs-nested mismatch permanently.

export function serializeForSQLite(record: SyncRecord) {
  return {
    id: record.id,
    idempotencyKey: record.idempotencyKey,
    payload: JSON.stringify(record.payload), // Store as JSON string
    clientId: record.clientId,
    sequenceNumber: record.sequenceNumber,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function deserializeFromSQLite(row: {
  id: string;
  idempotencyKey: string;
  payload: string;
  clientId: string;
  sequenceNumber: number;
  createdAt: number;
  updatedAt: number;
}): SyncRecord {
  const record: SyncRecord = {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    payload: JSON.parse(row.payload), // Reconstruct from JSON string
    clientId: row.clientId,
    sequenceNumber: row.sequenceNumber,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  // Validate the reconstructed record
  const validation = validateRecord(record);
  if (!validation.success) {
    throw new Error(`Record validation failed after SQLite deserialization: ${validation.error}`);
  }
  return record;
}
