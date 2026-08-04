/**
 * Unit tests for prompt-structure-verifier.ts (Rule 42)
 *
 * Tests:
 *  1. FAILS when prompt file is missing required sections (falsification)
 *  2. PASSES when prompt file has all 10 sections
 *  3. PASSES when no implementation prompts exist (Rule 42 not applicable)
 *  4. Ignores non-prompt markdown files
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Related Rule: Rule 42 (Engineer Before You Prompt)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promptStructureVerifier } from '../prompt-structure-verifier.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ALL_10_SECTIONS = [
  '## Problem',
  '## Root Cause',
  '## Evidence',
  '## Constraints',
  '## Architecture',
  '## Implementation',
  '## Verification',
  '## Regression',
  '## Falsification',
  '## Expected Output',
]
  .map((s) => `${s}\n\nContent.\n`)
  .join('\n');

describe('promptStructureVerifier — Rule 42 enforcement', () => {
  let tmpRepo: string;

  beforeAll(() => {
    tmpRepo = mkdtempSync('/tmp/eae-prompt-');
    mkdirSync(join(tmpRepo, 'docs', 'prompts'), { recursive: true });
    execSync('git init -b main', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: tmpRepo, stdio: 'pipe' });
  });

  afterAll(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('FAILS when prompt file is missing required sections (falsification)', async () => {
    // Create a prompt file with only 2 of 10 required sections
    writeFileSync(
      join(tmpRepo, 'docs', 'prompts', 'BAD.PROMPT.md'),
      `# Bad Prompt\n\n## Problem\nSomething is broken.\n\n## Implementation\nJust fix it.\n`,
    );
    execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git commit -m "add bad prompt"', { cwd: tmpRepo, stdio: 'pipe' });

    const result = await promptStructureVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('FAIL');
    expect(result.message).toMatch(/prompt\(s\) fail Rule 42 structure check/);
    expect(JSON.stringify(result.details)).toMatch(/missing sections/);
    // Confirm the 8 missing sections are correctly identified
    expect(JSON.stringify(result.details)).toMatch(/Root Cause/);
    expect(JSON.stringify(result.details)).toMatch(/Evidence/);
    expect(JSON.stringify(result.details)).toMatch(/Constraints/);
    expect(JSON.stringify(result.details)).toMatch(/Architecture/);
    expect(JSON.stringify(result.details)).toMatch(/Verification/);
    expect(JSON.stringify(result.details)).toMatch(/Regression/);
    expect(JSON.stringify(result.details)).toMatch(/Falsification/);
    expect(JSON.stringify(result.details)).toMatch(/Expected Output/);
  });

  it('PASSES when prompt file has all 10 sections', async () => {
    // Reset repo to remove the bad prompt
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(join(tmpRepo, 'docs', 'prompts'), { recursive: true });
    execSync('git init -b main', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: tmpRepo, stdio: 'pipe' });

    writeFileSync(
      join(tmpRepo, 'docs', 'prompts', 'GOOD.PROMPT.md'),
      `# Good Prompt\n\n${ALL_10_SECTIONS}\n`,
    );
    execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git commit -m "add good prompt"', { cwd: tmpRepo, stdio: 'pipe' });

    const result = await promptStructureVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    expect(result.message).toMatch(/all contain 10 mandatory sections/);
  });

  it('PASSES when no implementation prompts exist (Rule 42 not applicable)', async () => {
    const emptyRepo = mkdtempSync('/tmp/eae-prompt-empty-');
    mkdirSync(join(emptyRepo, 'docs'), { recursive: true });
    execSync('git init -b main', { cwd: emptyRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: emptyRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: emptyRepo, stdio: 'pipe' });

    // Add a non-prompt markdown file (should be ignored)
    writeFileSync(join(emptyRepo, 'docs', 'README.md'), '# Project README\n\nNo prompt here.\n');
    execSync('git add .', { cwd: emptyRepo, stdio: 'pipe' });
    execSync('git commit -m "add readme"', { cwd: emptyRepo, stdio: 'pipe' });

    try {
      const result = await promptStructureVerifier.verify({
        repoRoot: emptyRepo,
        evidenceDir: join(emptyRepo, 'evidence'),
      });

      expect(result.status).toBe('PASS');
      expect(result.message).toMatch(/No implementation prompts to validate/);
    } finally {
      rmSync(emptyRepo, { recursive: true, force: true });
    }
  });

  it('Ignores non-prompt markdown files', async () => {
    // Reset repo
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(join(tmpRepo, 'docs'), { recursive: true });
    execSync('git init -b main', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: tmpRepo, stdio: 'pipe' });

    // Add multiple non-prompt markdown files
    writeFileSync(join(tmpRepo, 'docs', 'README.md'), '# README\n');
    writeFileSync(join(tmpRepo, 'docs', 'NOTES.md'), '# Notes\n\nImplemented.\n');
    writeFileSync(join(tmpRepo, 'docs', 'CHANGELOG.md'), '# Changelog\n\n- Done.\n');
    execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git commit -m "add docs"', { cwd: tmpRepo, stdio: 'pipe' });

    const result = await promptStructureVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    // Should PASS because none of these files are implementation prompts
    expect(result.status).toBe('PASS');
    expect(result.message).toMatch(/No implementation prompts to validate/);
  });

  it('Detects prompts by ENGINEERING IMPLEMENTATION DIRECTIVE marker', async () => {
    // Reset repo
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(join(tmpRepo, 'docs'), { recursive: true });
    execSync('git init -b main', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: tmpRepo, stdio: 'pipe' });

    // Create a file with the directive marker but no .PROMPT.md suffix
    writeFileSync(
      join(tmpRepo, 'docs', 'directive.md'),
      `# Some Document\n\nENGINEERING IMPLEMENTATION DIRECTIVE\n\n## Problem\nBroken.\n`,
    );
    execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git commit -m "add directive"', { cwd: tmpRepo, stdio: 'pipe' });

    const result = await promptStructureVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    // Should FAIL because the file is detected as a prompt but only has 1 of 10 sections
    expect(result.status).toBe('FAIL');
    expect(JSON.stringify(result.details)).toMatch(/directive\.md/);
    expect(JSON.stringify(result.details)).toMatch(/missing sections/);
  });
});
