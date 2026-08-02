/**
 * SPIKE-01 Sync Server — with lifecycle tracing (Observability Phase)
 *
 * No protocol changes. Same behavior. Added trace instrumentation only.
 */

import * as net from 'node:net';
import type Database from 'better-sqlite3';
import type { ReplicationTracer } from './trace.js';

export interface SyncRecord {
  id: string; idempotencyKey: string;
  payload: { name: string; value: number; timestamp: number };
  clientId: string; sequenceNumber: number; createdAt: number; updatedAt: number;
}

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
      const snap = tracer.takeSocketSnapshot(socket as unknown as { bytesWritten: number; bytesRead: number; bufferSize: number; destroyed: boolean; pending: boolean; readyState: string });
      tracer.recordConnectionEvent(connId, 'SERVER_NEW_CONNECTION', state, snap);
    }

    function processRecord(record: SyncRecord): void {
      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'packetReceived');
      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'jsonParsed');
      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'insertAttempted');

      const changes = db.prepare('INSERT OR IGNORE INTO sync_records (id, idempotencyKey, name, value, timestamp, clientId, sequenceNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        record.id, record.idempotencyKey, record.payload.name, record.payload.value, record.payload.timestamp, record.clientId, record.sequenceNumber, record.createdAt, record.updatedAt
      );

      if (tracer) {
        tracer.recordStage(record.id, record.idempotencyKey, 'insertComplete');
        if (changes.changes === 0) tracer.recordStage(record.id, record.idempotencyKey, 'insertIgnored', true);
      }

      onRecordReceived(record);

      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'ackSent');
      socket.write(JSON.stringify({ type: 'ack', idempotencyKey: record.idempotencyKey }) + '\n');
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
            if (state === 'SYNCHRONIZED') {
              processRecord(record);
            } else {
              pendingQueue.push(record);
            }
            continue;
          }

          if (state !== 'SYNCHRONIZED') continue;

          if (msg.type === 'sync_request') {
            const sinceSeq = msg.sinceSequence || 0;
            const records = db.prepare('SELECT * FROM sync_records WHERE sequenceNumber > ? ORDER BY sequenceNumber ASC LIMIT 1000').all(sinceSeq) as SyncRecord[];
            for (const record of records) socket.write(JSON.stringify({ type: 'record', record }) + '\n');
            socket.write(JSON.stringify({ type: 'sync_complete' }) + '\n');
          }
        } catch {}
      }
    });

    socket.on('error', () => {
      state = 'DISCONNECTED';
      if (tracer) tracer.recordConnectionEvent(connId, 'SERVER_ERROR', state);
    });
    socket.on('close', () => {
      state = 'DISCONNECTED';
      if (tracer) tracer.recordConnectionEvent(connId, 'SERVER_CLOSE', state);
    });
  });

  server.listen(port, '127.0.0.1');
  return server;
}

export function insertRecord(db: Database.Database, record: SyncRecord): void {
  db.prepare('INSERT OR IGNORE INTO sync_records (id, idempotencyKey, name, value, timestamp, clientId, sequenceNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    record.id, record.idempotencyKey, record.payload.name, record.payload.value, record.payload.timestamp, record.clientId, record.sequenceNumber, record.createdAt, record.updatedAt
  );
}
