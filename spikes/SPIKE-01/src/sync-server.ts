/**
 * SPIKE-01 Sync Server — with connection state machine (Run 4)
 *
 * State machine for INCOMING connections (peer connecting to us):
 * DISCONNECTED → CONNECTED → HELLO_RECEIVED → READY_SENT → SYNCHRONIZED
 *
 * We do NOT send records to the peer until we receive their HELLO
 * and respond READY. We do NOT accept records until READY is sent.
 */

import * as net from 'node:net';
import type Database from 'better-sqlite3';

export interface SyncRecord {
  id: string; idempotencyKey: string;
  payload: { name: string; value: number; timestamp: number };
  clientId: string; sequenceNumber: number; createdAt: number; updatedAt: number;
}

export type ServerConnState = 'DISCONNECTED' | 'CONNECTED' | 'HELLO_RECEIVED' | 'READY_SENT' | 'SYNCHRONIZED';

export interface ServerConnStats {
  state: ServerConnState;
  transitions: { from: string; to: string; timestamp: number }[];
  recordsReceived: number;
  recordsSent: number;
}

export function createSyncServer(
  db: Database.Database,
  port: number,
  onRecordReceived: (record: SyncRecord) => void,
  onStateChange?: (state: ServerConnState) => void
): net.Server {
  const server = net.createServer((socket) => {
    let buffer = '';

    // State machine for this connection
    let state: ServerConnState = 'CONNECTED';
    const transitions: { from: string; to: string; timestamp: number }[] = [];
    let recordsReceived = 0;
    let recordsSent = 0;

    // H-008: Pending incoming queue — buffer records received before SYNCHRONIZED
    const pendingQueue: SyncRecord[] = [];
    let queueFlushCount = 0;

    function processRecord(record: SyncRecord): void {
      insertRecord(db, record);
      recordsReceived++;
      onRecordReceived(record);
      socket.write(JSON.stringify({ type: 'ack', idempotencyKey: record.idempotencyKey }) + '\n');
    }

    function flushPendingQueue(): void {
      if (pendingQueue.length === 0) return;
      for (const record of pendingQueue) {
        processRecord(record);
      }
      pendingQueue.length = 0;
      queueFlushCount++;
    }

    function transition(newState: ServerConnState): void {
      const oldState = state;
      state = newState;
      transitions.push({ from: oldState, to: newState, timestamp: Date.now() });
      onStateChange?.(newState);

      // H-008: When we reach SYNCHRONIZED, flush any buffered records
      if (newState === 'SYNCHRONIZED') {
        flushPendingQueue();
      }
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
            transition('SYNCHRONIZED'); // flushPendingQueue() called here via transition()
            continue;
          }

          if (msg.type === 'record') {
            const record = msg.record as SyncRecord;
            if (state === 'SYNCHRONIZED') {
              // Normal path — process immediately
              processRecord(record);
            } else {
              // H-008: Buffer record — will be flushed when SYNCHRONIZED is reached
              pendingQueue.push(record);
            }
            continue;
          }

          // Only process sync_request if SYNCHRONIZED
          if (state !== 'SYNCHRONIZED') continue;

          if (msg.type === 'sync_request') {
            const sinceSeq = msg.sinceSequence || 0;
            const records = db.prepare('SELECT * FROM sync_records WHERE sequenceNumber > ? ORDER BY sequenceNumber ASC LIMIT 1000').all(sinceSeq) as SyncRecord[];
            for (const record of records) {
              socket.write(JSON.stringify({ type: 'record', record }) + '\n');
              recordsSent++;
            }
            socket.write(JSON.stringify({ type: 'sync_complete' }) + '\n');
          }
        } catch {}
      }
    });

    socket.on('error', () => {
      transition('DISCONNECTED');
    });
    socket.on('close', () => {
      transition('DISCONNECTED');
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
