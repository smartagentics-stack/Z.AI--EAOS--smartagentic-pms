#!/usr/bin/env node
/**
 * Engineering Assurance Engine (EAE) — CLI
 *
 * Usage:
 *   npx eae                    — Run all verifiers
 *   npx eae governance         — Run only governance verifier
 *   npx eae adr                — Run only ADR verifier
 *   npx eae evidence           — Run only evidence verifier
 *   npx eae architecture       — Run only architecture drift verifier
 *   npx eae serialization      — Run only serialization verifier
 *   npx eae forbidden          — Run only forbidden code verifier
 *   npx eae dependencies       — Run only dependency audit
 */

import { resolve } from 'node:path';
import { runAllVerifiers, ALL_VERIFIERS } from './index.js';
import type { Verifier, VerificationContext } from './types/index.js';

const repoRoot = resolve(process.cwd());
const ctx: VerificationContext = {
  repoRoot,
  evidenceDir: resolve(repoRoot, 'evidence'),
};

/**
 * Find a verifier by name, throwing if not found (avoids non-null assertion).
 */
function requireVerifier(name: string): Verifier {
  const verifier = ALL_VERIFIERS.find((v) => v.name === name);
  if (!verifier) {
    throw new Error(`Verifier '${name}' not found in ALL_VERIFIERS`);
  }
  return verifier;
}

const VERIFIER_MAP: Record<string, Verifier> = {
  governance: requireVerifier('governance-compliance'),
  adr: requireVerifier('adr-compliance'),
  evidence: requireVerifier('evidence-completeness'),
  architecture: requireVerifier('architecture-drift'),
  serialization: requireVerifier('serialization-consistency'),
  forbidden: requireVerifier('forbidden-code'),
  dependencies: requireVerifier('dependency-audit'),
  traceability: requireVerifier('traceability-compliance'),
  prompt: requireVerifier('prompt-structure'),
  performance: requireVerifier('performance-regression'),
};

/**
 * Write to stdout without using console.log (ESLint forbids console.log
 * in production code; CLI output is legitimate but must use process.stdout).
 */
function out(message: string): void {
  process.stdout.write(message + '\n');
}

async function main() {
  const target = process.argv[2];

  out('═══════════════════════════════════════════════════════');
  out('Engineering Assurance Engine (EAE)');
  out('═══════════════════════════════════════════════════════');
  out(`Repository: ${repoRoot}`);
  out(`Evidence:   ${ctx.evidenceDir}`);
  out('');

  if (target && target !== 'all') {
    const verifier = VERIFIER_MAP[target];
    if (!verifier) {
      process.stderr.write(`Unknown verifier: ${target}\n`);
      process.stderr.write(`Available: ${Object.keys(VERIFIER_MAP).join(', ')}, all\n`);
      process.exit(1);
    }

    const result = await verifier.verify(ctx);
    printResult(result);
    process.exit(result.status === 'FAIL' ? 1 : 0);
  }

  // Run all verifiers
  const results = await runAllVerifiers(repoRoot);

  out('');
  out('═══════════════════════════════════════════════════════');
  out('RESULTS');
  out('═══════════════════════════════════════════════════════');

  for (const result of results) {
    printResult(result);
  }

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;

  out('');
  out('═══════════════════════════════════════════════════════');
  out(`PASS: ${passCount}  FAIL: ${failCount}  WARN: ${warnCount}`);

  if (failCount > 0) {
    out('❌ ENGINEERING ASSURANCE: FAILED');
    process.exit(1);
  } else if (warnCount > 0) {
    out('⚠️  ENGINEERING ASSURANCE: PASSED WITH WARNINGS');
    process.exit(0);
  } else {
    out('✅ ENGINEERING ASSURANCE: PASSED');
    process.exit(0);
  }
}

function printResult(result: {
  name: string;
  status: string;
  message: string;
  evidence?: string[];
}): void {
  const icon =
    result.status === 'PASS'
      ? '✅'
      : result.status === 'FAIL'
        ? '❌'
        : result.status === 'WARN'
          ? '⚠️'
          : '⏭️';
  out(`${icon} ${result.name}: ${result.message}`);
  if (result.evidence) {
    for (const e of result.evidence) {
      out(`   ${e}`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${err}\n`);
  process.exit(1);
});
