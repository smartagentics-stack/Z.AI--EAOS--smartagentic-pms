# ADR-041: Memory Permissions & Isolation

**ADR-ID:** ADR-041
**Status:** ACCEPTED
**Context:** 2026-09-01
**Owner:** Architecture Office

---

## 1. Context

ADR-038 (AI Memory Architecture) and ADR-040 (Storage & Encryption) established the substrate: 3 Prisma models with `tenantId` NOT NULL on every row. ADR-039 (Taxonomy) established the 7-category contract. Phase C Stream 4 research (`/home/z/my-project/phase-c-stream4-ai-memory-report.md`, §9) details the permissions and isolation layer that enforces the four-dimensional scope model.

The Microsoft SFI (Secure Future Initiative) guidance (research §9.1) is the canonical reference: "Isolate memory by user, agent, and tenant using deterministic controls like ACLs, scoped tokens, encryption at rest and in transit. **Don't rely on model prompting for boundary enforcement.** Scope subagent access to only the memory they require." SFI also mandates: "Gate writes on intent and provenance," "Label provenance on every memory entry," "Treat retrieval as a risk decision," "Surface memory and its influence to users," and "Maintain full lifecycle observability."

The research (§9.1, design guide) is explicit that "isolation by prompt" — "only use memories belonging to the current user" as a system-prompt instruction rather than a query-path constraint — is "not a memory bug waiting to happen; it is an access-control vulnerability already shipped." The non-negotiable rule: "memory isolation must be enforced by the storage layer, never by asking the model to be careful. Per-user and per-tenant scoping belongs in the query path — the retrieval call physically cannot address another tenant's records."

AWS AgentCore (research §9.1) provides the multi-tenant namespace pattern: "Namespaces are a critical organizational concept within long-term memory that provide hierarchical structure within your memory resource. They function like file system paths, and you can use them to logically group and categorize memories. These are especially powerful in multi-tenant systems, be it multi-agent, multi-users, or both." And the per-agent isolation rule: "Agent isolation (agentId) ensures that the shopping agent can't access memories stored by the travel agent, even for the same tenant."

Microsoft SDL for AI (Feb 2026) (research §9.1) calls out multi-agent memory specifically: "In multi-agent architectures where agents share memory, the risks multiply. Shared or global memory (useful for capturing cross-user patterns) is the higher-risk surface and needs stricter access controls."

## 2. Problem

