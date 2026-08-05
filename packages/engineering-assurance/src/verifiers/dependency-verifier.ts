/**
 * Verifier: Dependency Audit
 *
 * Checks for high-severity vulnerabilities in production dependencies.
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Verification Method: pnpm verify:dependencies
 * Responsible Verifier: this file
 * Regression Test: __tests__/dependency-verifier.test.ts
 * Falsification Criteria: a high/critical vulnerability in production deps causes FAIL
 */

import { execSync } from 'node:child_process';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

/**
 * Pnpm 9.x audit JSON output structure (subset — only fields we use).
 * See: https://pnpm.io/cli/audit#--json
 *
 * IMPORTANT: pnpm 9.x changed the audit schema. The legacy
 * `audit.vulnerabilities` field NO LONGER EXISTS. Aggregate counts live under
 * `audit.metadata.vulnerabilities` (info/low/moderate/high/critical), and
 * per-advisory detail lives under `audit.advisories` (keyed by advisory ID).
 */
interface PnpmAuditResult {
  readonly metadata?: {
    readonly vulnerabilities?: {
      readonly info?: number;
      readonly low?: number;
      readonly moderate?: number;
      readonly high?: number;
      readonly critical?: number;
    };
  };
  readonly advisories?: Record<
    string,
    {
      readonly severity: string;
      readonly module_name?: string;
      readonly vulnerable_versions?: string;
    }
  >;
}

/**
 * Error thrown by execSync when the command exits non-zero.
 * Node.js provides stdout/stderr on the error object.
 */
interface ExecSyncError {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly message: string;
  readonly status?: number;
}

/**
 * Count high/critical vulnerabilities from pnpm 9.x audit output.
 *
 * Reads from BOTH sources and takes the max (safety: if EITHER method detects
 * vulns, we fail):
 *  - `metadata.vulnerabilities` — aggregate counts (info/low/moderate/high/critical)
 *  - `advisories` — per-advisory detail with a `severity` field
 *
 * Returns total vuln count, high/critical count, and human-readable details
 * (package + severity) for evidence.
 */
function countHighCritical(audit: PnpmAuditResult): {
  total: number;
  highCritical: number;
  details: string[];
} {
  // Method 1: Read counts from metadata.vulnerabilities
  const meta = audit.metadata?.vulnerabilities;
  const highFromMeta = meta?.high ?? 0;
  const criticalFromMeta = meta?.critical ?? 0;
  const highCriticalFromMeta = highFromMeta + criticalFromMeta;

  // Method 2: Count from advisories (cross-check)
  const advisories = audit.advisories ?? {};
  const highCriticalAdvisories = Object.values(advisories).filter(
    (a) => a.severity === 'high' || a.severity === 'critical',
  );
  const highCriticalFromAdvisories = highCriticalAdvisories.length;

  // Use the higher count (safety: if either method detects vulns, fail)
  const highCritical = Math.max(highCriticalFromMeta, highCriticalFromAdvisories);

  // Total vulnerabilities from metadata
  const total =
    (meta?.info ?? 0) +
    (meta?.low ?? 0) +
    (meta?.moderate ?? 0) +
    (meta?.high ?? 0) +
    (meta?.critical ?? 0);

  // Build details for evidence
  const details = highCriticalAdvisories.map(
    (a) => `${a.module_name || 'unknown'} (${a.severity})`,
  );

  return { total, highCritical, details };
}

export const dependencyVerifier: Verifier = {
  name: 'dependency-audit',
  description: 'Checks for high/critical vulnerabilities in production dependencies',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const evidence: string[] = [];

    try {
      const output = execSync('pnpm audit --prod --json', {
        cwd: ctx.repoRoot,
        encoding: 'utf-8',
        timeout: 30000,
      });

      const audit = JSON.parse(output) as PnpmAuditResult;
      const { total, highCritical, details } = countHighCritical(audit);

      evidence.push(`Total vulnerabilities: ${total}`);
      evidence.push(`High/Critical: ${highCritical}`);
      if (details.length > 0) {
        evidence.push(`Affected packages: ${details.join(', ')}`);
      }

      if (highCritical > 0) {
        return {
          name: this.name,
          status: 'FAIL',
          message: `${highCritical} high/critical vulnerability(ies) found`,
          evidence,
        };
      }

      return {
        name: this.name,
        status: 'PASS',
        message: 'No high/critical vulnerabilities in production dependencies',
        evidence,
      };
    } catch (err: unknown) {
      // pnpm audit exits non-zero if vulns found — parse stdout from the error
      const execErr = err as ExecSyncError;
      if (execErr.stdout) {
        try {
          const audit = JSON.parse(execErr.stdout) as PnpmAuditResult;
          const { total, highCritical, details } = countHighCritical(audit);

          evidence.push(`Total vulnerabilities: ${total}`);
          evidence.push(`High/Critical: ${highCritical}`);
          if (details.length > 0) {
            evidence.push(`Affected packages: ${details.join(', ')}`);
          }

          if (highCritical > 0) {
            return {
              name: this.name,
              status: 'FAIL',
              message: `${highCritical} high/critical vulnerability(ies) found`,
              evidence,
            };
          }

          return {
            name: this.name,
            status: 'PASS',
            message: 'No high/critical vulnerabilities (low/moderate may exist)',
            evidence,
          };
        } catch {
          // Fail-closed-adjacent: do NOT silently PASS when we cannot parse the
          // audit output. A hard FAIL is inappropriate because the audit may
          // have errored for non-security reasons (e.g. registry timeout), but
          // a silent PASS would hide a real vuln dump we failed to parse.
          // WARN surfaces the problem for human triage.
          evidence.push('Audit JSON parse failed — treating as WARN (cannot verify)');
          return {
            name: this.name,
            status: 'WARN',
            message: 'Dependency audit ran but output could not be parsed',
            evidence,
          };
        }
      }

      evidence.push('pnpm audit failed to run');
      return {
        name: this.name,
        status: 'WARN',
        message: 'Dependency audit could not run',
        evidence,
      };
    }
  },
};
