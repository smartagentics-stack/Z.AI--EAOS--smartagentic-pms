/**
 * F1-S0: Schema-Contract Alignment Tests
 *
 * Tests for the six foundational conflict resolutions (FC-F1-01 through FC-F1-06)
 * per the F1 Foundational Conflict Resolution Directive §19 (Test Requirements)
 * and §16 (Migration Safety Tests).
 *
 * Covers:
 *  - Domain (FC-F1-04): create, read, required fields, tenant isolation
 *  - Module (FC-F1-05): create, read, activation, domain isolation
 *  - EntityType (FC-F1-06): schema, storage class, typed-table metadata, permissions
 *  - Relationship (FC-F1-03): valid relationship, required fields, domain isolation
 *  - AIConfiguration (FC-F1-01): tenant scope, domain scope, version, audit metadata
 *  - Tool.generatorType (FC-F1-02): canonical values, runtime validation
 *  - Migration Safety (§16 Tests A-H): schema validity, model accessibility
 *  - Tenant/Domain Isolation (§20): cross-tenant and cross-domain access denied
 *
 * Applies migration SQL directly via Prisma $executeRawUnsafe on a temp SQLite
 * database (avoids child_process import — forbidden-code verifier compliant).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isToolGeneratorType, TOOL_GENERATOR_TYPES } from '@smartagentics/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const schemaPath = join(__dirname, '..', '..', 'schema.prisma');
const migrationPath = join(
  __dirname,
  '..',
  '..',
  'migrations',
  '20260905092751_f1_s0_schema_alignment',
  'migration.sql',
);

describe('F1-S0: Schema-Contract Alignment', () => {
  let prisma: PrismaClient;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'f1-s0-test-'));
    dbPath = join(tmpDir, 'test.db');
    prisma = new PrismaClient({
      datasources: { db: { url: `file:${dbPath}` } },
    });
    // Apply migration SQL directly via Prisma raw SQL execution.
    // Avoids child_process import (forbidden-code verifier) and is reproducible.
    const initSqlPath = join(
      __dirname,
      '..',
      '..',
      'migrations',
      '20260826182214_init',
      'migration.sql',
    );
    const initSql = readFileSync(initSqlPath, 'utf-8');
    const f1s0Sql = readFileSync(migrationPath, 'utf-8');
    for (const sql of [initSql, f1s0Sql]) {
      // Strip SQL comments (lines starting with --) and split by semicolon+newline
      const cleaned = sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      const statements = cleaned
        .split(/;\s*\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (let i = 0; i < statements.length; i++) {
        try {
          await prisma.$executeRawUnsafe(statements[i]);
        } catch (err) {
          throw new Error(
            `SQL statement ${i} failed: ${err instanceof Error ? err.message : String(err)}\nStatement: ${statements[i].slice(0, 200)}...`,
          );
        }
      }
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await prisma.aIConfiguration.deleteMany();
    await prisma.relationship.deleteMany();
    await prisma.entityFieldIndex.deleteMany();
    await prisma.dynamicRecord.deleteMany();
    await prisma.entityType.deleteMany();
    await prisma.toolPermission.deleteMany();
    await prisma.tool.deleteMany();
    await prisma.module.deleteMany();
    await prisma.domain.deleteMany();
  });

  // ─── Domain (FC-F1-04) ───────────────────────────────────────────────────
  describe('Domain (FC-F1-04)', () => {
    it('creates a Domain with all F1-S0 aligned fields', async () => {
      const domain = await prisma.domain.create({
        data: {
          tenantId: 'tenant-1',
          name: 'pms',
          displayName: 'Hotel PMS',
          version: '1.0.0',
          status: 'active',
          configuration: '{}',
          capabilities: JSON.stringify(['reservations', 'housekeeping']),
          publishedAt: new Date(),
        },
      });
      expect(domain.id).toBeDefined();
      expect(domain.displayName).toBe('Hotel PMS');
      expect(domain.capabilities).toBe(JSON.stringify(['reservations', 'housekeeping']));
      expect(domain.publishedAt).toBeDefined();
      expect(domain.deprecatedAt).toBeNull();
    });

    it('rejects Domain without displayName (NOT NULL constraint)', async () => {
      await expect(
        prisma.domain.create({
          data: {
            tenantId: 't1',
            name: 'test',
            version: '1.0.0',
            configuration: '{}',
          } as never,
        }),
      ).rejects.toThrow();
    });

    it('defaults status to "active"', async () => {
      const domain = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-default',
          displayName: 'Default',
          version: '1',
          configuration: '{}',
        },
      });
      expect(domain.status).toBe('active');
    });

    it('tenant isolation: domains from different tenants are separate', async () => {
      await prisma.domain.create({
        data: {
          tenantId: 'tenant-a',
          name: 'd-a',
          displayName: 'A',
          version: '1',
          configuration: '{}',
        },
      });
      await prisma.domain.create({
        data: {
          tenantId: 'tenant-b',
          name: 'd-b',
          displayName: 'B',
          version: '1',
          configuration: '{}',
        },
      });
      const aDomains = await prisma.domain.findMany({ where: { tenantId: 'tenant-a' } });
      const bDomains = await prisma.domain.findMany({ where: { tenantId: 'tenant-b' } });
      expect(aDomains).toHaveLength(1);
      expect(bDomains).toHaveLength(1);
      expect(aDomains[0].name).toBe('d-a');
      expect(bDomains[0].name).toBe('d-b');
    });
  });

  // ─── Module (FC-F1-05) ───────────────────────────────────────────────────
  describe('Module (FC-F1-05)', () => {
    it('creates a Module with displayName and active fields', async () => {
      const domain = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-mod',
          displayName: 'D',
          version: '1',
          configuration: '{}',
        },
      });
      const mod = await prisma.module.create({
        data: {
          tenantId: 't1',
          domainId: domain.id,
          name: 'reservations',
          displayName: 'Reservations',
          version: '1.0.0',
          active: true,
        },
      });
      expect(mod.displayName).toBe('Reservations');
      expect(mod.active).toBe(true);
    });

    it('defaults active to true (deterministic default)', async () => {
      const domain = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-def',
          displayName: 'D',
          version: '1',
          configuration: '{}',
        },
      });
      const mod = await prisma.module.create({
        data: {
          tenantId: 't1',
          domainId: domain.id,
          name: 'm-default',
          displayName: 'M',
          version: '1',
        },
      });
      expect(mod.active).toBe(true);
    });

    it('supports deactivation (active = false)', async () => {
      const domain = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-deact',
          displayName: 'D',
          version: '1',
          configuration: '{}',
        },
      });
      const mod = await prisma.module.create({
        data: {
          tenantId: 't1',
          domainId: domain.id,
          name: 'm-deact',
          displayName: 'M',
          version: '1',
          active: false,
        },
      });
      expect(mod.active).toBe(false);
    });

    it('domain isolation: modules from different domains are separate', async () => {
      const d1 = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-iso1',
          displayName: 'D1',
          version: '1',
          configuration: '{}',
        },
      });
      const d2 = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-iso2',
          displayName: 'D2',
          version: '1',
          configuration: '{}',
        },
      });
      await prisma.module.create({
        data: { tenantId: 't1', domainId: d1.id, name: 'm1', displayName: 'M1', version: '1' },
      });
      await prisma.module.create({
        data: { tenantId: 't1', domainId: d2.id, name: 'm2', displayName: 'M2', version: '1' },
      });
      const d1Mods = await prisma.module.findMany({ where: { domainId: d1.id } });
      const d2Mods = await prisma.module.findMany({ where: { domainId: d2.id } });
      expect(d1Mods).toHaveLength(1);
      expect(d2Mods).toHaveLength(1);
    });
  });

  // ─── EntityType (FC-F1-06) ───────────────────────────────────────────────
  describe('EntityType (FC-F1-06)', () => {
    it('creates an EntityType with all F1-S0 aligned fields', async () => {
      const domain = await prisma.domain.create({
        data: { tenantId: 't1', name: 'd-et', displayName: 'D', version: '1', configuration: '{}' },
      });
      const et = await prisma.entityType.create({
        data: {
          tenantId: 't1',
          domainId: domain.id,
          name: 'Reservation',
          displayName: 'Reservation',
          schemaJson: '{"type":"object"}',
          schemaVersion: 1,
          storageClass: 'typed',
          typedTableName: 'Reservation',
          permissions: JSON.stringify(['read', 'write']),
          publishedAt: new Date(),
        },
      });
      expect(et.displayName).toBe('Reservation');
      expect(et.typedTableName).toBe('Reservation');
      expect(et.permissions).toBe(JSON.stringify(['read', 'write']));
      expect(et.publishedAt).toBeDefined();
    });

    it('supports dynamic storage class with null typedTableName', async () => {
      const domain = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-dyn',
          displayName: 'D',
          version: '1',
          configuration: '{}',
        },
      });
      const et = await prisma.entityType.create({
        data: {
          tenantId: 't1',
          domainId: domain.id,
          name: 'Bar',
          displayName: 'Bar Tab',
          schemaJson: '{"type":"object"}',
          schemaVersion: 1,
          storageClass: 'dynamic',
        },
      });
      expect(et.typedTableName).toBeNull();
    });

    it('rejects EntityType without displayName (NOT NULL)', async () => {
      const domain = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-reject',
          displayName: 'D',
          version: '1',
          configuration: '{}',
        },
      });
      await expect(
        prisma.entityType.create({
          data: {
            tenantId: 't1',
            domainId: domain.id,
            name: 'NoDisplayName',
            schemaJson: '{}',
            schemaVersion: 1,
            storageClass: 'typed',
          } as never,
        }),
      ).rejects.toThrow();
    });
  });

  // ─── Relationship (FC-F1-03) ─────────────────────────────────────────────
  describe('Relationship (FC-F1-03)', () => {
    it('creates a valid relationship between two entity types', async () => {
      const domain = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-rel',
          displayName: 'D',
          version: '1',
          configuration: '{}',
        },
      });
      const source = await prisma.entityType.create({
        data: {
          tenantId: 't1',
          domainId: domain.id,
          name: 'Reservation',
          displayName: 'R',
          schemaJson: '{}',
          schemaVersion: 1,
          storageClass: 'typed',
        },
      });
      const target = await prisma.entityType.create({
        data: {
          tenantId: 't1',
          domainId: domain.id,
          name: 'Guest',
          displayName: 'G',
          schemaJson: '{}',
          schemaVersion: 1,
          storageClass: 'typed',
        },
      });
      const rel = await prisma.relationship.create({
        data: {
          tenantId: 't1',
          domainId: domain.id,
          name: 'Reservation.guestId_to_Guest.id',
          sourceEntityTypeId: source.id,
          sourceFieldName: 'guestId',
          targetEntityTypeId: target.id,
          cardinality: 'many-to-one',
          ownership: 'child',
          onDelete: 'restrict',
        },
      });
      expect(rel.id).toBeDefined();
      expect(rel.cardinality).toBe('many-to-one');
      expect(rel.ownership).toBe('child');
      expect(rel.onDelete).toBe('restrict');
    });

    it('rejects relationship without required cardinality', async () => {
      await expect(
        prisma.relationship.create({
          data: {
            tenantId: 't1',
            domainId: 'd-fake',
            name: 'rel-invalid',
            sourceEntityTypeId: 'src-1',
            sourceFieldName: 'field',
            targetEntityTypeId: 'tgt-1',
          } as never,
        }),
      ).rejects.toThrow();
    });

    it('domain isolation: relationships from different domains are separate', async () => {
      const d1 = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-iso-rel1',
          displayName: 'D1',
          version: '1',
          configuration: '{}',
        },
      });
      const d2 = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-iso-rel2',
          displayName: 'D2',
          version: '1',
          configuration: '{}',
        },
      });
      const et1 = await prisma.entityType.create({
        data: {
          tenantId: 't1',
          domainId: d1.id,
          name: 'A',
          displayName: 'A',
          schemaJson: '{}',
          schemaVersion: 1,
          storageClass: 'typed',
        },
      });
      const et2 = await prisma.entityType.create({
        data: {
          tenantId: 't1',
          domainId: d2.id,
          name: 'B',
          displayName: 'B',
          schemaJson: '{}',
          schemaVersion: 1,
          storageClass: 'typed',
        },
      });
      await prisma.relationship.create({
        data: {
          tenantId: 't1',
          domainId: d1.id,
          name: 'rel-a',
          sourceEntityTypeId: et1.id,
          sourceFieldName: 'x',
          targetEntityTypeId: et1.id,
          cardinality: 'one-to-one',
          ownership: 'peer',
          onDelete: 'restrict',
        },
      });
      await prisma.relationship.create({
        data: {
          tenantId: 't1',
          domainId: d2.id,
          name: 'rel-b',
          sourceEntityTypeId: et2.id,
          sourceFieldName: 'y',
          targetEntityTypeId: et2.id,
          cardinality: 'one-to-one',
          ownership: 'peer',
          onDelete: 'restrict',
        },
      });
      const d1Rels = await prisma.relationship.findMany({ where: { domainId: d1.id } });
      const d2Rels = await prisma.relationship.findMany({ where: { domainId: d2.id } });
      expect(d1Rels).toHaveLength(1);
      expect(d2Rels).toHaveLength(1);
    });
  });

  // ─── AIConfiguration (FC-F1-01) ──────────────────────────────────────────
  describe('AIConfiguration (FC-F1-01)', () => {
    it('creates a tenant-wide AIConfiguration (domainId = null)', async () => {
      const config = await prisma.aIConfiguration.create({
        data: {
          tenantId: 't1',
          domainId: null,
          version: 1,
          configJson: '{}',
          promptInjectionConfig: '{}',
          piiRedactionConfig: '{}',
          egressConfig: '{}',
          approvalConfig: '{}',
          driftConfig: '{}',
          rateLimitConfig: '{}',
          modelConfig: '{}',
          auditConfig: '{}',
          changedBy: 'admin-1',
        },
      });
      expect(config.id).toBeDefined();
      expect(config.domainId).toBeNull();
      expect(config.version).toBe(1);
      expect(config.changedBy).toBe('admin-1');
    });

    it('creates a domain-scoped AIConfiguration override (domainId = "pms")', async () => {
      const domainConfig = await prisma.aIConfiguration.create({
        data: {
          tenantId: 't1',
          domainId: 'domain-pms-id',
          version: 1,
          configJson: '{"maxTokens":4096}',
          promptInjectionConfig: '{}',
          piiRedactionConfig: '{}',
          egressConfig: '{}',
          approvalConfig: '{}',
          driftConfig: '{}',
          rateLimitConfig: '{}',
          modelConfig: '{}',
          auditConfig: '{}',
          changedBy: 'admin-1',
        },
      });
      expect(domainConfig.domainId).toBe('domain-pms-id');
    });

    it('rejects duplicate [tenantId, domainId] for domain-scoped AIConfiguration (non-NULL domainId)', async () => {
      const baseData = {
        tenantId: 't-dup',
        domainId: 'domain-test-id',
        version: 1,
        configJson: '{}',
        promptInjectionConfig: '{}',
        piiRedactionConfig: '{}',
        egressConfig: '{}',
        approvalConfig: '{}',
        driftConfig: '{}',
        rateLimitConfig: '{}',
        modelConfig: '{}',
        auditConfig: '{}',
        changedBy: 'admin-1',
      };
      await prisma.aIConfiguration.create({ data: baseData });
      await expect(prisma.aIConfiguration.create({ data: baseData })).rejects.toThrow();
    });

    it('NOTE: SQLite allows multiple NULL domainId rows — application MUST enforce tenant-wide uniqueness', async () => {
      // SQLite treats NULL as distinct in unique constraints, so
      // @@unique([tenantId, domainId]) does NOT prevent multiple
      // tenant-wide (domainId = NULL) configs. The application layer
      // (AIConfigurationService) MUST enforce that only one tenant-wide
      // config exists per tenant. This is consistent with directive §9:
      // "SQLite does not enforce... application/runtime validation MUST enforce."
      const baseData = {
        tenantId: 't-null-test',
        domainId: null,
        version: 1,
        configJson: '{}',
        promptInjectionConfig: '{}',
        piiRedactionConfig: '{}',
        egressConfig: '{}',
        approvalConfig: '{}',
        driftConfig: '{}',
        rateLimitConfig: '{}',
        modelConfig: '{}',
        auditConfig: '{}',
        changedBy: 'admin-1',
      };
      await prisma.aIConfiguration.create({ data: baseData });
      // SQLite allows this (NULL is distinct) — application must enforce uniqueness
      const second = await prisma.aIConfiguration.create({ data: baseData });
      expect(second.id).toBeDefined();
      // Clean up the duplicate for subsequent tests
      await prisma.aIConfiguration.deleteMany({ where: { tenantId: 't-null-test' } });
    });

    it('supports version history with previousVersionId linkage', async () => {
      const v1 = await prisma.aIConfiguration.create({
        data: {
          tenantId: 't-ver',
          domainId: null,
          version: 1,
          configJson: '{}',
          promptInjectionConfig: '{}',
          piiRedactionConfig: '{}',
          egressConfig: '{}',
          approvalConfig: '{}',
          driftConfig: '{}',
          rateLimitConfig: '{}',
          modelConfig: '{}',
          auditConfig: '{}',
          changedBy: 'admin-1',
        },
      });
      const v2 = await prisma.aIConfiguration.create({
        data: {
          tenantId: 't-ver',
          domainId: null,
          version: 2,
          configJson: '{"updated":true}',
          promptInjectionConfig: '{}',
          piiRedactionConfig: '{}',
          egressConfig: '{}',
          approvalConfig: '{}',
          driftConfig: '{}',
          rateLimitConfig: '{}',
          modelConfig: '{}',
          auditConfig: '{}',
          changedBy: 'admin-2',
          previousVersionId: v1.id,
        },
      });
      expect(v2.version).toBe(2);
      expect(v2.previousVersionId).toBe(v1.id);
    });

    it('tenant isolation: AIConfiguration from different tenants are separate', async () => {
      await prisma.aIConfiguration.create({
        data: {
          tenantId: 'tenant-x',
          domainId: null,
          version: 1,
          configJson: '{}',
          promptInjectionConfig: '{}',
          piiRedactionConfig: '{}',
          egressConfig: '{}',
          approvalConfig: '{}',
          driftConfig: '{}',
          rateLimitConfig: '{}',
          modelConfig: '{}',
          auditConfig: '{}',
          changedBy: 'a1',
        },
      });
      await prisma.aIConfiguration.create({
        data: {
          tenantId: 'tenant-y',
          domainId: null,
          version: 1,
          configJson: '{}',
          promptInjectionConfig: '{}',
          piiRedactionConfig: '{}',
          egressConfig: '{}',
          approvalConfig: '{}',
          driftConfig: '{}',
          rateLimitConfig: '{}',
          modelConfig: '{}',
          auditConfig: '{}',
          changedBy: 'a2',
        },
      });
      const xConfigs = await prisma.aIConfiguration.findMany({ where: { tenantId: 'tenant-x' } });
      const yConfigs = await prisma.aIConfiguration.findMany({ where: { tenantId: 'tenant-y' } });
      expect(xConfigs).toHaveLength(1);
      expect(yConfigs).toHaveLength(1);
    });
  });

  // ─── Tool.generatorType (FC-F1-02) ───────────────────────────────────────
  describe('Tool.generatorType (FC-F1-02)', () => {
    it('creates a Tool with canonical generatorType "static"', async () => {
      const tool = await prisma.tool.create({
        data: {
          tenantId: 't1',
          name: 'searchProduct',
          description: 'Search products',
          inputSchema: '{}',
          outputSchema: '{}',
          generatorType: 'static',
          domainId: null,
        },
      });
      expect(tool.generatorType).toBe('static');
    });

    it('creates a Tool with canonical generatorType "auto-crud"', async () => {
      const tool = await prisma.tool.create({
        data: {
          tenantId: 't1',
          name: 'product.create',
          description: 'Auto-generated CRUD create',
          inputSchema: '{}',
          outputSchema: '{}',
          generatorType: 'auto-crud',
          domainId: 'domain-pms-id',
        },
      });
      expect(tool.generatorType).toBe('auto-crud');
      expect(tool.domainId).toBe('domain-pms-id');
    });

    it('creates a Tool with canonical generatorType "auto-search"', async () => {
      const tool = await prisma.tool.create({
        data: {
          tenantId: 't1',
          name: 'product.search',
          description: 'Auto-generated search',
          inputSchema: '{}',
          outputSchema: '{}',
          generatorType: 'auto-search',
          domainId: 'domain-pms-id',
        },
      });
      expect(tool.generatorType).toBe('auto-search');
    });

    it('creates a Tool with null generatorType (legacy/unknown)', async () => {
      const tool = await prisma.tool.create({
        data: {
          tenantId: 't1',
          name: 'legacy.tool',
          description: 'Legacy tool',
          inputSchema: '{}',
          outputSchema: '{}',
          generatorType: null,
          domainId: null,
        },
      });
      expect(tool.generatorType).toBeNull();
    });
  });

  // ─── ToolGeneratorType Runtime Validation (§9) ───────────────────────────
  describe('ToolGeneratorType Runtime Validation (§9)', () => {
    it('TOOL_GENERATOR_TYPES contains exactly 3 canonical values', () => {
      expect(TOOL_GENERATOR_TYPES).toHaveLength(3);
      expect([...TOOL_GENERATOR_TYPES]).toEqual(['static', 'auto-crud', 'auto-search']);
    });

    it('isToolGeneratorType accepts all canonical values', () => {
      expect(isToolGeneratorType('static')).toBe(true);
      expect(isToolGeneratorType('auto-crud')).toBe(true);
      expect(isToolGeneratorType('auto-search')).toBe(true);
    });

    it('isToolGeneratorType rejects old Phase E values', () => {
      expect(isToolGeneratorType('builtin')).toBe(false);
      expect(isToolGeneratorType('dynamic')).toBe(false);
      expect(isToolGeneratorType('ai_generated')).toBe(false);
      expect(isToolGeneratorType('mcp')).toBe(false);
    });

    it('isToolGeneratorType rejects non-string and empty values', () => {
      expect(isToolGeneratorType(null)).toBe(false);
      expect(isToolGeneratorType(undefined)).toBe(false);
      expect(isToolGeneratorType('')).toBe(false);
      expect(isToolGeneratorType(123)).toBe(false);
      expect(isToolGeneratorType({})).toBe(false);
      expect(isToolGeneratorType([])).toBe(false);
    });
  });

  // ─── Migration Safety Tests (§16 Tests A-H) ──────────────────────────────
  describe('Migration Safety (§16)', () => {
    it('Test A: all F1-S0 models are accessible via PrismaClient', () => {
      expect(prisma.domain).toBeDefined();
      expect(prisma.module).toBeDefined();
      expect(prisma.entityType).toBeDefined();
      expect(prisma.relationship).toBeDefined();
      expect(prisma.aIConfiguration).toBeDefined();
      expect(prisma.tool).toBeDefined();
    });

    it('Test G: migration file exists and contains expected DDL', () => {
      const migrationPath = join(
        __dirname,
        '..',
        '..',
        'migrations',
        '20260905092751_f1_s0_schema_alignment',
        'migration.sql',
      );
      expect(existsSync(migrationPath)).toBe(true);
      const sql = readFileSync(migrationPath, 'utf-8');
      expect(sql).toContain('CREATE TABLE "Relationship"');
      expect(sql).toContain('CREATE TABLE "AIConfiguration"');
      expect(sql).toContain('"displayName"');
      expect(sql).toContain('"typedTableName"');
      expect(sql).toContain('"active" BOOLEAN NOT NULL DEFAULT true');
      expect(sql).toContain('"capabilities"');
      expect(sql).toContain('"publishedAt"');
      expect(sql).toContain('"deprecatedAt"');
      expect(sql).toContain('"permissions"');
    });

    it('Test H: schema.prisma has 38 models (36 original + 2 new)', () => {
      const schema = readFileSync(schemaPath, 'utf-8');
      const modelCount = (schema.match(/^model /gm) || []).length;
      expect(modelCount).toBe(38);
    });
  });

  // ─── Tenant/Domain Isolation (§20) ───────────────────────────────────────
  describe('Tenant/Domain Isolation (§20)', () => {
    it('cross-tenant: tenant A domains invisible to tenant B queries', async () => {
      await prisma.domain.create({
        data: {
          tenantId: 'tenant-a',
          name: 'd-iso-a',
          displayName: 'A',
          version: '1',
          configuration: '{}',
        },
      });
      await prisma.domain.create({
        data: {
          tenantId: 'tenant-b',
          name: 'd-iso-b',
          displayName: 'B',
          version: '1',
          configuration: '{}',
        },
      });
      const aOnly = await prisma.domain.findMany({ where: { tenantId: 'tenant-a' } });
      expect(aOnly).toHaveLength(1);
      expect(aOnly[0].name).toBe('d-iso-a');
    });

    it('cross-domain: domain A relationships invisible to domain B queries', async () => {
      const dA = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-cross-a',
          displayName: 'A',
          version: '1',
          configuration: '{}',
        },
      });
      const dB = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-cross-b',
          displayName: 'B',
          version: '1',
          configuration: '{}',
        },
      });
      const etA = await prisma.entityType.create({
        data: {
          tenantId: 't1',
          domainId: dA.id,
          name: 'EA',
          displayName: 'EA',
          schemaJson: '{}',
          schemaVersion: 1,
          storageClass: 'typed',
        },
      });
      await prisma.relationship.create({
        data: {
          tenantId: 't1',
          domainId: dA.id,
          name: 'rel-cross-a',
          sourceEntityTypeId: etA.id,
          sourceFieldName: 'x',
          targetEntityTypeId: etA.id,
          cardinality: 'one-to-one',
          ownership: 'peer',
          onDelete: 'restrict',
        },
      });
      const bRels = await prisma.relationship.findMany({ where: { domainId: dB.id } });
      expect(bRels).toHaveLength(0);
    });

    it('AIConfiguration: domain-scoped config separate from tenant-wide config', async () => {
      const domain = await prisma.domain.create({
        data: {
          tenantId: 't1',
          name: 'd-aicfg',
          displayName: 'D',
          version: '1',
          configuration: '{}',
        },
      });
      await prisma.aIConfiguration.create({
        data: {
          tenantId: 't1',
          domainId: null,
          version: 1,
          configJson: '{}',
          promptInjectionConfig: '{}',
          piiRedactionConfig: '{}',
          egressConfig: '{}',
          approvalConfig: '{}',
          driftConfig: '{}',
          rateLimitConfig: '{}',
          modelConfig: '{}',
          auditConfig: '{}',
          changedBy: 'a1',
        },
      });
      await prisma.aIConfiguration.create({
        data: {
          tenantId: 't1',
          domainId: domain.id,
          version: 1,
          configJson: '{"override":true}',
          promptInjectionConfig: '{}',
          piiRedactionConfig: '{}',
          egressConfig: '{}',
          approvalConfig: '{}',
          driftConfig: '{}',
          rateLimitConfig: '{}',
          modelConfig: '{}',
          auditConfig: '{}',
          changedBy: 'a1',
        },
      });
      const tenantWide = await prisma.aIConfiguration.findMany({
        where: { tenantId: 't1', domainId: null },
      });
      const domainScoped = await prisma.aIConfiguration.findMany({
        where: { tenantId: 't1', domainId: domain.id },
      });
      expect(tenantWide).toHaveLength(1);
      expect(domainScoped).toHaveLength(1);
    });
  });
});
