# ADR-046: Memory Operations API

**ADR-ID:** ADR-046
**Status:** ACCEPTED
**Context:** 2026-09-01
**Owner:** Architecture Office

---

## 1. Context

ADR-038 (AI Memory Architecture) established the `MemoryStore` top-level interface and 7 sub-interfaces. ADR-039 (Taxonomy) established the 7-category contract. ADR-041 (Permissions) established the `MemoryContext` required parameter. Phase C Stream 4 research (`/home/z/my-project/phase-c-stream4-ai-memory-report.md`, §14) consolidates the SDK interface recommendations into a concrete operations API surface.

The research (§1.2) verified READ-ONLY that `packages/sdk/src/ai/index.ts` has 5 interfaces only (`AIRequest`, `AIUsage`, `AIResponse`, `AIProvider`, `AIEvaluator`, `AIBudgetEnforcer`) — **no `MemoryStore`, no `MemoryRecord`, no `WorkingMemory`, no `EpisodicMemory`, no `UserMemory`, no `AgentMemory`**. This is FC-4.3: the SDK has no memory interface. The resolution (research §15 FC-4.3) is to add `MemoryStore` top-level interface + 7 sub-interfaces + supporting types in a new file `packages/sdk/src/ai/memory.ts`. **Additive — no existing interface modified.**

The Mem0 cookbook (research §3.1) defines the canonical memory operations: "Store: decide what to remember from each step. Retrieve: fetch only the relevant items for the next step. Update/forget: merge, decay, or [delete]." The research (§14) extends this to 10 operations: **store, retrieve, update, forget, export, list, search, consolidate, verify, promote**.

