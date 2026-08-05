/**
 * SPIKE-01 Phase 1: Definitive Evidence Gathering
 *
 * Prints the EXACT record at all 7 lifecycle stages using JSON.stringify.
 * No summarizing. No guessing. Complete object structure at each stage.
 *
 * Stages:
 * 1. Original object before SQLite insert (client writeRecord)
 * 2. SQLite row immediately after insert
 * 3. SQLite row returned by replay SELECT
 * 4. Replay object before JSON serialization (what gets sent over TCP)
 * 5. JSON payload sent over TCP (the actual string)
 * 6. Object received and parsed by server (after JSON.parse)
 * 7. Object passed into INSERT function (what processRecord receives)
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Setup ───────────────────────────────────────────────────────────────────

const DB_A = join(tmpdir(), 'spike-01-evidence-a.db');
const DB_B = join(tmpdir(), 'spike-01-evidence-b.db');

function setupDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS sync_records (
    id TEXT PRIMARY KEY, idempotencyKey TEXT UNIQUE,
    name TEXT, value INTEGER, timestamp INTEGER,
    clientId TEXT, sequenceNumber INTEGER,
    createdAt INTEGER, updatedAt INTEGER
  )`);
  return db;
}

const dbA = setupDatabase(DB_A);
const dbB = setupDatabase(DB_B);

// ─── Stage 1: Original object before SQLite insert ───────────────────────────

const record = {
  id: randomUUID(),
  idempotencyKey: 'A-1',
  payload: { name: 'record-1', value: 42, timestamp: Date.now() },
  clientId: 'A',
  sequenceNumber: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

console.log('=== STAGE 1: Original object before SQLite insert ===');
console.log(JSON.stringify(record, null, 2));
console.log('');

// ─── Stage 2: SQLite row immediately after insert ────────────────────────────

dbA
  .prepare(
    'INSERT OR IGNORE INTO sync_records (id, idempotencyKey, name, value, timestamp, clientId, sequenceNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  .run(
    record.id,
    record.idempotencyKey,
    record.payload.name,
    record.payload.value,
    record.payload.timestamp,
    record.clientId,
    record.sequenceNumber,
    record.createdAt,
    record.updatedAt,
  );

const sqliteRow = dbA.prepare('SELECT * FROM sync_records WHERE idempotencyKey = ?').get('A-1');

console.log('=== STAGE 2: SQLite row immediately after insert (SELECT *) ===');
console.log(JSON.stringify(sqliteRow, null, 2));
console.log('');

// ─── Stage 3: SQLite row returned by replay SELECT ───────────────────────────

const replayRows = dbA
  .prepare('SELECT * FROM sync_records WHERE clientId = ? ORDER BY sequenceNumber ASC')
  .all('A');
const replayRow = replayRows[0];

console.log('=== STAGE 3: SQLite row returned by replay SELECT ===');
console.log(JSON.stringify(replayRow, null, 2));
console.log('');

// ─── Stage 4: Replay object before JSON serialization ────────────────────────
// This is what the replay code actually sends — the raw SQLite row

const replayObject = replayRow; // The replay sends the SQLite row directly

console.log('=== STAGE 4: Replay object before JSON serialization ===');
console.log(JSON.stringify(replayObject, null, 2));
console.log('');

// ─── Stage 5: JSON payload sent over TCP ─────────────────────────────────────

const tcpPayload = JSON.stringify({ type: 'record', record: replayObject }) + '\n';

console.log('=== STAGE 5: JSON payload sent over TCP ===');
console.log(JSON.stringify({ type: 'record', record: replayObject }, null, 2));
console.log('');

// ─── Stage 6: Object received and parsed by server ───────────────────────────
// Simulate what the server does: JSON.parse the line, extract msg.record

const parsed = JSON.parse(tcpPayload.trim());
const receivedRecord = parsed.record;

console.log('=== STAGE 6: Object received and parsed by server (msg.record) ===');
console.log(JSON.stringify(receivedRecord, null, 2));
console.log('');

// ─── Stage 7: Object passed into INSERT function ─────────────────────────────
// The server's processRecord tries: record.payload.name

console.log('=== STAGE 7: Object passed into INSERT function ===');
console.log('The INSERT function accesses: record.payload.name');
console.log('record.payload =', JSON.stringify(receivedRecord.payload));
console.log('record.name =', JSON.stringify(receivedRecord.name));
console.log('');

// ─── Comparison Table ────────────────────────────────────────────────────────

console.log('=== OBJECT SHAPE COMPARISON TABLE ===');
console.log('');

const stages = [
  { stage: '1. Original (before SQLite)', obj: record },
  { stage: '2. SQLite row (after insert)', obj: sqliteRow },
  { stage: '3. Replay SELECT result', obj: replayRow },
  { stage: '4. Pre-serialize object', obj: replayObject },
  { stage: '6. Server received (parsed)', obj: receivedRecord },
];

// Print field comparison
const allFields = new Set<string>();
for (const s of stages) {
  if (s.obj && typeof s.obj === 'object') {
    for (const key of Object.keys(s.obj)) {
      allFields.add(key);
    }
  }
}

console.log(
  'Field                    | Stage 1 (Original)           | Stage 2 (SQLite)             | Stage 3 (Replay SELECT)      | Stage 6 (Server received)',
);
console.log(
  '-------------------------|------------------------------|------------------------------|------------------------------|------------------------------',
);
for (const field of allFields) {
  let row = field.padEnd(24) + ' | ';
  for (const s of stages) {
    const val = (s.obj as Record<string, unknown>)?.[field];
    const valStr = val === undefined ? 'UNDEFINED' : JSON.stringify(val);
    row += valStr.padEnd(28) + ' | ';
  }
  console.log(row);
}

console.log('');
console.log('=== KEY FINDING ===');
console.log('');

// Check if payload exists at each stage
for (const s of stages) {
  const hasPayload = (s.obj as Record<string, unknown>)?.payload !== undefined;
  const hasName = (s.obj as Record<string, unknown>)?.name !== undefined;
  console.log(
    `${s.stage}: payload=${hasPayload ? 'EXISTS' : 'MISSING'}, name=${hasName ? 'EXISTS (flat)' : 'MISSING'}`,
  );
}

console.log('');
console.log('=== TRANSFORMATION POINT ===');
console.log('');

// Identify where the shape changes
let prevPayload = (record as Record<string, unknown>)?.payload !== undefined;
for (const s of stages) {
  const currPayload = (s.obj as Record<string, unknown>)?.payload !== undefined;
  if (prevPayload && !currPayload) {
    console.log(`SHAPE CHANGE: payload field DISAPPEARED at stage "${s.stage}"`);
    console.log('  Before this stage: record.payload = { name, value, timestamp } (nested object)');
    console.log('  After this stage: record.name, record.value, record.timestamp (flat fields)');
    console.log(
      '  Root cause: SQLite stores payload fields as separate columns, not as a JSON object.',
    );
    console.log('  SELECT * returns flat columns, not the original nested structure.');
  }
  prevPayload = currPayload;
}

// Write evidence to file
writeFileSync(
  join(__dirname, 'evidence-phase1.json'),
  JSON.stringify(
    {
      stages: stages.map((s) => ({ stage: s.stage, object: s.obj })),
      transformationPoint:
        'SQLite SELECT * returns flat columns (name, value, timestamp) instead of nested payload object',
    },
    null,
    2,
  ),
);

console.log('');
console.log('Evidence written to spikes/SPIKE-01/evidence-phase1.json');

dbA.close();
dbB.close();
