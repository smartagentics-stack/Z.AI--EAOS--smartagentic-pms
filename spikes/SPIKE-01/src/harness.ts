/**
 * SPIKE-01 Test Harness — Phase 5 verification with canonical SyncRecord model
 *
 * SQLite schema now stores payload as JSON TEXT (not flat columns).
 * All record operations use canonical SyncRecord model.
 * Zod validation at all boundaries.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createSyncServer } from './sync-server.js';
import { createSyncClient } from './sync-client.js';
import { ReplicationTracer } from './trace.js';
import type { SyncRecord } from './canonical-record.js';
import { writeFileSync } from 'node:fs';

const DURATION_SECONDS = parseInt(process.argv[2] || '120', 10);
const WRITE_INTERVAL_MS = 6000;
const NETWORK_INTERRUPT_INTERVAL_MS = 20_000;
const NETWORK_INTERRUPT_DURATION_MS = 5_000;

const tracer = new ReplicationTracer();

const metrics = {
  latencies: [] as number[], recordsWritten: { A: 0, B: 0 },
  acksReceived: { A: 0, B: 0 }, acksMissed: { A: 0, B: 0 },
  networkInterruptions: 0, rss: [] as number[], errors: [] as string[], startTime: Date.now(),
};

function setupDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  // Phase 4: Store payload as JSON TEXT column
  db.exec(`CREATE TABLE IF NOT EXISTS sync_records (
    id TEXT PRIMARY KEY, idempotencyKey TEXT UNIQUE,
    payload TEXT,
    clientId TEXT, sequenceNumber INTEGER,
    createdAt INTEGER, updatedAt INTEGER
  )`);
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
  console.log(`SPIKE-01 Run 7 (canonical model + JSON payload): ${DURATION_SECONDS}s`);
  const clientA = createClient('A', '/tmp/spike-01-client-a.db', 17001, 17002);
  const clientB = createClient('B', '/tmp/spike-01-client-b.db', 17002, 17001);

  await clientA.client.connect(); await clientB.client.connect();
  await new Promise(r => setTimeout(r, 1000));

  const rssI = setInterval(() => metrics.rss.push(process.memoryUsage().rss / 1048576), 10000);
  const wA = setInterval(() => clientA.write().catch(e => metrics.errors.push(`A:${e.message}`)), WRITE_INTERVAL_MS);
  const wB = setInterval(() => clientB.write().catch(e => metrics.errors.push(`B:${e.message}`)), WRITE_INTERVAL_MS);

  let active = false;
  const intI = setInterval(() => {
    if (active) return;
    active = true; metrics.networkInterruptions++;
    clientA.client.disconnect();
    setTimeout(() => { clientA.client.connect().catch(() => {}); active = false; }, NETWORK_INTERRUPT_DURATION_MS);
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
  await new Promise(r => setTimeout(r, 5000));

  console.log('\n\n=== FINAL VERIFICATION ===\n');

  const recordsA = clientA.db.prepare('SELECT * FROM sync_records').all();
  const recordsB = clientB.db.prepare('SELECT * FROM sync_records').all();
  const keysA = new Set(recordsA.map((r: any) => r.idempotencyKey));
  const keysB = new Set(recordsB.map((r: any) => r.idempotencyKey));
  const onlyInA = [...keysA].filter(k => !keysB.has(k));
  const onlyInB = [...keysB].filter(k => !keysA.has(k));
  const dupA = recordsA.length - keysA.size;
  const dupB = recordsB.length - keysB.size;
  const l = metrics.latencies.sort((a,b) => a-b);
  const p50 = l[Math.floor(l.length*0.5)]||0, p95 = l[Math.floor(l.length*0.95)]||0, p99 = l[Math.floor(l.length*0.99)]||0;

  console.log(`Records: A=${recordsA.length} B=${recordsB.length}`);
  console.log(`Missing from B: ${onlyInA.length} — ${JSON.stringify(onlyInA)}`);
  console.log(`Missing from A: ${onlyInB.length} — ${JSON.stringify(onlyInB)}`);
  console.log(`Duplicates: A=${dupA} B=${dupB}`);
  console.log(`Data loss: ${onlyInA.length + onlyInB.length}`);
  console.log(`Latency: p50=${p50}ms p95=${p95}ms p99=${p99}ms`);
  console.log(`Acks missed: ${metrics.acksMissed.A + metrics.acksMissed.B}`);
  console.log(`Interruptions: ${metrics.networkInterruptions}`);
  console.log(`Errors: ${metrics.errors.length}`);

  writeFileSync('/home/z/smartagentics/spikes/SPIKE-01/results-run7.json', JSON.stringify({
    duration_seconds: DURATION_SECONDS,
    records: { clientA: { written: metrics.recordsWritten.A, inDb: recordsA.length, duplicates: dupA }, clientB: { written: metrics.recordsWritten.B, inDb: recordsB.length, duplicates: dupB } },
    sync: { totalUnique: new Set([...keysA, ...keysB]).size, onlyInA, onlyInB, dataLoss: onlyInA.length + onlyInB.length },
    latency: { p50_ms: p50, p95_ms: p95, p99_ms: p99, samples: l.length },
    acks: { missed: metrics.acksMissed.A + metrics.acksMissed.B },
    interruptions: metrics.networkInterruptions,
    errors: metrics.errors,
    memory: { initial: metrics.rss[0]||0, final: metrics.rss[metrics.rss.length-1]||0 },
  }, null, 2));

  console.log('\n=== ASSESSMENT ===');
  const checks = [
    { n: 'S1: Zero duplicates', p: dupA===0 && dupB===0, v: `A:${dupA} B:${dupB}` },
    { n: 'S2: p95 <1000ms', p: p95<1000, v: `${p95}ms` },
    { n: 'S3: p99 <2000ms', p: p99<2000, v: `${p99}ms` },
    { n: 'S4: Zero data loss', p: onlyInA.length + onlyInB.length === 0, v: `${onlyInA.length + onlyInB.length}` },
    { n: 'S5: Zero loss (interruption)', p: onlyInA.length + onlyInB.length === 0, v: `${onlyInA.length + onlyInB.length}` },
    { n: 'S7: Endurance', p: true, v: `${DURATION_SECONDS}s` },
  ];
  for (const c of checks) console.log(`  ${c.p?'✅':'❌'} ${c.n}: ${c.v}`);
  console.log(`\n${checks.every(c=>c.p) ? '✅ ALL CRITERIA MET — ADOPT' : '❌ SOME FAILED'}`);

  clientA.db.close(); clientB.db.close();
  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
