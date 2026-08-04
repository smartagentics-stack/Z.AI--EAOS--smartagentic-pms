/**
 * Unit tests for adr-verifier.ts (B1 closure)
 *
 * Tests:
 *  1. PASSES when ADRs are properly numbered with Status and Decision sections
 *  2. FAILS when docs/adr directory is missing (falsification)
 *  3. FAILS when an ADR file is missing the Decision section
 *  4. WARNs when an ADR is missing the Context section (recommended)
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Related Rule: Rule 29 (Architecture Drift Detection — ADR compliance)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adrVerifier } from '../adr-verifier.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function createAdrDir(repoDir: string): void {
  const adrDir = join(repoDir, 'docs', 'adr');
  mkdirSync(adrDir, { recursive: true });
}

describe('adrVerifier', () => {
  let tmpRepo: string;

  beforeAll(() => {
    tmpRepo = mkdtempSync('/tmp/eae-adr-');
  });

  afterAll(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('PASSES when ADRs are properly numbered with Status and Decision', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    createAdrDir(tmpRepo);

    writeFileSync(
      join(tmpRepo, 'docs', 'adr', 'ADR-001-test.md'),
      '# ADR-001: Test\n\nStatus: Accepted\n\n## Decision\n\nWe decided X.\n\n## Context\n\nBecause Y.\n',
    );
    writeFileSync(
      join(tmpRepo, 'docs', 'adr', 'ADR-002-test.md'),
      '# ADR-002: Test2\n\nStatus: Accepted\n\n## Decision\n\nWe decided Z.\n\n## Context\n\nBecause W.\n',
    );

    const result = await adrVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    expect(result.message).toMatch(/2 ADRs verified, all compliant/);
  });

  it('FAILS when docs/adr directory is missing (falsification)', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    // No docs/adr directory created

    const result = await adrVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('FAIL');
    expect(result.message).toMatch(/docs\/adr directory does not exist/);
  });

  it('FAILS when an ADR is missing the Decision section', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    createAdrDir(tmpRepo);

    writeFileSync(
      join(tmpRepo, 'docs', 'adr', 'ADR-001-test.md'),
      '# ADR-001: Test\n\nStatus: Accepted\n\nNo decision here.\n',
    );

    const result = await adrVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('FAIL');
    expect(JSON.stringify(result.details)).toMatch(/missing Decision section/);
  });

  it('WARNs when an ADR is missing the Context section (recommended)', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    createAdrDir(tmpRepo);

    writeFileSync(
      join(tmpRepo, 'docs', 'adr', 'ADR-001-test.md'),
      '# ADR-001: Test\n\nStatus: Accepted\n\n## Decision\n\nWe decided X.\n',
    );

    const result = await adrVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('WARN');
    expect(result.message).toMatch(/missing Context section/);
  });
});
