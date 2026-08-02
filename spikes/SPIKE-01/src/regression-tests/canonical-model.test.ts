/**
 * Regression Test 1: Canonical Model Round-Trip
 *
 * Verifies that a SyncRecord preserves its exact shape through:
 * Original → SQLite Serialize → SQLite Deserialize → Equality Check
 *
 * If this test fails, the canonical model has been broken.
 * This must never happen — one record model, everywhere.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  type SyncRecord,
  validateRecord,
  serializeForSQLite,
  deserializeFromSQLite,
} from '../canonical-record.js';

describe('Regression Test 1: Canonical Model Round-Trip', () => {
  it('preserves exact object shape through SQLite serialize/deserialize', () => {
    // Create a canonical SyncRecord
    const original: SyncRecord = {
      id: randomUUID(),
      idempotencyKey: 'regression-test-1',
      payload: {
        name: 'test-record',
        value: 42,
        timestamp: Date.now(),
      },
      clientId: 'A',
      sequenceNumber: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Serialize for SQLite
    const serialized = serializeForSQLite(original);
    expect(serialized.payload).toBeTypeOf('string'); // Must be JSON string

    // Store in SQLite
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE sync_records (
      id TEXT PRIMARY KEY, idempotencyKey TEXT UNIQUE,
      payload TEXT, clientId TEXT, sequenceNumber INTEGER,
      createdAt INTEGER, updatedAt INTEGER
    )`);

    db.prepare(
      'INSERT INTO sync_records (id, idempotencyKey, payload, clientId, sequenceNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      serialized.id, serialized.idempotencyKey, serialized.payload,
      serialized.clientId, serialized.sequenceNumber, serialized.createdAt, serialized.updatedAt
    );

    // Read back from SQLite
    const row = db.prepare('SELECT * FROM sync_records WHERE idempotencyKey = ?').get('regression-test-1') as {
      id: string; idempotencyKey: string; payload: string; clientId: string;
      sequenceNumber: number; createdAt: number; updatedAt: number;
    };

    // Deserialize back to canonical SyncRecord
    const reconstructed = deserializeFromSQLite(row);

    // ASSERTION: The reconstructed record must strictly equal the original
    expect(reconstructed).toStrictEqual(original);

    // Verify every field individually
    expect(reconstructed.id).toBe(original.id);
    expect(reconstructed.idempotencyKey).toBe(original.idempotencyKey);
    expect(reconstructed.payload.name).toBe(original.payload.name);
    expect(reconstructed.payload.value).toBe(original.payload.value);
    expect(reconstructed.payload.timestamp).toBe(original.payload.timestamp);
    expect(reconstructed.clientId).toBe(original.clientId);
    expect(reconstructed.sequenceNumber).toBe(original.sequenceNumber);
    expect(reconstructed.createdAt).toBe(original.createdAt);
    expect(reconstructed.updatedAt).toBe(original.updatedAt);

    db.close();
  });

  it('validates the canonical record with Zod schema', () => {
    const validRecord: SyncRecord = {
      id: randomUUID(),
      idempotencyKey: 'validation-test',
      payload: { name: 'test', value: 1, timestamp: Date.now() },
      clientId: 'A',
      sequenceNumber: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = validateRecord(validRecord);
    expect(result.success).toBe(true);
  });

  it('rejects records with missing payload (the original bug)', () => {
    // This is the exact shape that caused SPIKE-01 data loss
    const flatRecord = {
      id: randomUUID(),
      idempotencyKey: 'flat-record',
      name: 'test',    // Flat field — NO payload object
      value: 42,       // Flat field
      timestamp: Date.now(), // Flat field
      clientId: 'A',
      sequenceNumber: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = validateRecord(flatRecord);
    expect(result.success).toBe(false);
    expect(result.success ? '' : result.error).toContain('payload');
  });

  it('preserves object shape through JSON serialization (network simulation)', () => {
    const original: SyncRecord = {
      id: randomUUID(),
      idempotencyKey: 'network-test',
      payload: { name: 'network-record', value: 99, timestamp: Date.now() },
      clientId: 'B',
      sequenceNumber: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Simulate network: serialize to JSON, parse back
    const jsonString = JSON.stringify({ type: 'record', record: original });
    const parsed = JSON.parse(jsonString);
    const received = parsed.record;

    // The received record must equal the original
    expect(received).toStrictEqual(original);

    // And must pass validation
    const validation = validateRecord(received);
    expect(validation.success).toBe(true);
  });
});
