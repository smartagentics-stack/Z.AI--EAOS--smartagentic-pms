/**
 * Verifier: Prompt Structure (Rule 42)
 *
 * Validates that implementation prompts stored as .md files in the
 * repository contain the 15 mandatory sections defined by Rule 42:
 *   Problem, Root Cause, Evidence, Constraints, Architecture,
 *   Implementation, Verification, Regression, Falsification, Expected Output
 *
 * A file is considered an "implementation prompt" if ANY of:
 *   - filename contains "PROMPT" (case-insensitive)
 *   - file is under prompts/ or docs/prompts/ directory
 *   - file content contains "ENGINEERING IMPLEMENTATION DIRECTIVE"
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Verification Method: pnpm verify:prompt
 * Responsible Verifier: this file
 * Regression Test: __tests__/prompt-structure-verifier.test.ts
 * Falsification Criteria: a prompt file missing any of the 15 mandatory
 *   sections causes this verifier to return FAIL.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, join, extname, relative } from 'node:path';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

interface SectionSpec {
  readonly name: string;
  readonly patterns: RegExp[];
}

// All 15 mandatory sections per strengthened Rule 42
// Sections MUST appear in this order (Rule 44 — Code First, Explanation Second)
const REQUIRED_SECTIONS: SectionSpec[] = [
  { name: 'Problem Definition', patterns: [/^##\s*Problem Definition\b/im, /^##\s*Problem\b/im] },
  {
    name: 'Root Cause Analysis',
    patterns: [
      /^##\s*Root Cause Analysis\b/im,
      /^##\s*Root Cause\b/im,
      /^##\s*Root Cause or Unknown\b/im,
    ],
  },
  { name: 'Constraints', patterns: [/^##\s*Constraints\b/im] },
  {
    name: 'Architecture Impact',
    patterns: [/^##\s*Architecture Impact\b/im, /^##\s*Architecture\b/im],
  },
  { name: 'Files to Modify', patterns: [/^##\s*Files to Modify\b/im, /^##\s*Files Modified\b/im] },
  {
    name: 'Functions to Modify',
    patterns: [/^##\s*Functions to Modify\b/im, /^##\s*Functions Modified\b/im],
  },
  {
    name: 'Production Code',
    patterns: [/^##\s*Production Code\b/im, /^##\s*Implementation\b/im, /^##\s*Code\b/im],
  },
  { name: 'Unit Tests', patterns: [/^##\s*Unit Tests\b/im, /^##\s*Tests\b/im] },
  { name: 'Integration Tests', patterns: [/^##\s*Integration Tests\b/im] },
  {
    name: 'Verification Commands',
    patterns: [/^##\s*Verification Commands\b/im, /^##\s*Verification\b/im],
  },
  { name: 'Expected Output', patterns: [/^##\s*Expected Output\b/im, /^##\s*Expected\b/im] },
  { name: 'Failure Output', patterns: [/^##\s*Failure Output\b/im, /^##\s*Failure\b/im] },
  { name: 'Rollback Procedure', patterns: [/^##\s*Rollback Procedure\b/im, /^##\s*Rollback\b/im] },
  {
    name: 'Engineering Traceability Block',
    patterns: [/^##\s*Engineering Traceability Block\b/im, /^##\s*Engineering Traceability\b/im],
  },
  {
    name: 'Evidence Required Before Completion',
    patterns: [/^##\s*Evidence Required Before Completion\b/im, /^##\s*Evidence Required\b/im],
  },
];

// Content indicator — files containing this phrase are treated as implementation prompts
const PROMPT_INDICATORS = [/ENGINEERING IMPLEMENTATION DIRECTIVE/i];

const SCAN_DIRS = ['prompts', 'docs/prompts', 'docs', 'spikes'];
const EXCLUDE_DIRS = ['node_modules', 'dist', '.next', '.turbo', '.git'];

// Governance docs are rule definitions, not implementation prompts.
// Even if their filenames contain "PROMPT" (e.g., MASTER-EAR-PROMPT-DEFINITIVE.md),
// they should not be subject to the 10-section implementation prompt check.
const GOVERNANCE_DIR = 'docs/governance/';

// ADR files are architecture decision records, not implementation prompts.
// Even if their filenames contain "prompt" (e.g., ADR-081-prompt-injection-defense.md),
// they should not be subject to the 15-section implementation prompt check.
const ADR_DIR = 'docs/adr/';

function isPromptFile(content: string, filename: string, relativePath: string): boolean {
  // Normalize path separators: Windows uses \, Unix uses /.
  // GOVERNANCE_DIR and other patterns use forward slashes, so convert to forward slashes.
  const normalizedPath = relativePath.replace(/\\/g, '/');
  // Exclude governance docs — they are rule definitions, not implementation prompts
  if (normalizedPath.startsWith(GOVERNANCE_DIR)) return false;
  // Exclude ADR files — they are architecture decision records, not implementation prompts
  if (normalizedPath.startsWith(ADR_DIR)) return false;
  // Filename contains .PROMPT.md (case-insensitive)
  if (filename.toUpperCase().includes('.PROMPT.MD')) return true;
  // File is under prompts/ or docs/prompts/
  if (normalizedPath.toLowerCase().includes('prompt')) return true;
  // Content contains directive marker
  return PROMPT_INDICATORS.some((p) => p.test(content));
}

function scanDirectory(dir: string, repoRoot: string): { file: string; content: string }[] {
  const results: { file: string; content: string }[] = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.includes(entry)) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...scanDirectory(fullPath, repoRoot));
    } else if (extname(fullPath) === '.md') {
      const content = readFileSync(fullPath, 'utf-8');
      const rel = relative(repoRoot, fullPath);
      if (isPromptFile(content, entry, rel)) {
        results.push({ file: rel, content });
      }
    }
  }
  return results;
}

export const promptStructureVerifier: Verifier = {
  name: 'prompt-structure',
  description: 'Validates implementation prompts contain 15 mandatory sections (Rule 42)',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const evidence: string[] = [];
    const issues: string[] = [];

    const seen = new Set<string>();
    const prompts: { file: string; content: string }[] = [];

    for (const dir of SCAN_DIRS) {
      const fullPath = resolve(ctx.repoRoot, dir);
      for (const found of scanDirectory(fullPath, ctx.repoRoot)) {
        if (!seen.has(found.file)) {
          seen.add(found.file);
          prompts.push(found);
        }
      }
    }

    evidence.push(`Implementation prompts found: ${prompts.length}`);

    if (prompts.length === 0) {
      evidence.push('No implementation prompts in repository — Rule 42 not yet applicable');
      return {
        name: this.name,
        status: 'PASS',
        message: 'No implementation prompts to validate',
        evidence,
      };
    }

    for (const { file, content } of prompts) {
      const missing: string[] = [];
      for (const section of REQUIRED_SECTIONS) {
        if (!section.patterns.some((p) => p.test(content))) {
          missing.push(section.name);
        }
      }
      if (missing.length > 0) {
        issues.push(`${file}: missing sections: ${missing.join(', ')}`);
        evidence.push(`${file}: ❌ missing ${missing.length} section(s) — ${missing.join(', ')}`);
      } else {
        evidence.push(`${file}: ✅ all 10 sections present`);
      }
    }

    if (issues.length > 0) {
      return {
        name: this.name,
        status: 'FAIL',
        message: `${issues.length} prompt(s) fail Rule 42 structure check`,
        details: { issues },
        evidence,
      };
    }

    return {
      name: this.name,
      status: 'PASS',
      message: `${prompts.length} prompt(s) verified — all contain 15 mandatory sections`,
      evidence,
    };
  },
};
