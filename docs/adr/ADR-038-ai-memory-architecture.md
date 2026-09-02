# ADR-038: AI Memory Architecture

**ADR-ID:** ADR-038
**Status:** ACCEPTED
**Context:** 2026-09-01
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 item #13 (`phase-b-report.md` line 485) classifies **AI Memory** as an "Architecture Contract — NOW" capability, mandating **7 sub-types** — working, conversational, episodic, semantic, procedural, agent, user — each with **ownership, permissions, retention, provenance, deletion rules, and tenant/property isolation**. That directive is the mandate for Stream 4.

Phase C Stream 4 research (`/home/z/my-project/phase-c-stream4-ai-memory-report.md`, §0, §1.2) verified READ-ONLY that SmartAgentics currently has **no AI memory subsystem whatsoever**:

- `packages/sdk/src/ai/index.ts` exposes only `AIRequest`, `AIUsage`, `AIResponse`, `AIProvider`, `AIEvaluator`, `AIBudgetEnforcer`. **No `MemoryStore`, no `MemoryRecord`, no `WorkingMemory`, no `EpisodicMemory`, no `UserMemory`, no `AgentMemory`.** This makes ADR-011's "SDK interfaces provide sufficient extension points for all 12 capabilities" claim inaccurate for Memory (FC-4.6).
- `prisma/schema.prisma` has 10 models but **zero memory tables**. `SemanticCacheEntry` is a query-result cache (caches LLM responses by query-embedding similarity) — not memory: no per-user/per-agent scoping, no retention policy beyond `expiresAt`, no provenance, no supersession, no GDPR compliance (FC-4.4).
- The AIOS demo UI (`src/lib/aios/types.ts:122-146`) carries a `MemoryType` enum with 10 demo values and a `MemoryRecord` shape with `embedding`/`ttl`/`importance`/`hits`/`lastAccessedAt` but **no `tenantId`, no `userId`, no `agentId`, no permissions, no provenance, no deletion rules, no security**. The Zustand store (`src/lib/aios/store.ts`) holds memory in-memory only, not persisted, not tenant-scoped. This is a UI mock, not a PMS contract (FC-4.5).
- ADR-001 (`download/smartagentics/ADR-001-Reference-Stack.md`) has decisions for Database, Auth, AI Provider, AI Evaluation, AI Observability, Vector Search, Local AI — but **no Memory decision at all** (FC-4.2). ADR-001 also says "Vector search — Deferred" while AI memory requires vector embeddings (FC-4.1, carry-forward from Stream 2 FC-2.1 / Stream 3 FC-3.1).

The research confirms the 7-category directive is **technically sound and aligned with the academic consensus taxonomy** — CoALA (Cognitive Architectures for Language Agents, Sumers et al., arXiv:2309.02427, 927 citations, Princeton 2023), adopted verbatim by LangChain/LangGraph, Letta (MemGPT), Mem0, IBM, and MongoDB. The directive's 7 categories map cleanly onto CoALA's canonical 4 (working, episodic, semantic, procedural) with two scope dimensions added (user, agent) for personalization and multi-agent systems, plus a renamed "conversational" subtype best treated as a specialized form of episodic/working memory (research §3.3).

## 2. Problem

