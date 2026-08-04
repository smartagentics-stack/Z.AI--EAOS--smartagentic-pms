/**
 * Verifier: Forbidden Code Detection (Rule 40 enhanced)
 *
 * Phase 1: scan source files for:
 *   - TODO/FIXME/HACK/XXX (WARN)
 *   - console.log/debug (WARN)
 *   - placeholder/empty export (WARN)
 *   - eval() (FAIL — security, closes B3)
 *   - direct child_process outside verifier/report layer (FAIL — security, closes B3)
 *
 * Phase 2: scan git commit messages (last 20) for:
 *   - Rule 40 bare claims ("Done.", "Implemented.", etc.) without evidence block
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Verification Method: pnpm verify:security
 * Responsible Verifier: this file
 * Regression Test: __tests__/forbidden-code-verifier.test.ts
 * Falsification Criteria:
 *   - source containing eval() causes FAIL
 *   - source importing child_process outside exempt paths causes FAIL
 *   - commit message with bare "Implemented." without evidence block causes WARN
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join, extname, relative } from 'node:path';
import { execSync } from 'node:child_process';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

interface ForbiddenRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly message: string;
  readonly severity: 'FAIL' | 'WARN';
  readonly exemptGlobs?: string[];
}

const FORBIDDEN_RULES: ForbiddenRule[] = [
  {
    id: 'todo',
    pattern: /\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b/,
    message: 'TODO/FIXME found',
    severity: 'WARN',
  },
  {
    id: 'console-log',
    pattern: /console\.(log|debug)\(/,
    message: 'console.log/debug in production code',
    severity: 'WARN',
  },
  {
    id: 'placeholder',
    pattern: /placeholder|export\s*\{\s*\};/,
    message: 'Placeholder/empty export found',
    severity: 'WARN',
  },
  {
    id: 'eval',
    pattern: /\beval\s*\(/,
    message: 'eval() usage forbidden — security risk',
    severity: 'FAIL',
    // The verifier and its tests legitimately reference eval() in detection patterns
    exemptGlobs: [
      'packages/engineering-assurance/src/verifiers/forbidden-code-verifier.ts',
      'packages/engineering-assurance/src/verifiers/__tests__/forbidden-code-verifier.test.ts',
    ],
  },
  {
    id: 'child-process',
    pattern: /require\s*\(\s*['"]child_process['"]\)|from\s+['"]node:child_process['"]/,
    message: 'Direct child_process import — only allowed in verifier/report layer',
    severity: 'FAIL',
    exemptGlobs: [
      'packages/engineering-assurance/src/verifiers/',
      'packages/engineering-assurance/src/reports/',
    ],
  },
];

// Rule 40: bare implementation claims without nearby evidence block.
// Note: no trailing \b because the period is followed by whitespace/EOF, not a word char.
const BARE_CLAIM_PATTERN = /\b(Done|Completed|Implemented|Fixed|Resolved|Finished)\./;
const EVIDENCE_BLOCK_PATTERN =
  /(Files Modified|Verification:|Expected:|Commit:|Git diff|Engineering Traceability)/;

const SCAN_DIRS = ['packages', 'apps'];
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const EXCLUDE_DIRS = ['node_modules', 'dist', '.next', 'coverage', '.turbo'];

function scanDirectory(dir: string, repoRoot: string): { file: string; content: string }[] {
  const results: { file: string; content: string }[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.includes(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...scanDirectory(fullPath, repoRoot));
    } else if (SCAN_EXTENSIONS.includes(extname(fullPath))) {
      results.push({
        file: relative(repoRoot, fullPath),
        content: readFileSync(fullPath, 'utf-8'),
      });
    }
  }
  return results;
}

function scanGitCommits(repoRoot: string, count = 20): { commit: string; message: string }[] {
  try {
    const log = execSync(`git log --no-merges -${count} --format="COMMIT:%H%n%B---END---"`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    return log
      .split(/^---END---$/m)
      .map((block) => block.trim())
      .filter((block) => block.length > 0)
      .map((block) => {
        const m = block.match(/^COMMIT:([0-9a-f]{40})\n([\s\S]*)/);
        return m
          ? { commit: m[1].substring(0, 7), message: m[2] }
          : { commit: '?', message: block };
      });
  } catch {
    return [];
  }
}

function isExempt(file: string, exemptGlobs?: string[]): boolean {
  if (!exemptGlobs || exemptGlobs.length === 0) return false;
  return exemptGlobs.some((g) => file.startsWith(g));
}

export const forbiddenCodeVerifier: Verifier = {
  name: 'forbidden-code',
  description:
    'Scans source + commits for forbidden code, eval, child_process, and Rule 40 bare claims',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const violations: string[] = [];
    const warnings: string[] = [];
    const evidence: string[] = [];
    let filesScanned = 0;

    // Phase 1: source file scan
    for (const dir of SCAN_DIRS) {
      const fullPath = resolve(ctx.repoRoot, dir);
      const files = scanDirectory(fullPath, ctx.repoRoot);
      for (const { file, content } of files) {
        filesScanned++;
        const lines = content.split('\n');

        for (const rule of FORBIDDEN_RULES) {
          if (isExempt(file, rule.exemptGlobs)) continue;
          for (let i = 0; i < lines.length; i++) {
            if (rule.pattern.test(lines[i])) {
              const finding = `${file}:${i + 1} — ${rule.message} [${rule.id}]`;
              if (rule.severity === 'FAIL') {
                violations.push(finding);
              } else {
                warnings.push(finding);
              }
            }
          }
        }

        // Rule 40: bare claim without nearby evidence block (within 5 lines)
        for (let i = 0; i < lines.length; i++) {
          if (BARE_CLAIM_PATTERN.test(lines[i])) {
            const context = lines
              .slice(Math.max(0, i - 2), Math.min(lines.length, i + 8))
              .join('\n');
            if (!EVIDENCE_BLOCK_PATTERN.test(context)) {
              warnings.push(
                `${file}:${i + 1} — Rule 40: bare implementation claim without evidence block`,
              );
            }
          }
        }
      }
    }

    // Phase 2: git commit message scan (Rule 40)
    const commits = scanGitCommits(ctx.repoRoot);
    let commitsScanned = 0;
    for (const { commit, message } of commits) {
      commitsScanned++;
      if (BARE_CLAIM_PATTERN.test(message) && !EVIDENCE_BLOCK_PATTERN.test(message)) {
        warnings.push(
          `commit ${commit}: Rule 40 — bare implementation claim without evidence block`,
        );
      }
    }

    evidence.push(`Files scanned: ${filesScanned}`);
    evidence.push(`Commits scanned: ${commitsScanned}`);
    evidence.push(`Warnings: ${warnings.length}`);
    evidence.push(`Violations: ${violations.length}`);

    if (violations.length > 0) {
      return {
        name: this.name,
        status: 'FAIL',
        message: `${violations.length} forbidden code violation(s) — see details`,
        details: { violations, warnings },
        evidence,
      };
    }

    if (warnings.length > 0) {
      return {
        name: this.name,
        status: 'WARN',
        message: `${warnings.length} warning(s) (TODOs, console.log, placeholders, Rule 40 bare claims)`,
        details: { warnings },
        evidence,
      };
    }

    return {
      name: this.name,
      status: 'PASS',
      message: `No forbidden code patterns found (${filesScanned} files, ${commitsScanned} commits scanned)`,
      evidence,
    };
  },
};
