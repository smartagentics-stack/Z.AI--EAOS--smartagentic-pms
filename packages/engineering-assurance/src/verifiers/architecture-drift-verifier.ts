/**
 * Verifier: Architecture Drift (B2 fixed)
 *
 * Checks that no code violates ADRs by scanning for forbidden patterns.
 *
 * B2 FIX: The original findFiles() function resolved glob patterns like
 * 'packages/sdk/src/\u002A\u002A/\u002A.ts' to a literal directory
 * 'packages/sdk/src/\u002A\u002A' which does not exist, causing 0 files
 * to be scanned and a false PASS. This version properly parses globs to
 * find the base directory and recursively scans it, filtering files by
 * extension.
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Verification Method: pnpm verify:architecture
 * Responsible Verifier: this file
 * Regression Test: __tests__/architecture-drift-verifier.test.ts
 * Falsification Criteria:
 *   - a source file matching a drift rule's glob containing the forbidden
 *     pattern causes FAIL
 *   - a drift rule scanning 0 files when matching files exist proves the
 *     glob bug is present
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

interface DriftRule {
  readonly id: string;
  readonly description: string;
  readonly adr: string;
  readonly pattern: RegExp;
  readonly glob: string[];
}

// Rules derived from ADRs
const DRIFT_RULES: DriftRule[] = [
  {
    id: 'ADR-009-no-nextjs-in-sdk',
    description: 'SDK must not import Next.js (ADR-009: framework-agnostic)',
    adr: 'ADR-009',
    pattern: /from\s+['"]next\/|from\s+['"]@next\//,
    glob: ['packages/sdk/src/**/*.ts'],
  },
  {
    id: 'ADR-012-no-flat-sqlite-columns',
    description: 'SQLite must not use flat columns for payload (ADR-012: canonical model)',
    adr: 'ADR-012',
    pattern: /CREATE TABLE.*\bname\b.*\bvalue\b.*\btimestamp\b(?!.*payload)/i,
    glob: ['spikes/SPIKE-01/src/**/*.ts'],
  },
  {
    id: 'ADR-006-no-postgres-in-spike',
    description: 'Spikes must use SQLite, not PostgreSQL (ADR-006)',
    adr: 'ADR-006',
    pattern: /postgres|pg\.connect|new Pool\(/i,
    glob: ['spikes/SPIKE-01/src/**/*.ts'],
  },
];

const EXCLUDE_DIRS = ['node_modules', 'dist', '.next', 'coverage', '.turbo', '.git'];

/**
 * Parse a glob pattern into a base directory and a file extension.
 *
 * Examples:
 *   'packages/sdk/src/\u002A\u002A/\u002A.ts' → baseDir='packages/sdk/src', fileExt='.ts'
 *   'spikes/SPIKE-01/src/\u002A\u002A/\u002A.ts' → baseDir='spikes/SPIKE-01/src', fileExt='.ts'
 */
function parseGlob(glob: string): { baseDir: string; fileExt: string } {
  const parts = glob.split('/');
  const starStarIdx = parts.indexOf('**');

  if (starStarIdx !== -1) {
    // Glob has ** — base dir is everything before **
    const baseDir = parts.slice(0, starStarIdx).join('/');
    // File extension is in the last segment (e.g., '*.ts' → '.ts')
    const lastPart = parts[parts.length - 1];
    const extMatch = lastPart.match(/\.(.+)$/);
    return { baseDir, fileExt: extMatch ? '.' + extMatch[1] : '' };
  }

  // No ** — base dir is everything except the last segment
  const baseDir = parts.slice(0, -1).join('/');
  const lastPart = parts[parts.length - 1];
  const extMatch = lastPart.match(/\.(.+)$/);
  return { baseDir, fileExt: extMatch ? '.' + extMatch[1] : '' };
}

/**
 * Recursively scan a directory and return all files matching the extension.
 * Returns relative paths (relative to repoRoot) for consistent reporting.
 */
function scanDirRecursive(dir: string, fileExt: string, repoRoot: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.includes(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...scanDirRecursive(fullPath, fileExt, repoRoot));
    } else if (entry.endsWith(fileExt)) {
      results.push(relative(repoRoot, fullPath));
    }
  }
  return results;
}

/**
 * Find all files matching a glob pattern, relative to repoRoot.
 */
function findFilesForGlob(repoRoot: string, glob: string): string[] {
  const { baseDir, fileExt } = parseGlob(glob);
  const fullBaseDir = resolve(repoRoot, baseDir);
  return scanDirRecursive(fullBaseDir, fileExt, repoRoot);
}

export const architectureDriftVerifier: Verifier = {
  name: 'architecture-drift',
  description: 'Scans code for ADR violations (forbidden patterns)',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const violations: string[] = [];
    const evidence: string[] = [];

    for (const rule of DRIFT_RULES) {
      let checkedFiles = 0;
      let foundViolations = 0;

      for (const glob of rule.glob) {
        const files = findFilesForGlob(ctx.repoRoot, glob);

        for (const file of files) {
          checkedFiles++;
          const fullPath = resolve(ctx.repoRoot, file);
          const content = readFileSync(fullPath, 'utf-8');
          if (rule.pattern.test(content)) {
            foundViolations++;
            violations.push(`${rule.id}: ${file} violates ${rule.adr} — ${rule.description}`);
          }
        }
      }

      evidence.push(`${rule.id}: checked ${checkedFiles} files, ${foundViolations} violation(s)`);
    }

    if (violations.length > 0) {
      return {
        name: this.name,
        status: 'FAIL',
        message: `${violations.length} architecture drift violation(s) found`,
        details: { violations },
        evidence,
      };
    }

    return {
      name: this.name,
      status: 'PASS',
      message: `No architecture drift detected (${DRIFT_RULES.length} rules checked)`,
      evidence,
    };
  },
};