The architectural problem: **define the memory permissions and isolation contract that (a) adopts a four-dimensional scope model — `tenantId` (NOT NULL) + `propertyId?` + `userId?` + `agentId?` + `sessionId?` — enforced on every retrieval query, so the retrieval call physically cannot address another tenant's/property's/user's/agent's/session's records; (b) adopts a `MemoryScope` enum (SESSION/USER_PRIVATE/AGENT_PRIVATE/TEAM_SHARED/PROPERTY_SHARED/TENANT_SHARED) that makes the sharing semantics explicit per memory type — "what is shared vs private should be answered explicitly per memory type" (design guide); (c) enforces the scope model via Prisma middleware — the only layer that ALL queries pass through — so no application code path can bypass isolation (application-layer enforcement can be bypassed by a buggy code path; SQLite doesn't natively support row-level security); (d) extends Stream 3's department ACL pattern to memory — every `MemoryRecord` has an optional `department` field, and retrieval requires `department IN (user's departments) OR department = 'ALL' OR department IS NULL`; (e) defines a `MemoryPermission` enum for RBAC on memory operations — `memory:read:own`, `memory:read:department`, `memory:write:agent`, `memory:write:extract`, `memory:delete:own`, `memory:delete:admin`, `memory:promote:procedural`, `memory:export`; (f) reserves the Stream 5 (Agent Runtime) agent-identity contract — every agent has a verifiable identity (signed JWT with `agentId`/`tenantId`/`propertyId?`/`permissions`); the `MemoryContext` is derived from this JWT; this integrates with existing Auth.js (ADR-001) for staff users and adds agent authentication for AI agents; (g) makes the `MemoryContext` a required TypeScript parameter on all `MemoryStore` methods — impossible to call without it; runtime validation rejects empty `tenantId`; (h) bans `prisma.$queryRaw` for memory tables via lint rule — all memory access goes through `MemoryStore` interface methods that internally use the Prisma client (which goes through middleware); (i) treats retrieval as a risk decision per Microsoft SFI — at retrieval time, before injecting memory into agent context, log every retrieved memory in `MemoryAccessLog`; Phase 2+ adds a content-safety check (Azure AI Content Safety / Prompt Shields equivalent, run locally via Ollama); (j) carries provenance on every entry (sourceKind/sourceIdentity/sourceEventIds) — the audit trail that makes incident response possible (detailed in ADR-047); and (k) feeds Stream 8 (Security & Governance) — the `MemoryAccessLog` is the foundation for AI Audit (B4 #20); the four-dimensional scope is the universal isolation primitive for AI-BOS.** This ADR is the permissions companion to ADR-038; it is the Stream 4 analog of Stream 3's ADR-031 (Knowledge Isolation) and Stream 2's ADR-027 (Multi-Tenant Vector Isolation).

## 3. Options

### Option A: Isolation by prompt ("only use memories belonging to the current user" as a system-prompt instruction)

Add a system-prompt instruction telling the LLM to only use memories belonging to the current user/tenant. **Rejected** — research §9.1, §9.5: explicitly listed as an access-control vulnerability by the design guide. Inadequate. The LLM cannot be trusted to enforce security boundaries; prompt injection (XPIA) can override any system-prompt instruction. Microsoft SFI: "Don't rely on model prompting for boundary enforcement."

### Option B: SQLite row-level security (RLS)

Use SQLite's native RLS to enforce tenant/user/agent scope at the database engine level. **Rejected** — research §9.5: SQLite does not natively support RLS (Postgres does — that's the cloud-mode parity target). Prisma middleware achieves the same effect at the application layer; the lint rule banning `$queryRaw` for memory tables ensures no bypass.

### Option C: Separate database per tenant (database-per-tenant) for isolation

One SQLite file per tenant, so cross-tenant queries are physically impossible. **Rejected as default** — research §9.5: strong isolation but operationally heavy (thousands of SQLite files for a chain; backup/migration/schema-evolution per file). Reserved for Phase 2+ opt-in for high-security tenants (per ADR-040). Phase 1 uses shared-schema with `tenantId` partition + Prisma middleware.

### Option D: Separate database per user

One SQLite file per user — strongest per-user isolation. **Rejected** — research §9.5: far too heavy; no way to do cross-user aggregation (needed for Phase 2+ features); operational complexity explodes with user count.

### Option E: No agent identity (agents run as a shared "AI system" user)

All agents share a single "AI system" user identity; memory writes are attributed to "AI system" not to specific agents. **Rejected** — research §9.5: cannot attribute memory writes to specific agents; cannot isolate agent memory (a compromised agent reads all agents' memory); violates Microsoft SFI "agent identity" rule; violates AWS AgentCore "agent isolation" pattern; blocks the `AgentMemory` contract (ADR-039 §8).

### Option F: Four-dimensional scope model + `MemoryScope` enum + Prisma middleware enforcement + department ACL + RBAC (`MemoryPermission` enum) + agent identity via signed JWT (Stream 5 contract reserved) + `MemoryContext` required TypeScript parameter + `$queryRaw` lint ban + retrieval-as-risk-decision logging + provenance on every entry

`tenantId` (NOT NULL) + `propertyId?` + `userId?` + `agentId?` + `sessionId?` enforced on every retrieval. `MemoryScope` enum makes sharing semantics explicit. Prisma middleware injects scope filters based on `MemoryContext` — no bypass. Department ACL extends Stream 3. RBAC via `MemoryPermission` enum. Agent identity via signed JWT (Stream 5 contract reserved from Phase 1). `MemoryContext` required TypeScript parameter. Lint rule bans `$queryRaw` for memory tables. Every retrieval logged in `MemoryAccessLog`. Provenance on every entry. Per research §9.

## 4. Decision

Adopt **Option F**. The Memory Permissions & Isolation architectural contract is:

1. **Four-dimensional scope model** (research §9.2) — all enforced on every retrieval; `tenantId` is NOT NULL:
   - `tenantId` (NOT NULL) — multi-tenant isolation. A hotel chain = one tenant; a single property = one tenant. The retrieval call physically cannot address another tenant's records.
   - `propertyId` (nullable) — for chain tenants with multiple properties. NULL = tenant-wide (brand-level preferences); non-NULL = property-specific.
   - `userId` (nullable, for `type='USER'`) — per-user isolation. NULL = not user-scoped.
   - `agentId` (nullable, for `type='AGENT'`) — per-agent isolation. NULL = not agent-scoped.
   - `sessionId` (nullable, for `type='WORKING'`/`'CONVERSATIONAL'`) — per-session isolation.

2. **`MemoryScope` enum** (research §9.2) — makes sharing semantics explicit:
   - `SESSION` — scoped to one session (working, conversational).
   - `USER_PRIVATE` — scoped to one user (user memory, user-extracted semantic facts).
   - `AGENT_PRIVATE` — scoped to one agent (agent memory).
   - `TEAM_SHARED` — scoped to one team of agents (Phase 2+).
   - `PROPERTY_SHARED` — scoped to one property (property-level facts, e.g., "this property's pool is under renovation").
   - `TENANT_SHARED` — scoped to one tenant (tenant-level facts, e.g., "this chain's loyalty program is X").

3. **Retrieval query template** (research §9.2) — enforced by Prisma middleware, never bypassed:

   ```sql
   SELECT * FROM MemoryRecord
   WHERE tenantId = :currentTenantId
     AND (propertyId = :currentPropertyId OR propertyId IS NULL)
     AND (
       (scope = 'SESSION'           AND sessionId = :currentSessionId)
       OR (scope = 'USER_PRIVATE'   AND userId = :currentUserId)
       OR (scope = 'AGENT_PRIVATE'  AND agentId = :currentAgentId)
       OR (scope = 'PROPERTY_SHARED' AND propertyId = :currentPropertyId)
       OR (scope = 'TENANT_SHARED')
     )
     AND (supersedes IS NULL)
     AND (deletedAt IS NULL)
     AND (expiresAt IS NULL OR expiresAt > :now)
     AND (departmentFilterSatisfied)  -- per Stream 3 department ACL
   ```

4. **Department ACL** (research §9.2; extends Stream 3 pattern) — every `MemoryRecord` has an optional `department` field (enum: FRONT_DESK/HOUSEKEEPING/MAINTENANCE/FNB/FINANCE/SECURITY/SALES_MARKETING/REVENUE_MGMT/IT/HR/MANAGEMENT/ALL). Retrieval requires `department IN (user's departments) OR department = 'ALL' OR department IS NULL`. This is how HIGH-sensitivity user preferences (dietary allergies, accessibility needs) are retrieved only for the relevant department (F&B for dietary, housekeeping for accessibility) per ADR-039 §7.

5. **`MemoryPermission` enum for RBAC** (research §9.2):
   - `memory:read:own` — user can read their own `USER_PRIVATE` memory.
   - `memory:read:department` — staff can read `PROPERTY_SHARED`/`TENANT_SHARED` memory for their department.
   - `memory:write:agent` — agent can write `AGENT_PRIVATE`/`SESSION`/`CONVERSATIONAL` memory for its own scope.
   - `memory:write:extract` — Restate extraction workflow can write `USER_PRIVATE`/`SEMANTIC` memory (system role).
   - `memory:delete:own` — user can delete their own `USER_PRIVATE` memory (GDPR Art 17).
   - `memory:delete:admin` — admin can delete any memory (GDPR Art 17 on behalf of users).
   - `memory:promote:procedural` — admin can promote candidate procedures to playbooks (ADR-045 validation gate).
   - `memory:export` — user/admin can export user memory (GDPR Art 20).

6. **Prisma middleware enforcement** (research §9.2; per Stream 3's three-layer isolation pattern) — every memory query passes through middleware that injects the `tenantId`/`propertyId`/`userId`/`agentId`/`sessionId`/`scope`/`department` filters based on the current `MemoryContext`. No code path can bypass this — the `MemoryStore` interface accepts a `MemoryContext` parameter that is the only source of scoping. Application-layer enforcement can be bypassed by a buggy code path; SQL-level enforcement (SQLite RLS) is too low-level and not natively supported. Prisma middleware is the sweet spot.

7. **`MemoryContext` required TypeScript parameter** (research §9.2, §14):

   ```typescript
   export interface MemoryContext {
     tenantId: string; // NOT NULL — runtime validation rejects empty
     propertyId?: string;
     userId?: string;
     agentId?: string;
     sessionId?: string;
     department?: string;
     permissions: MemoryPermission[];
     agentIdentity?: AgentIdentity; // signed JWT (Stream 5 contract)
   }
   ```

   TypeScript makes it impossible to call `MemoryStore` methods without a `MemoryContext`; runtime validation rejects empty `tenantId` (research R-9.2).

8. **Agent identity via signed JWT** (research §9.2; Stream 5 contract reserved from Phase 1):

   ```typescript
   export interface AgentIdentity {
     agentId: string;
     agentType: string;
     tenantId: string;
     propertyId?: string;
     version: string;
     permissions: MemoryPermission[];
     signedJwt: string; // signed with tenant-specific key
   }
   ```

   Every agent has a verifiable identity. The `MemoryContext` is derived from this JWT. This integrates with existing Auth.js (ADR-001) for staff users and adds agent authentication for AI agents (Stream 5 concern, but the memory layer supports it from Phase 1). JWTs signed with tenant-specific keys; key rotation; `MemoryAccessLog` detects anomalous access patterns (Stream 8) (research R-9.3).

9. **`$queryRaw` lint ban for memory tables** (research R-9.1) — a lint rule (e.g., ESLint custom rule) bans `prisma.$queryRaw` and `prisma.$executeRaw` for memory tables. All memory access goes through `MemoryStore` interface methods that internally use the Prisma client (which goes through middleware). Code review checklist item: "No raw SQL on memory tables."

10. **Provenance on every entry** (research §9.2; detailed in ADR-047) — every `MemoryRecord` carries `provenance` JSON: `sourceKind` (USER_STATED/INFERRED/ADMIN_DECLARED/EXTRACTED/SYSTEM), `sourceIdentity` (userId or agentId or systemComponent), `sourceEventIds[]`, `extractorModelVersion?`, `writtenAt`. This is the Microsoft SFI "Label provenance on every memory entry: source, identity, timestamp, model version" rule, and the audit trail that makes incident response possible.

11. **Retrieval as a risk decision** (research §9.2; Microsoft SFI) — "Treat retrieval as a risk decision. Memory is candidate context, not authoritative truth. At retrieval time: Validate relevance and freshness. Re-evaluate for sensitive or malicious content. Prevent memory from overriding safety controls or system instructions. Guard against cross-context information disclosure." Phase 1 ships the retrieval-time logging (every retrieved memory is logged in `MemoryAccessLog`); Phase 2+ ships the content-safety check (Azure AI Content Safety / Prompt Shields equivalent, run locally via Ollama).

12. **Surface memory and its influence to users** (research §9.1; Microsoft SFI) — "Show users how memory influenced a specific response or action. Provide view, edit, and delete controls. Notify on memory creation. Enable both granular and bulk deletion." Implemented via the PMS "My Memory" UI page (ADR-043) and the `MemoryAccessLog` admin viewer (ADR-047).

## 5. Rationale

- **"Isolation by prompt" is an access-control vulnerability already shipped** — research §9.1, design guide: "Per-user and per-tenant scoping belongs in the query path — the retrieval call physically cannot address another tenant's records." The Microsoft SFI rule is unambiguous: "Don't rely on model prompting for boundary enforcement." Prompt injection (XPIA) can override any system-prompt instruction; the only safe enforcement is deterministic, at the storage/query layer.
- **Prisma middleware is the right enforcement point** — research §9.3: it's the only layer that ALL queries pass through. Application-layer enforcement can be bypassed by a buggy code path; SQL-level enforcement (SQLite RLS) is too low-level and not natively supported. Prisma middleware is the sweet spot — it intercepts every Prisma client query and injects the scope filters based on the `MemoryContext`.
- **The four-dimensional scope model covers all SmartAgentics use cases** — research §9.3: tenant (hotel chain), property (single hotel), user (guest or staff), agent (front desk / concierge / housekeeping / etc.), session (one conversation). The `MemoryScope` enum makes the sharing semantics explicit per memory type. "What is shared vs private should be answered explicitly per memory type" (design guide).
- **Department ACL extends Stream 3's pattern** — research §9.2: the same department isolation that Stream 3 applies to knowledge chunks applies to memory. HIGH-sensitivity user preferences (dietary allergies) are retrieved only for F&B; accessibility needs only for housekeeping. This is how department-level privacy is enforced.
- **Agent identity is non-negotiable for security** — research §9.1, §9.5: AWS AgentCore pattern — "the shopping agent can't access memories stored by the travel agent, even for the same tenant." Microsoft SFI "agent identity" rule. Without agent identity, a compromised agent reads all agents' memory; the `AgentMemory` contract (ADR-039 §8) is impossible; multi-agent coordination (Stream 6) cannot attribute writes. Stream 5 lands the agent-identity contract; the memory layer reserves it from Phase 1 via the `MemoryContext.agentIdentity` field.
- **`$queryRaw` lint ban is the bypass mitigation** — research R-9.1 (High severity): "Prisma middleware bypassed by a raw SQL query (e.g., a developer writes a `prisma.$queryRaw` that skips middleware)." Mitigation: lint rule + code review checklist + all memory access through `MemoryStore` interface methods. This is the highest-severity risk in the permissions layer.
- **Retrieval as a risk decision is the Microsoft SFI rule** — research §9.1: "Memory is candidate context, not authoritative truth." Phase 1 logs every retrieval (the `MemoryAccessLog`); Phase 2+ adds content-safety checks. This is the foundation for AI Audit (B4 #20) and incident response.
- **Provenance is dual-purpose** — research §9.3: it's the audit trail (security) AND the supersession/staleness machinery (lifecycle) AND the GDPR cascading-delete attribution (compliance). The same `provenance` JSON serves all three.
- **Rejecting isolation-by-prompt (Option A)** — research §9.5: access-control vulnerability.
- **Rejecting SQLite RLS (Option B)** — research §9.5: not natively supported; Prisma middleware achieves the same effect.
- **Rejecting database-per-tenant as default (Option C)** — research §9.5: operationally heavy; reserved for Phase 2+ high-security tenants.
- **Rejecting database-per-user (Option D)** — research §9.5: far too heavy; blocks cross-user aggregation.
- **Rejecting no-agent-identity (Option E)** — research §9.5: violates SFI/AgentCore; blocks `AgentMemory` contract.

## 6. Consequences

**Positive**:

- Four-dimensional scope enforced at the SQL WHERE clause via Prisma middleware — the retrieval call physically cannot address another tenant's/property's/user's/agent's/session's records. Isolation by architecture, not by prompt (Microsoft SFI rule).
- The `MemoryScope` enum makes sharing semantics explicit per memory type — SESSION/USER_PRIVATE/AGENT_PRIVATE/TEAM_SHARED/PROPERTY_SHARED/TENANT_SHARED.
- Department ACL extends Stream 3's pattern — HIGH-sensitivity preferences retrieved only for the relevant department.
- RBAC via `MemoryPermission` enum — least privilege on every memory operation.
- Agent identity via signed JWT (Stream 5 contract reserved) — per-agent isolation, multi-agent attribution, foundation for Stream 6.
- `MemoryContext` required TypeScript parameter — impossible to call `MemoryStore` methods without scoping; runtime validation rejects empty `tenantId`.
- `$queryRaw` lint ban — highest-severity bypass risk mitigated.
- Retrieval-as-risk-decision logging — every retrieved memory logged in `MemoryAccessLog`; Phase 2+ adds content-safety checks.
- Provenance on every entry — audit trail + lifecycle machinery + GDPR cascading-delete attribution.
- Feeds Stream 8 (Security & Governance) — `MemoryAccessLog` is the AI Audit foundation; the four-dimensional scope is the universal isolation primitive for AI-BOS.

**Negative / obligations**:

- Prisma middleware must be maintained — every memory query passes through it; a bug in middleware compromises all isolation. Integration tests must verify tenant/user/agent/session isolation (research R-9.1, R-7.1, R-8.1).
- The `$queryRaw` lint rule must be enforced in CI — a developer who bypasses it via raw SQL creates a cross-tenant leakage path. Code review checklist item.
- `MemoryContext` is a required parameter on every `MemoryStore` method — developers must thread it through every call site; this is a discipline obligation.
- Agent identity (signed JWT) requires Stream 5 to land the signing key infrastructure — Phase 1 reserves the contract but cannot fully enforce agent isolation until Stream 5 ships. Phase 1 mitigation: agents run with staff-user-derived `MemoryContext` (limited agent RBAC); Phase 2+ adds full agent JWT.
- Department ACL requires the Department entity (Stream 3 open question) — if Department is a free string in Phase 1, the ACL is coarser; if Department is a foreign key (Phase D decision), the ACL is tighter.
- The retrieval-as-risk-decision content-safety check (Phase 2+) requires a local Ollama classifier or Azure AI Content Safety equivalent — adds latency to every retrieval; benchmark required.
- Provenance is mandatory at write time (research R-11.1) — Prisma middleware rejects writes without `provenance`; this is a discipline obligation but a non-negotiable for GDPR cascading delete.
- The `MemoryAccessLog` grows at memory-operation volume — 7-year retention (research §10.2); a busy hotel property with 10 AI agents could generate 100K+ operations/day; archival/rotation strategy needed (Phase 2+).

**Dependencies on other ADRs**:

- Depends on ADR-001 (Reference Stack) — Auth.js for staff user authentication; offline-first principle.
- Depends on ADR-005 (Prisma) — middleware pattern.
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` partition key pattern; shared-collection Phase 1 / collection-per-tenant Phase 2+ strategy.
- Depends on ADR-028 (Knowledge Base Architecture) / ADR-031 (Knowledge Isolation) — department ACL pattern; three-layer isolation pattern.
- Depends on ADR-038 (AI Memory Architecture) — the `MemoryStore` interface and `MemoryContext` type.
- Depends on ADR-039 (Memory Taxonomy) — the `type`/`scope` enums encode the 7-category contract.
- Depends on ADR-040 (Storage & Encryption) — the schema's `tenantId`/`scope`/`department` columns are the substrate.
- Feeds ADR-042 (Retention & Decay) — the `expiresAt`/`deletedAt` filters in the retrieval query template.
- Feeds ADR-043 (Deletion & GDPR) — the `memory:delete:own`/`memory:delete:admin` permissions and the cascading-delete semantics.
- Feeds ADR-044 (Security & Poisoning) — the write-gate RBAC and the retrieval-as-risk-decision Layer 4.
- Feeds ADR-045 (Procedural Memory Promotion) — the `memory:promote:procedural` permission.
- Feeds ADR-046 (Operations API) — the `MemoryContext` parameter on every SDK method.
- Feeds ADR-047 (Provenance & Audit) — the `MemoryAccessLog` and `provenance` JSON.
- Feeds Stream 5 (Agent Runtime) — agent identity (signed JWT) contract; `MemoryContext.agentIdentity` derivation.
- Feeds Stream 6 (Multi-Agent Collaboration) — `TEAM_SHARED` scope and `teamId` field (Phase 2+).
- Feeds Stream 8 (Security & Governance) — `MemoryAccessLog` is the AI Audit foundation; integration tests for tenant/user/agent isolation.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Stream 5 (Agent Runtime) lands the agent-identity contract** — verify the signed JWT → `MemoryContext.agentIdentity` derivation; verify the `MemoryPermission` enum covers all Stream 5 agent capabilities; verify the `agentType` enum covers all Stream 5 agent types.
2. **A Prisma middleware bypass incident occurs** (a `$queryRaw` query leaks cross-tenant data) — root-cause the lint-rule failure; tighten the lint rule; verify the code review checklist caught it; consider CI integration test that runs cross-tenant queries and asserts zero results.
3. **A `MemoryContext` misconfiguration incident occurs** (empty `tenantId` reaches the middleware) — root-cause the runtime validation failure; verify the TypeScript required-parameter discipline; consider stricter runtime validation (reject any missing scope field per memory type).
4. **An agent JWT forgery incident occurs** (compromised agent fakes another agent's identity) — root-cause the signing key compromise; verify the tenant-specific signing key rotation; verify the `MemoryAccessLog` anomaly detection (Phase 2+) would have caught it.
5. **A department ACL failure occurs** (HIGH-sensitivity preference retrieved by wrong department) — root-cause the `department` filter omission; verify the integration test for department isolation; consider tightening the `department` field from free string to foreign key (Stream 3 Open Question #1).
6. **A retrieval-as-risk-decision content-safety check is needed in Phase 2+** — evaluate local Ollama classifier vs Azure AI Content Safety equivalent; benchmark the latency overhead; verify the `MemoryAccessLog` captures the safety decision.
7. **A TEAM_SHARED write-contention incident occurs in Phase 2+** (multiple agents mutate a shared record directly) — root-cause the bypass of the propose-then-consolidate pipeline; verify the `proposeMemoryWrite()` API is the only write path for shared memory; verify the Restate consolidator handles contention.
8. **The `MemoryAccessLog` volume exceeds retention capacity** — evaluate archival/rotation strategy (Phase 2+); verify the 7-year retention is enforced; consider a separate audit SQLite file for very-high-volume tenants.
9. **A new memory scope is needed** (e.g., `REGION_SHARED` for multi-region chains) — evaluate extending the `MemoryScope` enum; verify the retrieval query template accommodates the new scope; verify the Prisma middleware injects the new filter.
10. **Annually**, as part of the regular ADR review cycle.
