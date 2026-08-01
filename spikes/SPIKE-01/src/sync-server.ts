import * as net from 'node:net';
import type Database from 'better-sqlite3';

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
  onStateChange?: (state: ServerConnState) => void
): net.Server {
  const server = net.createServer((socket) => {
    let buffer = '';
    let state: ServerConnState = 'CONNECTED';
    const pendingQueue: SyncRecord[] = [];
    let queueFlushCount = 0;
    let recordsReceived = 0;
    let maxQueueDepth = 0;

    function processRecord(record: SyncRecord): void {
      insertRecord(db, record);
      recordsReceived++;
      onRecordReceived(record);
      socket.write(JSON.stringify({ type: 'ack', idempotencyKey: record.idempotencyKey }) + '\n');
    }

    function flushPendingQueue(): void {
      if (pendingQueue.length === 0) return;
      console.log(`  [SERVER port=${port}] Flushing ${pendingQueue.length} pending records`);
      for (const record of pendingQueue) {
        processRecord(record);
      }
      pendingQueue.length = 0;
      queueFlushCount++;
    }

    function transition(newState: ServerConnState): void {
      const oldState = state;
      state = newState;
      onStateChange?.(newState);
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
            transition('SYNCHRONIZED');
            continue;
          }

          if (msg.type === 'record') {
            const record = msg.record as SyncRecord;
            if (state === 'SYNCHRONIZED') {
              processRecord(record);
            } else {
              pendingQueue.push(record);
              if (pendingQueue.length > maxQueueDepth) maxQueueDepth = pendingQueue.length;
              console.log(`  [SERVER port=${port}] Buffered record (queue=${pendingQueue.length}, state=${state})`);
            }
            continue;
          }

          if (state !== 'SYNCHRONIZED') continue;

          if (msg.type === 'sync_request') {
            const sinceSeq = msg.sinceSequence || 0;
            const records = db.prepare('SELECT * FROM sync_records WHERE sequenceNumber > ? ORDER BY sequenceNumber ASC LIMIT 1000').all(sinceSeq) as SyncRecord[];
            for (const record of records) {
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
  db.prepare('INSERT OR IGNORE INTO sync_records (id, idempotencyKey, name, value, timestamp, clientId, sequenceNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    record.id, record.idempotencyKey, record.payload.name, record.payload.value, record.payload.timestamp, record.clientId, record.sequenceNumber, record.createdAt, record.updatedAt
  );
}
