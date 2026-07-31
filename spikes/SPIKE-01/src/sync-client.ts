import * as net from 'node:net';
import type Database from 'better-sqlite3';
import { insertRecord, type SyncRecord } from './sync-server.js';

export interface SyncClient {
  writeRecord(record: SyncRecord): Promise<{ latencyMs: number; acked: boolean }>;
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
}

export function createSyncClient(db: Database.Database, peerPort: number, peerHost: string = '127.0.0.1'): SyncClient {
  let socket: net.Socket | null = null;
  let connected = false;
  const pendingAcks = new Map<string, (latencyMs: number) => void>();
  const writeTimestamps = new Map<string, number>();
  let reconnectTimer: NodeJS.Timeout | null = null;
  let peerLastSequence = 0;

  function handleData(data: string): void {
    const lines = data.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'ack') {
          const writeTime = writeTimestamps.get(msg.idempotencyKey);
          if (writeTime) {
            const latency = Date.now() - writeTime;
            writeTimestamps.delete(msg.idempotencyKey);
            const resolver = pendingAcks.get(msg.idempotencyKey);
            if (resolver) { pendingAcks.delete(msg.idempotencyKey); resolver(latency); }
          }
        } else if (msg.type === 'record') {
          insertRecord(db, msg.record as SyncRecord);
        }
      } catch {}
    }
  }

  // FIX: Replay queued records on reconnect (bidirectional sync)
  function replayQueuedRecords(): void {
    if (!socket || !connected) return;
    const queuedRecords = db.prepare('SELECT * FROM sync_records WHERE sequenceNumber > ? ORDER BY sequenceNumber ASC').all(peerLastSequence) as SyncRecord[];
    for (const record of queuedRecords) {
      socket.write(JSON.stringify({ type: 'record', record }) + '\n');
    }
  }

  function connectInternal(): Promise<void> {
    return new Promise((resolve) => {
      socket = new net.Socket();
      let buffer = '';
      socket.connect(peerPort, peerHost, () => {
        connected = true;
        // FIX: On reconnect, replay queued records AND request peer's records
        replayQueuedRecords();
        socket!.write(JSON.stringify({ type: 'sync_request', sinceSequence: peerLastSequence }) + '\n');
        resolve();
      });
      socket.on('data', (data) => { buffer += data.toString(); const lines = buffer.split('\n'); buffer = lines.pop() || ''; handleData(lines.join('\n')); });
      socket.on('error', () => { connected = false; scheduleReconnect(); });
      socket.on('close', () => { connected = false; scheduleReconnect(); });
    });
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; if (!connected) { connectInternal().catch(() => scheduleReconnect()); } }, 1000);
  }

  return {
    async connect() { await connectInternal(); },
    disconnect() { if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } socket?.destroy(); connected = false; },
    isConnected() { return connected; },
    async writeRecord(record: SyncRecord): Promise<{ latencyMs: number; acked: boolean }> {
      insertRecord(db, record);
      if (!connected || !socket) { return { latencyMs: 0, acked: false }; }
      return new Promise((resolve) => {
        writeTimestamps.set(record.idempotencyKey, Date.now());
        const timeout = setTimeout(() => { pendingAcks.delete(record.idempotencyKey); writeTimestamps.delete(record.idempotencyKey); resolve({ latencyMs: 5000, acked: false }); }, 5000);
        pendingAcks.set(record.idempotencyKey, (latencyMs: number) => { clearTimeout(timeout); resolve({ latencyMs, acked: true }); });
        socket!.write(JSON.stringify({ type: 'record', record }) + '\n');
      });
    },
  };
}
