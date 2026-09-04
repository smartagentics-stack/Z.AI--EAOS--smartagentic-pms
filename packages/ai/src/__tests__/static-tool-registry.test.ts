/**
 * Integration tests for StaticToolRegistry (ADR-054 in-memory ToolRegistry).
 *
 * Covers register, get (+ tenant isolation), list, byRiskClass, revoke,
 * invoke (SUCCEEDED / REJECTED / FAILED), and permission CRUD
 * (setPermission / getPermission).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StaticToolRegistry } from '../static-tool-registry.js';
import type { ToolRegistry, ToolDefinition, ToolInvocation, ToolRisk } from '@smartagentics/sdk';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

/** Builds a ToolDefinition. */
function makeToolDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'search-guests',
    description: 'Search the guest directory',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    handlerModule: '@smartagentics/pms-tools',
    handlerFunction: 'searchGuests',
    riskClass: 'LOW',
    requiredRoles: ['agent'],
    requiredAgentPermissions: ['read:guests'],
    sideEffects: 'READ',
    auditLevel: 'SUMMARY',
    offlineCompatible: true,
    version: '1.0.0',
    ...overrides,
  };
}

/** Builds a ToolInvocation. */
function makeInvocation(
  toolId: string,
  tenantId: string,
  overrides: Partial<ToolInvocation> = {},
): ToolInvocation {
  return {
    invocationId: 'inv-1',
    toolId,
    tenantId,
    input: {},
    idempotencyKey: 'idem-1',
    ...overrides,
  };
}

