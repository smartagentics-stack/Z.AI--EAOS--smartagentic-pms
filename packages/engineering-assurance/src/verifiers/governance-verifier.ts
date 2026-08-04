/**
 * Verifier: Governance Compliance (Rule 43 enhanced)
 *
 * Checks:
 *  1. All required governance documents exist (including RULES.md registry)
 *  2. Every rule document declares its Enforcement Type (Rule 43)
 *
 * Rule 43 requires every governance rule document to declare its
 * enforcement classification in a structured block at the top of the
 * document. This verifier scans all docs/governance/*-Rule*.md and
 * docs/governance/27-Rules-*.md files for the declaration.
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Verification Method: pnpm verify:governance
 * Responsible Verifier: this file
 * Regression Test: __tests__/governance-verifier.test.ts
 * Falsification Criteria:
 *   - a required doc missing causes FAIL
 *   - a rule doc missing 'Enforcement Type:' declaration causes FAIL
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

const REQUIRED_DOCS = [
  'docs/governance/RULES.md',
  'docs/governance/MASTER-ENGINEERING-ASSURANCE-PROMPT.md',
  'docs/governance/MASTER-EAR-PROMPT-DEFINITIVE.md',
  'docs/governance/18-Senior-Engineering-Operating-Rules.md',
  'docs/governance/19-Evidence-First-Debugging-Methodology.md',
  'docs/governance/20-Engineering-Verification-Evidence-Policy.md',
  'docs/governance/21-Independent-Audit-Before-Phase-Transition.md',
  'docs/governance/22-Independent-Engineering-Acceptance-Policy.md',
  'docs/governance/24-Engineering-Assurance-Framework-v2.md',
  'docs/governance/25-Rule-36-Governance-Automation.md',
  'docs/governance/26-Rule-38-Executable-Evidence.md',
  'docs/governance/27-Rules-39-43-Traceability-Executable-Recommendations-Prompt-Discipline-Classification.md',
  'docs/governance/28-Rules-44-48-Code-First-Working-Code-Verifiable-Samples-Executable-Proof-Diff-Evidence.md',
];

// Rule 43: every rule document must declare its Enforcement Type.
// Matches "Enforcement Type:" possibly wrapped in markdown bold (**...**).
// Handles both "Enforcement Type: Machine-Enforceable" and "**Enforcement Type:** Machine-Enforceable".
const ENFORCEMENT_TYPE_PATTERN =
  /^\*{0,2}Enforcement Type:\*{0,2}\s*(Machine-Enforceable|Reviewer-Enforced|Hybrid)\b/im;

// Files that match this pattern are subject to Rule 43 classification check.
// Includes docs 18 (Rules 1-18), 21 (Rule 18), 22 (Rules 19-21), 23 (Rules 24-30),
// 24 (Rules 31-35), 25 (Rule 36), 26 (Rule 38), 27 (Rules 39-43), 28 (Rules 44-48).
const RULE_DOC_PATTERN =
  /^docs\/governance\/(\d+-Rule|27-Rules|28-Rules|21-Independent|22-Independent|23-Engineering|24-Engineering|25-Rule|26-Rule|18-Senior)/;

interface RuleDocCheck {
  readonly doc: string;
  readonly declared: boolean;
  readonly enforcementType?: string;
}

function findRuleDocs(repoRoot: string): string[] {
  const govDir = resolve(repoRoot, 'docs', 'governance');
  if (!existsSync(govDir)) return [];

  const ruleDocs: string[] = [];
  for (const entry of readdirSync(govDir)) {
    const relativePath = `docs/governance/${entry}`;
    if (RULE_DOC_PATTERN.test(relativePath) && entry.endsWith('.md')) {
      ruleDocs.push(relativePath);
    }
  }
  return ruleDocs.sort();
}

export const governanceVerifier: Verifier = {
  name: 'governance-compliance',
  description: 'Checks governance docs exist AND declare Enforcement Type (Rule 43)',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const issues: string[] = [];
    const evidence: string[] = [];

    // Check 1: All required docs exist
    for (const doc of REQUIRED_DOCS) {
      const fullPath = resolve(ctx.repoRoot, doc);
      if (!existsSync(fullPath)) {
        issues.push(`Missing: ${doc}`);
        evidence.push(`❌ ${doc}`);
        continue;
      }
      evidence.push(`✅ ${doc}`);
    }

    // Check 2: Rule 43 — every rule doc must declare Enforcement Type
    const ruleDocs = findRuleDocs(ctx.repoRoot);
    const ruleDocChecks: RuleDocCheck[] = [];

    for (const doc of ruleDocs) {
      const fullPath = resolve(ctx.repoRoot, doc);
      if (!existsSync(fullPath)) continue;

      const content = readFileSync(fullPath, 'utf-8');
      const match = content.match(ENFORCEMENT_TYPE_PATTERN);
      if (!match) {
        issues.push(`${doc}: missing 'Enforcement Type:' declaration (Rule 43 violation)`);
        ruleDocChecks.push({ doc, declared: false });
        evidence.push(`   ⚠️ Rule 43 violation — ${doc} missing Enforcement Type`);
      } else {
        ruleDocChecks.push({ doc, declared: true, enforcementType: match[1] });
        evidence.push(`   ✅ ${doc}: ${match[1]}`);
      }
    }

    evidence.push(`Rule docs checked for Rule 43: ${ruleDocs.length}`);
    evidence.push(
      `Rule 43 compliant: ${ruleDocChecks.filter((c) => c.declared).length}/${ruleDocs.length}`,
    );

    if (issues.length > 0) {
      return {
        name: this.name,
        status: 'FAIL',
        message: `${issues.length} governance issue(s) — see details`,
        details: { issues, ruleDocChecks },
        evidence,
      };
    }

    return {
      name: this.name,
      status: 'PASS',
      message: `All ${REQUIRED_DOCS.length} governance documents present and Rule 43 compliant (${ruleDocs.length} rule docs)`,
      evidence,
    };
  },
};