The architectural problem: **define the top-level AI Memory architecture for SmartAgentics that (a) adopts the CoALA-aligned 7-category taxonomy (working, conversational, episodic, semantic, procedural, user, agent) as the SDK contract, with each category carrying its own lifecycle, write path, retention policy, and retrieval mode — one size does not fit all (this is the central lesson of the academic literature and managed-platform post-mortems); (b) uses the existing offline-first SQLite database (Stream 2/3 substrate) as the storage substrate — extend it with 3 new Prisma tables (`MemoryRecord` unified envelope, `MemoryEvent` raw episodic log, `MemoryAccessLog` audit) + SQLite FTS5 (BM25 keyword search) + a `vec0_memrecord` sqlite-vec virtual table (semantic search on memory embeddings, reusing Stream 2's `nomic-embed-text-v1.5`); memory lives in the same SQLite file as PMS data so memory operations are transactional with PMS operations and there is no separate database process; (c) ships a `MemoryStore` top-level SDK interface with 7 sub-interfaces (`WorkingMemory`, `ConversationalMemory`, `EpisodicMemory`, `SemanticMemory`, `ProceduralMemory`, `UserMemory`, `AgentMemory`) in a new file `packages/sdk/src/ai/memory.ts` — additive, no existing interface modified; (d) ships a `SQLiteMemoryStore` reference implementation in Phase 1, with `PostgresMemoryStore` (cloud parity reusing Stream 2's pgvector) and `Mem0CompatibleMemoryStore` (vendor-neutral wire format per arXiv:2606.01138) reserved for Phase 2+; (e) makes `tenantId` NOT NULL on every memory record and enforces a four-dimensional scope model (tenant/property/user/agent) at the SQL `WHERE` clause via Prisma middleware — isolation by architecture, never by prompt (Microsoft SFI rule); (f) treats memory as both high-value data AND a control plane (Microsoft SFI) — a 6-layer defense-in-depth posture against memory poisoning (MINJA 95% injection / 70% attack success; AgentPoison 80%+ across domains; MemoryGraft); (g) makes GDPR Art 15/16/17/20 first-class operations, not an afterthought — cascading delete reaches relational + vector + FTS5 + summaries; (h) carries provenance on every entry (sourceKind, sourceIdentity, sourceEventIds) so incident response and GDPR cascading delete are tractable; (i) reserves the Stream 5 (Agent Runtime) contract for agent identity (signed JWT with `agentId`/`tenantId`/`permissions`) so the memory layer can attribute writes to specific agents from Phase 1; and (j) makes all changes additive — no existing interface modified, no existing Prisma model modified, no breaking change to ADR-001 (only an amendment distinguishing contract NOW from implementation Phase 1 PoC) or ADR-011 (only an amendment reclassifying Memory as NOW).** This ADR is the umbrella architecture referenced by ADR-039 (Taxonomy) through ADR-048 (Framework Policy); it is the Stream 4 analog of Stream 3's ADR-028 (Knowledge Base Architecture) and Stream 2's ADR-023 (Vector Store).

## 3. Options

### Option A: Adopt Mem0 (managed platform or OSS) as the runtime memory layer

Use Mem0 Platform (managed SaaS) or Mem0 Open Source (Python + PostgreSQL + pgvector) for all 7 memory types. **Rejected** — research §5.5, §7.5, §0: Mem0 Platform breaks offline-first (cloud SaaS); Mem0 OSS adds a Python runtime + a second database process, conflicting with Stream 3's "no full framework runtime dependency" policy (ADR-037 analog). The _patterns_ (extraction + consolidation + user_id scoping, hybrid vector+BM25+graph boost, 91% lower p95 latency per arXiv:2504.19413) are adopted as reference; the _platform_ is not. See ADR-048 (Memory Framework Policy) for the full framework-avoidance rationale.

### Option B: Adopt Letta (MemGPT) as the runtime memory layer

Use Letta (Apache-2.0, self-hostable, Postgres-backed) for memory blocks and recall/archival tiers. **Rejected** — research §2.5: Letta is a full agent framework (Python, Docker, Postgres) — too heavy for Phase 1 and conflicts with Stream 3's framework-avoidance policy. The _pattern_ (4-block core memory: persona/human/task/scratchpad, persisted in DB, compiled into context at call time) is adopted for `WorkingMemory` (ADR-039 §2); the _platform_ is not.

### Option C: Adopt Zep / Graphiti (temporal knowledge graph) as the runtime memory layer

Use Zep's temporal knowledge graph (arXiv:2501.13956, SOTA on LongMemEval — 63.8% vs Mem0's 49.0% on GPT-4o). **Rejected** — research §5.5: Zep requires Graphiti (Python, Neo4j) — incompatible with offline-first Windows deployment. The _pattern_ (temporal supersession chain via `supersedes` field) is adopted at 10% of the complexity; the _platform_ is reserved for Phase 2+ if multi-hop reasoning demand emerges.

### Option D: Reuse the Stream 3 knowledge base for AI memory

