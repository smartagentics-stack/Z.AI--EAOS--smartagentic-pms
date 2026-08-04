/**
 * Engineering Assurance Engine (EAE) — Main Entry Point
 *
 * Runs all verifiers and generates reports.
 */

import { resolve } from 'node:path';
import type { Verifier, VerificationResult, VerificationContext } from './types/index.js';
import { adrVerifier } from './verifiers/adr-verifier.js';
import { governanceVerifier } from './verifiers/governance-verifier.js';
import { evidenceVerifier } from './verifiers/evidence-verifier.js';
import { architectureDriftVerifier } from './verifiers/architecture-drift-verifier.js';
import { serializationVerifier } from './verifiers/serialization-verifier.js';
import { forbiddenCodeVerifier } from './verifiers/forbidden-code-verifier.js';
import { dependencyVerifier } from './verifiers/dependency-verifier.js';
import { traceabilityVerifier } from './verifiers/traceability-verifier.js';
import { generateReports } from './reports/report-generator.js';

export {
  adrVerifier,
  governanceVerifier,
  evidenceVerifier,
  architectureDriftVerifier,
  serializationVerifier,
  forbiddenCodeVerifier,
  dependencyVerifier,
  traceabilityVerifier,
};
export { generateReports };

export const ALL_VERIFIERS: Verifier[] = [
  governanceVerifier,
  adrVerifier,
  evidenceVerifier,
  architectureDriftVerifier,
  serializationVerifier,
  forbiddenCodeVerifier,
  dependencyVerifier,
  traceabilityVerifier,
];

export async function runAllVerifiers(repoRoot: string): Promise<VerificationResult[]> {
  const ctx: VerificationContext = {
    repoRoot,
    evidenceDir: resolve(repoRoot, 'evidence'),
  };

  const results: VerificationResult[] = [];

  for (const verifier of ALL_VERIFIERS) {
    const start = Date.now();
    try {
      const result = await verifier.verify(ctx);
      results.push({ ...result, durationMs: Date.now() - start });
    } catch (err) {
      results.push({
        name: verifier.name,
        status: 'FAIL',
        message: `Verifier crashed: ${(err as Error).message}`,
        durationMs: Date.now() - start,
      });
    }
  }

  // Generate reports
  generateReports(results, ctx.evidenceDir, repoRoot);

  return results;
}

export type { ReportSummary } from './types/index.js';
