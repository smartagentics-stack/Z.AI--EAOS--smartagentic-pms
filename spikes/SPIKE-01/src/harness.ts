/**
 * SPIKE-01 Test Harness — Observability Phase
 *
 * No protocol changes. No architecture changes.
 * Instruments every record with lifecycle tracing.
 * Identifies missing records by ID and traces their last known stage.
 * Verifies SQLite at key points. Logs socket metrics.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createSyncServer, type SyncRecord } from './sync-server.js';
import { createSyncClient } from './sync-client.js';
import { ReplicationTracer } from './trace.js';
import { writeFileSync } from 'node:fs';

const DURATION_SECONDS = parseInt(process.argv[2] || '120', 10);
const WRITE_INTERVAL_MS = 6000;
const NETWORK_INTERRUPT_INTERVAL_MS = 20_000;
const NETWORK_INTERRUPT_DURATION_MS = 5_000;

const tracer = new ReplicationTracer();

const metrics = {
  latencies: [] as number[],
  recordsWritten: { A: 0, B: 0 },
  acksReceived: { A: 0, B: 0 },
  acksMissed: { A: 0, B: 0 },
  networkInterruptions: 0,
  rss: [] as number[],
  errors: [] as string[],
  startTime: Date.now(),
};

function setupDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS sync_records (id TEXT PRIMARY KEY, idempotencyKey TEXT UNIQUE, name TEXT, value INTEGER, timestamp INTEGER, clientId TEXT, sequenceNumber INTEGER, createdAt INTEGER, updatedAt INTEGER); CREATE INDEX IF NOT EXISTS idx_seq ON sync_records(sequenceNumber);');
  return db;
}

function createClient(clientId: 'A' | 'B', dbPath: string, serverPort: number, peerPort: number) {
  const db = setupDatabase(dbPath);
  let sequence = 0;
  const server = createSyncServer(db, serverPort, () => {}, tracer);
  const client = createSyncClient(db, peerPort, '127.0.0.1', clientId, tracer);

  return {
    clientId, db, server, client,
    async write() {
      const record: SyncRecord = {
        id: randomUUID(), idempotencyKey: `${clientId}-${++sequence}`,
        payload: { name: `r-${sequence}`, value: Math.floor(Math.random()*1000), timestamp: Date.now() },
        clientId, sequenceNumber: sequence, createdAt: Date.now(), updatedAt: Date.now()
      };
      const result = await client.writeRecord(record);
      metrics.recordsWritten[clientId]++;
      if (result.acked) { metrics.acksReceived[clientId]++; metrics.latencies.push(result.latencyMs); }
      else { metrics.acksMissed[clientId]++; }
    },
  };
}

async function main() {
  console.log(`SPIKE-01 OBSERVABILITY RUN: ${DURATION_SECONDS}s`);

  const clientA = createClient('A', '/tmp/spike-01-client-a.db', 17001, 17002);
  const clientB = createClient('B', '/tmp/spike-01-client-b.db', 17002, 17001);

  // SQLite verification BEFORE test
  tracer.recordSqliteVerification('PRE_TEST_A', clientA.db as unknown as { prepare: (s: string) => { get: () => unknown } });
  tracer.recordSqliteVerification('PRE_TEST_B', clientB.db as unknown as { prepare: (s: string) => { get: () => unknown } });

  await clientA.client.connect();
  await clientB.client.connect();
  await new Promise(r => setTimeout(r, 1000));

  // SQLite verification AFTER initial connect
  tracer.recordSqliteVerification('POST_CONNECT_A', clientA.db as unknown as { prepare: (s: string) => { get: () => unknown } });
  tracer.recordSqliteVerification('POST_CONNECT_B', clientB.db as unknown as { prepare: (s: string) => { get: () => unknown } });

  const rssI = setInterval(() => metrics.rss.push(process.memoryUsage().rss / 1048576), 10000);
  const wA = setInterval(() => clientA.write().catch(e => metrics.errors.push(`A:${e.message}`)), WRITE_INTERVAL_MS);
  const wB = setInterval(() => clientB.write().catch(e => metrics.errors.push(`B:${e.message}`)), WRITE_INTERVAL_MS);

  let active = false;
  const intI = setInterval(() => {
    if (active) return;
    active = true; metrics.networkInterruptions++;
    clientA.client.disconnect();
    // SQLite verification during disconnect
    tracer.recordSqliteVerification(`DURING_DISCONNECT_${metrics.networkInterruptions}_A`, clientA.db as unknown as { prepare: (s: string) => { get: () => unknown } });
    setTimeout(() => {
      clientA.client.connect().catch(() => {});
      active = false;
    }, NETWORK_INTERRUPT_DURATION_MS);
  }, NETWORK_INTERRUPT_INTERVAL_MS);

  const progI = setInterval(() => {
    const e = Math.floor((Date.now()-metrics.startTime)/1000);
    process.stdout.write(`\rT+${e}s w:A=${metrics.recordsWritten.A} B=${metrics.recordsWritten.B} miss:A=${metrics.acksMissed.A} B=${metrics.acksMissed.B} int:${metrics.networkInterruptions} st:A=${clientA.client.getState()} B=${clientB.client.getState()}`);
  }, 5000);

  console.log(`Running for ${DURATION_SECONDS}s...`);
  await new Promise(r => setTimeout(r, DURATION_SECONDS * 1000));

  clearInterval(wA); clearInterval(wB); clearInterval(intI); clearInterval(progI); clearInterval(rssI);
  clientA.client.disconnect(); clientB.client.disconnect();
  clientA.server.close(); clientB.server.close();
  await new Promise(r => setTimeout(r, 5000)); // Wait for final sync

  // SQLite verification AFTER test
  tracer.recordSqliteVerification('POST_TEST_A', clientA.db as unknown as { prepare: (s: string) => { get: () => unknown } });
  tracer.recordSqliteVerification('POST_TEST_B', clientB.db as unknown as { prepare: (s: string) => { get: () => unknown } });

  console.log('\n\n=== FINAL VERIFICATION ===\n');

  const recordsA = clientA.db.prepare('SELECT * FROM sync_records ORDER BY clientId, sequenceNumber').all() as SyncRecord[];
  const recordsB = clientB.db.prepare('SELECT * FROM sync_records ORDER BY clientId, sequenceNumber').all() as SyncRecord[];
  const keysA = new Set(recordsA.map(r=>r.idempotencyKey));
  const keysB = new Set(recordsB.map(r=>r.idempotencyKey));
  const onlyInA = [...keysA].filter(k=>!keysB.has(k));
  const onlyInB = [...keysB].filter(k=>!keysA.has(k));
  const dupA = recordsA.length - keysA.size;
  const dupB = recordsB.length - keysB.size;
  const l = metrics.latencies.sort((a,b)=>a-b);
  const p50 = l[Math.floor(l.length*0.5)]||0, p95 = l[Math.floor(l.length*0.95)]||0, p99 = l[Math.floor(l.length*0.99)]||0;

  // Generate Replication Trace Report
  const report = tracer.generateReport(onlyInA.length > 0 ? onlyInA : onlyInB);

  console.log('=== RECORD SUMMARY ===');
  console.log(`A: ${recordsA.length} records (${recordsA.filter(r=>r.clientId==='A').length} A, ${recordsA.filter(r=>r.clientId==='B').length} B)`);
  console.log(`B: ${recordsB.length} records (${recordsB.filter(r=>r.clientId==='A').length} A, ${recordsB.filter(r=>r.clientId==='B').length} B)`);
  console.log(`Missing from B (only in A): ${onlyInA.length} — ${JSON.stringify(onlyInA)}`);
  console.log(`Missing from A (only in B): ${onlyInB.length} — ${JSON.stringify(onlyInB)}`);
  console.log(`Duplicates: A=${dupA} B=${dupB}`);
  console.log(`Data loss: ${onlyInA.length + onlyInB.length}`);
  console.log(`Latency: p50=${p50}ms p95=${p95}ms p99=${p99}ms`);
  console.log(`Acks missed: ${metrics.acksMissed.A + metrics.acksMissed.B}`);
  console.log(`Interruptions: ${metrics.networkInterruptions}`);
  console.log('');

  console.log('=== MISSING RECORD TRACE DETAILS ===');
  for (const detail of report.missingRecordDetails) {
    console.log(`\nRecord ${detail.idempotencyKey}:`);
    console.log(`  Last stage reached: ${detail.lastStage}`);
    if (detail.trace) {
      const t = detail.trace;
      console.log(`  created: ${t.created ?? '—'}`);
      console.log(`  sqliteCommitted: ${t.sqliteCommitted ?? '—'}`);
      console.log(`  replayQueued: ${t.replayQueued ?? '—'}`);
      console.log(`  socketWriteStart: ${t.socketWriteStart ?? '—'}`);
      console.log(`  socketWriteEnd: ${t.socketWriteEnd ?? '—'} (ok: ${t.socketWriteOk ?? '—'})`);
      console.log(`  packetReceived: ${t.packetReceived ?? '—'}`);
      console.log(`  jsonParsed: ${t.jsonParsed ?? '—'}`);
      console.log(`  insertAttempted: ${t.insertAttempted ?? '—'}`);
      console.log(`  insertComplete: ${t.insertComplete ?? '—'}`);
      console.log(`  ackSent: ${t.ackSent ?? '—'}`);
      console.log(`  ackReceived: ${t.ackReceived ?? '—'}`);
      console.log(`  connectionId: ${t.connectionId ?? '—'}`);
      console.log(`  replaySessionId: ${t.replaySessionId ?? '—'}`);
      console.log(`  sequenceInReplay: ${t.sequenceInReplay ?? '—'}`);
    } else {
      console.log('  NO TRACE FOUND — record was never traced');
    }
  }

  console.log('\n=== SQLITE VERIFICATIONS ===');
  for (const v of report.sqliteVerifications) {
    console.log(`  ${v.label}: total=${v.totalCount} A=${v.clientACount} B=${v.clientBCount} seq=${v.minSequence}-${v.maxSequence}`);
  }

  console.log('\n=== CONNECTION EVENTS (last 20) ===');
  const lastEvents = report.connectionEvents.slice(-20);
  for (const e of lastEvents) {
    const time = new Date(e.timestamp).toISOString().split('T')[1].replace('Z','');
    console.log(`  ${time} ${e.connectionId} ${e.event} state=${e.state ?? ''}`);
    if (e.socketSnapshot) {
      console.log(`    socket: written=${e.socketSnapshot.bytesWritten} read=${e.socketSnapshot.bytesRead} buf=${e.socketSnapshot.bufferSize} destroyed=${e.socketSnapshot.destroyed} ready=${e.socketSnapshot.readyState}`);
    }
  }

  // Write full report to file
  writeFileSync('/home/z/smartagentics/spikes/SPIKE-01/trace-report.json', JSON.stringify({
    duration: DURATION_SECONDS,
    recordsA: recordsA.length,
    recordsB: recordsB.length,
    missingFromB: onlyInA,
    missingFromA: onlyInB,
    dataLoss: onlyInA.length + onlyInB.length,
    duplicates: { A: dupA, B: dupB },
    latency: { p50, p95, p99 },
    acksMissed: metrics.acksMissed,
    interruptions: metrics.networkInterruptions,
    memory: { initial: metrics.rss[0]||0, final: metrics.rss[metrics.rss.length-1]||0 },
    errors: metrics.errors,
    missingRecordDetails: report.missingRecordDetails,
    sqliteVerifications: report.sqliteVerifications,
    connectionEvents: report.connectionEvents,
  }, null, 2));

  console.log('\n=== ASSESSMENT ===');
  const checks = [
    { n: 'S1: Zero duplicates', p: dupA===0 && dupB===0, v: `A:${dupA} B:${dupB}` },
    { n: 'S4: Zero data loss', p: onlyA.length + onlyB.length === 0, v: `${onlyA.length + onlyB.length}` },
  ];
  for (const c of checks) console.log(`  ${c.p?'✅':'❌'} ${c.n}: ${c.v}`);

  clientA.db.close(); clientB.db.close();
  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
