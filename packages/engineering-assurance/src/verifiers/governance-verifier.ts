/**
 * Verifier: Governance Compliance
 *
 * Checks that all required governance documents exist, including the
 * canonical Rule Registry (docs/governance/RULES.md).
 *
 * The Rule Registry is the single source of truth for all engineering
 * rules. Its existence is enforced by this verifier per Rule 38
 * (Executable Evidence) and Rule 36 (Governance Automation).
 */

import { existsSync } from 'node:fs';
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
];

export const governanceVerifier: Verifier = {
  name: 'governance-compliance',
  description: 'Checks that all required governance documents exist',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const issues: string[] = [];
    const evidence: string[] = [];

    for (const doc of REQUIRED_DOCS) {
      const path = resolve(ctx.repoRoot, doc);
      if (existsSync(path)) {
        evidence.push(`✅ ${doc}`);
      } else {
        issues.push(`Missing: ${doc}`);
        evidence.push(`❌ ${doc}`);
      }
    }

    if (issues.length > 0) {
      return {
        name: this.name,
        status: 'FAIL',
        message: `${issues.length} governance document(s) missing`,
        details: { issues },
        evidence,
      };
    }

    return {
      name: this.name,
      status: 'PASS',
      message: `All ${REQUIRED_DOCS.length} governance documents present`,
      evidence,
    };
  },
};
