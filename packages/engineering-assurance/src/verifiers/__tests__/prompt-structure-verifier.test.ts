/**
 * Unit tests for prompt-structure-verifier.ts (Rule 42)
 *
 * Tests:
 *  1. FAILS when prompt file is missing required sections (falsification)
 *  2. PASSES when prompt file has all 15 sections
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
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

const ALL_15_SECTIONS = [
  '## Problem Definition',
  '## Root Cause Analysis',
  '## Constraints',
  '## Architecture Impact',
  '## Files to Modify',
  '## Functions to Modify',
  '## Production Code',
  '## Unit Tests',
  '## Integration Tests',
  '## Verification Commands',
  '## Expected Output',
  '## Failure Output',
  '## Rollback Procedure',
  '## Engineering Traceability Block',
  '## Evidence Required Before Completion',
]
  .map((s) => `${s}\n\nContent.\n`)
  .join('\n');

describe('promptStructureVerifier — Rule 42 enforcement', () => {
  let tmpRepo: string;

  beforeAll(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), 'eae-prompt-'));
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
    // Confirm the 13 missing sections are correctly identified (prompt only has Problem + Implementation)
    expect(JSON.stringify(result.details)).toMatch(/Root Cause Analysis/);
    expect(JSON.stringify(result.details)).toMatch(/Constraints/);
    expect(JSON.stringify(result.details)).toMatch(/Architecture Impact/);
    expect(JSON.stringify(result.details)).toMatch(/Files to Modify/);
    expect(JSON.stringify(result.details)).toMatch(/Functions to Modify/);
    expect(JSON.stringify(result.details)).toMatch(/Unit Tests/);
    expect(JSON.stringify(result.details)).toMatch(/Verification Commands/);
    expect(JSON.stringify(result.details)).toMatch(/Expected Output/);
    expect(JSON.stringify(result.details)).toMatch(/Failure Output/);
    expect(JSON.stringify(result.details)).toMatch(/Rollback Procedure/);
    expect(JSON.stringify(result.details)).toMatch(/Engineering Traceability Block/);
    expect(JSON.stringify(result.details)).toMatch(/Evidence Required Before Completion/);
  });

  it('PASSES when prompt file has all 15 sections', async () => {
    // Reset repo to remove the bad prompt
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(join(tmpRepo, 'docs', 'prompts'), { recursive: true });
    execSync('git init -b main', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: tmpRepo, stdio: 'pipe' });

    writeFileSync(
      join(tmpRepo, 'docs', 'prompts', 'GOOD.PROMPT.md'),
      `# Good Prompt\n\n${ALL_15_SECTIONS}\n`,
    );
    execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git commit -m "add good prompt"', { cwd: tmpRepo, stdio: 'pipe' });

    const result = await promptStructureVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    expect(result.message).toMatch(/all contain 15 mandatory sections/);
  });

  it('PASSES when no implementation prompts exist (Rule 42 not applicable)', async () => {
    const emptyRepo = mkdtempSync(join(tmpdir(), 'eae-prompt-empty-'));
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

    // Should FAIL because the file is detected as a prompt but only has 1 of 15 sections
    expect(result.status).toBe('FAIL');
    expect(JSON.stringify(result.details)).toMatch(/directive\.md/);
    expect(JSON.stringify(result.details)).toMatch(/missing sections/);
  });

  it('Ignores governance docs even if filename contains PROMPT', async () => {
    // Reset repo
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'docs', 'governance'), { recursive: true });
    execSync('git init -b main', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.email t@t.t', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: tmpRepo, stdio: 'pipe' });

    // Create a governance doc with PROMPT in the filename (should be ignored)
    writeFileSync(
      join(tmpRepo, 'docs', 'governance', 'MASTER-EAR-PROMPT-DEFINITIVE.md'),
      `# Master EAR Prompt\n\nThis is a governance document, not an implementation prompt.\n`,
    );
    execSync('git add .', { cwd: tmpRepo, stdio: 'pipe' });
    execSync('git commit -m "add governance doc"', { cwd: tmpRepo, stdio: 'pipe' });

    const result = await promptStructureVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    // Should PASS because governance docs are excluded from prompt detection
    expect(result.status).toBe('PASS');
    expect(result.message).toMatch(/No implementation prompts to validate/);
  });
});