describe('StaticToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new StaticToolRegistry();
  });

  describe('register', () => {
    it('stores a tool and returns a Tool with id, status, and timestamps', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      expect(tool.id).toEqual(expect.any(String));
      expect(tool.status).toBe('ACTIVE');
      expect(tool.createdAt).toEqual(expect.any(String));
      expect(tool.updatedAt).toEqual(expect.any(String));
      expect(tool.name).toBe('search-guests');
    });

    it('preserves a caller-supplied id', async () => {
      const tool = await registry.register(makeToolDef({ id: 'custom-id', tenantId: TENANT_A }));
      expect(tool.id).toBe('custom-id');
    });

    it('throws when tool.name is missing', async () => {
      await expect(
        registry.register(makeToolDef({ name: '', tenantId: TENANT_A })),
      ).rejects.toThrow(/tool\.name is required/);
    });

    it('defaults tenantId to "global" when not supplied', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: undefined }));
      const fetched = await registry.get(tool.id, 'global');
      expect(fetched).not.toBeNull();
    });
  });

  describe('get', () => {
    it('retrieves a tool by (toolId, tenantId)', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      const fetched = await registry.get(tool.id, TENANT_A);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(tool.id);
    });

    it('returns null for a wrong tenantId (tenant isolation)', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      const fetched = await registry.get(tool.id, TENANT_B);
      expect(fetched).toBeNull();
    });

    it('returns null for an unknown toolId', async () => {
      const fetched = await registry.get('does-not-exist', TENANT_A);
      expect(fetched).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all registered tools when no filter is supplied', async () => {
      await registry.register(makeToolDef({ name: 'a', tenantId: TENANT_A }));
      await registry.register(makeToolDef({ name: 'b', tenantId: TENANT_A }));
      const all = await registry.list();
      expect(all).toHaveLength(2);
    });

    it('filters by tenantId', async () => {
      await registry.register(makeToolDef({ name: 'a', tenantId: TENANT_A }));
      await registry.register(makeToolDef({ name: 'b', tenantId: TENANT_B }));
      const aTools = await registry.list({ tenantId: TENANT_A });
      expect(aTools).toHaveLength(1);
      expect(aTools[0].name).toBe('a');
    });

    it('filters by riskClass', async () => {
      await registry.register(makeToolDef({ name: 'low', riskClass: 'LOW', tenantId: TENANT_A }));
      await registry.register(makeToolDef({ name: 'high', riskClass: 'HIGH', tenantId: TENANT_A }));
      const high = await registry.list({ riskClass: 'HIGH' });
      expect(high).toHaveLength(1);
      expect(high[0].name).toBe('high');
    });

    it('filters by status', async () => {
      await registry.register(makeToolDef({ name: 'a', tenantId: TENANT_A }));
      const active = await registry.list({ status: 'ACTIVE' });
      expect(active).toHaveLength(1);
    });

    it('filters by offlineCompatible', async () => {
      await registry.register(
        makeToolDef({ name: 'online', offlineCompatible: false, tenantId: TENANT_A }),
      );
      await registry.register(
        makeToolDef({ name: 'offline', offlineCompatible: true, tenantId: TENANT_A }),
      );
      const offline = await registry.list({ offlineCompatible: true });
      expect(offline).toHaveLength(1);
      expect(offline[0].name).toBe('offline');
    });
  });

  describe('byRiskClass', () => {
    it('returns tools whose riskClass is <= maxRiskClass', async () => {
      await registry.register(makeToolDef({ name: 'low', riskClass: 'LOW', tenantId: TENANT_A }));
      await registry.register(
        makeToolDef({ name: 'med', riskClass: 'MEDIUM', tenantId: TENANT_A }),
      );
      await registry.register(
        makeToolDef({ name: 'crit', riskClass: 'CRITICAL', tenantId: TENANT_A }),
      );
      const allowed: ToolRisk = 'MEDIUM';
      const tools = await registry.byRiskClass(allowed, TENANT_A);
      expect(tools.map((t) => t.name).sort()).toEqual(['low', 'med']);
    });

    it('is scoped to the requesting tenant (tenant isolation)', async () => {
      await registry.register(makeToolDef({ name: 'a', riskClass: 'LOW', tenantId: TENANT_A }));
      await registry.register(makeToolDef({ name: 'b', riskClass: 'LOW', tenantId: TENANT_B }));
      const tools = await registry.byRiskClass('LOW', TENANT_A);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('a');
    });

    it('returns an empty array when no tools qualify', async () => {
      await registry.register(
        makeToolDef({ name: 'crit', riskClass: 'CRITICAL', tenantId: TENANT_A }),
      );
      const tools = await registry.byRiskClass('LOW', TENANT_A);
      expect(tools).toEqual([]);
    });
  });

  describe('revoke', () => {
    it('removes a tool from the registry', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      await registry.revoke(tool.id, TENANT_A);
      const fetched = await registry.get(tool.id, TENANT_A);
      expect(fetched).toBeNull();
    });

    it('also removes associated permissions', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      await registry.setPermission({
        toolId: tool.id,
        agentId: 'agent-1',
        permission: 'ALLOW',
        conditions: {},
        createdBy: 'admin',
      });
      await registry.revoke(tool.id, TENANT_A);
      const perm = await registry.getPermission(tool.id, 'agent-1');
      expect(perm).toBeNull();
    });

    it('is a no-op for an unknown toolId (does not throw)', async () => {
      await expect(registry.revoke('unknown', TENANT_A)).resolves.toBeUndefined();
    });
  });

  describe('invoke', () => {
    it('returns SUCCEEDED when the tool exists and no DENY permission is set', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      const result = await registry.invoke(makeInvocation(tool.id, TENANT_A));
      expect(result.status).toBe('SUCCEEDED');
      expect(result.toolId).toBe(tool.id);
    });

    it('returns SUCCEEDED when an explicit ALLOW permission is set', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      await registry.setPermission({
        toolId: tool.id,
        agentId: 'agent-1',
        permission: 'ALLOW',
        conditions: {},
        createdBy: 'admin',
      });
      const result = await registry.invoke(
        makeInvocation(tool.id, TENANT_A, { agentId: 'agent-1' }),
      );
      expect(result.status).toBe('SUCCEEDED');
    });

    it('returns REJECTED when a DENY permission is set for the agent', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      await registry.setPermission({
        toolId: tool.id,
        agentId: 'agent-1',
        permission: 'DENY',
        conditions: {},
        createdBy: 'admin',
      });
      const result = await registry.invoke(
        makeInvocation(tool.id, TENANT_A, { agentId: 'agent-1' }),
      );
      expect(result.status).toBe('REJECTED');
      expect(result.errorKind).toBe('PERMISSION');
    });

    it('returns FAILED when the tool is not found', async () => {
      const result = await registry.invoke(makeInvocation('unknown-tool', TENANT_A));
      expect(result.status).toBe('FAILED');
      expect(result.errorKind).toBe('HANDLER');
    });

    it('returns FAILED when the tool exists in a different tenant (tenant isolation)', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      const result = await registry.invoke(makeInvocation(tool.id, TENANT_B));
      expect(result.status).toBe('FAILED');
    });

    it('stamps startedAt, completedAt, and latencyMs on every result', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      const result = await registry.invoke(makeInvocation(tool.id, TENANT_A));
      expect(result.startedAt).toEqual(expect.any(String));
      expect(result.completedAt).toEqual(expect.any(String));
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('compensate', () => {
    it('returns a COMPENSATED result for the given invocationId', async () => {
      const result = await registry.compensate('inv-1');
      expect(result.status).toBe('COMPENSATED');
      expect(result.invocationId).toBe('inv-1');
    });
  });

  describe('permission CRUD (setPermission / getPermission)', () => {
    it('stores and retrieves a permission by (toolId, agentId)', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      const perm = await registry.setPermission({
        toolId: tool.id,
        agentId: 'agent-1',
        permission: 'ALLOW',
        conditions: { after: '2024-01-01' },
        createdBy: 'admin',
      });
      expect(perm.id).toEqual(expect.any(String));
      expect(perm.createdAt).toEqual(expect.any(String));
      expect(perm.permission).toBe('ALLOW');

      const fetched = await registry.getPermission(tool.id, 'agent-1');
      expect(fetched).not.toBeNull();
      expect(fetched!.permission).toBe('ALLOW');
      expect(fetched!.conditions).toEqual({ after: '2024-01-01' });
    });

    it('returns null when no permission is set for the (toolId, agentId) pair', async () => {
      const fetched = await registry.getPermission('unknown-tool', 'agent-1');
      expect(fetched).toBeNull();
    });

    it('overwrites a permission when set twice for the same key', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      await registry.setPermission({
        toolId: tool.id,
        agentId: 'agent-1',
        permission: 'ALLOW',
        conditions: {},
        createdBy: 'admin',
      });
      await registry.setPermission({
        toolId: tool.id,
        agentId: 'agent-1',
        permission: 'DENY',
        conditions: {},
        createdBy: 'admin',
      });
      const fetched = await registry.getPermission(tool.id, 'agent-1');
      expect(fetched!.permission).toBe('DENY');
    });

    it('keys permissions by roleId when agentId is absent', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      await registry.setPermission({
        toolId: tool.id,
        roleId: 'supervisor',
        permission: 'ALLOW_WITH_APPROVAL',
        conditions: {},
        createdBy: 'admin',
      });
      const fetched = await registry.getPermission(tool.id, undefined, 'supervisor');
      expect(fetched).not.toBeNull();
      expect(fetched!.permission).toBe('ALLOW_WITH_APPROVAL');
    });
  });

  describe('full register → invoke → revoke lifecycle', () => {
    it('register, invoke (SUCCEEDED), revoke, invoke (FAILED)', async () => {
      const tool = await registry.register(makeToolDef({ tenantId: TENANT_A }));
      const ok = await registry.invoke(makeInvocation(tool.id, TENANT_A));
      expect(ok.status).toBe('SUCCEEDED');
      await registry.revoke(tool.id, TENANT_A);
      const after = await registry.invoke(makeInvocation(tool.id, TENANT_A));
      expect(after.status).toBe('FAILED');
    });
  });
});
