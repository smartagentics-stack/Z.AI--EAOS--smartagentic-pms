/**
 * Fine-Grained Authorization SDK interfaces (ADR-099).
 *
 * Defines the four-layer authorization contract:
 *   Layer 1 — OpenFGA relationships (ReBAC, `domain → module → entity_type → record`)
 *   Layer 2 — Cedar policies (ABAC: time-of-day, amount thresholds, multi-control)
 *   Layer 3 — signed-JWT agent identity (ADR-055; `agentId` claim resolved by OpenFGA)
 *   Layer 4 — 5-way permission intersection (extends ADR-088's 4-way)
 *
 * The 5-way intersection = `agentCaps ∩ userPerms ∩ toolRoles ∩ delegationNarrowing ∩ openfgaRelationships`.
 * This closes the OWASP ASI03 gap left by ADR-088 (user has role but no record relationship).
 *
 * This file contains TYPE DEFINITIONS ONLY — no implementation logic.
 */

/** Authorization action verbs (CRUD + lifecycle). */
export type AuthorizationAction =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'archive'
  | 'restore'
  | 'approve'
  | 'reject'
  | 'export'
  | 'import'
  | 'execute'
  | 'delegate';

/** OpenFGA relation names for the domain-neutral hierarchy. */
export type OpenFGARelation =
  | 'member'
  | 'parent'
  | 'module'
  | 'entity_type'
  | 'record'
  | 'field'
  | 'owner'
  | 'creator'
  | 'viewer'
  | 'editor'
  | 'approver'
  | 'delegated';

/** OpenFGA object kind (the left of the colon in `domain:pms`). */
export type OpenFGAObjectKind =
  'domain' | 'module' | 'entity_type' | 'record' | 'field' | 'tenant' | 'user' | 'agent';

/** An OpenFGA object reference (e.g. `domain:pms`, `record:RES-2026-001`). */
export interface OpenFGAObject {
  readonly kind: OpenFGAObjectKind;
  readonly id: string;
  toString(): string;
}

/** A principal (user or agent) in OpenFGA tuple form. */
export type OpenFGAPrincipal =
  | { readonly kind: 'user'; readonly id: string }
  | { readonly kind: 'agent'; readonly id: string }
  | { readonly kind: 'delegated'; readonly id: string; readonly scope: string };

/**
 * RelationshipTuple — an OpenFGA-style `(user, relation, object)` tuple.
 * E.g. `(user:alice, viewer, record:RES-2026-001)`.
 */
export interface RelationshipTuple {
  readonly user: OpenFGAPrincipal;
  readonly relation: OpenFGARelation;
  readonly object: OpenFGAObject;
  readonly conditions?: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
  readonly expiresAt?: string | null;
}

/** Cedar policy effect (allow / deny / forbid). */
export type CedarEffect = 'permit' | 'forbid';

/** Cedar policy kind (a Cedar policy has an effect + conditions + scope). */
export type CedarPolicyKind =
  'abac' | 'rbac' | 'multi-control' | 'time-window' | 'amount-threshold';

/**
 * CedarPolicy — an attribute-based policy in Cedar (already adopted per
 * ADR-083 T3 / ADR-095 §6). Layered ON TOP of OpenFGA relationship checks
 * (Layer 2 over Layer 1).
 */
export interface CedarPolicy {
  readonly id: string;
  readonly name: string;
  readonly effect: CedarEffect;
  readonly kind: CedarPolicyKind;
  readonly principal?: string;
  readonly actions: readonly AuthorizationAction[];
  readonly resources: readonly OpenFGAObject[];
  readonly conditions?: Readonly<Record<string, unknown>>;
  readonly annotation?: string;
  readonly priority?: number;
}

/** Permission conditions (attribute-based predicates). */
export interface PermissionCondition {
  readonly field: string;
  readonly op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'between';
  readonly value?: unknown;
  readonly range?: readonly [unknown, unknown];
}

/**
 * Permission — a single (action, resource, conditions) grant inside a Role.
 * `conditions` allow attribute-scoped permissions (e.g. `refund.amount <= 1000`).
 */
export interface Permission {
  readonly action: AuthorizationAction;
  readonly resource: OpenFGAObject | string;
  readonly relation?: OpenFGARelation;
  readonly conditions?: readonly PermissionCondition[];
  readonly effect?: CedarEffect;
}

/** A role assignment to a user or agent. */
export interface RoleAssignment {
  readonly roleId: string;
  readonly principal: OpenFGAPrincipal;
  readonly scope?: OpenFGAObject;
  readonly assignedAt: string;
  readonly assignedBy: string;
  readonly expiresAt?: string | null;
}

/**
 * Role — a named bundle of Permissions, scoped to a tenant and optionally a
 * domain. The platform-core spine defines roles like `admin`, `manager`,
 * `approver`; domains may declare their own roles via domain packages.
 */
export interface Role {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly permissions: readonly Permission[];
  readonly tenantId: string;
  readonly domainId?: string;
  readonly system: boolean;
  readonly createdAt: string;
  readonly deprecatedAt?: string | null;
}

/** Agent capability tag (from AgentContract.capabilities, ADR-055). */
export type AgentCapability = string;

/** Tool permission descriptor (from ToolPermission, ADR-055 / ADR-103). */
export interface ToolPermission {
  readonly toolId: string;
  readonly requiredRoles: readonly string[];
  readonly requiredRelation: OpenFGARelation;
  readonly requiredCapabilities: readonly AgentCapability[];
  readonly resourceObject?: OpenFGAObject;
  readonly conditions?: readonly PermissionCondition[];
}

