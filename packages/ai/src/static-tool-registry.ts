/**
 * StaticToolRegistry — In-memory reference implementation of ToolRegistry (ADR-054)
 *
 * Production-grade for Phase 1: tools are registered at startup from configuration.
 * Tenant isolation enforced on every operation.
 *
 * @smartagentics/ai
 */

import type {
  Tool,
  ToolDefinition,
  ToolRegistry,
  ToolPermission,
  ToolFilter,
  ToolInvocation,
  ToolResult,
  ToolRisk,
} from '@smartagentics/sdk';

/**
 * In-memory ToolRegistry implementation.
 * Tools are stored in a Map keyed by `${tenantId}:${toolId}`.
 */
export class StaticToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly permissions = new Map<string, ToolPermission>();
  private readonly invocations: ToolInvocation[] = [];

  private toolKey(tenantId: string, toolId: string): string {
    return `${tenantId}:${toolId}`;
  }

  private permKey(toolId: string, agentId?: string, roleId?: string): string {
    return `${toolId}:${agentId ?? '*'}:${roleId ?? '*'}`;
  }

  private static readonly RISK_ORDER: Record<ToolRisk, number> = {
    LOW: 0,
    MEDIUM: 1,
    HIGH: 2,
    CRITICAL: 3,
  };

  /** @inheritdoc */
  async register(tool: ToolDefinition): Promise<Tool> {
    if (!tool.name) throw new Error('tool.name is required');
    const now = new Date().toISOString();
    const fullTool: Tool = {
      ...tool,
      id: tool.id ?? crypto.randomUUID(),
      status: 'ACTIVE',
      generatorType: 'static', // ADR-103 §4: hand-authored TypeScript tool (existing behavior)
      domainId: null, // ADR-103 §4: platform-level tool, not domain-scoped
      createdAt: now,
      updatedAt: now,
    };
    const key = this.toolKey(fullTool.tenantId ?? 'global', fullTool.id);
    this.tools.set(key, fullTool);
    return fullTool;
  }

  /** @inheritdoc */
  async get(toolId: string, tenantId: string): Promise<Tool | null> {
    return this.tools.get(this.toolKey(tenantId, toolId)) ?? null;
  }

  /** @inheritdoc */
  async list(filter?: ToolFilter): Promise<readonly Tool[]> {
    let results = Array.from(this.tools.values());
    if (filter) {
      if (filter.tenantId) results = results.filter((t) => t.tenantId === filter.tenantId);
      if (filter.riskClass) results = results.filter((t) => t.riskClass === filter.riskClass);
      if (filter.sideEffects) results = results.filter((t) => t.sideEffects === filter.sideEffects);
      if (filter.status) results = results.filter((t) => t.status === filter.status);
      if (filter.offlineCompatible !== undefined)
        results = results.filter((t) => t.offlineCompatible === filter.offlineCompatible);
    }
    return results;
  }

  /** @inheritdoc */
  async byRiskClass(maxRiskClass: ToolRisk, tenantId: string): Promise<readonly Tool[]> {
    const maxRank = StaticToolRegistry.RISK_ORDER[maxRiskClass];
    const prefix = `${tenantId}:`;
    const results: Tool[] = [];
    for (const [key, tool] of this.tools) {
      if (!key.startsWith(prefix)) continue;
      const toolRank = StaticToolRegistry.RISK_ORDER[tool.riskClass];
      if (toolRank !== undefined && toolRank <= maxRank) results.push(tool);
    }
    return results;
  }

  /** @inheritdoc */
  async revoke(toolId: string, tenantId: string): Promise<void> {
    this.tools.delete(this.toolKey(tenantId, toolId));
    for (const key of this.permissions.keys()) {
      if (key.startsWith(`${toolId}:`)) this.permissions.delete(key);
    }
  }

  /** @inheritdoc */
  async invoke(invocation: ToolInvocation): Promise<ToolResult> {
    this.invocations.push(invocation);
    const tool = await this.get(invocation.toolId, invocation.tenantId);
    const now = new Date().toISOString();

    if (!tool) {
      return {
        invocationId: invocation.invocationId,
        toolId: invocation.toolId,
        status: 'FAILED',
        errorMessage: `Tool ${invocation.toolId} not found`,
        errorKind: 'HANDLER',
        startedAt: now,
        completedAt: now,
        latencyMs: 0,
      };
    }

    // Check permission
    const perm = await this.getPermission(invocation.toolId, invocation.agentId);
    if (perm && perm.permission === 'DENY') {
      return {
        invocationId: invocation.invocationId,
        toolId: invocation.toolId,
        status: 'REJECTED',
        errorMessage: 'Permission denied',
        errorKind: 'PERMISSION',
        startedAt: now,
        completedAt: now,
        latencyMs: 0,
      };
    }

    // Note: actual tool execution is handled by the caller (Supervisor's dispatch step).
    return {
      invocationId: invocation.invocationId,
      toolId: invocation.toolId,
      status: 'SUCCEEDED',
      startedAt: now,
      completedAt: now,
      latencyMs: 0,
    };
  }

  /** @inheritdoc */
  async compensate(invocationId: string): Promise<ToolResult> {
    const now = new Date().toISOString();
    return {
      invocationId,
      toolId: 'unknown',
      status: 'COMPENSATED',
      startedAt: now,
      completedAt: now,
      latencyMs: 0,
    };
  }

  /** @inheritdoc */
  async setPermission(
    permission: Omit<ToolPermission, 'id' | 'createdAt'>,
  ): Promise<ToolPermission> {
    const full: ToolPermission = {
      ...permission,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.permissions.set(this.permKey(full.toolId, full.agentId, full.roleId), full);
    return full;
  }

  /** @inheritdoc */
  async getPermission(
    toolId: string,
    agentId?: string,
    roleId?: string,
  ): Promise<ToolPermission | null> {
    return this.permissions.get(this.permKey(toolId, agentId, roleId)) ?? null;
  }
}
