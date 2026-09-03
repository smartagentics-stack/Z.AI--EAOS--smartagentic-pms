/**
 * Unit tests for architecture-drift-verifier.ts (B1 closure + B2 falsification)
 *
 * Tests:
 *  1. PASSES when no ADR violations are found in scanned files
 *  2. FAILS when a source file contains a forbidden pattern (falsification)
 *  3. B2 REGRESSION: verifies that files are actually scanned (not 0)
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Related Rule: Rule 29 (Architecture Drift Detection)
 * Related ADR: ADR-006, ADR-009, ADR-012
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { architectureDriftVerifier } from '../architecture-drift-verifier.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('architectureDriftVerifier — B1 closure + B2 falsification', () => {
  let tmpRepo: string;

  beforeAll(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), 'eae-archdrift-'));
  });

  afterAll(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('PASSES when no ADR violations are found in scanned files', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'sdk', 'src'), { recursive: true });
    mkdirSync(join(tmpRepo, 'spikes', 'SPIKE-01', 'src'), { recursive: true });

    // Clean SDK file (no Next.js import)
    writeFileSync(join(tmpRepo, 'packages', 'sdk', 'src', 'index.ts'), 'export const foo = 1;\n');
    // Clean SPIKE-01 file (no flat SQLite columns, no PostgreSQL)
    writeFileSync(
      join(tmpRepo, 'spikes', 'SPIKE-01', 'src', 'sync.ts'),
      'import Database from "better-sqlite3";\nexport function run() { return; }\n',
    );

    const result = await architectureDriftVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    // B2 regression: confirm files were actually scanned (not 0)
    const evidenceStr = JSON.stringify(result.evidence);
    expect(evidenceStr).toMatch(/checked [1-9]\d* files/); // at least 1 file per rule
  });

  it('FAILS when a source file contains a forbidden pattern (falsification)', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'sdk', 'src'), { recursive: true });

    // SDK file with Next.js import (violates ADR-009)
    writeFileSync(
      join(tmpRepo, 'packages', 'sdk', 'src', 'bad.ts'),
      `import { useRouter } from 'next/router';\nexport const x = 1;\n`,
    );

    const result = await architectureDriftVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('FAIL');
    expect(result.message).toMatch(/architecture drift violation/);
    expect(JSON.stringify(result.details)).toMatch(/ADR-009/);
    expect(JSON.stringify(result.details)).toMatch(/bad\.ts/);
  });

  it('B2 REGRESSION: scans more than 0 files when matching files exist', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'sdk', 'src', 'auth'), { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'sdk', 'src', 'config'), { recursive: true });
    mkdirSync(join(tmpRepo, 'spikes', 'SPIKE-01', 'src'), { recursive: true });

    // Create multiple SDK files in subdirectories
    writeFileSync(join(tmpRepo, 'packages', 'sdk', 'src', 'index.ts'), 'export const _test = 1;\n');
    writeFileSync(
      join(tmpRepo, 'packages', 'sdk', 'src', 'auth', 'index.ts'),
      'export const _test = 1;\n',
    );
    writeFileSync(
      join(tmpRepo, 'packages', 'sdk', 'src', 'config', 'index.ts'),
      'export const _test = 1;\n',
    );
    writeFileSync(
      join(tmpRepo, 'spikes', 'SPIKE-01', 'src', 'sync.ts'),
      'export const _test = 1;\n',
    );

    const result = await architectureDriftVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    // B2 check: must have scanned at least 3 SDK files and 1 SPIKE file
    const evidenceStr = JSON.stringify(result.evidence);
    // ADR-009 scans packages/sdk/src/**/*.ts — should find 3 files
    expect(evidenceStr).toMatch(/ADR-009.*checked [3-9]\d* files/);
    // ADR-012 and ADR-006 scan spikes/SPIKE-01/src/**/*.ts — should find 1 file
    expect(evidenceStr).toMatch(/ADR-012.*checked [1-9]\d* files/);
    expect(evidenceStr).toMatch(/ADR-006.*checked [1-9]\d* files/);
  });
});
