# ADR-099: Fine-Grained Authorization (OpenFGA + Cedar + 5-Way Permission Intersection)

**ADR-ID:** ADR-099
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

The domain-neutral architecture (ADR-097/098) introduces a `domain → module → entity_type → record` hierarchy with field-level permission requirements. Existing SmartAgentics authorization — ADR-055 (Agent Permissions & Identity, 3-way intersection), ADR-083 (AI Tenant Isolation 5-Layer, Cedar L1/L2/L3 at T3), ADR-088 (Agent Permission Intersection, 4-way intersection) — is tenant-scoped and role-based. It does not model the relationship hierarchy (a `manager` role but not assigned to this property's restaurant), nor does it express attribute-based policies (refund amount ≤ 1000, time-of-day restrictions) on top of relationship checks.

Web research (Phase D Revision research report, Topic 3) confirms the layered authorization posture:

- **OpenFGA** (`https://openfga.dev`, CNCF Incubating) is the leading open-source ReBAC system, inspired by Google's Zanzibar. It natively models relationship hierarchies and is cited twice in the directive: multi-tenant SaaS (`https://openfga.dev/docs/use-cases/multi-tenant-saas`, line 549 fn 2) and agent-as-principal (`https://openfga.dev/docs/modeling/agents`, line 673 fn 3; `https://openfga.dev/docs/use-cases/ai-agent-authorization`, Aug 2026: "Model agents as principals, delegate user permissions, and enforce least privilege for autonomous agents").
- **AWS Cedar** (`https://docs.cedarpolicy.com`, `https://cedarpolicy.com`) is a policy-based authorization language. Amazon Verified Permissions is the managed Cedar host.
- **OpenFGA and Cedar are complementary, not mutually exclusive** (Auth0 blog Oct 2025: "Understanding ReBAC and ABAC Through OpenFGA and Cedar"; sph.sh Mar 2026: "Cedar's speed advantage is real for ABAC workloads, but it does not mean Cedar is 'better' than OpenFGA for relationship-based access control"; `https://github.com/openfga/openfga-cedar-comparison`).
- **Cedar is already adopted** in SmartAgentics: ADR-083 §4 (T3 ACL layer) specifies "Cedar-style L1/L2/L3"; ADR-095 §6 references "Stream 6 Cedar L1/L2/L3"; ADR-088 references "Stream 6 ADR-057 3-layer Cedar authorization." The new domain-neutral authorization decision is therefore **not OpenFGA-vs-Cedar; it is OpenFGA-as-addition-to-Cedar**.
- **OWASP ASI03 (Identity & Privilege Abuse)** remains the driving threat (per ADR-088 §1): an agent must not act beyond what the originating user authorized, even when RBAC is in place. The 4-way intersection (ADR-088) closes most of ASI03 but leaves a gap: a user with `manager` role but without a relationship to a specific record (e.g., not assigned to this property's restaurant) can still pass the intersection. OpenFGA's relationship check closes that gap.

## 2. Problem

Should SmartAgentics (a) keep the existing 4-way intersection (ADR-088) and rely on Cedar ABAC for relationship checks (verbose; relationship hierarchies are awkward in Cedar), (b) replace Cedar with OpenFGA (loses Cedar's ABAC strengths already adopted; breaks ADR-083/095), (c) use OpenFGA as the sole authorization engine (no — Cedar policies for ABAC are already in production), or (d) layer OpenFGA (relationships) on top of Cedar (policies/attributes) and extend ADR-088's 4-way intersection to a 5-way intersection that includes the OpenFGA relationship check?

## 3. Options

### Option A: Keep the 4-way intersection; rely on Cedar ABAC for relationships

Rejected. Relationship hierarchies (`domain → module → entity_type → record`, with inherited `viewer`/`editor`/`creator` relations) are awkward to express in Cedar's policy DSL. Cedar is optimized for attribute-based policies (`refund.amount <= 1000`), not for traversing relationship graphs. Forcing relationships into Cedar produces verbose policies and loses OpenFGA's optimized relationship-graph traversal (Zanzibar's graph traversal is the canonical solution).

### Option B: Replace Cedar with OpenFGA

Rejected. Cedar is already adopted (ADR-083 T3, ADR-095 §6, ADR-088 references). Cedar's ABAC strengths — time-of-day, amount-based, role-intersection, multi-control-approval policies — are not natively expressible in OpenFGA. Replacing Cedar breaks existing production policies and the Stream 6 architecture.

### Option C: Use OpenFGA as the sole authorization engine

Rejected. OpenFGA is a ReBAC engine, not a general-purpose policy engine. ABAC policies (time-of-day, amount thresholds) require Cedar's policy DSL. OpenFGA + Cedar together cover both paradigms; neither alone is sufficient.

### Option D: Layered authorization — OpenFGA (relationships) + Cedar (policies/attributes) + signed-JWT agent identity + 5-way permission intersection

Adopted. Four authorization layers:

1. **Layer 1 (Relationships)** — OpenFGA models the `domain → module → entity_type → record` hierarchy.
2. **Layer 2 (Policies / Attributes)** — Cedar (already adopted) handles attribute-based policies.
3. **Layer 3 (Agent identity)** — signed-JWT agent identity (ADR-055) is preserved; the JWT carries an `agentId` claim that OpenFGA resolves as a principal.
4. **Layer 4 (Permission Intersection)** — ADR-088's 4-way intersection is extended to a 5-way intersection that includes the OpenFGA relationship check.

## 4. Decision

Adopt **Option D** — the Layered Authorization Model with 5-Way Permission Intersection.

### OpenFGA authorization model (Layer 1 — Relationships)

The FGA DSL models the domain-neutral hierarchy natively:

```
type domain
  relations
    define member: [user, agent]
    define module: [module]
type module
  relations
    define parent: [domain]
    define entity_type: [entity_type]
    define viewer: [user, agent] or viewer from parent
    define editor: [user, agent] or editor from parent
type entity_type
  relations
    define parent: [module]
    define record: [record]
    define viewer: [user, agent] or viewer from parent
    define creator: [user, agent] or creator from parent
type record
  relations
    define parent: [entity_type]
    define owner: [user, agent]
    define viewer: [user, agent] or viewer from parent or owner
    define editor: [user, agent] or editor from parent or owner
    define field: [field]   // field-level permissions
```

This natively supports the directive's authorization hierarchy (lines 514–571) and OpenFGA's agent-as-principal pattern (`https://openfga.dev/docs/use-cases/ai-agent-authorization`).

### Cedar policies (Layer 2 — Policies / Attributes)

Cedar (already adopted per ADR-083 T3) handles attribute-based policies that OpenFGA does not natively express:

- **Time-of-day restrictions**: `permit (principal, action == Action::"refund", resource) when resource.amount <= 1000 && now() > Time::"09:00" && now() < Time::"17:00";`
- **Amount-based conditions**: `permit` clause with `resource.amount <= 1000`.
- **Role intersections**: `when principal has role Manager && principal has role Approver`.
- **Multi-control approval**: `permit ... unless resource.requiresDualApproval && !resource.secondaryApprovalReceived`.

Cedar policies are evaluated against the OpenFGA-resolved relationship set — i.e., OpenFGA answers "does the principal have a `viewer` relationship to this record?", and Cedar answers "given that relationship, is the policy satisfied?".

### Signed-JWT agent identity (Layer 3 — Agent identity)

Per ADR-055, signed JWTs carry agent identity. The JWT now carries an additional claim:

- `agentId` — resolved by OpenFGA as a principal (per OpenFGA agent-as-principal pattern).
- `openfgaTuplesetHash` — fingerprint of the OpenFGA tupleset relevant to this agent/session; used for cache invalidation when relationships change.

### 5-way permission intersection (Layer 4 — extends ADR-088)

ADR-088's 4-way intersection (`agentCaps ∩ userPerms ∩ toolRoles ∩ delegationNarrowing`) is extended to a **5-way intersection** that also includes the OpenFGA relationship check:

```typescript
// Pseudocode — computed at tool-call time by the Supervisor
function computeEffectivePermission(
  agentContract: AgentContract,
  userJwt: SignedJWT,
  toolPermission: ToolPermission,
  delegationContext?: DelegationContext,
  openfgaContext: OpenFGAContext, // NEW — 5th input
): EffectivePermission {
  const agentCaps = new Set(agentContract.capabilities);
  const userPerms = new Set(userJwt.claims.permissions);
  const toolRoles = new Set(toolPermission.requiredRoles);

  // Intersection 1: agent capabilities ∩ user permissions
  let effective = intersection(agentCaps, userPerms);

  // Intersection 2: ∩ tool required roles
  effective = intersection(effective, toolRoles);

  // Intersection 3: ∩ delegation-narrowed scope (if sub-agent)
  if (delegationContext?.scopeNarrowing) {
    effective = intersection(effective, new Set(delegationContext.scopeNarrowing));
  }

  // Intersection 4 (NEW): ∩ OpenFGA relationship check
  // OpenFGA answers: "does (userId OR agentId) have the required relationship
  // (viewer | editor | creator | owner) to the target record (or its parent entity_type / module / domain)?"
  const openfgaAllowed = openfgaContext.check({
    principal: userJwt.claims.agentId ?? userJwt.claims.userId,
    relation: toolPermission.requiredRelation, // "viewer" | "editor" | "creator" | "owner"
    object: openfgaContext.recordObject, // "domain:pms:entity:reservation:record:RES-001"
  });
  if (!openfgaAllowed) {
    return { allowed: false, scopes: new Set() };
  }

  return { allowed: effective.size > 0, scopes: effective };
}
```

The 5-way intersection closes the gap where a user has the role but lacks the specific record-relationship (e.g., a `manager` role but not assigned to this property's restaurant). This is the ASI03 closure that ADR-088's 4-way intersection could not provide.

### When the intersection is computed

- **Pre-computed** when the signed JWT is issued (the JWT carries an `effectivePermissions` claim + `openfgaTuplesetHash`).
- **Recomputed** when a delegation hop occurs (Stream 6 `DelegationContext` changes) OR when the OpenFGA tupleset hash changes (relationships added/removed).
- **Re-verified** at every tool call (the Supervisor checks the current `effectivePermissions` claim + queries OpenFGA for the relationship check; OpenFGA query is cached with the `openfgaTuplesetHash` as cache key).

### OpenFGA deployment topology

- **Phase 1 (offline-first STANDALONE)**: OpenFGA runs **in-process** via `@openfga/sdk` embedded in the SmartAgentics server. The OpenFGA store is a local SQLite file (OpenFGA supports Postgres or MySQL backends; for offline-first we use the embedded Postgres-compatible mode or a SQLite shim). This satisfies the directive's offline-first requirement.
- **Phase 2+ (LAN_SYNCED / CLOUD_SYNCED)**: OpenFGA runs as a sidecar container (Docker) per ADR-075 LAN topology, or as a shared cloud service in Phase 3+. The SDK abstracts the deployment topology; the authorization contract is unchanged.

### VectorStore extension (amends ADR-027)

`VectorStore.query()` gains an optional `domainId` parameter (like the existing optional `propertyId`). The partition-key schema is extended to `(tenant_id, property_id, domain_id)` — within sqlite-vec's ~3-column partition-key limit (per ADR-027 §6 risk R-2.13). This is the FC-DN-22 resolution.

### Amendment / reference register

| Existing ADR                                | Relationship                  | Change                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ADR-001 (Reference Stack)**               | AMENDED (MODERATE — FC-DN-21) | Add OpenFGA (self-hosted via Docker in Phase 2+, embedded in-process via `@openfga/sdk` for offline-first Phase 1) as the ReBAC engine. Cedar (already referenced via ADR-083) is reaffirmed as the ABAC engine.                                                                                                                   |
| **ADR-027 (Multi-Tenant Vector Isolation)** | AMENDED (MINOR — FC-DN-22)    | `VectorStore.query()` gains optional `domainId` parameter. Partition-key schema extended to `(tenant_id, property_id, domain_id)` — within sqlite-vec's ~3-column partition-key limit.                                                                                                                                             |
| **ADR-055 (Agent Permissions & Identity)**  | AMENDED (MODERATE — FC-DN-13) | The 3-way intersection becomes a 4-way intersection at the ADR-055 layer (+ OpenFGA check). The signed-JWT agent identity is preserved unchanged; OpenFGA is queried by the Supervisor at `authorize` time as an additional check. The JWT claims gain an `openfgaTuplesetHash` fingerprint for cache invalidation.                |
| **ADR-083 (AI Tenant Isolation 5-Layer)**   | AMENDED (HIGH — FC-DN-16)     | T3 expands from "Cedar L1/L2/L3" to "Cedar policies + OpenFGA relationships." T4 context-window invariant extends to check `chunk.tenantId == session.tenantId AND chunk.domainId ∈ session.authorizedDomains` (or per-entity-type check). T5 prompt-template isolation extends to per-domain (not just per-tenant) AgentContract. |
| **ADR-088 (Agent Permission Intersection)** | AMENDED (MODERATE — FC-DN-17) | `computeEffectivePermission` gains a fifth input — `openfgaRelationships` — and the intersection becomes `agentCaps ∩ userPerms ∩ toolRoles ∩ delegationNarrowing ∩ openfgaRelationships`. The signed JWT carries an `openfgaTuplesetHash` for cache invalidation.                                                                 |
| **ADR-095 (AI Configuration Policy)**       | REFERENCED                    | Cedar policies (Layer 2) may reference `AIConfiguration` attributes for per-tenant / per-domain AI configuration (amended by ADR-103 to add `domainId`).                                                                                                                                                                           |
| **ADR-097 (Domain Meta-Model)**             | CROSS-REFERENCE               | The `domain → module → entity_type → record` hierarchy modeled in OpenFGA mirrors the ADR-097 meta-model. OpenFGA tuples are auto-provisioned when an EntityType or Record is created.                                                                                                                                             |
| **ADR-103 (Domain-to-AI Context)**          | CROSS-REFERENCE               | ADR-103's auto-generated tools carry `requiredRelation` (viewer/editor/creator/owner) metadata consumed by the 5-way intersection.                                                                                                                                                                                                 |

### Conflicts resolved

- **FC-DN-13** (ADR-055 MODERATE) — resolved by extending the 3-way intersection to 4-way at the ADR-055 layer (+ OpenFGA check).
- **FC-DN-16** (ADR-083 HIGH) — resolved by expanding T3 to "Cedar + OpenFGA," extending T4 context-window invariant to include `domainId`, and extending T5 prompt-template isolation to per-domain.
- **FC-DN-17** (ADR-088 MODERATE) — resolved by extending the 4-way intersection to 5-way (+ OpenFGA relationship check) + `openfgaTuplesetHash` cache invalidation.
- **FC-DN-21** (ADR-001 MODERATE, OpenFGA portion) — resolved by adding OpenFGA to the reference stack.
- **FC-DN-22** (ADR-027 MINOR) — resolved by extending the partition-key schema to `(tenant_id, property_id, domain_id)`.

## 5. Rationale

- **OpenFGA + Cedar is the documented complementary posture** (Auth0 blog, sph.sh, openfga-cedar-comparison repo): ReBAC (OpenFGA) for relationship hierarchies, ABAC (Cedar) for attribute policies. Neither alone covers both paradigms; together they do.
- **OpenFGA natively models the directive's authorization hierarchy** (lines 514–571): `domain → module → entity_type → record` with inherited `viewer`/`editor`/`creator` relations. The FGA DSL is concise and matches the directive's hierarchy verbatim.
- **OpenFGA agent-as-principal pattern** (`https://openfga.dev/docs/use-cases/ai-agent-authorization`, cited by directive line 673 fn 3): "Model agents as principals, delegate user permissions, and enforce least privilege for autonomous agents." This is the canonical pattern for AI agent authorization; SmartAgentics adopts it directly.
- **5-way intersection closes the ASI03 gap** that ADR-088's 4-way intersection left: a user with `manager` role but without a relationship to a specific record now fails the OpenFGA check. OWASP ASI03 (per ADR-088 §1) is fully closed.
- **`openfgaTuplesetHash` for cache invalidation**: the OpenFGA query result is cached against a hash of the relevant tupleset; when relationships change, the hash changes, the cache invalidates. This keeps the hot-path cost O(1) for the common case (relationships unchanged).
- **In-process OpenFGA for offline-first Phase 1**: the directive's offline-first requirement means a cloud-only OpenFGA is unacceptable. `@openfga/sdk` embedded in-process with a local SQLite/Postgres-compatible backend satisfies offline-first; the SDK abstraction allows Phase 2+ sidecar or cloud deployment without contract change.
- **Cedar is already adopted** (ADR-083/095/088 references) — the new ADR does not disrupt the existing Cedar investment; it adds OpenFGA as the relationship layer underneath.
- **VectorStore `domainId` extension is within sqlite-vec's partition-key limit** (ADR-027 §6 R-2.13: ~3 columns) — `(tenant_id, property_id, domain_id)` fits the limit.

## 6. Consequences

- New runtime dependency: OpenFGA (in-process `@openfga/sdk` for Phase 1; Docker sidecar for Phase 2+; cloud service for Phase 3+).
- New SDK module: `packages/sdk/src/authz/` with `OpenFGAContext`, `AuthorizationResolver` interfaces.
- New Prisma middleware hook: auto-provision OpenFGA tuples when an `EntityType` or `Record` is created (e.g., `record:RES-001 parent entity_type:reservation` tuple).
- Signed JWT claims extended (additive): `agentId`, `openfgaTuplesetHash`.
- `PermissionResolver` Restate Virtual Object (per ADR-088 §4) gains an `OpenFGAContext` parameter; cache key includes `openfgaTuplesetHash`.
- **Risk: OpenFGA query latency on the hot path.** Mitigation: OpenFGA queries are cached with `openfgaTuplesetHash` as cache key; cache hit is O(1). OpenFGA's Zanzibar-derived graph traversal is sub-millisecond for typical relationship depth (4 hops: domain → module → entity_type → record).
- **Risk: in-process OpenFGA memory footprint.** Mitigation: OpenFGA stores are compact (tuple storage is row-oriented; a hotel-PMS-scale tupleset is ~100K tuples, ~10MB). For Phase 2+ cloud deployments with millions of tuples, the sidecar/cloud topology offloads memory.
- **Risk: OpenFGA tupleset drift from Prisma state.** If a Record is deleted via raw SQL (bypassing the middleware), the OpenFGA tuple leaks. Mitigation: a periodic `OpenFGAReconcileWorkflow` Restate scheduled job diffs Prisma state vs OpenFGA tuples and repairs drift; the verifier rule flags raw SQL on sync-replicated tables.
- **Risk: Cedar policy evaluation cost when policies proliferate.** Mitigation: Cedar compiles policies to IL (per CodeEffects pattern); evaluation is sub-millisecond for typical policy counts. A policy linter in CI rejects policies that don't compile or that conflict.
- **Risk: ADR-088 amendment invalidates the 4-way intersection contract.** Mitigation: the amendment is additive — the 5th input (`openfgaContext`) is required; the existing 4 inputs are unchanged. Code that imports `computeEffectivePermission` must supply the 5th input; the verifier rule flags call sites that omit it.
- **Risk: ADR-083 T4 context-window invariant extension to `domainId` may break existing vector queries.** Mitigation: the `domainId` filter is optional (null = cross-domain agent); existing queries that don't specify `domainId` behave as before.
- Dependencies: ADR-001 (Reference Stack — amended), ADR-027 (Multi-Tenant Vector Isolation — amended), ADR-055 (Agent Permissions & Identity — amended), ADR-075 (LAN Operation Topology — OpenFGA sidecar), ADR-083 (AI Tenant Isolation 5-Layer — amended), ADR-088 (Agent Permission Intersection — amended), ADR-095 (AI Configuration Policy — referenced), ADR-097 (Domain Meta-Model — cross-reference), ADR-103 (Domain-to-AI Context — cross-reference).
- Phase E effort: ~3 weeks for the OpenFGA model, SDK interfaces, Prisma middleware tuple provisioning, 5-way intersection extension, and `OpenFGAReconcileWorkflow`.

## 7. Review Conditions

- Review if Phase 1 telemetry shows OpenFGA query latency (cache miss) exceeds 10ms — would investigate tuple-store indexing or move to the sidecar topology earlier.
- Review if `openfgaTuplesetHash` cache invalidation proves too coarse (a single tuple change invalidates the whole session cache) — would move to per-relation caching.
- Review if in-process OpenFGA memory footprint exceeds 100MB at production scale — would move to the sidecar topology.
- Review if `OpenFGAReconcileWorkflow` reports persistent drift (> 0.1% of tuples) — would indicate a bypass path that needs verifier-rule coverage.
- Review if a community standard for AI-agent authorization emerges (e.g., an OWASP ASI03 mitigation pattern that prescribes a specific ReBAC+ABAC layering) that should replace the SmartAgentics-owned model.
- Review if Phase 3+ multi-tenant cloud deployment requires a different OpenFGA topology (e.g., per-tenant OpenFGA stores for hard isolation) — would warrant a Phase 3+ authorization-topology ADR.
- Review if Cedar policy proliferation (> 1000 policies per tenant) degrades evaluation latency — would warrant a policy-partitioning strategy or a move to a Cedar managed service.
- Review if field-level permissions (the `record.field` relation in the FGA model) prove too granular for typical use cases — would simplify to record-level permissions and reserve field-level for specific entities.
- Review if OpenFGA's Zanzibar-derived graph traversal proves insufficient for very deep hierarchies (> 6 hops) — would investigate graph-traversal optimizations or denormalization.