The research (§1.3, §20) also cites the "Vendor-Neutral Wire Format for Agent Memory Operations" (arXiv:2606.01138) — a wire-format proposal for interoperable memory operations across vendor platforms. SmartAgentics adopts the patterns but owns the lifecycle (research §21 design principle #8: "Managed pipeline, self-owned lifecycle — adopt the patterns from AgentCore Memory / Mem0 / Letta (asynchronous extraction, memory blocks, supersession) but own the lifecycle (write gate, staleness, procedural promotion, deletion) in a thin SmartAgentics-owned abstraction. No Mem0/Letta/Zep runtime dependency."). A `Mem0CompatibleMemoryStore` adapter (vendor-neutral wire format) is reserved for Phase 2+.

The Microsoft SFI guidance (research §9.1) requires that memory operations be auditable: "Maintain full lifecycle observability: Log all memory operations (create, read, update, delete) with identity, timestamp, source, and provenance. Track where memory propagated (blast radius)." This means every operation in the API must emit a `MemoryAccessLog` entry (ADR-047).

## 2. Problem

The architectural problem: **define the Memory Operations API contract that (a) adds a `MemoryStore` top-level SDK interface in a new file `packages/sdk/src/ai/memory.ts` — additive, no existing interface modified; (b) adds 7 sub-interfaces (`WorkingMemory`, `ConversationalMemory`, `EpisodicMemory`, `SemanticMemory`, `ProceduralMemory`, `UserMemory`, `AgentMemory`) each extending the top-level `MemoryStore` contract with type-specific operations; (c) defines the 10 cross-cutting operations — `store` (write with write-gate per ADR-044), `retrieve` (hybrid RRF k=60 per ADR-024 with scope filters per ADR-041 + decay scoring per ADR-042), `update` (supersession chain per ADR-039 §5), `forget` (cascading delete per ADR-043), `export` (GDPR Art 15/20 per ADR-043), `list` (paginated list with scope filters), `search` (semantic+keyword hybrid), `consolidate` (episodic→semantic/user extraction via Restate workflow), `verify` (cryptographic integrity check per ADR-044 Layer 4), `promote` (procedural validation gate per ADR-045); (d) makes `MemoryContext` a required TypeScript parameter on every operation — impossible to call without it; runtime validation rejects empty `tenantId` (per ADR-041); (e) emits a `MemoryAccessLog` entry on every operation (per ADR-047) — operation type, operator identity, target record ID, timestamp, operation detail; (f) returns typed results — `MemoryRecord[]` for retrieve/search/list, `MemoryRecord` for store/update/promote, `DeletionReport` for forget, `MemoryExport` for export, `MemoryAccessLog[]` for audit; (g) reserves the Stream 5 (Agent Runtime) contract — agents call `MemoryStore` methods via a `MemoryContext` derived from their signed JWT; no LangChain memory adapter, no LlamaIndex memory, no Mem0 runtime — SmartAgentics-owned abstraction (per ADR-048); (h) reserves a `Mem0CompatibleMemoryStore` adapter (Phase 2+) for vendor-neutral wire-format interop per arXiv:2606.01138 — behind the SmartAgentics-owned `MemoryStore` interface; (i) reserves a `PostgresMemoryStore` (Phase 2+) for cloud parity reusing Stream 2's pgvector; (j) makes the API surface minimal and stable — the 7 sub-interfaces and 10 cross-cutting operations are the contract; new operations are added additively (no breaking change to existing operations); (k) documents every operation with JSDoc including the cognitive-science foundation (per ADR-039), the lifecycle implication (per ADR-042), the security implication (per ADR-044), and the GDPR implication (per ADR-043); and (l) feeds Stream 5 (Agent Runtime) — agents use the `MemoryStore` as a tool, not a LangChain memory adapter; Stream 5's agent abstractions are also SmartAgentics-owned.** This ADR is the operations-API companion to ADR-038; it is the Stream 4 analog of Stream 3's ADR-028 §13.1 (Knowledge Base Architecture SDK surface).

## 3. Options

### Option A: Adopt Mem0's API surface as the SmartAgentics memory API

Use Mem0's `add`/`search`/`update`/`delete`/`get_all` API verbatim. **Rejected** — research §7.5, ADR-048: Mem0 is Apache-2.0 and self-hostable, but it's a Python service (FastAPI + PostgreSQL+pgvector) — adds a Python runtime and a second database. Conflicts with the Stream 3 framework-avoidance policy. Adopt the _patterns_ (extraction + consolidation + user_id scoping), not the _platform_ or its API surface. A `Mem0CompatibleMemoryStore` adapter (Phase 2+) provides wire-format interop without runtime dependency.

### Option B: Adopt LangChain's memory API surface (ConversationBufferMemory, etc.)

Use LangChain's classic memory classes as the SmartAgentics memory API. **Rejected** — research §3.1, ADR-048: LangChain's memory types are implementation classes (buffer vs summary vs KG), not cognitive categories. They conflate conversational buffer with working memory and have no episodic/semantic/procedural distinction. The CoALA cognitive categories are the contract; LangChain's `ConversationSummaryBufferMemory` pattern is adopted as the _implementation_ of `ConversationalMemory` (per ADR-039 §3).

### Option C: Adopt Letta's API surface (memory blocks, core/recall/archival)

Use Letta's block-based API (`get_block`/`update_block`/`append_to_block`/`core_memory_replace`) as the SmartAgentics memory API. **Rejected** — research §2.5, ADR-048: Letta is a full agent framework (Python, Docker, Postgres) — too heavy for Phase 1 and conflicts with framework-avoidance. The _4-block pattern_ (persona/human/task/scratchpad) is adopted as the implementation of `WorkingMemory` (per ADR-039 §2); the Letta API surface is not.

### Option D: Single flat `MemoryStore` interface with type-discriminated operations

One `MemoryStore` interface with operations like `store(type, ...)`, `retrieve(type, ...)` where `type` is a parameter. **Rejected** — research §14: loses the type-safety and per-type contract clarity of 7 sub-interfaces. Each memory type has a different lifecycle/write-path/retention/retrieval-mode (per ADR-039); a flat interface with type-discriminated operations conflates these. The 7 sub-interfaces make the per-type contracts explicit and TypeScript-enforced.

### Option E: SmartAgentics-owned `MemoryStore` top-level + 7 sub-interfaces + 10 cross-cutting operations + `MemoryContext` required parameter + `MemoryAccessLog` on every operation + Phase 2+ `Mem0CompatibleMemoryStore` and `PostgresMemoryStore` reserved

New file `packages/sdk/src/ai/memory.ts`. `MemoryStore` top-level interface with 7 sub-interface properties (`working`/`conversational`/`episodic`/`semantic`/`procedural`/`user`/`agent`) + 4 cross-cutting methods (`retrieve`/`export`/`forgetUser`/`audit`). Each sub-interface has type-specific methods. `MemoryContext` required on every method. Every operation emits a `MemoryAccessLog` entry. Phase 2+ reserves `Mem0CompatibleMemoryStore` (wire-format interop) and `PostgresMemoryStore` (cloud parity). Per research §14.

## 4. Decision

Adopt **Option E**. The Memory Operations API architectural contract is:

1. **New file `packages/sdk/src/ai/memory.ts`** (research §14) — additive to existing `ai/index.ts`. No existing interface modified. The file exports: `MemoryContext`, `MemoryPermission` enum, `MemoryStore` interface, 7 sub-interfaces, supporting types (`MemoryRecord`, `MemoryProvenance`, `AgentIdentity`, `MemoryType`, `MemoryScope`, `MemoryExport`, `DeletionReport`, etc.).

2. **`MemoryContext` required parameter** (research §14; per ADR-041):

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

3. **`MemoryPermission` enum for RBAC** (research §14; per ADR-041): `MEMORY_READ_OWN`, `MEMORY_READ_DEPARTMENT`, `MEMORY_WRITE_AGENT`, `MEMORY_WRITE_EXTRACT`, `MEMORY_DELETE_OWN`, `MEMORY_DELETE_ADMIN`, `MEMORY_PROMOTE_PROCEDURAL`, `MEMORY_EXPORT`.

4. **`MemoryStore` top-level interface** (research §14):

   ```typescript
   export interface MemoryStore {
     // 7 sub-stores (each memory type)
     working: WorkingMemory;
     conversational: ConversationalMemory;
     episodic: EpisodicMemory;
     semantic: SemanticMemory;
     procedural: ProceduralMemory;
     user: UserMemory;
     agent: AgentMemory;

     // 4 cross-cutting operations
     retrieve(ctx: MemoryContext, query: MemoryQuery): Promise<MemoryRecord[]>;
     export(ctx: MemoryContext, filter: MemoryExportFilter): Promise<MemoryExport>;
     forgetUser(ctx: MemoryContext, userId: string): Promise<DeletionReport>;
     audit(ctx: MemoryContext, filter: MemoryAuditFilter): Promise<MemoryAccessLog[]>;
   }
   ```

5. **7 sub-interfaces** (research §14; per ADR-039):

   - **`WorkingMemory`** (Letta 4-block):

     ```typescript
     export interface WorkingMemory {
       getBlock(
         ctx: MemoryContext,
         blockLabel: 'persona' | 'human' | 'task' | 'scratchpad',
       ): Promise<MemoryBlock>;
       setBlock(ctx: MemoryContext, blockLabel: string, value: string): Promise<void>;
       compactScratchpad(ctx: MemoryContext): Promise<CompactionResult>;
     }
     ```

   - **`ConversationalMemory`** (buffer + summary):

     ```typescript
     export interface ConversationalMemory {
       getBuffer(ctx: MemoryContext): Promise<{ recentTurns: MemoryEvent[]; summary: string }>;
       addTurn(ctx: MemoryContext, turn: ConversationTurn): Promise<void>;
       summarize(ctx: MemoryContext): Promise<string>;
     }
     ```

   - **`EpisodicMemory`** (append-only event log):

     ```typescript
     export interface EpisodicMemory {
       appendEvent(ctx: MemoryContext, event: MemoryEvent): Promise<void>;
       queryByTime(
         ctx: MemoryContext,
         range: TimeRange,
         filter?: EventFilter,
       ): Promise<MemoryEvent[]>;
       replaySession(ctx: MemoryContext, sessionId: string): Promise<MemoryEvent[]>;
       queryByActor(ctx: MemoryContext, actorId: string, range: TimeRange): Promise<MemoryEvent[]>;
     }
     ```

   - **`SemanticMemory`** (triple-store + supersession + staleness):

     ```typescript
     export interface SemanticMemory {
       store(ctx: MemoryContext, fact: SemanticFactInput): Promise<MemoryRecord>;
       retrieve(ctx: MemoryContext, query: string, topK?: number): Promise<MemoryRecord[]>;
       supersede(
         ctx: MemoryContext,
         oldRecordId: string,
         newFact: SemanticFactInput,
       ): Promise<MemoryRecord>;
       checkStaleness(ctx: MemoryContext, recordId: string): Promise<StalenessReport>;
     }
     ```

   - **`ProceduralMemory`** (file-based + validation gate, per ADR-045):

     ```typescript
     export interface ProceduralMemory {
       listProcedures(
         ctx: MemoryContext,
         status?: 'candidate' | 'active' | 'deprecated',
       ): Promise<Procedure[]>;
       readProcedure(ctx: MemoryContext, name: string, version?: number): Promise<Procedure>;
       proposeCandidate(ctx: MemoryContext, candidate: ProcedureCandidateInput): Promise<Procedure>;
       promoteCandidate(
         ctx: MemoryContext,
         name: string,
         validation: ValidationEvidence,
       ): Promise<Procedure>;
       deprecateProcedure(ctx: MemoryContext, name: string, reason: string): Promise<void>;
     }
     ```

   - **`UserMemory`** (per-user preferences + GDPR control):

     ```typescript
     export interface UserMemory {
       getPreferences(
         ctx: MemoryContext,
         userId: string,
         category?: PreferenceCategory,
       ): Promise<MemoryRecord[]>;
       setPreference(
         ctx: MemoryContext,
         userId: string,
         preference: PreferenceInput,
       ): Promise<MemoryRecord>;
       deletePreference(ctx: MemoryContext, userId: string, recordId: string): Promise<void>;
       disableMemory(ctx: MemoryContext, userId: string): Promise<void>; // GDPR toggle
       exportUserMemory(ctx: MemoryContext, userId: string): Promise<UserMemoryExport>; // GDPR Art 20
     }
     ```

   - **`AgentMemory`** (per-agent state + team-shared Phase 2+):
     ```typescript
     export interface AgentMemory {
       getLearnedPatterns(ctx: MemoryContext, agentId: string): Promise<MemoryRecord[]>;
       recordOutcome(
         ctx: MemoryContext,
         agentId: string,
         taskId: string,
         outcome: TaskOutcome,
       ): Promise<void>;
       // Team-shared memory (Phase 2+)
       proposeTeamWrite(
         ctx: MemoryContext,
         teamId: string,
         proposal: TeamMemoryProposal,
       ): Promise<void>;
     }
     ```

6. **10 cross-cutting operations** (research §16 ADR-040 candidate table; consolidated from sub-interfaces + top-level):

   | Operation       | Method                                                                                                                                    | Per-ADR                                                      |
   | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
   | **store**       | `semantic.store` / `user.setPreference` / `agent.recordOutcome` / `episodic.appendEvent` / `working.setBlock` / `conversational.addTurn`  | ADR-044 write gate; ADR-039 per-type                         |
   | **retrieve**    | `MemoryStore.retrieve` (top-level, hybrid RRF k=60) + per-sub-interface retrievals                                                        | ADR-024 hybrid; ADR-041 scope filters; ADR-042 decay scoring |
   | **update**      | `semantic.supersede` / `user.setPreference` (supersession)                                                                                | ADR-039 §5 supersession chain                                |
   | **forget**      | `MemoryStore.forgetUser` (top-level, cascading delete)                                                                                    | ADR-043 GDPR Art 17                                          |
   | **export**      | `MemoryStore.export` (top-level) + `user.exportUserMemory`                                                                                | ADR-043 GDPR Art 15/20                                       |
   | **list**        | `procedural.listProcedures` / `user.getPreferences` / `agent.getLearnedPatterns`                                                          | ADR-039 per-type                                             |
   | **search**      | `semantic.retrieve` (semantic+keyword hybrid) + `episodic.queryByTime`/`queryByActor` (temporal)                                          | ADR-024; ADR-039 §4                                          |
   | **consolidate** | (Restate workflow; not a synchronous API method) calls `semantic.store` + `user.setPreference` with `provenance.sourceEventIds` backlinks | ADR-039 §4 consolidation; ADR-047 provenance                 |
   | **verify**      | (Nightly Restate workflow; not a synchronous API method) recomputes SHA-256 `contentHash` for all `MemoryRecord` rows                     | ADR-044 Layer 4                                              |
   | **promote**     | `procedural.promoteCandidate` (validation gate)                                                                                           | ADR-045                                                      |

7. **`MemoryAccessLog` emission on every operation** (research §9.2; per ADR-047) — every `store`/`retrieve`/`update`/`forget`/`export`/`list`/`search`/`promote` emits a `MemoryAccessLog` entry with: `operation` (CREATE/READ/UPDATE/DELETE/EXPORT/PROMOTE), `operatorType` (USER/AGENT/SYSTEM), `operatorId`, `targetRecordId`/`targetEventId`/`targetUserId`, `operationTimestamp`, `operationDetail` (query, scope, resultCount), `ipAddress`, `userAgent`. The `consolidate` and `verify` workflows emit SYSTEM-operator entries.

8. **Typed results** (research §14):
   - `MemoryRecord[]` for `retrieve`/`search`/`list`.
   - `MemoryRecord` for `store`/`update`/`promote`.
   - `DeletionReport` for `forget` (per ADR-043 — lists all deleted record IDs, counts by type, tax-retained count, verification query).
   - `MemoryExport`/`UserMemoryExport` for `export` (per ADR-043 — JSON format, machine-readable, GDPR Art 20 portable).
   - `MemoryAccessLog[]` for `audit`.
   - `StalenessReport` for `checkStaleness`.
   - `CompactionResult` for `compactScratchpad`.

9. **Phase 2+ reserved adapters** (research §0, §17.2):
   - **`Mem0CompatibleMemoryStore`** — implements `MemoryStore` with a vendor-neutral wire-format adapter per arXiv:2606.01138. Enables interop with Mem0-managed platforms without taking a Mem0 runtime dependency. Behind the SmartAgentics-owned `MemoryStore` interface.
   - **`PostgresMemoryStore`** — implements `MemoryStore` with Postgres + pgvector (Stream 2 cloud parity). For cloud-deployed tenants who outgrow single-file SQLite.

10. **Reference implementation = `SQLiteMemoryStore`** (research §0; per ADR-038) — Phase 1 ships this. Implements all 7 sub-interfaces backed by the 3 Prisma models + 2 virtual tables (ADR-040). The `MemoryStore` interface is the contract; the implementation is swappable (SQLite Phase 1, Postgres Phase 2+, Mem0-compatible Phase 2+).

11. **Minimal and stable API surface** (research §14) — the 7 sub-interfaces and 10 cross-cutting operations are the contract. New operations are added additively (no breaking change to existing operations). The `MemoryContext` parameter is non-optional and stable. The `MemoryPermission` enum extends additively. The `MemoryType`/`MemoryScope` enums extend additively (new types/scopes added in future industry packs).

12. **JSDoc documentation** (research §14; per ADR-039) — every operation documents: the cognitive-science foundation (which of the 7 categories), the lifecycle implication (TTL/decay/supersession per ADR-042), the security implication (write gate / RBAC / integrity check per ADR-044), and the GDPR implication (Art 15/16/17/20 per ADR-043). The `MemoryContext` parameter documents the four-dimensional scope model (per ADR-041).

## 5. Rationale

- **The SDK has no memory interface today (FC-4.3)** — research §1.2, §15: `packages/sdk/src/ai/index.ts` has 5 interfaces only. The resolution is additive — a new file `packages/sdk/src/ai/memory.ts` with `MemoryStore` + 7 sub-interfaces + supporting types. No existing interface modified. This resolves FC-4.3 with zero risk to existing AI interfaces.
- **7 sub-interfaces make per-type contracts explicit and TypeScript-enforced** — research §14, ADR-039: each memory type has a different lifecycle/write-path/retention/retrieval-mode. A flat interface with type-discriminated operations (Option D) conflates these. The 7 sub-interfaces make the per-type contracts explicit — `WorkingMemory.getBlock` is type-safe; `EpisodicMemory.appendEvent` is type-safe; `ProceduralMemory.promoteCandidate` is type-safe.
- **`MemoryContext` required parameter enforces the four-dimensional scope model** — research §14, ADR-041: TypeScript makes it impossible to call `MemoryStore` methods without a `MemoryContext`; runtime validation rejects empty `tenantId`. This is the architectural guarantee that no code path bypasses isolation.
- **`MemoryAccessLog` emission on every operation is the Microsoft SFI rule** — research §9.1: "Maintain full lifecycle observability: Log all memory operations (create, read, update, delete) with identity, timestamp, source, and provenance. Track where memory propagated (blast radius)." Every operation in the API emits a log entry; the `audit` operation queries them (per ADR-047).
- **The 10 operations cover the Mem0 cookbook pattern + GDPR + procedural** — research §3.1, §16: Mem0's "Store / Retrieve / Update/forget" + GDPR Art 15/16/17/20 + procedural promotion. The `consolidate` and `verify` operations are Restate workflows (not synchronous API methods) — they call the synchronous `store` operation with provenance backlinks.
- **Typed results enable compile-time safety** — research §14: `MemoryRecord[]` for retrieve, `DeletionReport` for forget, etc. The `DeletionReport` (per ADR-043) is the audit evidence that GDPR Art 17 erasure succeeded.
- **Phase 2+ adapters reserved behind the SmartAgentics-owned interface** — research §0, §17.2: `Mem0CompatibleMemoryStore` (wire-format interop) and `PostgresMemoryStore` (cloud parity) are reserved. The `MemoryStore` interface is the contract; implementations are swappable. This is the "managed pipeline, self-owned lifecycle" principle (research §21 design principle #8).
- **Minimal and stable API surface enables forward compatibility** — research §14: new operations added additively; no breaking change to existing operations. The `MemoryType`/`MemoryScope` enums extend additively for future industry packs (hotel, healthcare, retail, etc.).
- **Rejecting Mem0 API (Option A)** — research §7.5, ADR-048: Python runtime + second database; framework-avoidance.
- **Rejecting LangChain API (Option B)** — research §3.1, ADR-048: implementation classes, not cognitive categories.
- **Rejecting Letta API (Option C)** — research §2.5, ADR-048: full agent framework; too heavy.
- **Rejecting flat type-discriminated interface (Option D)** — research §14: loses type-safety and per-type contract clarity.

## 6. Consequences

**Positive**:

- A complete, typed, documented Memory Operations API in a new additive file `packages/sdk/src/ai/memory.ts` — resolves FC-4.3 with zero risk to existing AI interfaces.
- 7 sub-interfaces make per-type contracts explicit and TypeScript-enforced — `WorkingMemory`/`ConversationalMemory`/`EpisodicMemory`/`SemanticMemory`/`ProceduralMemory`/`UserMemory`/`AgentMemory`.
- 10 cross-cutting operations cover the full lifecycle: store/retrieve/update/forget/export/list/search/consolidate/verify/promote.
- `MemoryContext` required parameter enforces the four-dimensional scope model — impossible to call without scoping.
- `MemoryAccessLog` emission on every operation is the Microsoft SFI lifecycle-observability guarantee.
- Typed results enable compile-time safety — `DeletionReport` is the GDPR Art 17 audit evidence.
- Phase 2+ adapters (`Mem0CompatibleMemoryStore`, `PostgresMemoryStore`) reserved behind the SmartAgentics-owned interface.
- Minimal and stable API surface — new operations added additively; no breaking change.
- Feeds Stream 5 (Agent Runtime) — agents call `MemoryStore` methods via a `MemoryContext` derived from their signed JWT; no LangChain memory adapter.
- Feeds AI-BOS vision — the `MemoryType`/`MemoryScope` enums extend additively for future industry packs.

**Negative / obligations**:

- 7 sub-interfaces + 10 cross-cutting operations + supporting types is a substantial API surface — Phase 1 must implement all of it in `SQLiteMemoryStore` (estimated 4–6 weeks of Phase E per ADR-038 §17.1).
- Every operation must emit a `MemoryAccessLog` entry — this is a discipline obligation; a missed emission breaks the audit trail. Integration tests must verify emission on every operation.
- The `MemoryContext` parameter must be threaded through every call site — developers must understand the four-dimensional scope model; the lint rule banning `$queryRaw` (ADR-041) prevents bypass.
- The `consolidate` and `verify` operations are Restate workflows, not synchronous API methods — developers must understand which operations are synchronous (`store`/`retrieve`/`update`/`forget`/`export`/`list`/`search`/`promote`) and which are asynchronous workflows (`consolidate`/`verify`). The JSDoc must make this clear.
- The `DeletionReport` verification query must return 0 — if it doesn't, the cascading delete missed something (per ADR-043 R-11.1).
- The Phase 2+ `Mem0CompatibleMemoryStore` adapter requires the vendor-neutral wire format (arXiv:2606.01138) to stabilize — track the spec; the adapter is behind the `MemoryStore` interface so no breaking change when it lands.
- The Phase 2+ `PostgresMemoryStore` requires Stream 2's pgvector decision to land — track Stream 2 cloud parity; the adapter is behind the `MemoryStore` interface.
- The `MemoryType`/`MemoryScope` enums must extend additively — a future industry pack that adds a new memory type (e.g., `REGION_SHARED` scope for multi-region chains) must not break existing operations.
- The JSDoc documentation must be maintained — every operation's cognitive-science/lifecycle/security/GDPR implications must be accurate as the underlying ADRs evolve.

**Dependencies on other ADRs**:

- Depends on ADR-001 (Reference Stack) — Next.js stack; offline-first principle.
- Depends on ADR-005 (Prisma) — schema modeling; middleware pattern.
- Depends on ADR-009 (Internal SDK) — `packages/sdk/` package structure.
- Depends on ADR-022 (Local Embeddings) — `nomic-embed-text-v1.5` for `semantic.retrieve` embeddings.
- Depends on ADR-023 (Vector Store) — sqlite-vec for `SQLiteMemoryStore`.
- Depends on ADR-024 (Hybrid Search) — RRF k=60 for `retrieve`/`search`.
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` partition key.
- Depends on ADR-028 (Knowledge Base Architecture) — sibling SDK surface pattern.
- Depends on ADR-030 (RAG Pipeline) — `OllamaRagGenerator` extended with `compileWorkingMemory`/`compileConversationalMemory`; `readProcedure` tool wired into agent tool set (Stream 5).
- Depends on ADR-032 (Source Attribution & Citation) — memory citations follow the same pattern as knowledge citations.
- Depends on ADR-033 (Confidence Scoring) — `confidence` field on every `MemoryRecord`; `CoverageConfidence` reused.
- Depends on ADR-038 (AI Memory Architecture) — the `MemoryStore` interface and `SQLiteMemoryStore` reference implementation.
- Depends on ADR-039 (Memory Taxonomy) — the 7 sub-interfaces' per-type contracts.
- Depends on ADR-040 (Storage & Encryption) — the 3 Prisma models + 2 virtual tables; SQLCipher; `contentHash`.
- Depends on ADR-041 (Permissions & Isolation) — `MemoryContext` required parameter; `MemoryPermission` enum; Prisma middleware.
- Depends on ADR-042 (Retention & Decay) — `retrieve`/`search` apply decay scoring; `list` filters by `expiresAt`/`deletedAt`.
- Depends on ADR-043 (Deletion & GDPR) — `forgetUser`/`export`/`update` operations; `DeletionReport`/`MemoryExport` types.
- Depends on ADR-044 (Security & Poisoning) — `store` invokes the write gate; `verify` recomputes `contentHash`.
- Depends on ADR-045 (Procedural Memory Promotion) — `ProceduralMemory.promoteCandidate` validation gate.
- Depends on ADR-047 (Provenance & Audit) — `MemoryAccessLog` emission on every operation; `audit` operation queries them.
- Depends on ADR-048 (Memory Framework Policy) — no Mem0/Letta/Zep runtime dependency; thin SmartAgentics-owned abstraction.
- Feeds Stream 5 (Agent Runtime) — agents call `MemoryStore` methods via `MemoryContext` from signed JWT; `readProcedure` tool wired into agent tool registry.
- Feeds Stream 6 (Multi-Agent Collaboration) — `agent.proposeTeamWrite` (Phase 2+) for team-shared memory.
- Feeds Stream 8 (Security & Governance) — `audit` operation is the AI Audit foundation (B4 #20); `MemoryAccessLog` is the incident-response surface.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A new operation is needed** (e.g., `summarize_range` for episodic memory, or `bulk_export` for compliance) — evaluate adding it additively to the relevant sub-interface; verify no breaking change to existing operations; update the JSDoc.
2. **Stream 5 (Agent Runtime) lands the agent tool registry** — verify the `readProcedure` tool is wired in; verify agents call `MemoryStore` methods via `MemoryContext` from signed JWT; verify the `MemoryPermission` enum covers all Stream 5 agent capabilities.
3. **A `MemoryAccessLog` emission is missed** (integration test or production incident) — root-cause the missed emission; tighten the integration test; verify the `audit` operation would have detected the gap.
4. **The vendor-neutral wire format (arXiv:2606.01138) stabilizes** — evaluate the Phase 2+ `Mem0CompatibleMemoryStore` adapter; verify it's behind the `MemoryStore` interface; benchmark the wire-format overhead.
5. **Stream 2 cloud parity (pgvector) lands** — evaluate the Phase 2+ `PostgresMemoryStore`; verify it's behind the `MemoryStore` interface; verify the schema migration path.
6. **A new memory type or scope is needed** (e.g., `REGION_SHARED` scope for multi-region chains) — verify the `MemoryType`/`MemoryScope` enums extend additively; verify the retrieval query template (ADR-041) accommodates the new scope; verify no breaking change.
7. **A `DeletionReport` verification query returns non-zero** — root-cause the missed records (per ADR-043 R-11.1); verify the cascading-delete logic; consider the fuzzy `LIKE` check as a backup.
8. **An operation's JSDoc is found to be inaccurate** (cognitive-science/lifecycle/security/GDPR implication outdated) — update the JSDoc; verify the underlying ADR reference is still valid.
9. **A Phase 2+ operation becomes synchronous** (e.g., `consolidate` moves from Restate workflow to synchronous API method) — evaluate the latency impact; verify the `MemoryAccessLog` emission still works; update the JSDoc.
10. **Annually**, as part of the regular ADR review cycle.
