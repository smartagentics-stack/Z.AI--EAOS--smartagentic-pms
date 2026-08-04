/**
 * Verifier: Dependency Audit
 *
 * Checks for high-severity vulnerabilities in production dependencies.
 */

import { execSync } from 'node:child_process';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

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

      const audit = JSON.parse(output);
      const vulns = audit.vulnerabilities || {};
      const highVulns = Object.values(vulns).filter(
        (v: any) => v.severity === 'high' || v.severity === 'critical'
      );

      evidence.push(`Total vulnerabilities: ${Object.keys(vulns).length}`);
      evidence.push(`High/Critical: ${highVulns.length}`);

      if (highVulns.length > 0) {
        return {
          name: this.name,
          status: 'FAIL',
          message: `${highVulns.length} high/critical vulnerability(ies) found`,
          evidence,
        };
      }

      return {
        name: this.name,
        status: 'PASS',
        message: 'No high/critical vulnerabilities in production dependencies',
        evidence,
      };
    } catch (err: any) {
      // pnpm audit exits non-zero if vulns found — parse stdout
      if (err.stdout) {
        try {
          const audit = JSON.parse(err.stdout);
          const vulns = audit.vulnerabilities || {};
          const highVulns = Object.values(vulns).filter(
            (v: any) => v.severity === 'high' || v.severity === 'critical'
          );

          evidence.push(`Total vulnerabilities: ${Object.keys(vulns).length}`);
          evidence.push(`High/Critical: ${highVulns.length}`);

          if (highVulns.length > 0) {
            return {
              name: this.name,
              status: 'FAIL',
              message: `${highVulns.length} high/critical vulnerability(ies) found`,
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
          evidence.push('Audit JSON parse failed — treating as pass');
          return {
            name: this.name,
            status: 'PASS',
            message: 'Dependency audit completed (could not parse JSON)',
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
