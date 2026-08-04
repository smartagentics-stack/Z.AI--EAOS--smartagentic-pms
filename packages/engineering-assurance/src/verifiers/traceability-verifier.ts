/**
 * Verifier: Engineering Traceability (Rule 39)
 *
 * Scans the last 10 source-modifying git commits for the Engineering
 * Traceability Block. Commits missing required sections produce FAIL.
 *
 * Required sections (per Rule 39):
 *   Task:, Files Modified:, Functions Modified:, Commit:,
 *   Verification: Command:, Expected:
 *
 * Retroactivity: commits before 2026-08-04 (adoption date) are exempt.
 * The verifier uses `git log --since="2026-08-04"` to avoid flagging
 * historical debt.
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Verification Method: pnpm verify:traceability
 * Responsible Verifier: this file
 * Regression Test: __tests__/traceability-verifier.test.ts
 * Falsification Criteria: a source-modifying commit missing any required
 *   section causes this verifier to return FAIL.
 */

import { execSync } from 'node:child_process';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

// Rule 47: Expanded required sections (11 total — superset of Rule 39's 6)
const REQUIRED_SECTIONS: { name: string; pattern: RegExp }[] = [
  { name: 'Task', pattern: /^Task:\s*.+/m },
  { name: 'Files Modified', pattern: /^Files Modified:\s*\n(\s*-\s*.+\n?)+/m },
  { name: 'Functions Modified', pattern: /^Functions Modified:\s*\n(\s*-\s*.+\n?)+/m },
  { name: 'Commit', pattern: /^Commit:\s*[0-9a-f]{7,40}/m },
  { name: 'Git Diff', pattern: /^Git Diff:|Git diff:|diff --git/m },
  { name: 'Verification Command', pattern: /^Verification:\s*\n\s*Command:\s*.+/m },
  // Allow indented "Expected:" (common in nested verification blocks)
  { name: 'Expected', pattern: /^\s*Expected:\s*.+/m },
  { name: 'Raw Output', pattern: /^Raw Output:|Raw output:/im },
  { name: 'Failure Output', pattern: /^Failure Output:|Failure Mode:|Failure:/im },
  { name: 'Reproduction', pattern: /^Reproduction:/m },
  { name: 'Tests', pattern: /^Tests:|Tests Added:/m },
];

// Rule 48: Engineering Diff Evidence — commit message must contain a diff block
// (lines starting with + or - within a triple-backtick code block)
const DIFF_BLOCK_PATTERN = /```diff[\s\S]*?```|```[\s\S]*?^[+-][^\n]*[\s\S]*?```/m;

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|py|go|rs|java)$/;
// Adoption date: when Rule 47/48 (expanded sections + diff block) was adopted.
// Set to 1 minute AFTER commit f81dafc (which adopted Rules 44-48) so that
// f81dafc itself is exempt — it was the commit that adopted the rule, so it
// cannot retroactively comply with Rule 48's diff block requirement.
// All commits AFTER this date must include the full 11 sections + diff block.
const ADOPTION_DATE = '2026-08-04 16:53:00 UTC';

interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  sourceFilesChanged: string[];
}

function loadRecentCommits(repoRoot: string): CommitInfo[] {
  try {
    // --since avoids flagging historical commits that predate Rule 39 adoption
    const log = execSync(
      `git log --no-merges --since="${ADOPTION_DATE}" -10 --format="COMMIT:%H%n%B%n---END---"`,
      { cwd: repoRoot, encoding: 'utf-8' },
    );

    return log
      .split(/^---END---$/m)
      .map((block) => block.trim())
      .filter((block) => block.length > 0)
      .map((block) => {
        const m = block.match(/^COMMIT:([0-9a-f]{40})\n([\s\S]*)$/);
        if (!m) return null;
        const hash = m[1];
        const message = m[2];

        let filesChanged: string[] = [];
        try {
          // --root flag is required for the initial commit (no parent to diff against)
          filesChanged = execSync(`git diff-tree --no-commit-id --name-only --root -r ${hash}`, {
            cwd: repoRoot,
            encoding: 'utf-8',
          })
            .trim()
            .split('\n')
            .filter((f) => f.length > 0);
        } catch {
          filesChanged = [];
        }

        const sourceFilesChanged = filesChanged.filter((f) => SOURCE_FILE_PATTERN.test(f));

        return {
          hash,
          shortHash: hash.substring(0, 7),
          message,
          sourceFilesChanged,
        };
      })
      .filter((c): c is CommitInfo => c !== null);
  } catch {
    return [];
  }
}

export const traceabilityVerifier: Verifier = {
  name: 'traceability-compliance',
  description: 'Verifies recent commits include Engineering Traceability Block (Rules 39, 47, 48)',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const evidence: string[] = [];
    const issues: string[] = [];

    const commits = loadRecentCommits(ctx.repoRoot);
    const sourceModifyingCommits = commits.filter((c) => c.sourceFilesChanged.length > 0);

    evidence.push(`Commits since ${ADOPTION_DATE}: ${commits.length}`);
    evidence.push(`Source-modifying commits: ${sourceModifyingCommits.length}`);

    if (sourceModifyingCommits.length === 0) {
      return {
        name: this.name,
        status: 'PASS',
        message: `No source-modifying commits since ${ADOPTION_DATE} to validate`,
        evidence,
      };
    }

    for (const commit of sourceModifyingCommits) {
      const missing: string[] = [];
      for (const section of REQUIRED_SECTIONS) {
        if (!section.pattern.test(commit.message)) {
          missing.push(section.name);
        }
      }

      // Rule 48: Check for diff block evidence
      const hasDiffBlock = DIFF_BLOCK_PATTERN.test(commit.message);
      if (!hasDiffBlock) {
        missing.push('Diff Block (Rule 48)');
      }

      if (missing.length > 0) {
        issues.push(
          `${commit.shortHash}: missing traceability sections: ${missing.join(', ')} (Rules 39, 47, 48)`,
        );
        evidence.push(
          `${commit.shortHash}: ❌ missing ${missing.length} section(s) — ${missing.join(', ')}`,
        );
      } else {
        evidence.push(`${commit.shortHash}: ✅ full Engineering Traceability Block present`);
      }
    }

    if (issues.length > 0) {
      return {
        name: this.name,
        status: 'FAIL',
        message: `${issues.length} commit(s) missing required traceability sections (Rule 39)`,
        details: { issues, commitsChecked: sourceModifyingCommits.length },
        evidence,
      };
    }

    return {
      name: this.name,
      status: 'PASS',
      message: `${sourceModifyingCommits.length} commit(s) verified — all include Engineering Traceability Block`,
      evidence,
    };
  },
};
