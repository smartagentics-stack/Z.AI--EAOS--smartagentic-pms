// ADR-054 Tool Registry & Tool Calling — Vercel AI SDK tool() + zod + toolApproval.
// Wire format: OpenAI function-calling JSON Schema (supported by Ollama, vLLM, llama-server, TGI, all cloud providers).
// User Permissions ≠ Agent Permissions ≠ Tool Permissions (B4 #19) — three distinct permission axes.

/** Risk class ceiling for a tool — drives the buildToolset intersection in the Supervisor (ADR-050). */
export type ToolRisk = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Side-effect classification — drives compensation/saga decisions (ADR-057). */
export type ToolSideEffects = 'NONE' | 'READ' | 'WRITE' | 'IRREVERSIBLE';

/** Audit granularity for tool invocations. */
export type ToolAuditLevel = 'OFF' | 'SUMMARY' | 'FULL';

/** Tool lifecycle status. */
export type ToolStatus = 'DRAFT' | 'ACTIVE' | 'DEPRECATED' | 'RETIRED';

/** Permission grant per B4 #19 (one row per (toolId, agentId|roleId) pair). */
export type ToolPermissionGrant = 'ALLOW' | 'DENY' | 'ALLOW_WITH_APPROVAL';

/**
 * Tool generator type per ADR-103 §4 (FC-F1-02 resolution).
 * - 'static' = handlerModule/handlerFunction point to TypeScript (existing behavior)
 * - 'auto-crud' = GenericEntityTool handler parameterized by (entityTypeId, operation)
 * - 'auto-search' = GenericEntityTool handler parameterized by (entityTypeId, 'search')
 * Runtime validation enforces these canonical values because SQLite does not
 * enforce Prisma enum correctness at the database level (directive §9).
 */
export type ToolGeneratorType = 'static' | 'auto-crud' | 'auto-search';

/** Canonical generator type values for runtime validation (directive §9). */
export const TOOL_GENERATOR_TYPES = ['static', 'auto-crud', 'auto-search'] as const;

/** Runtime type guard for ToolGeneratorType — enforces canonical values (directive §9). */
export function isToolGeneratorType(value: unknown): value is ToolGeneratorType {
  return typeof value === 'string' && (TOOL_GENERATOR_TYPES as readonly string[]).includes(value);
}

/** JSON-Schema-shaped input/output descriptor (zod-compatible). */
export type ToolSchema = Readonly<Record<string, unknown>>;

/** Definition used to register a tool into the registry. */
export interface ToolDefinition {
  readonly id?: string;
  readonly tenantId?: string | null;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolSchema;
  readonly outputSchema: ToolSchema;
  readonly handlerModule: string;
  readonly handlerFunction: string;
  readonly riskClass: ToolRisk;
  readonly requiredRoles: readonly string[];
  readonly requiredAgentPermissions: readonly string[];
  readonly sideEffects: ToolSideEffects;
  readonly auditLevel: ToolAuditLevel;
  readonly offlineCompatible: boolean;
  readonly compensationToolId?: string;
  readonly version: string;
}

/** Persisted Tool entity per ADR-054 §4 + ADR-103 §4 (FC-F1-02 / ADD-10 resolution). */
export interface Tool extends ToolDefinition {
  readonly id: string;
  readonly status: ToolStatus;
  readonly generatorType: ToolGeneratorType | null; // ADR-103 §4: 'static' | 'auto-crud' | 'auto-search' | null
  readonly domainId: string | null; // ADR-103 §4: null = platform tool; non-null = domain-scoped
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** ToolPermission entity per B4 #19. */
export interface ToolPermission {
  readonly id: string;
  readonly toolId: string;
  readonly agentId?: string;
  readonly roleId?: string;
  readonly permission: ToolPermissionGrant;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly createdBy: string;
}

/** An invocation request — produced by the Vercel AI SDK tool() helper and routed through the Supervisor. */
export interface ToolInvocation {
  readonly invocationId: string;
  readonly toolId: string;
  readonly tenantId: string;
  readonly propertyId?: string;
  readonly agentId?: string;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
}

/** Result of executing a tool. */
export interface ToolResult {
  readonly invocationId: string;
  readonly toolId: string;
  readonly status: 'SUCCEEDED' | 'FAILED' | 'REJECTED' | 'COMPENSATED';
  readonly output?: Readonly<Record<string, unknown>>;
  readonly errorMessage?: string;
  readonly errorKind?: 'SCHEMA' | 'PERMISSION' | 'HANDLER' | 'TIMEOUT' | 'OFFLINE';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly latencyMs: number;
  readonly auditEventId?: string;
}

/** Filter for ToolRegistry.list(). */
export interface ToolFilter {
  readonly tenantId?: string;
  readonly riskClass?: ToolRisk;
  readonly sideEffects?: ToolSideEffects;
  readonly status?: ToolStatus;
  readonly offlineCompatible?: boolean;
}

/**
 * ToolRegistry contract per ADR-054 §4. The Supervisor's buildToolset step intersects
 * AgentContract.allowedTools with ToolRegistry.byRiskClass(agent.maxRiskClass).
 */
export interface ToolRegistry {
  register(tool: ToolDefinition): Promise<Tool>;
  get(toolId: string, tenantId: string): Promise<Tool | null>;
  list(filter?: ToolFilter): Promise<readonly Tool[]>;
  byRiskClass(maxRiskClass: ToolRisk, tenantId: string): Promise<readonly Tool[]>;
  revoke(toolId: string, tenantId: string): Promise<void>;
  invoke(invocation: ToolInvocation): Promise<ToolResult>;
  compensate(invocationId: string): Promise<ToolResult>;
  setPermission(permission: Omit<ToolPermission, 'id' | 'createdAt'>): Promise<ToolPermission>;
  getPermission(toolId: string, agentId?: string, roleId?: string): Promise<ToolPermission | null>;
}