Treat memory as a special document type in the existing `KnowledgeDocument`/`KnowledgeChunk`/`KnowledgeChunkVector` tables. **Rejected** — research §5.5: knowledge base = externally authoritative documents (SOPs, policies, rate sheets); memory = internally generated observations (episodes, extracted facts, preferences, procedures). Different authors, different governance, different lifecycles. They are complementary sibling subsystems sharing the same SQLite database, same embedding pipeline, same hybrid retrieval — but distinct schemas. Conflating them produces a confused schema.

### Option E: Reuse the existing `AuditEvent` Prisma table and `SemanticCacheEntry` for memory

Stretch the existing PMS audit table and LLM response cache to cover AI memory. **Rejected** — research §4.5: `AuditEvent` is PMS-domain audit (user actions on PMS entities), not AI episodic memory (agent decisions, RAG citations, tool calls). `SemanticCacheEntry` is a query-result cache with no per-user/per-agent scoping, no retention policy beyond `expiresAt`, no provenance, no supersession, no GDPR compliance. Conflating them produces a confused schema. Keep them separate; they may reference each other via `correlationId`.

### Option F: SmartAgentics-owned thin abstraction over the existing offline-first SQLite substrate; 7 SDK sub-interfaces; 3 new Prisma tables; sqlite-vec + FTS5 virtual tables; `SQLiteMemoryStore` reference implementation; Stream 5 agent-identity contract reserved

A `MemoryStore` top-level interface in a new file `packages/sdk/src/ai/memory.ts` with 7 sub-interfaces, each carrying its own lifecycle/write-path/retention/retrieval-mode contract. Backed by 3 new Prisma models (`MemoryRecord` unified envelope, `MemoryEvent` raw episodic log, `MemoryAccessLog` audit) + 2 raw SQL virtual-table migrations (`vec0_memrecord` sqlite-vec, `memrecord_fts` FTS5). `SQLiteMemoryStore` reference implementation in Phase 1. `tenantId` NOT NULL + four-dimensional scope model enforced by Prisma middleware. Memory lives in the same SQLite file as PMS data (transactional, offline-first, crash-safe via WAL). Additive — no existing interface or model modified. Per research §0, §13, §14, §17.

## 4. Decision

Adopt **Option F**. The AI Memory Architecture architectural contract is:

1. **7-category CoALA-aligned taxonomy as the SDK contract** — `MemoryStore` top-level interface with 7 sub-interfaces (`WorkingMemory`, `ConversationalMemory`, `EpisodicMemory`, `SemanticMemory`, `ProceduralMemory`, `UserMemory`, `AgentMemory`) in `packages/sdk/src/ai/memory.ts`. Each sub-interface carries a different lifecycle, write path, retention policy, and retrieval mode. Detailed in ADR-039.

2. **Storage substrate = existing SQLite database, extended** — Memory lives in the **same SQLite file as PMS data** (and as the Stream 3 knowledge base), scoped by `tenantId` mandatory NOT NULL on every record. Memory operations are transactional with PMS operations; there is no separate database process to manage. Three new Prisma models:
   - **`MemoryRecord`** — the unified envelope for working/conversational/semantic/user/agent memories (NOT episodic events). Carries: id, tenantId (NOT NULL), propertyId?, userId?, agentId?, sessionId?, teamId?, `type` (enum), `scope` (enum), `department`?, content, contentHash, embedding (Bytes, stored separately in vec0), confidence, importance, writtenAt, lastConfirmedAt, expiresAt?, retentionPolicy?, halfLifeDays, timesRetrieved, timesRetrievedAndConfirmed, sensitivity, supersedes?, supersededBy?, provenance (JSON), metadata (JSON), deletedAt?. 9 composite indexes on tenantId+*.
   - **`MemoryEvent`** — the append-only raw episodic log. Carries: id, tenantId (NOT NULL), propertyId?, agentId?, userId?, sessionId?, eventType (enum), eventTimestamp (indexed), payload (JSON), provenance (JSON), retentionExpiresAt?, retentionPolicy?, deletedAt?. 7 composite indexes including `(tenantId, eventTimestamp)` and `(tenantId, retentionExpiresAt)`.
   - **`MemoryAccessLog`** — the audit log of every memory operation (CREATE/READ/UPDATE/DELETE/EXPORT/PROMOTE) with operator identity, target record, timestamp, operation detail, IP/user-agent. 7-year retention. 5 composite indexes.
   - 2 enums: `MemoryType` (WORKING/CONVERSATIONAL/EPISODIC/SEMANTIC/USER/AGENT), `MemoryScope` (SESSION/USER_PRIVATE/AGENT_PRIVATE/TEAM_SHARED/PROPERTY_SHARED/TENANT_SHARED).
   - 2 raw SQL migrations: `vec0_memrecord` (sqlite-vec, partition-keyed on tenant_id, 768-dim nomic-embed-text-v1.5 vectors) and `memrecord_fts` (FTS5 with porter unicode61 tokenizer).
   - Full schema in research §13. ADR-040 (Storage & Encryption) details the schema; ADR-046 (Operations API) details the SDK surface.

