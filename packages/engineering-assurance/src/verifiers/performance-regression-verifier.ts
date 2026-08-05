/**
 * Verifier: Performance Regression Gate (Rule 27)
 *
 * Executes reproducible benchmarks and compares against baseline metrics.
 * Detects performance regressions with configurable threshold.
 *
 * Methodology:
 *   1. Run each benchmark N times (default 3)
 *   2. Take the median (not mean — outliers should not skew results)
 *   3. Compare median against baseline
 *   4. Status: PASS (within threshold), WARN (within 2x threshold), FAIL (exceeds 2x)
 *
 * Baseline file: baseline-performance.json (committed to repo)
 * Reports: performance-report.json, performance-history.json, performance-summary.json
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Verification Method: pnpm verify:performance
 * Responsible Verifier: this file
 * Regression Test: __tests__/performance-regression-verifier.test.ts
 * Falsification Criteria:
 *   - baseline-performance.json missing → FAIL
 *   - baseline-performance.json corrupt JSON → FAIL
 *   - benchmark exceeds 2x threshold → FAIL
 *   - benchmark exceeds 1x threshold → WARN
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

interface BaselineMetric {
  readonly maxExecutionMs: number;
}

interface BaselineFile {
  readonly verify?: BaselineMetric;
  readonly architecture?: BaselineMetric;
  readonly serialization?: BaselineMetric;
  readonly [key: string]: BaselineMetric | undefined;
}

interface BenchmarkResult {
  readonly name: string;
  readonly measurements: number[];
  readonly medianMs: number;
  readonly baselineMs: number;
  readonly thresholdPercent: number;
  readonly ratio: number;
  readonly status: 'PASS' | 'WARN' | 'FAIL';
  readonly regression: boolean;
}

const BASELINE_FILE = 'baseline-performance.json';
const DEFAULT_THRESHOLD_PERCENT = 15;
const BENCHMARK_RUNS = 3;

function loadBaseline(repoRoot: string): BaselineFile {
  const baselinePath = resolve(repoRoot, BASELINE_FILE);
  if (!existsSync(baselinePath)) {
    throw new Error(`Baseline file not found: ${BASELINE_FILE}`);
  }
  const content = readFileSync(baselinePath, 'utf-8');
  let parsed: BaselineFile;
  try {
    parsed = JSON.parse(content) as BaselineFile;
  } catch {
    throw new Error(`Baseline file is corrupt (invalid JSON): ${BASELINE_FILE}`);
  }

  // Validate each metric has a positive finite number.
  // Without this guard, a baseline like `{ "verify": { "maxExecutionMs": "NaN" } }`
  // would parse successfully but silently break every threshold comparison:
  //   - `baselineMs <= 0` is false for the string "NaN" (string vs number comparison)
  //   - `actualMs / "NaN"` produces NaN, which makes `ratio > threshold` always false
  //   - Result: status = PASS for a poisoned baseline → defeats the entire gate.
  for (const [key, metric] of Object.entries(parsed)) {
    if (metric != null) {
      const ms = (metric as BaselineMetric).maxExecutionMs;
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
        throw new Error(
          `Invalid baseline metric '${key}.maxExecutionMs': expected positive finite number, got ${JSON.stringify(ms)}`,
        );
      }
    }
  }

  return parsed;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function runBenchmark(fn: () => void, runs: number = BENCHMARK_RUNS): number[] {
  const measurements: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = Date.now();
    fn();
    measurements.push(Date.now() - start);
  }
  return measurements;
}

function determineStatus(
  actualMs: number,
  baselineMs: number,
  thresholdPercent: number,
): { status: 'PASS' | 'WARN' | 'FAIL'; ratio: number; regression: boolean } {
  if (baselineMs <= 0) {
    return { status: 'FAIL', ratio: 0, regression: true };
  }
  const ratio = actualMs / baselineMs;
  const warnThreshold = 1.0 + thresholdPercent / 100;
  const failThreshold = 1.0 + (2 * thresholdPercent) / 100;

  if (ratio > failThreshold) {
    return { status: 'FAIL', ratio, regression: true };
  }
  if (ratio > warnThreshold) {
    return { status: 'WARN', ratio, regression: true };
  }
  return { status: 'PASS', ratio, regression: false };
}

function benchmarkVerify(repoRoot: string): number[] {
  return runBenchmark(() => {
    try {
      // Use verify:evidence as proxy for overall verify performance.
      // Cannot run full `pnpm verify` because it includes this performance
      // verifier itself, causing infinite recursion.
      // NOTE: use `stdio: 'ignore'` instead of `> /dev/null 2>&1` so the
      // benchmark works on Windows too (no /dev/null on Win32).
      execSync('pnpm verify:evidence', {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'ignore',
      });
    } catch {
      // Benchmark doesn't care about verify result, only timing
    }
  });
}

function benchmarkArchitecture(repoRoot: string): number[] {
  return runBenchmark(() => {
    try {
      // `stdio: 'ignore'` for Windows compatibility (no /dev/null on Win32).
      execSync('pnpm verify:architecture', {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'ignore',
      });
    } catch {
      // Timing only
    }
  });
}

function benchmarkSerialization(repoRoot: string): number[] {
  return runBenchmark(() => {
    try {
      // `stdio: 'ignore'` for Windows compatibility (no /dev/null on Win32).
      execSync('pnpm verify:serialization', {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: 'ignore',
      });
    } catch {
      // Timing only
    }
  });
}

function evaluateBenchmark(
  name: string,
  measurements: number[],
  baseline: BaselineMetric | undefined,
  thresholdPercent: number,
): BenchmarkResult {
  const medianMs = median(measurements);

  if (!baseline) {
    return {
      name,
      measurements,
      medianMs,
      baselineMs: 0,
      thresholdPercent,
      ratio: 0,
      status: 'PASS',
      regression: false,
    };
  }

  const baselineMs = baseline.maxExecutionMs;
  const { status, ratio, regression } = determineStatus(medianMs, baselineMs, thresholdPercent);

  return {
    name,
    measurements,
    medianMs,
    baselineMs,
    thresholdPercent,
    ratio,
    status,
    regression,
  };
}

function writeReports(results: BenchmarkResult[], evidenceDir: string): void {
  mkdirSync(evidenceDir, { recursive: true });

  writeFileSync(
    resolve(evidenceDir, 'performance-report.json'),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  writeFileSync(
    resolve(evidenceDir, 'performance-summary.json'),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        totalBenchmarks: results.length,
        pass: passCount,
        warn: warnCount,
        fail: failCount,
        overallStatus: failCount > 0 ? 'FAIL' : warnCount > 0 ? 'WARN' : 'PASS',
        results: results.map((r) => ({
          name: r.name,
          medianMs: r.medianMs,
          baselineMs: r.baselineMs,
          ratio: r.ratio,
          status: r.status,
        })),
      },
      null,
      2,
    ),
  );

  const historyPath = resolve(evidenceDir, 'performance-history.json');
  let history: unknown[] = [];
  if (existsSync(historyPath)) {
    try {
      history = JSON.parse(readFileSync(historyPath, 'utf-8')) as unknown[];
    } catch {
      history = [];
    }
  }
  history.push({
    timestamp: new Date().toISOString(),
    results: results.map((r) => ({
      name: r.name,
      medianMs: r.medianMs,
      baselineMs: r.baselineMs,
      ratio: r.ratio,
      status: r.status,
    })),
  });
  if (history.length > 50) {
    history = history.slice(-50);
  }
  writeFileSync(historyPath, JSON.stringify(history, null, 2));

  writeFileSync(
    resolve(evidenceDir, 'benchmark-results.json'),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        runs: BENCHMARK_RUNS,
        results: results.map((r) => ({
          name: r.name,
          measurements: r.measurements,
          medianMs: r.medianMs,
        })),
      },
      null,
      2,
    ),
  );
}

export const performanceRegressionVerifier: Verifier = {
  name: 'performance-regression',
  description: 'Executes benchmarks and detects performance regressions (Rule 27)',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const evidence: string[] = [];
    const issues: string[] = [];

    let baseline: BaselineFile;
    try {
      baseline = loadBaseline(ctx.repoRoot);
      evidence.push(`✅ Baseline loaded: ${BASELINE_FILE}`);
    } catch (err) {
      const msg = (err as Error).message;
      evidence.push(`❌ ${msg}`);
      return {
        name: this.name,
        status: 'FAIL',
        message: `Performance baseline error: ${msg}`,
        details: { issues: [msg] },
        evidence,
      };
    }

    evidence.push(
      `Threshold: ${DEFAULT_THRESHOLD_PERCENT}% (WARN), ${DEFAULT_THRESHOLD_PERCENT * 2}% (FAIL)`,
    );
    evidence.push(`Benchmark runs per metric: ${BENCHMARK_RUNS}`);

    const results: BenchmarkResult[] = [];

    evidence.push('Running benchmark: verify (proxy: pnpm verify:evidence)...');
    const verifyMeasurements = benchmarkVerify(ctx.repoRoot);
    const verifyResult = evaluateBenchmark(
      'verify',
      verifyMeasurements,
      baseline.verify,
      DEFAULT_THRESHOLD_PERCENT,
    );
    results.push(verifyResult);
    evidence.push(
      `  verify: median=${verifyResult.medianMs}ms, baseline=${verifyResult.baselineMs}ms, ratio=${verifyResult.ratio.toFixed(2)}, status=${verifyResult.status}`,
    );

    evidence.push('Running benchmark: architecture...');
    const archMeasurements = benchmarkArchitecture(ctx.repoRoot);
    const archResult = evaluateBenchmark(
      'architecture',
      archMeasurements,
      baseline.architecture,
      DEFAULT_THRESHOLD_PERCENT,
    );
    results.push(archResult);
    evidence.push(
      `  architecture: median=${archResult.medianMs}ms, baseline=${archResult.baselineMs}ms, ratio=${archResult.ratio.toFixed(2)}, status=${archResult.status}`,
    );

    evidence.push('Running benchmark: serialization...');
    const serialMeasurements = benchmarkSerialization(ctx.repoRoot);
    const serialResult = evaluateBenchmark(
      'serialization',
      serialMeasurements,
      baseline.serialization,
      DEFAULT_THRESHOLD_PERCENT,
    );
    results.push(serialResult);
    evidence.push(
      `  serialization: median=${serialResult.medianMs}ms, baseline=${serialResult.baselineMs}ms, ratio=${serialResult.ratio.toFixed(2)}, status=${serialResult.status}`,
    );

    writeReports(results, ctx.evidenceDir);
    evidence.push(
      'Reports: performance-report.json, performance-summary.json, performance-history.json, benchmark-results.json',
    );

    const failCount = results.filter((r) => r.status === 'FAIL').length;
    const warnCount = results.filter((r) => r.status === 'WARN').length;

    for (const r of results) {
      if (r.status === 'FAIL') {
        issues.push(
          `${r.name}: ${r.medianMs}ms exceeds baseline ${r.baselineMs}ms by ${((r.ratio - 1) * 100).toFixed(1)}% (FAIL threshold: ${DEFAULT_THRESHOLD_PERCENT * 2}%)`,
        );
      } else if (r.status === 'WARN') {
        issues.push(
          `${r.name}: ${r.medianMs}ms exceeds baseline ${r.baselineMs}ms by ${((r.ratio - 1) * 100).toFixed(1)}% (WARN threshold: ${DEFAULT_THRESHOLD_PERCENT}%)`,
        );
      }
    }

    if (failCount > 0) {
      return {
        name: this.name,
        status: 'FAIL',
        message: `${failCount} performance regression(s) detected — see details`,
        details: { issues, results },
        evidence,
      };
    }

    if (warnCount > 0) {
      return {
        name: this.name,
        status: 'WARN',
        message: `${warnCount} benchmark(s) approaching threshold — see details`,
        details: { issues, results },
        evidence,
      };
    }

    return {
      name: this.name,
      status: 'PASS',
      message: `All ${results.length} benchmarks within threshold`,
      details: { results },
      evidence,
    };
  },
};
