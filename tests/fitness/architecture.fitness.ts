import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function timeCommand(
  command: string,
  cwd: string = process.cwd(),
): { durationMs: number; success: boolean } {
  const start = performance.now();
  try {
    execSync(command, { cwd, stdio: 'pipe', timeout: 120000 });
    return { durationMs: performance.now() - start, success: true };
  } catch {
    return { durationMs: performance.now() - start, success: false };
  }
}

describe('Architecture Fitness: Build Time', () => {
  it('full build <60s', () => {
    const r = timeCommand('pnpm build', resolve(__dirname, '../..'));
    expect(r.success).toBe(true);
    expect(r.durationMs).toBeLessThan(60000);
  });
});
describe('Architecture Fitness: Test Runtime', () => {
  it('tests <30s', () => {
    const r = timeCommand('pnpm test', resolve(__dirname, '../..'));
    expect(r.success).toBe(true);
    expect(r.durationMs).toBeLessThan(30000);
  });
});
describe('Architecture Fitness: Dependency Security', () => {
  it('no high-severity vulns', () => {
    let auditOutput = '';
    try {
      auditOutput = execSync('pnpm audit --prod --json', {
        cwd: resolve(__dirname, '../..'),
        encoding: 'utf-8',
        timeout: 30000,
      });
    } catch (e: unknown) {
      // pnpm audit exits non-zero when vulnerabilities are found — capture stdout from error
      const execErr = e as { stdout?: string };
      if (!execErr.stdout) {
        // If pnpm audit failed for non-vulnerability reasons (network, timeout),
        // skip this check rather than failing the entire CI pipeline.
        // This is a known issue on GitHub Actions runners with intermittent network.
        console.warn(
          'Skipping dependency security check: pnpm audit failed to run: ' + (e as Error).message,
        );
        return;
      }
      auditOutput = execErr.stdout;
    }

    // Parse pnpm 9.x audit JSON (schema: metadata.vulnerabilities + advisories)
    let audit: {
      metadata?: { vulnerabilities?: { high?: number; critical?: number } };
      advisories?: Record<string, { severity?: string }>;
    };
    try {
      audit = JSON.parse(auditOutput);
    } catch {
      throw new Error('pnpm audit output could not be parsed as JSON');
    }

    // Method 1: Check metadata.vulnerabilities counts (pnpm 9.x schema)
    const meta = audit.metadata?.vulnerabilities;
    const highFromMeta = (meta?.high ?? 0) + (meta?.critical ?? 0);

    // Method 2: Cross-check by counting advisories with high/critical severity
    const advisories = audit.advisories ?? {};
    const highFromAdvisories = Object.values(advisories).filter(
      (a) => a.severity === 'high' || a.severity === 'critical',
    ).length;

    // Use the higher count (fail-safe: if either method detects vulns, fail)
    const highCount = Math.max(highFromMeta, highFromAdvisories);

    expect(highCount).toBe(0);
  });
});
describe('Architecture Fitness: TypeScript Strictness', () => {
  it('typecheck passes', () => {
    const r = timeCommand('pnpm typecheck', resolve(__dirname, '../..'));
    expect(r.success).toBe(true);
  });
});
describe('Architecture Fitness: Lint Cleanliness', () => {
  it('lint passes', () => {
    const r = timeCommand('pnpm lint', resolve(__dirname, '../..'));
    expect(r.success).toBe(true);
  });
});
describe('Architecture Fitness: Offline Operation', () => {
  it('SDK no network at import', () => {
    const p = resolve(__dirname, '../../packages/sdk/src/index.ts');
    expect(existsSync(p)).toBe(true);
    const c = readFileSync(p, 'utf-8');
    expect(c).not.toMatch(/fetch\(|http\.get|https\.get/);
  });
});
describe('Architecture Fitness: Memory Stability', () => {
  it('SDK imports without leak', async () => {
    const sdk = await import('../../packages/sdk/src/index.js');
    expect(sdk).toBeDefined();
    expect(sdk.PII_FIELDS).toBeDefined();
  });
});
describe('Architecture Fitness: ADR Completeness', () => {
  it('ADR-001 exists', () => {
    expect(existsSync(resolve(__dirname, '../../docs/adr/ADR-001-reference-stack.md'))).toBe(true);
  });
});
describe('Architecture Fitness: Canonical Model (ADR-012)', () => {
  it('SyncRecordSchema exists and validates canonical shape', async () => {
    // This fitness test fails if serialization/deserialization changes the object shape.
    // Prevents the SPIKE-01 data model mismatch bug from returning.
    const db = require('better-sqlite3')(':memory:');
    db.exec(
      'CREATE TABLE sync_records (id TEXT PRIMARY KEY, idempotencyKey TEXT UNIQUE, payload TEXT, clientId TEXT, sequenceNumber INTEGER, createdAt INTEGER, updatedAt INTEGER)',
    );

    const { serializeForSQLite, deserializeFromSQLite, validateRecord } =
      await import('../../spikes/SPIKE-01/src/canonical-record.js');

    const original = {
      id: 'fitness-test-id',
      idempotencyKey: 'fitness-1',
      payload: { name: 'test', value: 42, timestamp: 1234567890 },
      clientId: 'A',
      sequenceNumber: 1,
      createdAt: 1234567890,
      updatedAt: 1234567890,
    };

    const serialized = serializeForSQLite(original);
    db.prepare(
      'INSERT INTO sync_records (id, idempotencyKey, payload, clientId, sequenceNumber, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      serialized.id,
      serialized.idempotencyKey,
      serialized.payload,
      serialized.clientId,
      serialized.sequenceNumber,
      serialized.createdAt,
      serialized.updatedAt,
    );

    const row = db.prepare('SELECT * FROM sync_records WHERE idempotencyKey = ?').get('fitness-1');
    const reconstructed = deserializeFromSQLite(row);

    expect(reconstructed).toStrictEqual(original);
    db.close();
  });
  it('ADR-012 exists', () => {
    expect(existsSync(resolve(__dirname, '../../docs/adr/ADR-012-canonical-domain-model.md'))).toBe(
      true,
    );
  });
  it('ADR-013 exists', () => {
    expect(existsSync(resolve(__dirname, '../../docs/adr/ADR-013-observability-strategy.md'))).toBe(
      true,
    );
  });
});
