/**
 * Verifier: Architecture Drift
 *
 * Checks that no code violates ADRs by scanning for forbidden patterns.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
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

function findFiles(dir: string, pattern: string[]): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findFiles(fullPath, pattern));
    } else {
      const ext = extname(fullPath);
      if (pattern.some(p => {
        // Simple glob matching
        if (p.endsWith('.ts')) return ext === '.ts';
        if (p.endsWith('.tsx')) return ext === '.tsx';
        return false;
      })) {
        results.push(fullPath);
      }
    }
  }
  return results;
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
        // Resolve glob relative to repo root
        const dir = resolve(ctx.repoRoot, glob.split('/').slice(0, -1).join('/'));
        const files = findFiles(dir, [glob]);

        for (const file of files) {
          checkedFiles++;
          const content = readFileSync(file, 'utf-8');
          if (rule.pattern.test(content)) {
            foundViolations++;
            const relativePath = file.replace(ctx.repoRoot + '/', '');
            violations.push(`${rule.id}: ${relativePath} violates ${rule.adr} — ${rule.description}`);
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
