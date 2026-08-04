/**
 * EAE Report Generator
 *
 * Generates machine-readable JSON reports in the evidence/ directory.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import type { ReportSummary, VerificationResult } from '../types/index.js';

export function generateReports(
  results: VerificationResult[],
  evidenceDir: string,
  repoRoot: string
): void {
  mkdirSync(evidenceDir, { recursive: true });

  const commit = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim();
  const branch = execSync('git branch --show-current', { cwd: repoRoot, encoding: 'utf-8' }).trim();

  const summary: ReportSummary = {
    timestamp: new Date().toISOString(),
    commit,
    branch,
    results,
    overallStatus: getOverallStatus(results),
    passCount: results.filter(r => r.status === 'PASS').length,
    failCount: results.filter(r => r.status === 'FAIL').length,
    warnCount: results.filter(r => r.status === 'WARN').length,
    skipCount: results.filter(r => r.status === 'SKIP').length,
    totalDurationMs: results.reduce((sum, r) => sum + (r.durationMs || 0), 0),
  };

  // Write individual reports
  writeFileSync(resolve(evidenceDir, 'verification-summary.json'), JSON.stringify(summary, null, 2));

  // Write per-verifier reports
  for (const result of results) {
    const filename = `${result.name}-report.json`;
    writeFileSync(resolve(evidenceDir, filename), JSON.stringify(result, null, 2));
  }

  // Write EAR report
  const earReport = {
    timestamp: summary.timestamp,
    commit: summary.commit,
    branch: summary.branch,
    overallStatus: summary.overallStatus,
    passCount: summary.passCount,
    failCount: summary.failCount,
    warnCount: summary.warnCount,
    verifiers: results.map(r => ({
      name: r.name,
      status: r.status,
      message: r.message,
    })),
  };
  writeFileSync(resolve(evidenceDir, 'ear-report.json'), JSON.stringify(earReport, null, 2));

  // Write governance report
  const governanceResult = results.find(r => r.name === 'governance-compliance');
  if (governanceResult) {
    writeFileSync(resolve(evidenceDir, 'governance-report.json'), JSON.stringify(governanceResult, null, 2));
  }

  // Write ADR report
  const adrResult = results.find(r => r.name === 'adr-compliance');
  if (adrResult) {
    writeFileSync(resolve(evidenceDir, 'adr-report.json'), JSON.stringify(adrResult, null, 2));
  }

  // Write architecture report
  const archResults = results.filter(r =>
    r.name === 'architecture-drift' || r.name === 'serialization-consistency'
  );
  writeFileSync(resolve(evidenceDir, 'architecture-report.json'), JSON.stringify(archResults, null, 2));

  // Write security report
  const securityResults = results.filter(r =>
    r.name === 'dependency-audit' || r.name === 'forbidden-code'
  );
  writeFileSync(resolve(evidenceDir, 'security-report.json'), JSON.stringify(securityResults, null, 2));
}

function getOverallStatus(results: VerificationResult[]): 'PASS' | 'FAIL' | 'WARN' | 'SKIP' {
  if (results.some(r => r.status === 'FAIL')) return 'FAIL';
  if (results.some(r => r.status === 'WARN')) return 'WARN';
  if (results.every(r => r.status === 'SKIP')) return 'SKIP';
  return 'PASS';
}
