/**
 * SPIKE-01 Sync Client — with lifecycle tracing (Observability Phase)
 *
 * No protocol changes. Same behavior. Added trace instrumentation only.
 */

import * as net from 'node:net';
import type Database from 'better-sqlite3';
import { insertRecord, type SyncRecord } from './sync-server.js';
import type { ReplicationTracer } from './trace.js';

export interface SyncClient {
  writeRecord(record: SyncRecord): Promise<{ latencyMs: number; acked: boolean }>;
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getState(): string;
  getStats(): Record<string, unknown>;
}

export function createSyncClient(
  db: Database.Database,
  peerPort: number,
  peerHost: string = '127.0.0.1',
  clientId?: string,
  tracer?: ReplicationTracer
): SyncClient {
  let socket: net.Socket | null = null;
  let connected = false;
  let handshakeComplete = false;
  const pendingAcks = new Map<string, (latencyMs: number) => void>();
  const writeTimestamps = new Map<string, number>();
  let reconnectTimer: NodeJS.Timeout | null = null;
  let peerLastSequence = 0;
  let recordsReplayed = 0;
  let recordsAcked = 0;
  let replaysTriggered = 0;
  const unexpectedTransitions: string[] = [];
  let drainEventCount = 0;
  let backpressureEvents = 0;
  let connectionId = '';
  let replaySessionId = '';

  let state: string = 'DISCONNECTED';
  const transitions: { from: string; to: string; timestamp: number }[] = [];

  function transition(newState: string): void {
    const valid: Record<string, string[]> = {
      'DISCONNECTED': ['CONNECTING'],
      'CONNECTING': ['CONNECTED', 'DISCONNECTED'],
      'CONNECTED': ['HELLO_SENT', 'DISCONNECTED'],
      'HELLO_SENT': ['READY_RECEIVED', 'DISCONNECTED'],
      'READY_RECEIVED': ['REPLAY_IN_PROGRESS', 'DISCONNECTED'],
      'REPLAY_IN_PROGRESS': ['REPLAY_COMPLETE', 'DISCONNECTED'],
      'REPLAY_COMPLETE': ['SYNCHRONIZED', 'DISCONNECTED'],
      'SYNCHRONIZED': ['NORMAL_OPERATION', 'DISCONNECTED'],
      'NORMAL_OPERATION': ['DISCONNECTED', 'CONNECTING'],
    };
    if (!valid[state]?.includes(newState) && newState !== 'DISCONNECTED') {
      unexpectedTransitions.push(`Invalid: ${state}→${newState}`);
    }
    const oldState = state;
    state = newState;
    transitions.push({ from: oldState, to: newState, timestamp: Date.now() });
    if (tracer) tracer.recordConnectionEvent(connectionId, `CLIENT_STATE:${newState}`, state);
  }

  async function handleData(data: string): Promise<void> {
    const lines = data.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        if (msg.type === 'ready') {
          if (state === 'HELLO_SENT') {
            transition('READY_RECEIVED');
            transition('REPLAY_IN_PROGRESS');
            replaySessionId = tracer ? tracer.newReplaySessionId() : '';
            await replayQueuedRecords();
            replaysTriggered++;
            transition('REPLAY_COMPLETE');
            socket?.write(JSON.stringify({ type: 'sync_request', sinceSequence: peerLastSequence }) + '\n');
            transition('SYNCHRONIZED');
            transition('NORMAL_OPERATION');
          }
          continue;
        }

        if (msg.type === 'ack') {
          const writeTime = writeTimestamps.get(msg.idempotencyKey);
          if (writeTime) {
            const latency = Date.now() - writeTime;
            writeTimestamps.delete(msg.idempotencyKey);
            const resolver = pendingAcks.get(msg.idempotencyKey);
            if (resolver) {
              pendingAcks.delete(msg.idempotencyKey);
              recordsAcked++;
              if (tracer) tracer.recordStage('', msg.idempotencyKey, 'ackReceived');
              resolver(latency);
            }
          }
        } else if (msg.type === 'record') {
          insertRecord(db, msg.record as SyncRecord);
        }
      } catch {}
    }
  }

  async function replayQueuedRecords(): Promise<number> {
    if (!socket || !clientId) return 0;
    const queuedRecords = db.prepare('SELECT * FROM sync_records WHERE clientId = ? ORDER BY sequenceNumber ASC').all(clientId) as SyncRecord[];
    let seqInReplay = 0;
    for (const record of queuedRecords) {
      seqInReplay++;
      if (tracer) {
        tracer.recordStage(record.id, record.idempotencyKey, 'replayQueued');
        tracer.recordStage(record.id, record.idempotencyKey, 'connectionId', connectionId);
        tracer.recordStage(record.id, record.idempotencyKey, 'replaySessionId', replaySessionId);
        tracer.recordStage(record.id, record.idempotencyKey, 'sequenceInReplay', seqInReplay);
        tracer.recordStage(record.id, record.idempotencyKey, 'socketWriteStart');
      }

      const data = JSON.stringify({ type: 'record', record }) + '\n';
      const canWrite = socket.write(data);
      recordsReplayed++;

      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'socketWriteEnd', canWrite);
      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'socketWriteOk', canWrite);

      if (!canWrite) {
        backpressureEvents++;
        await new Promise<void>((resolve) => {
          const onDrain = () => { drainEventCount++; socket!.off('drain', onDrain); resolve(); };
          socket!.once('drain', onDrain);
          setTimeout(() => { socket!.off('drain', onDrain); resolve(); }, 5000);
        });
      }
    }
    return queuedRecords.length;
  }

  function connectInternal(): Promise<void> {
    return new Promise((resolve) => {
      connectionId = tracer ? tracer.newConnectionId() : `CONN-${Date.now()}`;
      transition('CONNECTING');
      socket = new net.Socket();
      let buffer = '';

      socket.connect(peerPort, peerHost, () => {
        transition('CONNECTED');
        if (tracer) {
          const snap = tracer.takeSocketSnapshot(socket as unknown as { bytesWritten: number; bytesRead: number; bufferSize: number; destroyed: boolean; pending: boolean; readyState: string });
          tracer.recordConnectionEvent(connectionId, 'CLIENT_TCP_CONNECTED', state, snap);
        }
        socket!.write(JSON.stringify({ type: 'hello' }) + '\n');
        transition('HELLO_SENT');
        resolve();
      });

      socket.on('data', (data) => { buffer += data.toString(); const lines = buffer.split('\n'); buffer = lines.pop() || ''; handleData(lines.join('\n')); });
      socket.on('error', () => { transition('DISCONNECTED'); scheduleReconnect(); });
      socket.on('close', () => { transition('DISCONNECTED'); scheduleReconnect(); });
    });
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; if (state === 'DISCONNECTED') { connectInternal().catch(() => scheduleReconnect()); } }, 1000);
  }

  return {
    async connect() { await connectInternal(); },
    disconnect() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (tracer && socket) {
        const snap = tracer.takeSocketSnapshot(socket as unknown as { bytesWritten: number; bytesRead: number; bufferSize: number; destroyed: boolean; pending: boolean; readyState: string });
        tracer.recordConnectionEvent(connectionId, 'CLIENT_DISCONNECT', 'DISCONNECTED', snap);
      }
      socket?.destroy();
      transition('DISCONNECTED');
    },
    isConnected() { return state === 'NORMAL_OPERATION'; },
    getState() { return state; },
    getStats() { return { state, transitions, recordsReplayed, recordsAcked, replaysTriggered, unexpectedTransitions, drainEventCount, backpressureEvents, connectionId }; },
    async writeRecord(record: SyncRecord): Promise<{ latencyMs: number; acked: boolean }> {
      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'created');
      insertRecord(db, record);
      if (tracer) tracer.recordStage(record.id, record.idempotencyKey, 'sqliteCommitted');

      if (state !== 'NORMAL_OPERATION' || !socket) {
        return { latencyMs: 0, acked: false };
      }
      return new Promise((resolve) => {
        writeTimestamps.set(record.idempotencyKey, Date.now());
        const timeout = setTimeout(() => { pendingAcks.delete(record.idempotencyKey); writeTimestamps.delete(record.idempotencyKey); resolve({ latencyMs: 5000, acked: false }); }, 5000);
        pendingAcks.set(record.idempotencyKey, (latencyMs: number) => { clearTimeout(timeout); resolve({ latencyMs, acked: true }); });
        socket!.write(JSON.stringify({ type: 'record', record }) + '\n');
      });
    },
  };
}
