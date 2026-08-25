/**
 * Verifier: Serialization Consistency
 *
 * Checks that canonical model round-trip works (ADR-012 compliance).
 * Uses in-memory SQLite to verify serialize → store → deserialize → equality.
 *
 * Tests the ACTUAL canonical-record.ts functions (not a simulation).
 * This verifier runs under tsx, which supports TypeScript imports.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

export const serializationVerifier: Verifier = {
  name: 'serialization-consistency',
  description: 'Verifies canonical SyncRecord round-trip through SQLite (ADR-012)',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const evidence: string[] = [];

    // Check that canonical-record.ts exists
    const canonicalPath = resolve(ctx.repoRoot, 'spikes/SPIKE-01/src/canonical-record.ts');
    if (!existsSync(canonicalPath)) {
      return {
        name: this.name,
        status: 'FAIL',
        message: 'canonical-record.ts not found',
        evidence,
      };
    }
    evidence.push('canonical-record.ts exists');

    // Dynamically import the ACTUAL canonical-record.ts functions
    // This verifier runs under tsx, which supports TypeScript imports.
    let serializeForSQLite: (record: unknown) => Record<string, unknown>;
    let deserializeFromSQLite: (row: Record<string, unknown>) => unknown;
    let validateRecord: (
      data: unknown,
    ) => { success: true; data: unknown } | { success: false; error: string };

    try {
      const canonicalUrl = pathToFileURL(canonicalPath).href;
      const imported = await import(canonicalUrl);
      serializeForSQLite = imported.serializeForSQLite;
      deserializeFromSQLite = imported.deserializeFromSQLite;
      validateRecord = imported.validateRecord;

      if (
        typeof serializeForSQLite !== 'function' ||
        typeof deserializeFromSQLite !== 'function' ||
        typeof validateRecord !== 'function'
      ) {
        return {
          name: this.name,
          status: 'FAIL',
          message:
            'canonical-record.ts does not export required functions (serializeForSQLite, deserializeFromSQLite, validateRecord)',
          evidence,
        };
      }
      evidence.push(
        'Imported actual serializeForSQLite, deserializeFromSQLite, validateRecord from canonical-record.ts',
      );
    } catch (err) {
      return {
        name: this.name,
        status: 'FAIL',
        message: `Failed to import canonical-record.ts: ${(err as Error).message}`,
        evidence,
      };
    }

    // Test the actual functions
    try {
      const original = {
        id: randomUUID(),
        idempotencyKey: 'eae-serialization-test',
        payload: { name: 'test', value: 42, timestamp: Date.now() },
        clientId: 'EAE',
        sequenceNumber: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Use the ACTUAL serializeForSQLite function
      const serialized = serializeForSQLite(original);
      evidence.push(`Serialized payload type: ${typeof serialized.payload}`);

      // Store in SQLite
      const db = new Database(':memory:');
      db.exec(`CREATE TABLE sync_records (
        id TEXT PRIMARY KEY, idempotencyKey TEXT UNIQUE,
        payload TEXT, clientId TEXT, sequenceNumber INTEGER,
        createdAt INTEGER, updatedAt INTEGER
      )`);

      db.prepare(
        'INSERT INTO sync_records (id, idempotencyKey, payload, clientId, sequenceNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        serialized.id as string,
        serialized.idempotencyKey as string,
        serialized.payload as string,
        serialized.clientId as string,
        serialized.sequenceNumber as number,
        serialized.createdAt as number,
        serialized.updatedAt as number,
      );

      // Read back
      const row = db
        .prepare('SELECT * FROM sync_records WHERE idempotencyKey = ?')
        .get('eae-serialization-test') as {
        id: string;
        idempotencyKey: string;
        payload: string;
        clientId: string;
        sequenceNumber: number;
        createdAt: number;
        updatedAt: number;
      };

      db.close();

      // Use the ACTUAL deserializeFromSQLite function (includes Zod validation)
      const reconstructed = deserializeFromSQLite(row);

      // Equality check
      const isEqual = JSON.stringify(original) === JSON.stringify(reconstructed);
      evidence.push(`Round-trip equality: ${isEqual}`);
      evidence.push(
        `Original payload.name: ${(original as { payload: { name: string } }).payload.name}`,
      );
      evidence.push(
        `Reconstructed payload.name: ${(reconstructed as { payload: { name: string } }).payload.name}`,
      );

      // Falsification: verify that validateRecord rejects invalid data
      const invalidRecord = {
        id: 'bad',
        idempotencyKey: 'bad',
        payload: 'not-an-object',
        clientId: 'X',
        sequenceNumber: 1,
        createdAt: 1,
        updatedAt: 1,
      };
      const validationResult = validateRecord(invalidRecord);
      evidence.push(`Validation rejects invalid payload: ${!validationResult.success}`);

      if (!isEqual) {
        return {
          name: this.name,
          status: 'FAIL',
          message: 'Serialization round-trip failed — object shape changed',
          evidence,
        };
      }

      // If validateRecord did NOT reject invalid data, that's a FAIL
      if (validationResult.success) {
        return {
          name: this.name,
          status: 'FAIL',
          message: 'validateRecord did not reject invalid payload — Zod validation is broken',
          evidence,
        };
      }

      return {
        name: this.name,
        status: 'PASS',
        message:
          'Canonical model round-trip verified using actual canonical-record.ts functions (serialize → SQLite → deserialize → equal + Zod validation)',
        evidence,
      };
    } catch (err) {
      return {
        name: this.name,
        status: 'FAIL',
        message: `Serialization test failed: ${(err as Error).message}`,
        evidence,
      };
    }
  },
};