3. **Reference implementation = `SQLiteMemoryStore`** — Phase 1 ships this. Phase 2+ may add `PostgresMemoryStore` (cloud parity, reusing pgvector from Stream 2) and `Mem0CompatibleMemoryStore` (vendor-neutral wire format per arXiv:2606.01138).

4. **Four-dimensional scope model + Prisma middleware enforcement** — `tenantId` (NOT NULL) + `propertyId?` + `userId?` + `agentId?` + `sessionId?` enforced on every retrieval query via Prisma middleware. No code path bypasses this — the `MemoryStore` interface accepts a `MemoryContext` parameter that is the only source of scoping. "Isolation by prompt" is explicitly listed as an access-control vulnerability. Detailed in ADR-041.

5. **Retention = tiered TTL ladder + Ebbinghaus decay + importance scoring** — different memory types have different forgetting mechanisms: working=session-scoped, episodic=180d TTL, summaries=365d, semantic/user/agent=no-TTL (governed by staleness/supersession/versioning), procedural=never TTL'd (versioned and deprecated), access-logs=7y. Ebbinghaus-style `recency_factor = 0.5^(age_days/half_life_days)` modulates retrieval ranking (decay the SCORE, not the data). Reinforcement on confirmation (not retrieval alone). Detailed in ADR-042.

6. **Deletion = GDPR Art 15/16/17/20 first-class operations** — `exportUserMemory(userId)` (Art 15/20), `updateMemory(recordId, newContent)` (Art 16 via supersession), `forgetUser(userId)` (Art 17 cascading delete with 30-day grace period), `MemoryAccessLog` (Art 5 minimization at the write gate). Tax-retention legal-basis tag (`retentionPolicy='TAX_7Y'`) exempts invoice/tax events from TTL per GDPR Art 17(3)(b). Detailed in ADR-043.

7. **Security = 6-layer defense-in-depth + SQLCipher encryption at rest** — (1) write gate (secret detection + PII redaction + injection-pattern detection + dedup); (2) scoped storage with isolation (per ADR-041); (3) RBAC on all operations; (4) trust-scored retrieval + cryptographic integrity checks (SHA-256 `contentHash`); (5) output validation (Phase 2+); (6) continuous monitoring (`MemoryAccessLog` 7-year retention + anomaly detection Phase 2+). SQLCipher (AES-256-CBC, per-tenant key derived from master key via HKDF, master key in OS keychain) for encryption at rest. Detailed in ADR-044.

8. **Procedural memory = file-based with validation gate** — procedures stored as version-controlled files in `procedures/candidates/{tenantId}/` (agent-authored) and `procedures/playbooks/{tenantId}/` (validated) + `procedures/playbooks/{default}/` (SmartAgentics pre-seeded hotel playbooks). Promotion requires validation (replay OR repetition OR human review) — **never automatic**. The validation gate is the foundation for AI safety: it prevents agents from silently rewriting their own operating rules. Detailed in ADR-045.

