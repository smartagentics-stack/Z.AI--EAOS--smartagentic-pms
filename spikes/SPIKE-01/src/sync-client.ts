/**
 * SPIKE-01 Sync Client — with connection state machine (Run 4)
 *
 * State machine for OUTGOING connections (us connecting to peer):
 * DISCONNECTED → CONNECTING → CONNECTED → HELLO_SENT → READY_RECEIVED →
 * REPLAY_IN_PROGRESS → REPLAY_COMPLETE → SYNCHRONIZED → NORMAL_OPERATION
 *
 * No replay may begin until READY_RECEIVED.
 * No normal writes may begin until SYNCHRONIZED.
 */

import * as net from 'node:net';
import type Database from 'better-sqlite3';
import { insertRecord, type SyncRecord } from './sync-server.js';

export interface SyncClient {
  writeRecord(record: SyncRecord): Promise<{ latencyMs: number; acked: boolean }>;
  connect(): Promise<void>;
  disconnect(): void;
  isConnected(): boolean;
  getState(): ClientConnState;
  getStats(): ClientConnStats;
}

export type ClientConnState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'HELLO_SENT'
  | 'READY_RECEIVED'
  | 'REPLAY_IN_PROGRESS'
  | 'REPLAY_COMPLETE'
  | 'SYNCHRONIZED'
  | 'NORMAL_OPERATION';

export interface ClientConnStats {
  state: ClientConnState;
  transitions: { from: string; to: string; timestamp: number }[];
  recordsReplayed: number;
  recordsAcked: number;
  replaysTriggered: number;
  unexpectedTransitions: string[];
}

export function createSyncClient(
  db: Database.Database,
  peerPort: number,
  peerHost: string = '127.0.0.1',
  clientId?: string
): SyncClient {
  let socket: net.Socket | null = null;
  let state: ClientConnState = 'DISCONNECTED';
  const transitions: { from: string; to: string; timestamp: number }[] = [];
  const pendingAcks = new Map<string, (latencyMs: number) => void>();
  const writeTimestamps = new Map<string, number>();
  let reconnectTimer: NodeJS.Timeout | null = null;
  let peerLastSequence = 0;
  let recordsReplayed = 0;
  let recordsAcked = 0;
  let replaysTriggered = 0;
  const unexpectedTransitions: string[] = [];

  function transition(newState: ClientConnState): void {
    const oldState = state;
    // Validate transition
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

    if (!valid[oldState]?.includes(newState) && newState !== 'DISCONNECTED') {
      unexpectedTransitions.push(`Invalid: ${oldState}→${newState} at ${Date.now()}`);
    }

    state = newState;
    transitions.push({ from: oldState, to: newState, timestamp: Date.now() });
  }

  function handleData(data: string): void {
    const lines = data.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        if (msg.type === 'ready') {
          if (state === 'HELLO_SENT') {
            transition('READY_RECEIVED');
            // Begin replay
            transition('REPLAY_IN_PROGRESS');
            replayQueuedRecords();
            replaysTriggered++;
            transition('REPLAY_COMPLETE');
            // Request peer's records
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
              resolver(latency);
            }
          }
        } else if (msg.type === 'record') {
          insertRecord(db, msg.record as SyncRecord);
        }
      } catch {}
    }
  }

  function replayQueuedRecords(): number {
    if (!socket || !clientId) return 0;
    const queuedRecords = db.prepare('SELECT * FROM sync_records WHERE clientId = ? ORDER BY sequenceNumber ASC').all(clientId) as SyncRecord[];
    for (const record of queuedRecords) {
      socket.write(JSON.stringify({ type: 'record', record }) + '\n');
      recordsReplayed++;
    }
    return queuedRecords.length;
  }

  function connectInternal(): Promise<void> {
    return new Promise((resolve) => {
      transition('CONNECTING');
      socket = new net.Socket();
      let buffer = '';

      socket.connect(peerPort, peerHost, () => {
        transition('CONNECTED');
        // Send HELLO — do NOT replay yet
        socket!.write(JSON.stringify({ type: 'hello' }) + '\n');
        transition('HELLO_SENT');
        resolve();
      });

      socket.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        handleData(lines.join('\n'));
      });

      socket.on('error', () => {
        transition('DISCONNECTED');
        scheduleReconnect();
      });

      socket.on('close', () => {
        transition('DISCONNECTED');
        scheduleReconnect();
      });
    });
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (state === 'DISCONNECTED') {
        connectInternal().catch(() => scheduleReconnect());
      }
    }, 1000);
  }

  return {
    async connect() { await connectInternal(); },

    disconnect() {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      socket?.destroy();
      transition('DISCONNECTED');
    },

    isConnected() { return state === 'NORMAL_OPERATION' || state === 'SYNCHRONIZED'; },

    getState() { return state; },

    getStats() {
      return { state, transitions, recordsReplayed, recordsAcked, replaysTriggered, unexpectedTransitions };
    },

    async writeRecord(record: SyncRecord): Promise<{ latencyMs: number; acked: boolean }> {
      insertRecord(db, record);
      // Only write if in NORMAL_OPERATION state
      if (state !== 'NORMAL_OPERATION' || !socket) {
        return { latencyMs: 0, acked: false };
      }
      return new Promise((resolve) => {
        writeTimestamps.set(record.idempotencyKey, Date.now());
        const timeout = setTimeout(() => {
          pendingAcks.delete(record.idempotencyKey);
          writeTimestamps.delete(record.idempotencyKey);
          resolve({ latencyMs: 5000, acked: false });
        }, 5000);
        pendingAcks.set(record.idempotencyKey, (latencyMs: number) => {
          clearTimeout(timeout);
          resolve({ latencyMs, acked: true });
        });
        socket!.write(JSON.stringify({ type: 'record', record }) + '\n');
      });
    },
  };
}
