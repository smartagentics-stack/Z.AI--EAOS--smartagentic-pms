import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Verifier, VerificationResult, VerificationContext } from '../types/index.js';

export const adrVerifier: Verifier = {
  name: 'adr-compliance',
  description: 'Checks ADR directory structure, numbering, and required sections',

  async verify(ctx: VerificationContext): Promise<VerificationResult> {
    const adrDir = resolve(ctx.repoRoot, 'docs/adr');
    const issues: string[] = [];
    const warnings: string[] = [];
    const evidence: string[] = [];

    if (!existsSync(adrDir)) {
      return { name: this.name, status: 'FAIL', message: 'docs/adr directory does not exist', evidence };
    }

    const files = readdirSync(adrDir).filter(f => f.startsWith('ADR-') && f.endsWith('.md'));
    evidence.push(`ADR files found: ${files.length}`);

    if (files.length === 0) {
      return { name: this.name, status: 'FAIL', message: 'No ADR files found', evidence };
    }

    const numbers: number[] = [];
    for (const file of files) {
      const match = file.match(/^ADR-(\d+)-/);
      if (!match) { issues.push(`Naming: ${file}`); continue; }
      numbers.push(parseInt(match[1], 10));

      const content = readFileSync(join(adrDir, file), 'utf-8');
      // Required: Status and Decision
      if (!content.match(/Status/i)) {
        issues.push(`${file}: missing Status`);
      }
      if (!content.match(/##\s*Decision|\*\*Decision/i)) {
        issues.push(`${file}: missing Decision section`);
      }
      // Optional (WARN): Context
      if (!content.match(/##\s*Context|\*\*Context/i)) {
        warnings.push(`${file}: missing Context section (recommended)`);
      }
    }

    numbers.sort((a, b) => a - b);
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] !== numbers[i - 1] + 1) {
        issues.push(`Gap: ADR-${numbers[i-1]} → ADR-${numbers[i]}`);
      }
    }

    evidence.push(`ADR numbers: ${numbers.join(', ')}`);
    evidence.push(`Warnings: ${warnings.length}`);

    if (issues.length > 0) {
      return { name: this.name, status: 'FAIL', message: `${issues.length} issue(s)`, details: { issues, warnings }, evidence };
    }

    if (warnings.length > 0) {
      return { name: this.name, status: 'WARN', message: `${warnings.length} ADR(s) missing Context section`, details: { warnings }, evidence };
    }

    return { name: this.name, status: 'PASS', message: `${files.length} ADRs verified, all compliant`, evidence };
  },
};
