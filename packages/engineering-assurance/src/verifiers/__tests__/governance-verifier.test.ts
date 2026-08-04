/**
 * Unit tests for governance-verifier.ts
 *
 * Tests:
 *  1. PASSES when all required docs (including RULES.md) exist
 *  2. FAILS when RULES.md is missing (falsification — proves the verifier enforces the registry)
 *  3. FAILS when any other required doc is missing
 *
 * These tests also partially close finding B1 from the EAR-EAP-PHASE-A-001
 * review (zero unit tests in engineering-assurance package).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { governanceVerifier } from '../governance-verifier.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

describe('governanceVerifier', () => {
  let tmpRepo: string;

  // Helper: create a temporary repo with all required governance docs
  function createTmpRepoWithAllDocs(): string {
    const tmp = mkdtempSync('/tmp/eae-gov-');
    const docsDir = join(tmp, 'docs', 'governance');
    mkdirSync(docsDir, { recursive: true });

    const requiredDocs = [
      'RULES.md',
      'MASTER-ENGINEERING-ASSURANCE-PROMPT.md',
      'MASTER-EAR-PROMPT-DEFINITIVE.md',
      '18-Senior-Engineering-Operating-Rules.md',
      '19-Evidence-First-Debugging-Methodology.md',
      '20-Engineering-Verification-Evidence-Policy.md',
      '21-Independent-Audit-Before-Phase-Transition.md',
      '22-Independent-Engineering-Acceptance-Policy.md',
      '24-Engineering-Assurance-Framework-v2.md',
      '25-Rule-36-Governance-Automation.md',
      '26-Rule-38-Executable-Evidence.md',
    ];

    for (const doc of requiredDocs) {
      writeFileSync(join(docsDir, doc), `# ${doc}\n\nPlaceholder content.\n`);
    }

    // Initialize as git repo (some verifiers use git, though governance-verifier doesn't)
    try {
      execSync('git init -b main', { cwd: tmp, stdio: 'pipe' });
      execSync('git config user.email t@t.t', { cwd: tmp, stdio: 'pipe' });
      execSync('git config user.name t', { cwd: tmp, stdio: 'pipe' });
    } catch {
      // git not available — governance-verifier doesn't need it
    }

    return tmp;
  }

  beforeAll(() => {
    tmpRepo = createTmpRepoWithAllDocs();
  });

  afterAll(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('PASSES when all required docs including RULES.md exist', async () => {
    const result = await governanceVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    expect(result.message).toMatch(/All 11 governance documents present/);
    expect(result.evidence).toContain('✅ docs/governance/RULES.md');
  });

  it('FAILS when RULES.md is missing (falsification — proves registry enforcement)', async () => {
    const rulesPath = join(tmpRepo, 'docs', 'governance', 'RULES.md');
    const backupPath = `${rulesPath}.bak`;

    // Remove RULES.md
    renameSync(rulesPath, backupPath);

    try {
      const result = await governanceVerifier.verify({
        repoRoot: tmpRepo,
        evidenceDir: join(tmpRepo, 'evidence'),
      });

      expect(result.status).toBe('FAIL');
      expect(result.message).toMatch(/governance document\(s\) missing/);
      expect(result.evidence).toContain('❌ docs/governance/RULES.md');
      expect(JSON.stringify(result.details)).toMatch(/Missing: docs\/governance\/RULES\.md/);
    } finally {
      // Restore RULES.md
      renameSync(backupPath, rulesPath);
    }
  });

  it('FAILS when any other required doc is missing', async () => {
    const targetPath = join(
      tmpRepo,
      'docs',
      'governance',
      '20-Engineering-Verification-Evidence-Policy.md',
    );
    const backupPath = `${targetPath}.bak`;

    renameSync(targetPath, backupPath);

    try {
      const result = await governanceVerifier.verify({
        repoRoot: tmpRepo,
        evidenceDir: join(tmpRepo, 'evidence'),
      });

      expect(result.status).toBe('FAIL');
      expect(result.message).toMatch(/governance document\(s\) missing/);
    } finally {
      renameSync(backupPath, targetPath);
    }
  });

  it('PASSES again after restoring all docs (confirms test isolation)', async () => {
    const result = await governanceVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
  });
});
