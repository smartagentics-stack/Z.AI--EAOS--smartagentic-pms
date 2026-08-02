/**
 * SPIKE-01 Replication Trace — Engineering Observability Phase
 *
 * Tracks every record through its full lifecycle:
 * created → sqlite_committed → replay_queued → socket_write_start →
 * socket_write_end → packet_received → json_parsed → insert_attempted →
 * insert_complete → ack_sent → ack_received
 *
 * No protocol changes. No architecture changes. Observation only.
 */

export interface ReplayTrace {
  recordId: string;
  idempotencyKey: string;
  created?: number;
  sqliteCommitted?: number;
  replayQueued?: number;
  socketWriteStart?: number;
  socketWriteEnd?: number;
  socketWriteOk?: boolean;
  packetReceived?: number;
  jsonParsed?: number;
  insertAttempted?: number;
  insertComplete?: number;
  insertIgnored?: boolean; // INSERT OR IGNORE skipped it
  ackSent?: number;
  ackReceived?: number;
  // Context
  connectionId?: string;
  replaySessionId?: string;
  sequenceInReplay?: number;
}

export interface SocketSnapshot {
  bytesWritten: number;
  bytesRead: number;
  bufferSize: number;
  destroyed: boolean;
  pending: boolean;
  readyState: string;
}

export interface ConnectionEvent {
  timestamp: number;
  connectionId: string;
  event: string;
  socketSnapshot?: SocketSnapshot;
  state?: string;
}

export interface SQLiteVerification {
  timestamp: number;
  label: string;
  totalCount: number;
  maxSequence: number;
  minSequence: number;
  clientACount: number;
  clientBCount: number;
}

export class ReplicationTracer {
  private traces = new Map<string, ReplayTrace>();
  private connectionEvents: ConnectionEvent[] = [];
  private sqliteVerifications: SQLiteVerification[] = [];
  private connectionCounter = 0;
  private replaySessionCounter = 0;

  getOrCreate(recordId: string, idempotencyKey: string): ReplayTrace {
    if (!this.traces.has(recordId)) {
      this.traces.set(recordId, { recordId, idempotencyKey });
    }
    return this.traces.get(recordId)!;
  }

  recordStage(recordId: string, idempotencyKey: string, stage: keyof ReplayTrace, value?: unknown): void {
    const trace = this.getOrCreate(recordId, idempotencyKey);
    if (stage === 'socketWriteOk') {
      trace.socketWriteOk = value as boolean;
    } else if (stage === 'insertIgnored') {
      trace.insertIgnored = value as boolean;
    } else if (stage === 'connectionId') {
      trace.connectionId = value as string;
    } else if (stage === 'replaySessionId') {
      trace.replaySessionId = value as string;
    } else if (stage === 'sequenceInReplay') {
      trace.sequenceInReplay = value as number;
    } else {
      (trace as Record<string, unknown>)[stage] = Date.now();
    }
  }

  newConnectionId(): string {
    return `CONN-${++this.connectionCounter}`;
  }

  newReplaySessionId(): string {
    return `REPLAY-${++this.replaySessionCounter}`;
  }

  recordConnectionEvent(connectionId: string, event: string, state?: string, socketSnapshot?: SocketSnapshot): void {
    this.connectionEvents.push({
      timestamp: Date.now(),
      connectionId,
      event,
      state,
      socketSnapshot,
    });
  }

  recordSqliteVerification(label: string, db: { prepare: (sql: string) => { get: () => unknown } }): void {
    const countResult = db.prepare('SELECT COUNT(*) as c FROM sync_records').get() as { c: number };
    const seqResult = db.prepare('SELECT MIN(sequenceNumber) as min, MAX(sequenceNumber) as max FROM sync_records').get() as { min: number; max: number };
    const aCount = db.prepare("SELECT COUNT(*) as c FROM sync_records WHERE clientId = 'A'").get() as { c: number };
    const bCount = db.prepare("SELECT COUNT(*) as c FROM sync_records WHERE clientId = 'B'").get() as { c: number };
    this.sqliteVerifications.push({
      timestamp: Date.now(),
      label,
      totalCount: countResult.c,
      maxSequence: seqResult.max,
      minSequence: seqResult.min,
      clientACount: aCount.c,
      clientBCount: bCount.c,
    });
  }

  takeSocketSnapshot(socket: { bytesWritten: number; bytesRead: number; bufferSize: number; destroyed: boolean; pending: boolean; readyState: string }): SocketSnapshot {
    return {
      bytesWritten: socket.bytesWritten,
      bytesRead: socket.bytesRead,
      bufferSize: socket.bufferSize,
      destroyed: socket.destroyed,
      pending: socket.pending,
      readyState: socket.readyState,
    };
  }

  generateReport(missingRecords: string[]): ReplicationTraceReport {
    const missingTraces = missingRecords.map(key => {
      const trace = Array.from(this.traces.values()).find(t => t.idempotencyKey === key);
      if (!trace) return { idempotencyKey: key, lastStage: 'NOT_FOUND_IN_TRACES', trace: null };
      const stages: (keyof ReplayTrace)[] = ['created', 'sqliteCommitted', 'replayQueued', 'socketWriteStart', 'socketWriteEnd', 'packetReceived', 'jsonParsed', 'insertAttempted', 'insertComplete', 'ackSent', 'ackReceived'];
      let lastStage = 'created';
      for (const stage of stages) {
        if (trace[stage] !== undefined) lastStage = stage;
      }
      return { idempotencyKey: key, lastStage, trace };
    });

    return {
      totalTraces: this.traces.size,
      missingRecords: missingTraces,
      missingTraces: missingTraces,
      connectionEvents: this.connectionEvents,
      sqliteVerifications: this.sqliteVerifications,
      missingRecordDetails: missingTraces,
    };
  }
}

export interface ReplicationTraceReport {
  totalTraces: number;
  missingRecords: string[];
  missingTraces: string[];
  connectionEvents: ConnectionEvent[];
  sqliteVerifications: SQLiteVerification[];
  missingRecordDetails: { idempotencyKey: string; lastStage: string; trace: ReplayTrace | null }[];
}
