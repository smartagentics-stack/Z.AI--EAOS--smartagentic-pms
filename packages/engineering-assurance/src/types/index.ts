/**
 * Engineering Assurance Engine (EAE) — Types
 *
 * Core types for verification results, reports, and evidence.
 */

export type VerificationStatus = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

export interface VerificationResult {
  readonly name: string;
  readonly status: VerificationStatus;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly evidence?: string[];
  readonly durationMs?: number;
}

export interface VerificationContext {
  readonly repoRoot: string;
  readonly evidenceDir: string;
}

export interface Verifier {
  readonly name: string;
  readonly description: string;
  verify(ctx: VerificationContext): Promise<VerificationResult>;
}

export interface ReportSummary {
  readonly timestamp: string;
  readonly commit: string;
  readonly branch: string;
  readonly results: VerificationResult[];
  readonly overallStatus: VerificationStatus;
  readonly passCount: number;
  readonly failCount: number;
  readonly warnCount: number;
  readonly skipCount: number;
  readonly totalDurationMs: number;
}
