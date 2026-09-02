# ADR-039: Memory Taxonomy

**ADR-ID:** ADR-039
**Status:** ACCEPTED
**Context:** 2026-09-01
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 item #13 mandates 7 AI memory sub-types: **working, conversational, episodic, semantic, procedural, agent, user** — each requiring ownership, permissions, retention, provenance, deletion rules, and tenant/property isolation. Phase C Stream 4 research (`/home/z/my-project/phase-c-stream4-ai-memory-report.md`, §2–§8, §3.3) confirms this directive is **technically sound and aligned with the academic consensus taxonomy**.

The canonical reference is **CoALA — Cognitive Architectures for Language Agents** (Sumers et al., arXiv:2309.02427, Princeton 2023, 927 citations), which describes "a language agent with modular memory components, a structured action space to interact with internal memory and external environments." CoALA's 4 canonical categories (working, episodic, semantic, procedural) are adopted verbatim by LangChain/LangGraph, Letta (MemGPT), Mem0, IBM, and MongoDB. The Phase B directive's 7 categories map cleanly onto CoALA's 4 plus two scope dimensions (user, agent) for personalization and multi-agent systems, plus a renamed "conversational" subtype that the research (§3.3) concludes is **best treated as a specialized form of episodic/working memory** — it deserves its own interface because (a) it is always in-context (unlike episodic which is retrieved on demand), (b) it has its own compaction strategy (sliding window + summary, not TTL+decay), and (c) the Phase B directive explicitly lists it as a separate category.

CoALA's three substrates for procedural memory are also foundational (research §6.1, citing arXiv:2309.02427): "embedded in LLM weights (training), written in agent code, or stored as explicit instruction sets. In-weights procedural knowledge cannot be updated without retraining. Code-embedded routing cannot be updated without a deployment. Only explicit instruction sets — system prompts and managed rule libraries — can be updated without touching the model or the code." This drives the file-based procedural memory substrate (ADR-045).

The central lesson of the academic literature and managed-platform post-mortems (research §5.1, design guide): **one size does not fit all**. "The most common substrate mistake is forcing everything through the vector store: preferences that should be key-value lookups get embedded and approximately retrieved, sometimes returning another user's preference as the nearest neighbor." Each memory type has a different lifecycle, write path, retention policy, and retrieval mode — and conflating them is "the most common design error" (research §5.3).

## 2. Problem

The architectural problem: **define the 7-category memory taxonomy contract that (a) adopts the CoALA-aligned 7 categories (working, conversational, episodic, semantic, procedural, user, agent) as 7 distinct SDK sub-interfaces extending the top-level `MemoryStore` (ADR-038); (b) specifies each category's lifecycle, write path, retention policy, retrieval mode, and scope — one size does not fit all; (c) maps each category to its cognitive-science foundation (Atkinson-Shiffrin modal model + Baddeley working memory; Tulving episodic/semantic distinction; Squire procedural; CoALA scope dimensions for user/agent); (d) for working memory, adopts the Letta/MemGPT 4-block pattern (persona/human/task/scratchpad) with token-budgeted compaction (summarize-then-prune on scratchpad only; never compact the task block); (e) for conversational memory, adopts the industry-consensus `ConversationSummaryBufferMemory` pattern (rolling buffer of recent turns verbatim + running summary of older turns; NOT embedded); (f) for episodic memory, adopts the append-only event log + temporal indexing pattern (4 composite indexes; SQL-only retrieval in Phase 1; optional semantic retrieval via sqlite-vec in Phase 2+); (g) for semantic memory, adopts the triple-store pattern (Prisma relational + sqlite-vec vector + FTS5 keyword) with supersession chain and staleness checks; (h) for procedural memory, adopts the file-based two-tier pattern (candidates/ vs playbooks/) with a validation gate (ADR-045); (i) for user memory, adopts the per-user preference store with explicit user control (OpenAI/Anthropic pattern) and 7 hotel-specific categories; (j) for agent memory, adopts the per-agent state + shared team memory with write-contention protection pattern (AWS AgentCore); (k) makes conversational memory functionally a specialized form of episodic/working memory (research §3.3) but deserving its own interface for the three reasons above; and (l) feeds Stream 5 (Agent Runtime) — the taxonomy is the contract that every future agent inherits without re-architecting memory.** This ADR is the cognitive-foundation companion to ADR-038 (Architecture); it is referenced by ADR-040 through ADR-048 for the per-type implications.

