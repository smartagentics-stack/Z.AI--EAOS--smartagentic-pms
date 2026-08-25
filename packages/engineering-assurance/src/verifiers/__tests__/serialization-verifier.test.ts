/**
 * Unit tests for serialization-verifier.ts (TD-008 remediation)
 *
 * Tests:
 *  1. PASSES when actual canonical-record.ts exists and round-trip succeeds
 *  2. FAILS when canonical-record.ts is missing (falsification)
 *  3. FAILS when canonical-record.ts exists but is broken (falsification)
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Related Rule: Rule 5 (Canonical Domain Model), Rule 6 (Mandatory Schema Validation)
 * Related ADR: ADR-012 (Canonical SyncRecord Model)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serializationVerifier } from '../serialization-verifier.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename2 = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const __dirname2 = dirname(__filename2);

// Walk up to find the repo root (where pnpm-workspace.yaml or spikes/ exists)
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(join(dir, 'pnpm-workspace.yaml')) ||
      existsSync(join(dir, 'spikes', 'SPIKE-01', 'src', 'canonical-record.ts'))
    ) {
      return dir;
    }
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

// Path to the REAL repository root (where node_modules with zod exists)
const REAL_REPO_ROOT = findRepoRoot(__dirname2);

describe('serializationVerifier', () => {
  let tmpRepo: string;

  beforeAll(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), 'eae-serial-'));
  });

  afterAll(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('PASSES when actual canonical-record.ts exists and round-trip succeeds', async () => {
    // Use the REAL repo root where canonical-record.ts AND zod are installed
    const result = await serializationVerifier.verify({
      repoRoot: REAL_REPO_ROOT,
      evidenceDir: join(REAL_REPO_ROOT, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    expect(result.message).toMatch(/Canonical model round-trip verified/);
    expect(result.evidence).toContain('Round-trip equality: true');
    expect(result.evidence).toContain('Original payload.name: test');
    expect(result.evidence).toContain('Reconstructed payload.name: test');
    expect(result.evidence).toContain('Validation rejects invalid payload: true');
  });

  it('FAILS when canonical-record.ts is missing (falsification)', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'spikes', 'SPIKE-01', 'src'), { recursive: true });
    // Do NOT create canonical-record.ts

    const result = await serializationVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('FAIL');
    expect(result.message).toMatch(/canonical-record\.ts not found/);
  });

  it('FAILS when canonical-record.ts exists but is broken (falsification)', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'spikes', 'SPIKE-01', 'src'), { recursive: true });

    // Create a broken canonical-record.ts that exports functions but with wrong behavior
    // No external imports — standalone broken functions
    writeFileSync(
      join(tmpRepo, 'spikes', 'SPIKE-01', 'src', 'canonical-record.ts'),
      'export function serializeForSQLite(record: any) { return { ...record, payload: "BROKEN" }; }\n' +
        'export function deserializeFromSQLite(row: any) { return { ...row, payload: "BROKEN" }; }\n' +
        'export function validateRecord(data: any) { return { success: true, data }; }\n',
    );

    const result = await serializationVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('FAIL');
    // Should fail — either import failure or round-trip mismatch
    expect(result.message).toMatch(
      /round-trip failed|object shape changed|Serialization test failed|Failed to import|Failed to load/,
    );
  });
});
