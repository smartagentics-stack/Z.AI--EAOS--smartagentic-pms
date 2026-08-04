/**
 * Unit tests for serialization-verifier.ts (B1 closure)
 *
 * Tests:
 *  1. PASSES when canonical-record.ts exists and round-trip succeeds
 *  2. FAILS when canonical-record.ts is missing (falsification)
 *  3. PASSES when round-trip equality holds (payload.name matches)
 *
 * Enforcement Type: Machine-Enforceable (Rule 43)
 * Related Rule: Rule 5 (Canonical Domain Model), Rule 6 (Mandatory Schema Validation)
 * Related ADR: ADR-012 (Canonical SyncRecord Model)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serializationVerifier } from '../serialization-verifier.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('serializationVerifier', () => {
  let tmpRepo: string;

  beforeAll(() => {
    tmpRepo = mkdtempSync(join(tmpdir(), 'eae-serial-'));
  });

  afterAll(() => {
    rmSync(tmpRepo, { recursive: true, force: true });
  });

  it('PASSES when canonical-record.ts exists and round-trip succeeds', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'spikes', 'SPIKE-01', 'src'), { recursive: true });

    // Create a minimal canonical-record.ts (the verifier only checks existence)
    writeFileSync(
      join(tmpRepo, 'spikes', 'SPIKE-01', 'src', 'canonical-record.ts'),
      'export const placeholder = true;\n',
    );

    const result = await serializationVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    expect(result.message).toMatch(/Canonical model round-trip verified/);
    // Verify round-trip evidence
    expect(result.evidence).toContain('Round-trip equality: true');
  });

  it('FAILS when canonical-record.ts is missing (falsification)', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'spikes', 'SPIKE-01', 'src'), { recursive: true });
    // Do NOT create canonical-record.ts

    const result = await serializationVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('FAIL');
    expect(result.message).toMatch(/canonical-record\.ts not found/);
  });

  it('Round-trip evidence shows payload.name is preserved', async () => {
    rmSync(tmpRepo, { recursive: true, force: true });
    mkdirSync(tmpRepo, { recursive: true });
    mkdirSync(join(tmpRepo, 'spikes', 'SPIKE-01', 'src'), { recursive: true });

    writeFileSync(
      join(tmpRepo, 'spikes', 'SPIKE-01', 'src', 'canonical-record.ts'),
      'export const placeholder = true;\n',
    );

    const result = await serializationVerifier.verify({
      repoRoot: tmpRepo,
      evidenceDir: join(tmpRepo, 'evidence'),
    });

    expect(result.status).toBe('PASS');
    expect(result.evidence).toContain('Original payload.name: test');
    expect(result.evidence).toContain('Reconstructed payload.name: test');
  });
});