## 3. Options

### Option A: Collapse to CoALA's canonical 4 categories (working, episodic, semantic, procedural) and drop user/agent/conversational

Use only the 4 CoALA categories; treat user preferences as scoped semantic facts; treat agent state as scoped episodic events; treat conversation as working memory. **Rejected** — research §3.3, §7.3, §8.3: (a) the Phase B directive explicitly mandates 7; (b) user memory has distinct GDPR Art 15/16/17/20 obligations that semantic facts don't (per-user explicit control UI); (c) agent memory has distinct per-agent isolation + team-shared write-contention concerns that episodic events don't (an agent's private notebook must not be readable by other agents — AWS AgentCore pattern); (d) conversational memory is always in-context (unlike episodic retrieved on demand) with its own compaction strategy (sliding window + summary, not TTL+decay). Collapsing loses these distinctions.

### Option B: Adopt the AIOS demo's 10-value `MemoryType` enum (short/long/project/organization/conversation/tool/domain/semantic/vector/knowledge)

Use the AIOS demo UI's enum as the taxonomy. **Rejected** — research §1.2, FC-4.5: the AIOS demo `MemoryType` is a UI mock with no `tenantId`, no `userId`, no `agentId`, no permissions, no provenance, no deletion rules, no security. Its 10 values mix scope (short/long) with content (semantic/knowledge) with storage (vector) — not a coherent taxonomy. The CoALA-aligned 7 categories are the contract; the demo enum is retrofitted to project onto it (optional Phase E).

### Option C: Adopt LangChain's flat memory-type list (ConversationBufferMemory, ConversationSummaryMemory, etc.) as the taxonomy

Use LangChain's classic memory-type classes as the categories. **Rejected** — research §3.1: LangChain's types are _implementation classes_ (buffer vs summary vs KG), not _cognitive categories_. They conflate conversational buffer with working memory and have no episodic/semantic/procedural distinction. The CoALA cognitive categories are the contract; LangChain's `ConversationSummaryBufferMemory` pattern is adopted as the _implementation_ of `ConversationalMemory` (research §3.2).

### Option D: Adopt Letta's 3-tier memory hierarchy (Core/Recall/Archival) as the taxonomy

Use Letta's Core/Recall/Archival tiers as the categories. **Rejected** — research §2.1: Letta's tiers are _storage tiers_ (in-context/out-of-context-vector), not _cognitive categories_. They map onto working (Core) + episodic (Recall) + semantic (Archival) but lose procedural/user/agent. Letta's _4-block Core Memory pattern_ (persona/human/task/scratchpad) is adopted as the implementation of `WorkingMemory` (research §2.2); the 3-tier hierarchy is not.

### Option E: CoALA-aligned 7-category taxonomy as 7 distinct SDK sub-interfaces, each with its own lifecycle/write-path/retention/retrieval-mode; cognitive-science foundations documented; Letta/LangChain/Mem0 patterns adopted as implementations

`MemoryStore` (ADR-038) with 7 sub-interfaces: `WorkingMemory` (Letta 4-block, token-budgeted, session-scoped), `ConversationalMemory` (`ConversationSummaryBufferMemory`-equivalent, session-scoped, NOT embedded), `EpisodicMemory` (append-only event log, temporal indexing, 180d TTL), `SemanticMemory` (triple-store + supersession + staleness), `ProceduralMemory` (file-based, validation gate, ADR-045), `UserMemory` (per-user preferences, 7 hotel categories, explicit control), `AgentMemory` (per-agent state + team-shared with write-contention). Each carries documented cognitive-science foundation. Per research §2–§8.

## 4. Decision

Adopt **Option E**. The Memory Taxonomy architectural contract is:

1. **`WorkingMemory` — Letta-style 4-block, token-budgeted, session-scoped** (research §2.2):
   - 4 blocks per active agent session: `persona` (agent identity, never user-modifiable), `human` (user facts the agent should always remember this session), `task` (current goal + plan + open questions), `scratchpad` (intermediate tool results, agent's own notes).
   - Storage: `MemoryRecord` rows with `type='WORKING'`, `scope='SESSION'`, keyed by `(tenantId, agentId, sessionId, blockLabel)`. NOT embedded (no semantic search over working memory — always in-context).
   - Token budget: persona 5% (~500), human 10% (~1000), task 15% (~1500), scratchpad 30% (~3000), retrieved long-term 30% (~3000), headroom 10% (~1000). Total ~10K tokens of context budget. Configurable per agent per tenant via `SystemConfig`.
   - Compaction: when `scratchpad` exceeds 80% budget, trigger summarize-then-prune (call Ollama with preservation-contract prompt; replace raw scratchpad with summary; move raw to `MemoryEvent`). **Never compact the `task` block** — losing the current plan mid-task is the worst compaction failure mode (research §2.3).
   - Session lifecycle: created on session start, mutated during session, either deleted at session end (default) or promoted to episodic if consequential (configurable per agent).
   - Cognitive foundation: Atkinson-Shiffrin modal model (short-term memory) + Baddeley working memory (actively-maintained planning surface) + CoALA "short-term scratchpad" + Letta Core Memory blocks.

2. **`ConversationalMemory` — `ConversationSummaryBufferMemory`-equivalent, session-scoped, NOT embedded** (research §3.2):
   - Rolling buffer of recent turns (default 8 = 4 user + 4 assistant) verbatim + running summary of older turns.
   - Storage: `MemoryRecord` with `type='CONVERSATIONAL'`, `scope='SESSION'`, keyed by `(tenantId, agentId, sessionId)`. Each turn is also a `MemoryEvent` row (raw episodic) so the full transcript is never lost.
   - When buffer exceeds 8 turns, oldest 4 are summarized via Ollama; summary replaces them; raw turns remain in `MemoryEvent`.
   - Retrieval at LLM call time: `[running summary]\n\n[recent 8 turns verbatim]` injected into `messages` array.
   - Cross-session: at session end, running summary promoted to `UserMemory` via Restate workflow. Raw `MemoryEvent` rows remain (subject to TTL).
   - NOT embedded — retrieved by `(sessionId)` not by semantic similarity. Embedding conversation history is an anti-pattern (loses turn order, produces cross-user contamination).
   - Cognitive foundation: functionally a specialized form of episodic/working memory (research §3.3) — deserves its own interface because (a) always in-context, (b) own compaction strategy (sliding window + summary), (c) Phase B directive lists it separately. LangChain `ConversationSummaryBufferMemory` is the industry consensus default.

3. **`EpisodicMemory` — append-only event log + temporal indexing, 180d TTL, SQL-only retrieval in Phase 1** (research §4.2):
   - `MemoryEvent` table: immutable append-only. Schema: id, tenantId (NOT NULL), propertyId?, agentId?, userId?, sessionId?, eventType (enum: USER_MESSAGE/ASSISTANT_MESSAGE/TOOL_CALL/TOOL_RESULT/DECISION/OBSERVATION/SYSTEM_EVENT/ERROR/HUMAN_APPROVAL/ESCALATION + hotel-domain: RESERVATION_CREATED/GUEST_CHECKED_IN/GUEST_CHECKED_OUT/ROOM_STATUS_CHANGED/INVOICE_GENERATED/INVENTORY_ADJUSTED + AI-specific: AGENT_DECISION/RAG_CITATION_USED/HUMAN_APPROVAL_GRANTED/ESCALATION_TRIGGERED), eventTimestamp (indexed), payload (JSON), provenance (JSON), retentionExpiresAt, retentionPolicy, deletedAt.
   - Temporal indexing: 4 composite indexes — `(tenantId, eventTimestamp DESC)`, `(tenantId, agentId, eventTimestamp DESC)`, `(tenantId, userId, eventTimestamp DESC)`, `(tenantId, sessionId, eventTimestamp ASC)`. This is the Atlan "Event Logging + Temporal Context" two-pillar architecture.
   - Retrieval modes (all SQL, not vector, in Phase 1): temporal ("last 7 days"), session-replay ("replay this conversation"), actor-filtered ("recent decisions by this agent"), outcome-filtered ("recent errors").
   - Optional embedding (Phase 2+): async Restate workflow embeds DECISION/OBSERVATION events with substantive content into `vec0_memrecord` partition-keyed on tenantId. Embed every event is wasteful — "decay the score, not the data" applies: embed only consequential events.
   - TTL: default 180-day TTL on raw `MemoryEvent` rows; tax-tagged events (`retentionPolicy='TAX_7Y'`) exempt — 7-year tax retention on tax-law legal basis (GDPR Art 17(3)(b)).
   - Consolidation: nightly Restate workflow reads recent events, extracts durable facts (→ `SemanticMemory`) and preferences (→ `UserMemory`), writes extracted records with `provenance.sourceEventIds` backlinks. Raw events NOT deleted by consolidation (deleted by TTL).
   - Cognitive foundation: Tulving episodic memory ("records of specific past experiences: what happened, when, in which session, with what outcome") + CoALA episodic + Letta Recall Memory + Mem0 Episodic API + AWS AgentCore short-term memory + REMem (arXiv:2602.13530) + "Episodic Memory is the Missing Piece for Long-Term LLM Agents" (arXiv:2502.06975).

4. **`SemanticMemory` — triple-store (relational + vector + FTS5) + supersession + staleness, no TTL** (research §5.2):
   - `MemoryRecord` with `type='SEMANTIC'`, `scope='TENANT_SHARED'` (or `USER_PRIVATE` for user-specific facts).
   - Triple indexing: (1) Prisma row (system of record, answers all non-similarity questions); (2) `vec0_memrecord` (semantic similarity, RRF k=60 hybrid with FTS5 per Stream 2/3); (3) `memrecord_fts` FTS5 (keyword/BM25).
   - Supersession: `supersedes` field points to old record's id; old record NOT deleted (audit trail) but excluded from retrieval (`WHERE supersedes IS NULL`). This is the "explicit chain instead of two contradictory records tied in a similarity search" pattern (design guide).
   - Staleness: every fact carries `lastConfirmedAt`. Nightly Restate workflow re-evaluates facts whose `validityBasis` references a PMS entity; if entity changed since `lastConfirmedAt`, flag `stale=true` and down-rank in retrieval (0.8 multiplier per Stream 3's staleness pattern).
   - Governance state (Atlan enterprise gap): facts from authoritative sources (policy doc, admin declaration) carry `metadata.certified=true`, `metadata.approvedBy`, `metadata.approvedAt`, `metadata.version`. Extracted facts carry `certified=false` + `confidence`. Retrieval can filter by certification for high-stakes decisions.
   - KG vs vector: Phase 1 = vector + relational only (no graph database). `metadata.entityReferences[]` captures entity relationships implicitly. Phase 2+ may add lightweight in-SQLite entity/edge tables for multi-hop reasoning — but only if Phase 1 usage demonstrates the need. Mem0 native-graph (no external store) is the Phase 2+ model if needed.
   - Cognitive foundation: Tulving semantic memory ("general facts and knowledge distilled from experience or ingested from outside") + CoALA semantic + Mem0 graph memory (arXiv:2504.19413) + Zep temporal KG (arXiv:2501.13956, SOTA on LongMemEval — pattern adopted at 10% complexity via `supersedes` chain).

5. **`ProceduralMemory` — file-based two-tier with validation gate, never TTL'd, version-controlled** (research §6.2; detailed in ADR-045):
   - Procedures stored as version-controlled files (markdown/YAML), NOT in vector store, NOT in Prisma.
   - Two directories: `procedures/candidates/{tenantId}/` (agent-authored, `status: candidate`) and `procedures/playbooks/{tenantId}/` (validated, `status: active`/`deprecated`) + `procedures/playbooks/{default}/` (SmartAgentics pre-seeded hotel playbooks — `check_in_guest.md`, `check_out_guest.md`, `handle_overbooking.md`, `process_no_show.md`, `handle_complaint.md`, `escalate_to_manager.md`, `apply_rate_code.md`, `generate_invoice.md`, etc.).
   - Progressive disclosure (Anthropic Agent Skills pattern): YAML front-matter (`name`/`description`/`appliesTo`/`version`/`status`/`provenance`) always loadable into `task` block; body loaded on demand via `readProcedure(name)` tool.
   - Promotion pipeline (validation gate — never automatic): candidate capture → evidence attachment → validation (replay OR repetition OR human review) → versioned write → scoped rollout.
   - Retrieval: `OllamaRagGenerator` loads YAML headers of all active procedures into `task` block; agent calls `readProcedure(name)` for full body.
   - Cognitive foundation: CoALA "knowledge of how to do things" + Squire procedural + CoALA's three substrates (in-weights / in-code / explicit instruction sets — only explicit instruction sets are updatable without retraining/deployment) + LangMem (prompt rules updated over time) + Anthropic Agent Skills (progressive disclosure) + Mem^p (arXiv:2508.06433). The design guide's central rule: "an unvalidated procedure must never be automatically promoted into permanent procedural memory. A bad fact in semantic memory misleads one retrieval; a bad procedure in procedural memory misleads every future execution of that task class, with the agent's full confidence behind it."

6. **`UserMemory` — per-user preferences with explicit user control, 7 hotel categories, GDPR-compliant** (research §7.2):
   - `MemoryRecord` with `type='USER'`, `scope='USER_PRIVATE'`, keyed by `(tenantId, userId)`.
   - 7 hotel-specific categories: `ROOM_PREFERENCE` (floor/bed type/away from elevator), `DIETARY` (allergies/restrictions — critical for F&B safety), `COMMUNICATION` (preferred language/channel/tone), `ACCESSIBILITY` (mobility/visual/hearing), `PAYMENT` (preferred method/billing format), `LOYALTY` (tier/program — but NOT the number itself, just membership fact), `OTHER`.
   - Extraction: Restate workflow runs after each session, scans `MemoryEvent` rows, extracts candidate preferences via Ollama, consolidates via supersession. Inferred: `confidence=0.5`. User-stated: `confidence=0.9`.
   - Explicit user control (OpenAI/Anthropic pattern): PMS "My Memory" UI page — view all preferences, edit, delete (immediate hard-delete + audit), toggle "AI Memory" off, export as JSON (GDPR Art 20), "Forget Everything" (GDPR Art 17 cascading delete per ADR-043).
   - PII handling: PII NOT stored in `UserMemory` — PII lives in PMS `Guest` entity. Extraction prompt redacts PII before storing. This is the Microsoft SFI rule: "Block from memory: Credentials, API keys, payment data, government IDs."
   - Sensitivity tagging: LOW/MEDIUM/HIGH. HIGH-sensitivity (accessibility, dietary allergies) retrieved only for relevant department (F&B for dietary, housekeeping for accessibility) — enforced by department ACL.
   - Cognitive foundation: Mem0 user memory + OpenAI ChatGPT memory (Settings > Personalization > Memory) + Anthropic Claude memory (3 spaces: shared/project/incognito) + Decagon user memory + hotel-industry guest profiles (PMS/CRM). The line between "preference" (allowed) and "PII" (not allowed) is critical.

7. **`AgentMemory` — per-agent state + shared team memory with write-contention protection** (research §8.2):
   - `MemoryRecord` with `type='AGENT'`, `scope='AGENT_PRIVATE'`, keyed by `(tenantId, agentId)`. Agent's "private notebook" — other agents cannot read it.
   - Per-agent isolation: SQL `WHERE tenantId=? AND agentId=?` enforced on every retrieval. AWS AgentCore pattern: "the shopping agent can't access memories stored by the travel agent, even for the same tenant."
   - Shared team memory: `scope='TEAM_SHARED'` with `teamId` field (Phase 2+) allows multiple agents in a team to read shared state (task progress, discovered facts, team decisions). Writes go through the **same gate-and-consolidate pipeline** as all other writes — no agent directly mutates a shared record; agents post proposals (as `MemoryEvent` rows) and a Restate consolidator merges them. This is the design guide's hazard mitigation: "route all writes through the same gate-and-consolidate pipeline rather than letting multiple agents mutate records directly."
   - Agent identity (extends Stream 5 / B4 #14 `AgentContract`): `agentId` (CUID), `agentType` (enum: FRONT_DESK/CONCIERGE/HOUSEKEEPING/MAINTENANCE/BILLING/etc.), `tenantId`, `propertyId?`, `version`, `permissions` (JSON: memory scopes), `tools` (JSON).
   - Learned patterns: agent's operational history (success rate per task type, avg tokens per task, common error patterns, learned tool preferences) stored as `MemoryRecord` with `type='AGENT'`, `category='LEARNED_PATTERN'`. Input to Stream 5's AI Supervisor (B4 #18) and to procedural promotion pipeline (ADR-045).
   - Phase 1 scope: per-agent isolation + basic learned-patterns (task success/failure counts, avg tokens). Defer team-shared + write-contention consolidation to Phase 2+ (depends on Stream 5 multi-agent runtime).
   - Cognitive foundation: multi-agent memory architectures (AWS S3 Vectors, MongoDB, Mem0 multi-agent) + AWS AgentCore agent isolation + Letta multi-agent shared memory blocks + design guide write-contention hazard warning. Microsoft SDL for AI (Feb 2026): "In multi-agent architectures where agents share memory, the risks multiply. Shared or global memory is the higher-risk surface and needs stricter access controls."

8. **Conversational as specialized episodic/working — documented** — The research (§3.3) concludes conversational memory is functionally a specialized form of episodic/working memory but deserves its own interface for the three reasons cited. This is documented in the SDK JSDoc and the ADR-039 rationale so future maintainers understand why there are 7 interfaces, not 6 (collapsed) or 4 (CoALA canonical).

## 5. Rationale

- **CoALA is the academic consensus, adopted verbatim by the industry** — arXiv:2309.02427 (927 citations, Princeton 2023); adopted by LangChain/LangGraph, Letta, Mem0, IBM, MongoDB. SmartAgentics is not inventing a novel taxonomy; it is adopting the consensus and extending with two scope dimensions (user, agent) plus a renamed conversational subtype per the Phase B directive (research §0, §3.3).
- **One size does not fit all** — The central lesson of the academic literature and managed-platform post-mortems: working memory is always-in-context (cheap, bounded); episodic memory is an append-only log (SQL retrieval, not embedding); semantic memory is a triple-store; procedural memory is file-based (governance > retrieval); user memory is per-user preferences with explicit GDPR control; agent memory is per-agent learned patterns. Forcing everything through the vector store is "the most common substrate mistake" (research §5.1, design guide).
- **The substrate must match the hard problem, not the easy one** — For procedural memory, "the retrieval problem is mild (tens to hundreds of procedures, addressable by name) while the governance problem is severe (diffs, reviews, rollbacks, audit). Choose the substrate for the hard problem, not the easy one." Hence file-based, not vector-based (research §6.1).
- **Working memory's worst failure mode is silent task-plan compaction** — "Losing the current plan mid-task is the worst compaction failure mode" (research §2.3). Mitigation: never compact the `task` block; only the `scratchpad`.
- **Conversational memory must NOT be embedded** — "Preferences that should be key-value lookups get embedded and approximately retrieved, sometimes returning another user's preference as the nearest neighbor." Conversation is a sequence to be replayed, not a fact to be retrieved. Embedding loses turn order and produces cross-user contamination (research §3.2, §3.5).
- **Episodic memory is the append-only source of truth** — It is NOT for in-context retrieval (that's working/conversational's job) — it is for "what happened?" queries after the fact: audit, incident response, consolidation. TTL is the deletion mechanism, not consolidation (research §4.3).
- **Semantic memory's supersession chain captures 80% of temporal-KG value at 10% of complexity** — Zep's temporal KG (arXiv:2501.13956) is SOTA but requires Graphiti (Python, Neo4j) — incompatible with offline-first. The `supersedes` chain in the relational record is the offline-first equivalent (research §5.3).
- **User memory is the most privacy-sensitive and most regulated** — GDPR Art 15/16/17/20 all apply directly. The OpenAI/Anthropic explicit-user-control pattern is both a compliance requirement and a trust feature. "Hotels that let guests inspect and control their AI memory will win trust; hotels that don't will face GDPR complaints" (research §7.3).
- **Agent memory's catastrophic failure mode is cross-agent contamination** — "A compromised agent reads another agent's private memory if isolation fails." Mitigation: SQL `WHERE agentId=?` + Prisma middleware + `MemoryAccessLog` audit (research R-8.1).
- **Procedural memory's catastrophic failure mode is silent self-modification** — "An unvalidated procedure must never be automatically promoted." The two-tier `candidates/` vs `playbooks/` structure is the cheapest possible defense (research §6.3).
- **Rejecting collapse-to-4 (Option A)** — Loses user/agent/conversational distinctions that have real compliance, isolation, and compaction implications.
- **Rejecting AIOS demo enum (Option B)** — UI mock with incoherent 10 values mixing scope/content/storage.
- **Rejecting LangChain types (Option C)** — Implementation classes, not cognitive categories.
- **Rejecting Letta 3-tier (Option D)** — Storage tiers, not cognitive categories; loses procedural/user/agent.

## 6. Consequences

**Positive**:

- 7 distinct SDK sub-interfaces, each with a documented cognitive-science foundation, lifecycle, write path, retention policy, and retrieval mode — the contract that every future agent inherits without re-architecting memory.
- CoALA alignment means SmartAgentics is interoperable with the academic and industry consensus — patterns from LangChain/Letta/Mem0/Zep can be adopted as implementations without lock-in.
- Each memory type gets the right substrate: working=in-context blocks, conversational=buffer+summary, episodic=append-only SQL log, semantic=triple-store, procedural=file-based, user=per-user preferences with GDPR control, agent=per-agent state with team-shared.
- The validation gate for procedural memory is the foundation for AI safety — agents cannot silently rewrite their own operating rules.
- The explicit user control for user memory is both GDPR compliance and a competitive differentiator.
- Feeds Stream 5 (Agent Runtime) — `AgentMemory` is the bridge: `AgentContract` (B4 #14) defines what an agent IS; `AgentMemory` defines what an agent HAS LEARNED.
- Feeds Stream 6 (Multi-Agent Collaboration) — `teamId` field and team-shared scope reserved for Phase 2+.

**Negative / obligations**:

- 7 sub-interfaces is more surface area than 1 — each must be implemented (`SQLiteWorkingMemory`, `SQLiteConversationalMemory`, etc.), tested, documented. Phase 1 effort estimate: 1–2 weeks per sub-store (research §17.1).
- The cognitive-science foundations must be documented in SDK JSDoc so future maintainers understand why there are 7 interfaces, not 6 or 4.
- Conversational memory's "specialized form of episodic/working" status is a documented compromise — future maintainers may be tempted to collapse it; the rationale (always in-context, own compaction, Phase B directive) must be preserved.
- Procedural memory's file-based substrate is counter-intuitive (most teams reach for a vector store for everything) — the design guide's "choose the substrate for the hard problem" rationale must be preserved.
- Pre-seeded hotel playbooks (10–15 default procedures) must be authored, versioned, and updatable without redeployment (research R-6.4, Open Question #6).
- The `eventType` enum for episodic memory must be extended as new PMS event types are added — the hotel-domain events align with the existing 5 SDK event contracts (`packages/sdk/src/events/index.ts`) but new ones will emerge.

**Dependencies on other ADRs**:

- Depends on ADR-038 (AI Memory Architecture) — the top-level `MemoryStore` interface and storage substrate.
- Depends on ADR-015 (Local AI Runtime) — Ollama for compaction/summarization/extraction LLM calls.
- Depends on ADR-022 (Local Embeddings) — `nomic-embed-text-v1.5` for semantic memory embeddings.
- Depends on ADR-023 (Vector Store) — sqlite-vec for `vec0_memrecord`.
- Depends on ADR-024 (Hybrid Search) — RRF k=60 for semantic memory retrieval.
- Depends on ADR-027 (Multi-Tenant Vector Isolation) — `tenantId` partition key.
- Depends on ADR-030 (RAG Pipeline) — `OllamaRagGenerator` extended with `compileWorkingMemory`/`compileConversationalMemory`; semantic facts injected into RAG prompt via `<memory mem_id="..."/>` tags.
- Depends on ADR-033 (Confidence Scoring) — `confidence` field on every `MemoryRecord`.
- Feeds ADR-040 (Storage & Encryption) — the schema for each type.
- Feeds ADR-041 (Permissions & Isolation) — the scope enum and per-type isolation rules.
- Feeds ADR-042 (Retention & Decay) — the per-type TTL ladder.
- Feeds ADR-043 (Deletion & GDPR) — the per-type cascading-delete semantics.
- Feeds ADR-044 (Security & Poisoning) — the per-type write-gate rules.
- Feeds ADR-045 (Procedural Memory Promotion) — the validation gate for procedural.
- Feeds ADR-046 (Operations API) — the per-type SDK methods.
- Feeds ADR-047 (Provenance & Audit) — the per-type provenance fields.
- Feeds Stream 5 (Agent Runtime) — `AgentMemory` + agent identity contract.
- Feeds Stream 6 (Multi-Agent Collaboration) — `teamId` and team-shared scope.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A new cognitive-science paper revises the CoALA taxonomy** (e.g., a new canonical category emerges in the literature) — evaluate whether the 7-category contract should be extended; verify the SDK sub-interface pattern accommodates new categories additively.
2. **A Phase 2+ evaluation demonstrates that collapsing conversational into episodic/working is safe and simpler** — draft a superseding ADR evaluating the collapse; verify the three rationale reasons (always in-context, own compaction, Phase B directive) no longer apply.
3. **Stream 5 (Agent Runtime) lands the `AgentContract`** — verify the `AgentMemory` interface supports Stream 5's learned-patterns storage needs; verify the `agentType` enum covers all Stream 5 agent types; verify the `teamId` field and team-shared scope design supports Stream 6 multi-agent coordination.
4. **A Phase 2+ multi-hop reasoning demand emerges that the `supersedes` chain cannot support** — evaluate a lightweight in-SQLite graph layer (entity/edge tables) for semantic memory; verify the Mem0 native-graph pattern is the right model.
5. **Hotel-domain event types or procedural playbooks need significant extension** (e.g., a new industry pack beyond hotels) — verify the `eventType` enum and procedural categories are extensible without redeployment; consider extracting industry-specific taxonomies into per-industry packs.
6. **Pre-seeded hotel playbooks are found to be wrong or insufficient** — verify the per-tenant override directory and `status: deprecated` rollback mechanism work; verify the validation gate catches bad promotions before they reach production.
7. **A user-memory PII leakage incident occurs** (extraction prompt fails to redact) — root-cause the extraction prompt; tighten the PII redaction regex; verify the periodic PII-pattern scan (Phase 2+) would have caught it.
8. **A cross-agent contamination incident occurs** (compromised agent reads another agent's memory) — root-cause the isolation failure; verify SQL `WHERE agentId=?` enforcement; verify `MemoryAccessLog` reconstruction.
9. **The AIOS demo UI retrofit is completed or abandoned** — verify the demo's `MemoryType` enum (10 demo values) is mapped to the SDK's `MemoryType` enum (6 contract values) or document the divergence.
10. **Annually**, as part of the regular ADR review cycle.
