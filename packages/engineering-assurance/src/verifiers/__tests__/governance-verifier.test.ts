/**
 * Unit tests for governance-verifier.ts (Rule 43 enhanced)
 *
 * Tests:
 *  1. PASSES when all required docs exist AND rule docs declare Enforcement Type
 *  2. FAILS when RULES.md is missing (falsification — proves registry enforcement)
 *  3. FAILS when any other required doc is missing
 *  4. PASSES again after restoring all docs (confirms test isolation)
 *  5. FAILS when a rule doc lacks Enforcement Type declaration (Rule 43 falsification)
 *  6. PASSES when rule doc has Enforcement Type with markdown bold (**Enforcement Type:**)
 *
 * These tests also partially close finding B1 from the EAR-EAP-PHASE-A-001
 * review (zero unit tests in engineering-assurance package).
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Related Rule: Rule 43 (Every Rule Must Be Classified)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { governanceVerifier } from '../governance-verifier.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, renameSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// Rule docs that must declare Enforcement Type per Rule 43
// Matches the RULE_DOC_PATTERN in governance-verifier.ts
const RULE_DOCS_WITH_CLASSIFICATION = [
  '18-Senior-Engineering-Operating-Rules.md',
  '21-Independent-Audit-Before-Phase-Transition.md',
  '22-Independent-Engineering-Acceptance-Policy.md',
  '24-Engineering-Assurance-Framework-v2.md',
  '25-Rule-36-Governance-Automation.md',
  '26-Rule-38-Executable-Evidence.md',
];

const REQUIRED_DOCS = [
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

describe('governanceVerifier — Rule 43 enforcement', () => {
  let tmpRepo: string;

  // Helper: create a temporary repo with all required governance docs,
  // including Enforcement Type declarations on rule docs.
  function createTmpRepoWithAllDocs(): string {
    const tmp = mkdtempSync(join(tmpdir(), 'eae-gov-'));
    const docsDir = join(tmp, 'docs', 'governance');
    mkdirSync(docsDir, { recursive: true });

    for (const doc of REQUIRED_DOCS) {
      // Rule docs must include Enforcement Type declaration (Rule 43)
      const isRuleDoc = RULE_DOCS_WITH_CLASSIFICATION.includes(doc);
      const content = isRuleDoc
        ? `# ${doc}\n\nEnforcement Type: Machine-Enforceable\n\nRule body.\n`
        : `# ${doc}\n\nPlaceholder content.\n`;
      writeFileSync(join(docsDir, doc), content);
    }

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

  it('PASSES when all required docs exist and rule docs declare Enforcement Type', async () => {
    const result = await governanceVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    expect(result.message).toMatch(/All 11 governance documents present/);
    expect(result.message).toMatch(/Rule 43 compliant/);
    expect(result.evidence).toContain('✅ docs/governance/RULES.md');
  });

  it('FAILS when RULES.md is missing (falsification — proves registry enforcement)', async () => {
    const rulesPath = join(tmpRepo, 'docs', 'governance', 'RULES.md');
    const backupPath = `${rulesPath}.bak`;

    renameSync(rulesPath, backupPath);

    try {
      const result = await governanceVerifier.verify({
        repoRoot: tmpRepo,
        evidenceDir: join(tmpRepo, 'evidence'),
      });

      expect(result.status).toBe('FAIL');
      expect(result.message).toMatch(/governance issue\(s\)/);
      expect(result.evidence).toContain('❌ docs/governance/RULES.md');
      expect(JSON.stringify(result.details)).toMatch(/Missing: docs\/governance\/RULES\.md/);
    } finally {
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
      expect(result.message).toMatch(/governance issue\(s\)/);
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

  it('FAILS when a rule doc lacks Enforcement Type declaration (Rule 43 falsification)', async () => {
    // Pick a rule doc and strip its Enforcement Type declaration
    const targetPath = join(tmpRepo, 'docs', 'governance', '25-Rule-36-Governance-Automation.md');
    const original = readFileSync(targetPath, 'utf-8');
    // Replace with content that lacks Enforcement Type
    writeFileSync(
      targetPath,
      `# Rule 36 — Governance Automation\n\nNo enforcement type declared.\n`,
    );

    try {
      const result = await governanceVerifier.verify({
        repoRoot: tmpRepo,
        evidenceDir: join(tmpRepo, 'evidence'),
      });

      expect(result.status).toBe('FAIL');
      expect(JSON.stringify(result.details)).toMatch(/Rule 43 violation/);
      expect(JSON.stringify(result.details)).toMatch(
        /25-Rule-36-Governance-Automation\.md.*missing 'Enforcement Type:'/,
      );
    } finally {
      writeFileSync(targetPath, original);
    }
  });

  it('PASSES when rule doc uses markdown bold (**Enforcement Type:**)', async () => {
    // Some docs use **Enforcement Type:** (markdown bold) — verifier should still detect it
    const targetPath = join(tmpRepo, 'docs', 'governance', '26-Rule-38-Executable-Evidence.md');
    const original = readFileSync(targetPath, 'utf-8');
    writeFileSync(
      targetPath,
      `# Rule 38 — Executable Evidence\n\n**Enforcement Type:** Machine-Enforceable\n\nRule body.\n`,
    );

    try {
      const result = await governanceVerifier.verify({
        repoRoot: tmpRepo,
        evidenceDir: join(tmpRepo, 'evidence'),
      });

      expect(result.status).toBe('PASS');
      expect(JSON.stringify(result.evidence)).toMatch(/26-Rule-38.*Machine-Enforceable/);
    } finally {
      writeFileSync(targetPath, original);
    }
  });
});
