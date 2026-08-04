/**
 * Unit tests for forbidden-code-verifier.ts (Rule 40 + B3 closure)
 *
 * Tests:
 *  1. FAILS when source contains eval() (B3 closure — security)
 *  2. FAILS when source imports child_process outside verifier layer (B3 closure)
 *  3. PASSES when child_process is used inside exempt verifier layer
 *  4. WARNs when commit message contains bare "Implemented." without evidence (Rule 40)
 *  5. PASSES when bare claim is accompanied by evidence block (Rule 40 forgiveness)
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Related Rule: Rule 40 (No Unsupported Engineering Claims), Rule 28 (Security Verification Gate)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { forbiddenCodeVerifier } from '../forbidden-code-verifier.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

function setupRepo(repoDir: string): void {
  execSync('git init -b main', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email t@t.t', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name t', { cwd: repoDir, stdio: 'pipe' });
}

function commit(repoDir: string, message: string): void {
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  // Write message to file to avoid shell escaping issues
  const msgFile = join(repoDir, '.git', 'COMMIT_MSG');
  writeFileSync(msgFile, message);
  execSync(`git commit -F "${msgFile}"`, { cwd: repoDir, stdio: 'pipe' });
}

describe('forbiddenCodeVerifier — B3 closure + Rule 40 enforcement', () => {
  let tmpRepo: string;

  beforeAll(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), 'eae-forbid-'));
  });

  afterAll(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('FAILS when source contains eval() (B3 closure — security)', async () => {
    // Reset repo
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'app', 'src'), { recursive: true });
    setupRepo(tmpRepo);

    writeFileSync(
      join(tmpRepo, 'packages', 'app', 'src', 'evil.ts'),
      'export function run(code: string) { return eval(code); }\n',
    );
    commit(tmpRepo, 'add evil');

    const result = await forbiddenCodeVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('FAIL');
    expect(JSON.stringify(result.details)).toMatch(/eval\(\) usage forbidden/);
    expect(JSON.stringify(result.details)).toMatch(/\[eval\]/);
  });

  it('FAILS when source imports child_process outside verifier layer (B3 closure)', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'app', 'src'), { recursive: true });
    setupRepo(tmpRepo);

    writeFileSync(
      join(tmpRepo, 'packages', 'app', 'src', 'runner.ts'),
      `import { execSync } from 'node:child_process';\nexport function run() { return execSync('ls'); }\n`,
    );
    commit(tmpRepo, 'add runner');

    const result = await forbiddenCodeVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('FAIL');
    expect(JSON.stringify(result.details)).toMatch(/child_process/);
    expect(JSON.stringify(result.details)).toMatch(/\[child-process\]/);
  });

  it('PASSes child_process when used inside exempt verifier layer', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'engineering-assurance', 'src', 'verifiers'), {
      recursive: true,
    });
    setupRepo(tmpRepo);

    // child_process is legitimately used by verifiers — should be exempt
    writeFileSync(
      join(tmpRepo, 'packages', 'engineering-assurance', 'src', 'verifiers', 'safe.ts'),
      `import { execSync } from 'node:child_process';\nexport function check() { return execSync('git log'); }\n`,
    );
    commit(tmpRepo, 'add safe verifier');

    const result = await forbiddenCodeVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    // Should NOT fail on child_process (exempt). May WARN on other patterns if present.
    const detailsStr = JSON.stringify(result.details ?? {});
    expect(detailsStr).not.toMatch(/child_process/);
    expect(result.status).not.toBe('FAIL');
  });

  it('WARNs when commit message contains bare "Implemented." without evidence (Rule 40)', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'app', 'src'), { recursive: true });
    setupRepo(tmpRepo);

    writeFileSync(join(tmpRepo, 'packages', 'app', 'src', 'clean.ts'), 'export const x = 1;\n');
    commit(tmpRepo, 'Implemented.');

    const result = await forbiddenCodeVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    // Should WARN (not FAIL) because bare claim without evidence
    expect(result.status).toBe('WARN');
    expect(JSON.stringify(result.details)).toMatch(/Rule 40/);
    expect(JSON.stringify(result.details)).toMatch(/bare implementation claim/);
  });

  it('PASSes when bare claim is accompanied by evidence block (Rule 40 forgiveness)', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'app', 'src'), { recursive: true });
    setupRepo(tmpRepo);

    writeFileSync(join(tmpRepo, 'packages', 'app', 'src', 'feature.ts'), 'export const y = 2;\n');
    // Commit message has bare "Implemented." BUT also has evidence block
    commit(
      tmpRepo,
      `Implemented.

Files Modified:
- packages/app/src/feature.ts

Verification:
  Command: pnpm test
Expected: PASS
`,
    );

    const result = await forbiddenCodeVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    // The bare claim is forgiven because evidence block is present.
    // May still WARN/PASS based on other patterns, but should NOT have Rule 40 warning.
    const detailsStr = JSON.stringify(result.details ?? {});
    expect(detailsStr).not.toMatch(/Rule 40/);
  });

  it('PASSes when source has no forbidden patterns and commits have no bare claims', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'packages', 'app', 'src'), { recursive: true });
    setupRepo(tmpRepo);

    writeFileSync(join(tmpRepo, 'packages', 'app', 'src', 'clean.ts'), 'export const z = 3;\n');
    commit(
      tmpRepo,
      `Add clean module

Files Modified:
- packages/app/src/clean.ts

Verification:
  Command: pnpm test
Expected: PASS
`,
    );

    const result = await forbiddenCodeVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
  });
});