9. **Provenance on every entry** — every `MemoryRecord` and `MemoryEvent` carries a `provenance` JSON: sourceKind (USER_STATED/INFERRED/ADMIN_DECLARED/EXTRACTED/SYSTEM), sourceIdentity, sourceEventIds[], extractorModelVersion?. This is dual-purpose: the audit trail (security) AND the supersession/staleness machinery (lifecycle) AND the GDPR cascading-delete attribution (compliance). Detailed in ADR-047.

10. **Additive only — no existing interface or model modified** — The 3 new Prisma models, 2 enums, 2 raw SQL migrations, and the new `packages/sdk/src/ai/memory.ts` SDK file are all additive. `AIProvider.generate()` continues to work unchanged. The `OllamaRagGenerator` (Stream 3) is _extended_ (not modified) with `compileWorkingMemory(sessionId)` / `compileConversationalMemory(sessionId)` methods. The AIOS demo UI is left in place (it's a UI mock); the new SDK `MemoryStore` interface is the contract, and the demo UI can be retrofitted to project onto it in Phase E (optional). Two ADR amendments are recommended in Phase D (this ADR's contract; not in scope of this ADR itself): ADR-001 (distinguish Memory/vector contract NOW from implementation Phase 1 PoC — resolves FC-4.1/FC-4.2) and ADR-011 (reclassify Memory as NOW; acknowledge SDK gap — resolves FC-4.6).

11. **Phase 1 scope (4–6 weeks of Phase E engineering)** — `MemoryStore` SDK interface + 7 sub-interfaces + supporting types (3–5 days); 3 Prisma models + 2 enums + 2 raw SQL migrations (1–2 days); `SQLiteMemoryStore` + 7 sub-store reference impls; Prisma middleware for 4-dimensional scope + RBAC (1 week); Restate workflows (nightly retention sweep, nightly consolidation, post-session preference extraction, 30-day hard-delete sweep, nightly integrity check — 1 week); write gate + integrity checks (1 week); SQLCipher integration opt-in (1 week); `MemoryAccessLog` + audit UI; "My Memory" / "Procedure Management" / "Memory Admin" PMS UI pages; Promptfoo evals; integration tests. Deferred to Phase 2+: semantic fact extraction pipeline, procedural automated candidate capture + replay validation, agent team-shared memory + write-contention consolidation, anomaly detection, archival, multi-property user memory, F&B allergen safety flow — all depend on Stream 5 (Agent Runtime) or further product validation.

## 5. Rationale

