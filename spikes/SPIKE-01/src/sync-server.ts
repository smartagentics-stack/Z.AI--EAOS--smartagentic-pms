import * as net from 'node:net';
import type Database from 'better-sqlite3';

export interface SyncRecord {
  id: string; idempotencyKey: string;
  payload: { name: string; value: number; timestamp: number };
  clientId: string; sequenceNumber: number; createdAt: number; updatedAt: number;
}

export function createSyncServer(db: Database.Database, port: number, onRecordReceived: (record: SyncRecord) => void): net.Server {
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          // HANDSHAKE: Client says HELLO, we respond READY.
          // Client will not send records until it receives READY.
          if (msg.type === 'hello') {
            socket.write(JSON.stringify({ type: 'ready' }) + '\n');
            continue;
          }

          if (msg.type === 'record') {
            const record = msg.record as SyncRecord;
            insertRecord(db, record);
            onRecordReceived(record);
            socket.write(JSON.stringify({ type: 'ack', idempotencyKey: record.idempotencyKey }) + '\n');
          } else if (msg.type === 'sync_request') {
            const sinceSeq = msg.sinceSequence || 0;
            const records = db.prepare('SELECT * FROM sync_records WHERE sequenceNumber > ? ORDER BY sequenceNumber ASC LIMIT 1000').all(sinceSeq) as SyncRecord[];
            for (const record of records) { socket.write(JSON.stringify({ type: 'record', record }) + '\n'); }
            socket.write(JSON.stringify({ type: 'sync_complete' }) + '\n');
          }
        } catch {}
      }
    });
    socket.on('error', () => {});
  });
  server.listen(port, '127.0.0.1');
  return server;
}

export function insertRecord(db: Database.Database, record: SyncRecord): void {
  db.prepare('INSERT OR IGNORE INTO sync_records (id, idempotencyKey, name, value, timestamp, clientId, sequenceNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(record.id, record.idempotencyKey, record.payload.name, record.payload.value, record.payload.timestamp, record.clientId, record.sequenceNumber, record.createdAt, record.updatedAt);
}
