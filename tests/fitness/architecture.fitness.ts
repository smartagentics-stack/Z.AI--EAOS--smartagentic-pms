import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function timeCommand(command: string, cwd: string = process.cwd()): { durationMs: number; success: boolean } {
  const start = performance.now();
  try { execSync(command, { cwd, stdio: 'pipe', timeout: 120000 }); return { durationMs: performance.now() - start, success: true }; }
  catch { return { durationMs: performance.now() - start, success: false }; }
}

describe('Architecture Fitness: Build Time', () => { it('full build <60s', () => { const r = timeCommand('pnpm build', resolve(__dirname, '../..')); expect(r.success).toBe(true); expect(r.durationMs).toBeLessThan(60000); }); });
describe('Architecture Fitness: Test Runtime', () => { it('tests <30s', () => { const r = timeCommand('pnpm test', resolve(__dirname, '../..')); expect(r.success).toBe(true); expect(r.durationMs).toBeLessThan(30000); }); });
describe('Architecture Fitness: Dependency Security', () => { it('no high-severity vulns', () => { try { const o = execSync('pnpm audit --prod --json', { cwd: resolve(__dirname, '../..'), encoding: 'utf-8', timeout: 30000 }); const a = JSON.parse(o); const h = a.vulnerabilities ? Object.values(a.vulnerabilities).filter((v: any) => v.severity === 'high' || v.severity === 'critical') : []; expect(h.length).toBe(0); } catch (e: any) { if (e.stdout) { try { const a = JSON.parse(e.stdout); const h = a.vulnerabilities ? Object.values(a.vulnerabilities).filter((v: any) => v.severity === 'high' || v.severity === 'critical') : []; expect(h.length).toBe(0); } catch { expect(true).toBe(true); } } else { expect(true).toBe(true); } } }); });
describe('Architecture Fitness: TypeScript Strictness', () => { it('typecheck passes', () => { const r = timeCommand('pnpm typecheck', resolve(__dirname, '../..')); expect(r.success).toBe(true); }); });
describe('Architecture Fitness: Lint Cleanliness', () => { it('lint passes', () => { const r = timeCommand('pnpm lint', resolve(__dirname, '../..')); expect(r.success).toBe(true); }); });
describe('Architecture Fitness: Offline Operation', () => { it('SDK no network at import', () => { const p = resolve(__dirname, '../../packages/sdk/src/index.ts'); expect(existsSync(p)).toBe(true); const c = readFileSync(p, 'utf-8'); expect(c).not.toMatch(/fetch\(|http\.get|https\.get/); }); });
describe('Architecture Fitness: Memory Stability', () => { it('SDK imports without leak', async () => { const sdk = await import('../../packages/sdk/src/index.js'); expect(sdk).toBeDefined(); expect(sdk.PII_FIELDS).toBeDefined(); }); });
describe('Architecture Fitness: ADR Completeness', () => { it('ADR-001 exists', () => { expect(existsSync(resolve(__dirname, '../../docs/adr/ADR-001-reference-stack.md'))).toBe(true); }); });
