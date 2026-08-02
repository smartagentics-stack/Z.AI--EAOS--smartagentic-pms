/**
 * SPIKE-01 Sync Server — with canonical SyncRecord model (Phase 4 fix)
 *
 * Changes from previous version:
 * - SQLite schema stores payload as JSON TEXT column (not flat columns)
 * - INSERT uses serializeForSQLite()
 * - SELECT uses deserializeFromSQLite()
 * - processRecord validates incoming records with Zod
 * - One canonical record model everywhere. No alternate formats.
 */

import * as net from 'node:net';
import type Database from 'better-sqlite3';
import type { ReplicationTracer } from './trace.js';
import { type SyncRecord, validateRecord, serializeForSQLite, deserializeFromSQLite } from './canonical-record.js';

export type { SyncRecord } from './canonical-record.js';

export type ServerConnState = 'DISCONNECTED' | 'CONNECTED' | 'HELLO_RECEIVED' | 'READY_SENT' | 'SYNCHRONIZED';

export function createSyncServer(
  db: Database.Database,
  port: number,
  onRecordReceived: (record: SyncRecord) => void,
  tracer?: ReplicationTracer
): net.Server {
  const server = net.createServer((socket) => {
    let buffer = '';
    let state: ServerConnState = 'CONNECTED';
    const pendingQueue: SyncRecord[] = [];
    let connId = `S-PORT${port}-${Date.now()}`;

    if (tracer) {
      tracer.recordConnectionEvent(connId, 'SERVER_NEW_CONNECTION', state);
    }

    function processRecord(record: SyncRecord): void {
      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'packetReceived');
      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'jsonParsed');

      // Phase 3: Validate incoming record with Zod
      const validation = validateRecord(record);
      if (!validation.success) {
        console.log(`  [SERVER] VALIDATION FAILED: ${record.idempotencyKey} — ${validation.error}`);
        if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'insertAttempted');
        return; // Don't insert invalid records
      }

      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'insertAttempted');

      try {
        const serialized = serializeForSQLite(record);
        const changes = db.prepare(
          'INSERT OR IGNORE INTO sync_records (id, idempotencyKey, payload, clientId, sequenceNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          serialized.id, serialized.idempotencyKey, serialized.payload,
          serialized.clientId, serialized.sequenceNumber, serialized.createdAt, serialized.updatedAt
        );

        if (tracer) {
          tracer.recordStage(record.id, record.idempotencyKey, 'insertComplete');
          if (changes.changes === 0) {
            tracer.recordStage(record.id, record.idempotencyKey, 'insertIgnored', true);
          }
        }

        onRecordReceived(record);

        if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'ackSent');
        socket.write(JSON.stringify({ type: 'ack', idempotencyKey: record.idempotencyKey }) + '\n');
      } catch (err) {
        console.log(`  [SERVER] INSERT FAILED: ${record.idempotencyKey} — ${(err as Error).message}`);
        if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'insertComplete');
        socket.write(JSON.stringify({ type: 'ack', idempotencyKey: record.idempotencyKey }) + '\n');
      }
    }

    function flushPendingQueue(): void {
      if (pendingQueue.length === 0) return;
      for (const record of pendingQueue) processRecord(record);
      pendingQueue.length = 0;
    }

    function transition(newState: ServerConnState): void {
      state = newState;
      if (tracer) tracer.recordConnectionEvent(connId, `SERVER_STATE:${newState}`, state);
      if (newState === 'SYNCHRONIZED') flushPendingQueue();
    }

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'hello') {
            transition('HELLO_RECEIVED');
            socket.write(JSON.stringify({ type: 'ready' }) + '\n');
            transition('READY_SENT');
            transition('SYNCHRONIZED');
            continue;
          }
          if (msg.type === 'record') {
            const record = msg.record as SyncRecord;
            if (state === 'SYNCHRONIZED') processRecord(record);
            else pendingQueue.push(record);
            continue;
          }
          if (state !== 'SYNCHRONIZED') continue;
          if (msg.type === 'sync_request') {
            const sinceSeq = msg.sinceSequence || 0;
            // Phase 4: Use deserializeFromSQLite to reconstruct canonical record
            const rows = db.prepare('SELECT * FROM sync_records WHERE sequenceNumber > ? ORDER BY sequenceNumber ASC LIMIT 1000').all(sinceSeq) as Array<{
              id: string; idempotencyKey: string; payload: string; clientId: string;
              sequenceNumber: number; createdAt: number; updatedAt: number;
            }>;
            for (const row of rows) {
              const record = deserializeFromSQLite(row); // Reconstruct canonical SyncRecord
              socket.write(JSON.stringify({ type: 'record', record }) + '\n');
            }
            socket.write(JSON.stringify({ type: 'sync_complete' }) + '\n');
          }
        } catch {}
      }
    });
    socket.on('error', () => { state = 'DISCONNECTED'; });
    socket.on('close', () => { state = 'DISCONNECTED'; });
  });
  server.listen(port, '127.0.0.1');
  return server;
}

export function insertRecord(db: Database.Database, record: SyncRecord): void {
  const serialized = serializeForSQLite(record);
  db.prepare(
    'INSERT OR IGNORE INTO sync_records (id, idempotencyKey, payload, clientId, sequenceNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    serialized.id, serialized.idempotencyKey, serialized.payload,
    serialized.clientId, serialized.sequenceNumber, serialized.createdAt, serialized.updatedAt
  );
}
