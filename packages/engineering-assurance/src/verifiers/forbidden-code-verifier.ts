/**
 * Verifier: Forbidden Code Detection
 *
 * Scans for TODOs, console.log in production code, placeholder code, and debug statements.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join, extname, relative } from 'node:path';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

interface ForbiddenRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly message: string;
  readonly severity: 'FAIL' | 'WARN';
}

const FORBIDDEN_RULES: ForbiddenRule[] = [
  { id: 'todo', pattern: /\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b/, message: 'TODO/FIXME found', severity: 'WARN' },
  { id: 'console-log', pattern: /console\.(log|debug)\(/, message: 'console.log/debug in production code', severity: 'WARN' },
  { id: 'placeholder', pattern: /placeholder|export\s*\{\s*\};/, message: 'Placeholder/empty export found', severity: 'WARN' },
];

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
      results.push({ file: relative(repoRoot, fullPath), content: readFileSync(fullPath, 'utf-8') });
    }
  }
  return results;
}

export const forbiddenCodeVerifier: Verifier = {
  name: 'forbidden-code',
  description: 'Scans for TODOs, console.log, placeholders, and debug statements',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const violations: string[] = [];
    const warnings: string[] = [];
    const evidence: string[] = [];
    let filesScanned = 0;

    for (const dir of SCAN_DIRS) {
      const fullPath = resolve(ctx.repoRoot, dir);
      const files = scanDirectory(fullPath, ctx.repoRoot);
      for (const { file, content } of files) {
        filesScanned++;
        for (const rule of FORBIDDEN_RULES) {
          if (rule.pattern.test(content)) {
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (rule.pattern.test(lines[i])) {
                const finding = `${file}:${i + 1} — ${rule.message}`;
                if (rule.severity === 'FAIL') {
                  violations.push(finding);
                } else {
                  warnings.push(finding);
                }
              }
            }
          }
        }
      }
    }

    evidence.push(`Files scanned: ${filesScanned}`);
    evidence.push(`Warnings: ${warnings.length}`);
    evidence.push(`Violations: ${violations.length}`);

    if (violations.length > 0) {
      return {
        name: this.name,
        status: 'FAIL',
        message: `${violations.length} forbidden code violation(s) found`,
        details: { violations, warnings },
        evidence,
      };
    }

    if (warnings.length > 0) {
      return {
        name: this.name,
        status: 'WARN',
        message: `${warnings.length} warning(s) (TODOs, console.log, placeholders)`,
        details: { warnings },
        evidence,
      };
    }

    return {
      name: this.name,
      status: 'PASS',
      message: `No forbidden code patterns found (${filesScanned} files scanned)`,
      evidence,
    };
  },
};
