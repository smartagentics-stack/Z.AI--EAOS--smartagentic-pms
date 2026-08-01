import * as net from 'node:net';
import type Database from 'better-sqlite3';
import { insertRecord, type SyncRecord } from './sync-server.js';

export interface SyncClient {
  writeRecord(record: SyncRecord): Promise<{ latencyMs: number; acked: boolean }>;
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
}

export function createSyncClient(db: Database.Database, peerPort: number, peerHost: string = '127.0.0.1', clientId?: string): SyncClient {
  let socket: net.Socket | null = null;
  let connected = false;
  let handshakeComplete = false;
  const pendingAcks = new Map<string, (latencyMs: number) => void>();
  const writeTimestamps = new Map<string, number>();
  let reconnectTimer: NodeJS.Timeout | null = null;
  let peerLastSequence = 0;
  let replayCount = 0;

  function handleData(data: string): void {
    const lines = data.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'ready') {
          handshakeComplete = true;
          const replayed = replayQueuedRecords();
          socket?.write(JSON.stringify({ type: 'sync_request', sinceSequence: peerLastSequence }) + '\n');
          if (clientId) console.log(`[${clientId}] READY received, replayed ${replayed} records`);
          continue;
        }
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

  function replayQueuedRecords(): number {
    if (!socket || !connected || !handshakeComplete || !clientId) return 0;
    const queuedRecords = db.prepare('SELECT * FROM sync_records WHERE clientId = ? ORDER BY sequenceNumber ASC').all(clientId) as SyncRecord[];
    for (const record of queuedRecords) {
      socket.write(JSON.stringify({ type: 'record', record }) + '\n');
    }
    replayCount++;
    return queuedRecords.length;
  }

  function connectInternal(): Promise<void> {
    return new Promise((resolve) => {
      socket = new net.Socket();
      let buffer = '';
      handshakeComplete = false;
      socket.connect(peerPort, peerHost, () => {
        connected = true;
        socket!.write(JSON.stringify({ type: 'hello' }) + '\n');
        resolve();
      });
      socket.on('data', (data) => { buffer += data.toString(); const lines = buffer.split('\n'); buffer = lines.pop() || ''; handleData(lines.join('\n')); });
      socket.on('error', () => { connected = false; handshakeComplete = false; scheduleReconnect(); });
      socket.on('close', () => { connected = false; handshakeComplete = false; scheduleReconnect(); });
    });
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; if (!connected) { connectInternal().catch(() => scheduleReconnect()); } }, 1000);
  }

  return {
    async connect() { await connectInternal(); },
    disconnect() { if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } socket?.destroy(); connected = false; handshakeComplete = false; },
    isConnected() { return connected; },
    async writeRecord(record: SyncRecord): Promise<{ latencyMs: number; acked: boolean }> {
      insertRecord(db, record);
      if (!connected || !socket || !handshakeComplete) { return { latencyMs: 0, acked: false }; }
      return new Promise((resolve) => {
        writeTimestamps.set(record.idempotencyKey, Date.now());
        const timeout = setTimeout(() => { pendingAcks.delete(record.idempotencyKey); writeTimestamps.delete(record.idempotencyKey); resolve({ latencyMs: 5000, acked: false }); }, 5000);
        pendingAcks.set(record.idempotencyKey, (latencyMs: number) => { clearTimeout(timeout); resolve({ latencyMs, acked: true }); });
        socket!.write(JSON.stringify({ type: 'record', record }) + '\n');
      });
    },
  };
}