- **The Phase B B4 #13 directive is technically sound and aligned with the academic consensus** — CoALA (arXiv:2309.02427, 927 citations, Princeton 2023) is adopted verbatim by LangChain/LangGraph, Letta, Mem0, IBM, and MongoDB. The directive's 7 categories map cleanly onto CoALA's canonical 4 plus two scope dimensions (user, agent) plus a renamed conversational subtype. SmartAgentics is not inventing a novel taxonomy; it is adopting the consensus (research §0, §3.3).
- **One size does not fit all** — The central lesson of the academic literature and managed-platform post-mortems: working memory is always-in-context (cheap, bounded); episodic memory is an append-only log (SQL retrieval, not embedding); semantic memory is a triple-store (relational + vector + FTS5); procedural memory is file-based (governance > retrieval); user memory is per-user preferences with explicit GDPR control; agent memory is per-agent learned patterns. Forcing everything through the vector store is "the most common substrate mistake" (research §5.1, design guide).
- **Memory is both data AND a control plane** (Microsoft SFI) — "Persistent memory doesn't just store information, it acts as a configuration layer for the AI system. A memory created today can influence tool selection, refusal behavior, and reasoning later, often outside the original context." This makes memory compromise worse than a database compromise — a persistent behavior-shaping attack (research §12.1). The 6-layer defense-in-depth is the minimum viable posture given documented attack success rates (MINJA 95% injection / 70% attack; AgentPoison 80%+; A-MemGuard misses 66% of poisoned entries).
- **Offline-first single-file SQLite is the right substrate** — Memory lives in the same SQLite file as PMS data, so a power failure mid-session does not lose working memory (SQLite is crash-safe via WAL). Memory operations are transactional with PMS operations. There is no separate database process to manage, no Python runtime, no Neo4j, no Docker. This mirrors Stream 2/3 conclusions and is the foundation of the offline Windows installer (research §0, §2.2).
- **Additive-only changes minimize risk** — No existing interface modified, no existing Prisma model modified, no breaking change. The 6 foundational conflicts (FC-4.1 through FC-4.6) are all resolvable with additive changes plus two ADR amendments (research §15, §21). The AIOS demo UI is left in place as a UI mock; the new SDK interface is the contract.
- **"No model training" is a strategic compliance advantage** — ADR-001 mandates local inference of pre-trained models only, no fine-tuning. Therefore the "AI fundamentally cannot comply with GDPR Art 17" critique (which applies to data baked into model weights) does NOT apply to SmartAgentics — all AI memory is in queryable storage (SQLite + sqlite-vec), not in model weights. Competitors who fine-tune on user data face the genuinely-hard "machine unlearning" problem; SmartAgentics does not (research §11.3).
- **`tenantId` NOT NULL + Prisma middleware is the Microsoft SFI rule** — "Isolate memory by user, agent, and tenant using deterministic controls like ACLs, scoped tokens, encryption at rest and in transit. Don't rely on model prompting for boundary enforcement." Prisma middleware is the only layer that ALL queries pass through; application-layer enforcement can be bypassed by a buggy code path (research §9.1, §9.3).
- **Reference implementation, not platform adoption** — Mem0, Letta, Zep, LangMem all offer excellent _patterns_ but unacceptable _platforms_ for an offline-first Windows installer (Python runtimes, second database processes, cloud SaaS, dependency bloat). SmartAgentics owns the abstraction; the patterns are adopted as reference. This mirrors Stream 1's `LocalLLMRuntime` (ADR-015), Stream 2's `VectorStore`/`EmbeddingsRuntime` (ADR-022/023), Stream 3's `RagGenerator` (ADR-030/037). See ADR-048 for the full framework policy.
- **Rejecting Mem0/Letta/Zep as runtime (Options A–C)** — research §2.5, §5.5, §7.5: patterns adopted, platforms rejected. Detailed in ADR-048.
- **Rejecting knowledge-base reuse (Option D)** — research §5.5: knowledge vs memory is an ontological distinction (external authoritative vs internally generated). Conflating produces a confused schema.
- **Rejecting `AuditEvent`/`SemanticCacheEntry` reuse (Option E)** — research §4.5: those tables serve different purposes; stretching them produces a confused schema with no GDPR compliance path.

## 6. Consequences

**Positive**:

