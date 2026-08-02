/**
 * Regression Test 2: Replay After Disconnect
 *
 * Simulates: disconnect → 50 writes → reconnect → replay → verify
 * Asserts: 0 missing records, 0 duplicates, all records synced
 *
 * If this test fails, the replay mechanism has been broken.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import * as net from 'node:net';
import { createSyncServer } from '../sync-server.js';
import { createSyncClient } from '../sync-client.js';
import type { SyncRecord } from '../canonical-record.js';

function setupDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS sync_records (
    id TEXT PRIMARY KEY, idempotencyKey TEXT UNIQUE,
    payload TEXT, clientId TEXT, sequenceNumber INTEGER,
    createdAt INTEGER, updatedAt INTEGER
  )`);
  return db;
}

describe('Regression Test 2: Replay After Disconnect', () => {
  let dbA: Database.Database;
  let dbB: Database.Database;
  let serverA: net.Server;
  let serverB: net.Server;

  beforeEach(() => {
    dbA = setupDatabase('/tmp/spike-01-regression-a.db');
    dbB = setupDatabase('/tmp/spike-01-regression-b.db');
  });

  afterEach(() => {
    serverA?.close();
    serverB?.close();
    dbA?.close();
    dbB?.close();
  });

  it('syncs all records after disconnect and reconnect (50 records)', async () => {
    const PORT_A = 18001;
    const PORT_B = 18002;

    serverA = createSyncServer(dbA, PORT_A, () => {});
    serverB = createSyncServer(dbB, PORT_B, () => {});

    const clientA = createSyncClient(dbA, PORT_B, '127.0.0.1', 'A');
    const clientB = createSyncClient(dbB, PORT_A, '127.0.0.1', 'B');

    // Connect both clients
    await clientA.connect();
    await clientB.connect();
    await new Promise(r => setTimeout(r, 500));

    // Write 10 records while connected
    for (let i = 1; i <= 10; i++) {
      const record: SyncRecord = {
        id: randomUUID(),
        idempotencyKey: `A-${i}`,
        payload: { name: `r-${i}`, value: i, timestamp: Date.now() },
        clientId: 'A', sequenceNumber: i,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await clientA.writeRecord(record);
    }

    // Write 5 records from B
    for (let i = 1; i <= 5; i++) {
      const record: SyncRecord = {
        id: randomUUID(),
        idempotencyKey: `B-${i}`,
        payload: { name: `r-${i}`, value: i, timestamp: Date.now() },
        clientId: 'B', sequenceNumber: i,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await clientB.writeRecord(record);
    }

    // Disconnect A
    clientA.disconnect();
    await new Promise(r => setTimeout(r, 500));

    // Write 50 more records while A is disconnected
    for (let i = 11; i <= 60; i++) {
      const record: SyncRecord = {
        id: randomUUID(),
        idempotencyKey: `A-${i}`,
        payload: { name: `r-${i}`, value: i, timestamp: Date.now() },
        clientId: 'A', sequenceNumber: i,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await clientA.writeRecord(record);
    }

    // Reconnect A
    await clientA.connect();
    // Wait for replay to complete
    await new Promise(r => setTimeout(r, 3000));

    // Verify: all records should be in both databases
    const recordsA = dbA.prepare('SELECT idempotencyKey FROM sync_records').all() as { idempotencyKey: string }[];
    const recordsB = dbB.prepare('SELECT idempotencyKey FROM sync_records').all() as { idempotencyKey: string }[];

    const keysA = new Set(recordsA.map(r => r.idempotencyKey));
    const keysB = new Set(recordsB.map(r => r.idempotencyKey));

    // A should have all 65 records (60 A + 5 B)
    expect(keysA.size).toBe(65);

    // B should have all 65 records (60 A + 5 B)
    expect(keysB.size).toBe(65);

    // No missing records
    const missingFromB = [...keysA].filter(k => !keysB.has(k));
    expect(missingFromB).toHaveLength(0);

    const missingFromA = [...keysB].filter(k => !keysA.has(k));
    expect(missingFromA).toHaveLength(0);

    // No duplicates
    const dupA = recordsA.length - keysA.size;
    const dupB = recordsB.length - keysB.size;
    expect(dupA).toBe(0);
    expect(dupB).toBe(0);

    clientA.disconnect();
    clientB.disconnect();
  }, 30000); // 30s timeout
});
