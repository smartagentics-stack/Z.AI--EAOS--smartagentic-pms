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

const VERIFIER_MAP: Record<string, Verifier> = {
  governance: ALL_VERIFIERS.find((v) => v.name === 'governance-compliance')!,
  adr: ALL_VERIFIERS.find((v) => v.name === 'adr-compliance')!,
  evidence: ALL_VERIFIERS.find((v) => v.name === 'evidence-completeness')!,
  architecture: ALL_VERIFIERS.find((v) => v.name === 'architecture-drift')!,
  serialization: ALL_VERIFIERS.find((v) => v.name === 'serialization-consistency')!,
  forbidden: ALL_VERIFIERS.find((v) => v.name === 'forbidden-code')!,
  dependencies: ALL_VERIFIERS.find((v) => v.name === 'dependency-audit')!,
  traceability: ALL_VERIFIERS.find((v) => v.name === 'traceability-compliance')!,
};

async function main() {
  const target = process.argv[2];

  console.log('═══════════════════════════════════════════════════════');
  console.log('Engineering Assurance Engine (EAE)');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Repository: ${repoRoot}`);
  console.log(`Evidence:   ${ctx.evidenceDir}`);
  console.log('');

  if (target && target !== 'all') {
    const verifier = VERIFIER_MAP[target];
    if (!verifier) {
      console.error(`Unknown verifier: ${target}`);
      console.error(`Available: ${Object.keys(VERIFIER_MAP).join(', ')}, all`);
      process.exit(1);
    }

    const result = await verifier.verify(ctx);
    printResult(result);
    process.exit(result.status === 'FAIL' ? 1 : 0);
  }

  // Run all verifiers
  const results = await runAllVerifiers(repoRoot);

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('═══════════════════════════════════════════════════════');

  for (const result of results) {
    printResult(result);
  }

  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`PASS: ${passCount}  FAIL: ${failCount}  WARN: ${warnCount}`);

  if (failCount > 0) {
    console.log('❌ ENGINEERING ASSURANCE: FAILED');
    process.exit(1);
  } else if (warnCount > 0) {
    console.log('⚠️  ENGINEERING ASSURANCE: PASSED WITH WARNINGS');
    process.exit(0);
  } else {
    console.log('✅ ENGINEERING ASSURANCE: PASSED');
    process.exit(0);
  }
}

function printResult(result: {
  name: string;
  status: string;
  message: string;
  evidence?: string[];
}) {
  const icon =
    result.status === 'PASS'
      ? '✅'
      : result.status === 'FAIL'
        ? '❌'
        : result.status === 'WARN'
          ? '⚠️'
          : '⏭️';
  console.log(`${icon} ${result.name}: ${result.message}`);
  if (result.evidence) {
    for (const e of result.evidence) {
      console.log(`   ${e}`);
    }
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
