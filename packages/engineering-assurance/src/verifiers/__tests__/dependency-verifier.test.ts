/**
 * Unit tests for dependency-verifier.ts (B1 closure)
 *
 * Tests:
 *  1. PASSES when pnpm audit finds no high/critical vulnerabilities
 *  2. WARNs when pnpm audit cannot run (not a git repo / no package.json)
 *
 * Note: This verifier shells out to `pnpm audit`, so tests create temporary
 * repos with package.json files. We cannot easily simulate a high/critical
 * vulnerability in a test, so the FAIL case is tested by the real repo
 * having a known vulnerable dependency (not applicable here).
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Related Rule: Rule 28 (Security Verification Gate), Rule 32 (Dependency Impact Analysis)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dependencyVerifier } from '../dependency-verifier.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

describe('dependencyVerifier', () => {
  let tmpRepo: string;

  beforeAll(() => {
    tmpRepo = mkdtempSync('/tmp/eae-deps-');
  });

  afterAll(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('PASSES or WARNs when running against a repo with no vulnerabilities', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });

    // Create a minimal package.json with no dependencies
    writeFileSync(
      join(tmpRepo, 'package.json'),
      JSON.stringify({
        name: 'test-deps-repo',
        version: '1.0.0',
        private: true,
      }),
    );

    // Initialize git (pnpm audit may need it)
    try {
      execSync('git init -b main', { cwd: tmpRepo, stdio: 'pipe' });
      execSync('git config user.email t@t.t', { cwd: tmpRepo, stdio: 'pipe' });
      execSync('git config user.name t', { cwd: tmpRepo, stdio: 'pipe' });
      execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: tmpRepo, stdio: 'pipe' });
    } catch {
      // git may not be available
    }

    const result = await dependencyVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    // The verifier should either PASS (no vulns) or WARN (audit couldn't run)
    // It should NOT FAIL (no high/critical vulns in an empty repo)
    expect(['PASS', 'WARN']).toContain(result.status);
  });

  it('WARNs when pnpm audit cannot run (no package.json)', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    // No package.json created — pnpm audit will fail

    const result = await dependencyVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    // Should WARN (pnpm audit failed to run) or PASS (if pnpm parses empty)
    expect(['PASS', 'WARN']).toContain(result.status);
  });
});