/** Signed-JWT agent identity claims (extends ADR-055). */
export interface AgentIdentityClaims {
  readonly agentId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly capabilities: readonly AgentCapability[];
  readonly effectivePermissions: readonly Permission[];
  readonly openfgaTuplesetHash: string;
  readonly delegatedFrom?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/**
 * DelegationContext — narrowing scope when an agent delegates to a sub-agent.
 * Per ADR-088, each delegation hop MUST narrow (never widen) the scope of
 * authority; the 5-way intersection intersects against `scopeNarrowing`.
 */
export interface DelegationContext {
  readonly delegationDepth: number;
  readonly parentAgentId: string;
  readonly originatingUserId: string;
  readonly scopeNarrowing: readonly Permission[];
  readonly delegatedCapabilities: readonly AgentCapability[];
  readonly maxDepth: number;
  readonly expiresAt: string;
  readonly auditTrail: readonly DelegationHop[];
}

/** A single hop in a delegation chain. */
export interface DelegationHop {
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly atDepth: number;
  readonly narrowedPermissions: readonly Permission[];
  readonly timestamp: string;
  readonly idempotencyKey: string;
}

/**
 * AuthorizationContext — the 5 inputs to the 5-way permission intersection:
 *   - userId / agentId (principal)
 *   - tenantId + domainId (scope)
 *   - sessionId (correlation)
 * Carried into every `AuthorizationResolver.check` call.
 */
export interface AuthorizationContext {
  readonly userId: string;
  readonly tenantId: string;
  readonly domainId?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly roles: readonly Role[];
  readonly agentCapabilities?: readonly AgentCapability[];
  readonly agentIdentity?: AgentIdentityClaims;
  readonly delegation?: DelegationContext;
  readonly resourceObject?: OpenFGAObject;
  readonly openfgaTuplesetHash?: string;
}

/** A single authorization decision request. */
export interface AuthorizationRequest {
  readonly context: AuthorizationContext;
  readonly action: AuthorizationAction;
  readonly resource: OpenFGAObject | string;
  readonly relation?: OpenFGARelation;
  readonly toolPermission?: ToolPermission;
  readonly field?: string;
}

/** Why an authorization decision was made (for audit / debugging). */
export interface AuthorizationReason {
  readonly layer:
    'openfga' | 'cedar' | 'agent-cap' | 'user-perm' | 'tool-role' | 'delegation' | 'jwt';
  readonly passed: boolean;
  readonly detail: string;
  readonly policyId?: string;
  readonly tuple?: RelationshipTuple;
}

/** Outcome of a single `AuthorizationResolver.check` call. */
export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly action: AuthorizationAction;
  readonly resource: OpenFGAObject | string;
  readonly effectivePermissions: readonly Permission[];
  readonly narrowedScope?: readonly Permission[];
  readonly reasons: readonly AuthorizationReason[];
  readonly openfgaTuplesetHash?: string;
  readonly decidedAt: string;
  readonly expiresAt?: string;
}

/**
 * AuthorizationResolver — the central contract that computes the 5-way
 * permission intersection: `agentCaps ∩ userPerms ∩ toolRoles ∩
 * delegationNarrowing ∩ openfgaRelationships`, with Cedar policies layered
 * on top (Layer 2 over Layer 1). Implementations are responsible for caching
 * OpenFGA query results against `openfgaTuplesetHash`.
 */
export interface AuthorizationResolver {
  check(request: AuthorizationRequest): Promise<AuthorizationDecision>;
  checkMany(requests: readonly AuthorizationRequest[]): Promise<readonly AuthorizationDecision[]>;
  getEffectivePermissions(
    context: AuthorizationContext,
    scope?: OpenFGAObject,
  ): Promise<readonly Permission[]>;
  invalidateCache(tuplesetHash: string): Promise<void>;
}

/** OpenFGA tuple store — write-side contract for provisioning tuples. */
export interface RelationshipStore {
  write(tuple: RelationshipTuple): Promise<void>;
  writeMany(tuples: readonly RelationshipTuple[]): Promise<void>;
  delete(tuple: RelationshipTuple): Promise<void>;
  list(filter: Partial<RelationshipTuple>): Promise<readonly RelationshipTuple[]>;
  check(user: OpenFGAPrincipal, relation: OpenFGARelation, object: OpenFGAObject): Promise<boolean>;
  tuplesetHash(filter: Partial<RelationshipTuple>): Promise<string>;
}

/** Cedar policy store — write-side contract for managing policies. */
export interface PolicyStore {
  publish(policy: CedarPolicy): Promise<void>;
  retract(policyId: string): Promise<void>;
  list(
    filter?: Partial<{ readonly kind: CedarPolicyKind; readonly effect: CedarEffect }>,
  ): Promise<readonly CedarPolicy[]>;
  evaluate(
    principal: OpenFGAPrincipal,
    action: AuthorizationAction,
    resource: OpenFGAObject,
    attributes?: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly allowed: boolean; readonly matchedPolicies: readonly CedarPolicy[] }>;
}

/**
 * PermissionService — top-level facade combining relationship tuples,
 * Cedar policies, and the 5-way intersection resolver. Consumed by the
 * Supervisor at tool-call time (ADR-088 / ADR-099 §4).
 */
export interface PermissionService {
  readonly relationships: RelationshipStore;
  readonly policies: PolicyStore;
  readonly resolver: AuthorizationResolver;
  /** Auto-provision OpenFGA tuples when an EntityType or Record is created (ADR-099 §6). */
  provisionForResource(object: OpenFGAObject, owner: OpenFGAPrincipal): Promise<void>;
}