- SmartAgentics gains a production-grade AI memory subsystem aligned with the academic and industry consensus (CoALA taxonomy), with 7 sub-types each having a distinct lifecycle — the foundation for agent personalization, episodic audit, procedural compounding, and multi-agent coordination.
- Memory lives in the existing offline-first SQLite substrate — no new database process, no Python runtime, no cloud SaaS, no breaking change to ADR-001's offline-first principle.
- All changes are additive — no existing interface or Prisma model modified; the 6 foundational conflicts are resolvable with additive changes plus two ADR amendments.
- Memory operations are transactional with PMS operations — a power failure mid-session does not lose working memory.
- `tenantId` NOT NULL + Prisma middleware + four-dimensional scope = isolation by architecture, not by prompt — the Microsoft SFI rule.
- GDPR Art 15/16/17/20 are first-class operations with cascading delete + 30-day grace + tax-retention legal-basis tagging — non-negotiable for EU deployment.
- "No model training" means the "AI cannot forget" critique does not apply — a strategic compliance advantage over fine-tuning competitors.
- Provenance on every entry makes incident response and GDPR cascading delete tractable.
- The 6-layer defense-in-depth is the minimum viable posture against documented memory-poisoning attacks (MINJA, AgentPoison, MemoryGraft).
- Procedural memory with validation gate is the foundation for AI safety — agents cannot silently rewrite their own operating rules.
- Feeds Stream 5 (Agent Runtime) — agent identity (signed JWT) contract reserved from Phase 1; Stream 5 just produces a new `MemoryContext` per agent.
- Feeds Stream 8 (Security & Governance) — `MemoryAccessLog` is the foundation for AI Audit (B4 #20); the 6-layer defense is the trust foundation.

**Negative / obligations**:

- Phase 1 must implement `MemoryStore` + 7 sub-interfaces + 3 Prisma models + 2 virtual tables + `SQLiteMemoryStore` + 7 sub-store reference impls + Prisma middleware + 5 Restate workflows + write gate + integrity checks + SQLCipher + `MemoryAccessLog` + 3 PMS UI pages + Promptfoo evals + integration tests — estimated 4–6 weeks of Phase E engineering (research §17.1). This is the cost of owning the abstractions.
- The SmartAgentics-owned abstractions must be maintained — bug fixes, feature additions, performance tuning are SmartAgentics' responsibility, not framework maintainers'.
- Stream 5 (Agent Runtime) is a hard dependency for several Phase 2+ deferrals (semantic fact extraction, procedural automated candidate capture + replay validation, agent team-shared memory, multi-agent coordination). Phase 1 ships with the contract reserved but the implementation deferred.
- The `MemoryContext` abstraction requires discipline — every memory operation must pass it; TypeScript makes it impossible to call without it; runtime validation rejects empty `tenantId`; lint rule bans `prisma.$queryRaw` for memory tables (research R-9.1).
- SQLCipher key management is non-trivial — master key in OS keychain with recovery flow; per-tenant keys derived via HKDF; documented key-rotation procedure; backup of encrypted database file + master key together (research R-12.2).
- The write gate's regex-based injection-pattern detection (Phase 1) will have false positives — Phase 2+ ships LLM-based detection; quarantined entries are reviewable by admin (research R-12.1).
- Pre-seeded hotel playbooks may not fit every property's workflow — per-tenant override directory mitigates (research R-6.4).
- The AIOS demo UI retrofit is optional — if not done, the demo's `MemoryType` enum (10 demo values) and the SDK's `MemoryType` enum (6 contract values) will diverge until retrofit.

**Dependencies on other ADRs**:

- Depends on ADR-001 (Reference Stack) — Next.js stack, Auth.js, Restate, offline-first principle, local-inference-only (no fine-tuning — the compliance advantage). **Amendment recommended in Phase D** to distinguish Memory/vector contract NOW from implementation Phase 1 PoC (resolves FC-4.1/FC-4.2).
- Depends on ADR-005 (Prisma) — Prisma middleware pattern for scope enforcement.
- Depends on ADR-006 (SQLite) — single-file offline-first substrate; WAL crash-safety.
- Depends on ADR-011 (TRB-007 Vision Reference) — **Amendment recommended in Phase D** to reclassify Memory as NOW and acknowledge SDK gap (resolves FC-4.6).
- Depends on ADR-013 (Observability Strategy) — every memory operation is traced (no framework-mediated opaque calls).
- Depends on ADR-015 (Local AI Runtime) — Ollama for compaction/summarization/extraction LLM calls; Phi-3.5-mini Phase 1 default.
- Depends on ADR-022 (Local Embeddings) — `nomic-embed-text-v1.5` (768-dim) for memory embeddings; same embedding pipeline as knowledge base.
- Depends on ADR-023 (Vector Store) — sqlite-vec for `vec0_memrecord` virtual table; OLTP-optimized UPDATE/INSERT/DELETE (critical for cascading deletes).
- Depends on ADR-024 (Hybrid Search) — RRF k=60 hybrid (BM25 + vector) for semantic memory retrieval.
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` partition key on `vec0_memrecord`.
- Depends on ADR-028 (Knowledge Base Architecture) — sibling subsystem pattern; shared SQLite substrate, shared embedding pipeline.
- Depends on ADR-030 (RAG Pipeline) — `OllamaRagGenerator` extended (not modified) with `compileWorkingMemory`/`compileConversationalMemory` methods; working-memory `scratchpad` and semantic-memory facts injected into the same RAG prompt as knowledge chunks via `<memory mem_id="..."/>` tags parallel to `<source chunk_id="..."/>`.
- Depends on ADR-032 (Source Attribution & Citation) — memory citations follow the same pattern as knowledge citations.
- Depends on ADR-033 (Confidence Scoring) — `confidence` field on every `MemoryRecord`; `CoverageConfidence` reused.
- Depends on ADR-037 (RAG Framework Policy) — framework-avoidance policy extended to memory (no Mem0/Letta/Zep runtime dependency). See ADR-048.
- Feeds ADR-039 (Memory Taxonomy) — the 7 sub-interfaces detailed.
- Feeds ADR-040 (Memory Storage & Encryption) — the schema and SQLCipher.
- Feeds ADR-041 (Memory Permissions & Isolation) — the scope model.
- Feeds ADR-042 (Memory Retention & Decay) — the TTL ladder and decay scoring.
- Feeds ADR-043 (Memory Deletion & GDPR) — the cascading delete.
- Feeds ADR-044 (Memory Security & Poisoning) — the 6-layer defense.
- Feeds ADR-045 (Procedural Memory Promotion) — the validation gate.
- Feeds ADR-046 (Memory Operations API) — the SDK surface.
- Feeds ADR-047 (Memory Provenance & Audit) — the provenance and audit log.
- Feeds ADR-048 (Memory Framework Policy) — the framework-avoidance extension.
- Feeds Stream 5 (Agent Runtime) — agent identity contract reserved; agents produce a `MemoryContext` from their signed JWT; agents use the `MemoryStore` as a tool, not a LangChain memory adapter.
- Feeds Stream 6 (Multi-Agent Collaboration) — `teamId` field on `MemoryRecord` reserved for Phase 2+ team-shared memory; write-contention consolidation pattern reserved.
- Feeds Stream 8 (Security & Governance) — `MemoryAccessLog` is the AI Audit foundation; the 6-layer defense is the trust foundation.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **Stream 5 (Agent Runtime) lands the agent-identity contract** — verify the signed JWT → `MemoryContext` derivation; verify the `MemoryPermission` enum covers all Stream 5 agent capabilities; verify the `AgentMemory` interface supports Stream 5's learned-patterns storage needs.
2. **A Phase 2+ evaluation demonstrates that the `SQLiteMemoryStore` is insufficient** (e.g., a multi-property chain tenant exceeds single-file SQLite scale, or multi-hop reasoning demand emerges that the `supersedes` chain cannot support) — draft a superseding ADR evaluating `PostgresMemoryStore` (pgvector) or a lightweight in-SQLite graph layer.
3. **A memory-poisoning attack is detected in production** (an AgentPoison/MINJA/MemoryGraft-style incident) — root-cause analysis; verify the 6-layer defense caught it or tighten the gap; verify the `MemoryAccessLog` enables reconstruction; consider Phase 2+ anomaly-detection acceleration.
4. **A GDPR Art 17 cascading-delete request misses a derived memory** (integration test or production incident) — root-cause the missing `provenance.sourceEventIds` link; tighten the write-gate provenance requirement; verify the fuzzy `LIKE` integration test catches the regression.
5. **A customer demands Mem0/Letta/Zep managed-platform integration** (e.g., "we already standardized on Mem0") — evaluate a `Mem0CompatibleMemoryStore` adapter (vendor-neutral wire format per arXiv:2606.01138) as a Phase 2+ option, behind the SmartAgentics-owned `MemoryStore` interface.
6. **SQLCipher key-loss incident occurs** (tenant key lost → tenant data unrecoverable) — root-cause the key-management failure; verify the master-key backup/recovery flow; consider field-level encryption escalation.
7. **AIOS demo UI retrofit is deferred indefinitely** — verify the demo's `MemoryType` enum divergence does not mislead developers; consider deprecating the demo's memory types in favor of the SDK enum.
8. **The ADR-001 / ADR-011 amendments are accepted** — verify this ADR's contract references align with the amended ADRs; verify the FC-4.1 through FC-4.6 resolutions are complete.
9. **Hotel-domain event types or procedural playbooks need revision** (e.g., a new PMS event type is added; a pre-seeded playbook is found to be wrong) — verify the `eventType` enum and `procedures/playbooks/{default}/` directory are versioned and updatable without redeployment.
10. **Annually**, as part of the regular ADR review cycle.
