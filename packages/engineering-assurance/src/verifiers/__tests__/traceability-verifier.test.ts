/**
 * Unit tests for traceability-verifier.ts (Rule 39)
 *
 * Tests:
 *  1. PASSES when commit includes full Engineering Traceability Block
 *  2. FAILS when commit lacks required sections (falsification)
 *  3. PASSES when no source-modifying commits exist (since adoption date)
 *  4. Ignores documentation-only commits (no source files changed)
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Related Rule: Rule 39 (Engineering Traceability Block)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { traceabilityVerifier } from '../traceability-verifier.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const FULL_TRACEABILITY_BLOCK = `Add bar module

Task: Add bar module
Files Modified:
- src/bar.ts
Functions Modified:
- bar() — new export
Commit: 0000000
Verification:
  Command: pnpm test
Expected: PASS
`;

const INCOMPLETE_COMMIT_MESSAGE = `Add foo

Implemented. No evidence.`;

describe('traceabilityVerifier — Rule 39 enforcement', () => {
  let tmpRepo: string;

  beforeAll(() => {
    tmpRepo = mkdtempSync('/tmp/eae-trace-');
    mkdirSync(join(tmpRepo, 'src'), { recursive: true });
    execSync('git init -b main', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: tmpRepo, stdio: 'pipe' });
  });

  afterAll(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('FAILS when commit lacks Engineering Traceability Block (falsification)', async () => {
    // Create a source file and commit it WITHOUT a traceability block
    writeFileSync(join(tmpRepo, 'src', 'foo.ts'), 'export const foo = 1;\n');
    execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
    execSync(`git commit -m "${INCOMPLETE_COMMIT_MESSAGE}"`, { cwd: tmpRepo, stdio: 'pipe' });

    const result = await traceabilityVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('FAIL');
    expect(result.message).toMatch(/missing required traceability sections/);
    expect(JSON.stringify(result.details)).toMatch(/missing.*section.*Task/);
  });

  it('PASSES when commit includes full Engineering Traceability Block', async () => {
    // Reset repo to clean state (remove the bad commit)
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(join(tmpRepo, 'src'), { recursive: true });
    execSync('git init -b main', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: tmpRepo, stdio: 'pipe' });

    // Create a source file and commit it WITH a full traceability block
    writeFileSync(join(tmpRepo, 'src', 'bar.ts'), 'export const bar = 2;\n');
    execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git commit -m "Add bar module"', { cwd: tmpRepo, stdio: 'pipe' });
    // Use a file-based commit message to avoid shell escaping issues
    const msgFile = join(tmpRepo, '.git', 'COMMIT_EDITMSG');
    writeFileSync(msgFile, FULL_TRACEABILITY_BLOCK);
    // Amend the last commit with the full message
    execSync(`git commit --amend -F "${msgFile}"`, { cwd: tmpRepo, stdio: 'pipe' });

    const result = await traceabilityVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    expect(result.message).toMatch(/verified.*Engineering Traceability Block/);
  });

  it('PASSES when no source-modifying commits exist since adoption date', async () => {
    // Create a new repo with only documentation commits
    const docRepo = mkdtempSync('/tmp/eae-trace-doc-');
    mkdirSync(join(docRepo, 'docs'), { recursive: true });
    execSync('git init -b main', { cwd: docRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: docRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: docRepo, stdio: 'pipe' });

    writeFileSync(join(docRepo, 'docs', 'README.md'), '# Docs only\n');
    execSync('git add .', { cwd: docRepo, stdio: 'pipe' });
    execSync('git commit -m "docs: add README"', { cwd: docRepo, stdio: 'pipe' });

    try {
      const result = await traceabilityVerifier.verify({
        repoRoot: docRepo,
        evidenceDir: join(docRepo, 'evidence'),
      });

      expect(result.status).toBe('PASS');
      expect(result.message).toMatch(/No source-modifying commits/);
    } finally {
      rmSync(docRepo, { recursive: true, force: true });
    }
  });

  it('Ignores commits that only modify documentation', async () => {
    // Reset main repo
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(join(tmpRepo, 'src'), { recursive: true });
    mkdirSync(join(tmpRepo, 'docs'), { recursive: true });
    execSync('git init -b main', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: tmpRepo, stdio: 'pipe' });

    // First commit: source file WITH traceability block
    writeFileSync(join(tmpRepo, 'src', 'baz.ts'), 'export const baz = 3;\n');
    execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
    const msgFile = join(tmpRepo, '.git', 'COMMIT_EDITMSG');
    writeFileSync(msgFile, FULL_TRACEABILITY_BLOCK);
    execSync(`git commit -F "${msgFile}"`, { cwd: tmpRepo, stdio: 'pipe' });

    // Second commit: documentation only (should be ignored)
    writeFileSync(join(tmpRepo, 'docs', 'NOTES.md'), '# Notes\n\nImplemented.\n');
    execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git commit -m "docs: add notes (no traceability needed)"', {
      cwd: tmpRepo,
      stdio: 'pipe',
    });

    const result = await traceabilityVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    // Should PASS because the docs-only commit is not source-modifying
    expect(result.status).toBe('PASS');
  });
});
