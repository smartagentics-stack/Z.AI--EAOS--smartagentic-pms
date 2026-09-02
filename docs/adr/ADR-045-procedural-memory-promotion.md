# ADR-045: Procedural Memory & Promotion Gate

**ADR-ID:** ADR-045
**Status:** ACCEPTED
**Context:** 2026-09-01
**Owner:** Architecture Office

---

## 1. Context

ADR-039 (Taxonomy) §6 established that `ProceduralMemory` is one of the 7 sub-interfaces, with a distinct substrate (file-based, not vector-store) and a distinct lifecycle (versioned, never TTL'd). Phase C Stream 4 research (`/home/z/my-project/phase-c-stream4-ai-memory-report.md`, §6) details the procedural memory architecture and the validation gate that is its defining feature.

The cognitive-science foundation (research §6.1) is CoALA + Squire: procedural memory = "knowledge of how to do things. CoALA splits this into implicit procedural memory (the skills baked into the LLM's weights) and explicit procedural memory (the agent's own code, prompts, and learned rules). The implementation form for the explicit half is system prompts, playbooks, skills, and validated runbooks." CoALA identifies three substrates for procedural memory (research §6.1): "embedded in LLM weights (training), written in agent code, or stored as explicit instruction sets. This is an important distinction for enterprise architects. **In-weights procedural knowledge cannot be updated without retraining. Code-embedded routing cannot be updated without a deployment. Only explicit instruction sets — system prompts and managed rule libraries — can be updated without touching the model or the code.**" This drives the file-based substrate decision.

The critical design rule (research §6.1, design guide) is unambiguous: "**an unvalidated procedure must never be automatically promoted into permanent procedural memory.** A bad fact in semantic memory misleads one retrieval; a bad procedure in procedural memory misleads every future execution of that task class, with the agent's full confidence behind it." And: "Procedural memory wants to live in version-controlled, diffable, human-reviewable form — files in a repository, not rows in a vector store. The retrieval problem for procedures is mild (there are usually tens to hundreds of them, addressable by name and short description), while the governance problem is severe (you need diffs, reviews, rollbacks, and audit). **Choose the substrate for the hard problem, not the easy one.**"

The two-tier structure (research §6.1, design guide): "A practical starting point that avoids over-engineering: keep candidate procedures in a `candidates/` area written freely by the agent, and promote to the live `playbooks/` area only through the validation gate. The agent can be told, in its system prompt, that candidates are suggestions and playbooks are law. This two-tier structure costs almost nothing and prevents the single worst outcome — silent self-modification of the agent's own operating rules."

The ecosystem immaturity (research §6.1): "Mem0's State of AI Agent Memory 2026 report, surveying the ecosystem, describes the tooling for managing procedural memory specifically as 'still early-stage.' ... that immaturity is exactly why procedural memory is the highest-leverage layer to design deliberately: it is where an agent's performance compounds, and where the ecosystem gives you the least off-the-shelf help."

Academic research (research §6.1): "Mem^p: Exploring Agent Procedural Memory" (arXiv:2508.06433). And: "Agent Skills organize instructions, executable code, and supporting resources into modular skill units, and follow a principle of context minimization" (techrxiv). And Anthropic Agent Skills: "implement this as folders with a SKILL definition whose body loads only when relevant, which is procedural memory with built-in working-memory hygiene" (progressive disclosure — short description always visible, full instructions loaded on demand).

## 2. Problem

The architectural problem: **define the procedural memory and promotion gate contract that (a) stores procedures as version-controlled files (markdown/YAML) in two directories per tenant — `procedures/candidates/{tenantId}/` (agent-authored, `status: candidate`) and `procedures/playbooks/{tenantId}/` (validated, `status: active`/`deprecated`) + `procedures/playbooks/{default}/` (SmartAgentics pre-seeded hotel playbooks) — NOT in the vector store, NOT in Prisma, because the retrieval problem is mild (tens to hundreds of procedures, addressable by name) while the governance problem is severe (diffs, reviews, rollbacks, audit); (b) adopts progressive disclosure (Anthropic Agent Skills pattern) — YAML front-matter (`name`/`description`/`appliesTo`/`version`/`status`/`provenance`) always loadable into the `task` block of working memory; body (full procedure steps) loaded on demand via a `readProcedure(name)` tool; (c) implements a promotion pipeline (the validation gate — never automatic): (1) candidate capture (agent or Restate extraction workflow drafts a candidate procedure), (2) evidence attachment (candidate links to motivating episodes via `provenance.promotedFrom: [sessionId, ...]`), (3) validation gate — at least one of: replay (execute in sandbox/staging, succeeds — Phase 2+, requires Stream 5 agent runtime), repetition (same procedure independently succeeded in N separate episodes — Phase 2+, requires episodic reflection), review (human — hotel manager, admin — approves the diff via PMS UI — Phase 1 minimum viable gate), (4) versioned write (promote to `playbooks/` with `version` incremented; never in-place mutation of a live procedure), (5) scoped rollout (new procedures apply to low-risk task classes first; regressions trigger rollback to prior version); (d) pre-seeds `procedures/playbooks/{default}/` with hotel-domain playbooks (`check_in_guest.md`, `check_out_guest.md`, `handle_overbooking.md`, `process_no_show.md`, `handle_complaint.md`, `escalate_to_manager.md`, `apply_rate_code.md`, `generate_invoice.md`, etc.) authored by SmartAgentics (certified, `status: active`, `provenance.approvedBy: SmartAgentics`), overridable per-tenant in `procedures/playbooks/{tenantId}/`; (e) retrieves procedures at LLM call time — `OllamaRagGenerator` loads YAML headers of all active procedures for the tenant into the `task` block of working memory; agent calls `readProcedure(name)` to load full body; (f) Phase 1 ships the file structure + YAML schema + pre-seeded hotel playbooks + human-review promotion gate (PMS UI) + `readProcedure` tool; Phase 2+ defers automated candidate capture, replay validation, repetition validation (all depend on Stream 5 agent runtime); (g) makes the validation gate non-negotiable — "an unvalidated procedure must never be automatically promoted into permanent procedural memory. A bad fact in semantic memory misleads one retrieval; a bad procedure in procedural memory misleads every future execution of that task class, with the agent's full confidence behind it"; (h) reserves a `ProcedureVersion` Prisma table (Phase 2+) for audit metadata if file-based versioning becomes insufficient; (i) handles procedure file proliferation via 90-day TTL on candidates (auto-archive if not promoted — per ADR-042); (j) handles file-based storage non-transactionality via write-to-temp-then-rename (atomic on most filesystems); per-tenant `procedures/` directory limits blast radius; (k) handles pre-seeded playbook misfit via per-tenant override directory — admin can edit/deprecate any default playbook; and (l) feeds Stream 5 (Agent Runtime) — Phase 2+ automated candidate capture and replay validation depend on the agent runtime; procedural memory is the bridge between agent experience and agent behavior.** This ADR is the procedural-memory companion to ADR-038; it is the Stream 4 analog of Stream 3's ADR-029 (Parser Stack) in that both define a file-based substrate with progressive disclosure.

## 3. Options

### Option A: Store procedures in Prisma + sqlite-vec (treat like semantic memory)

Treat procedures as `MemoryRecord` with `type='SEMANTIC'` (or a new `type='PROCEDURAL'`), triple-indexed (relational + vector + FTS5). **Rejected** — research §6.5: loses diffs, reviews, rollbacks, audit. The design guide is explicit: "Choose the substrate for the hard problem, not the easy one." Governance > retrieval for procedures. A vector store gives fuzzy recall (which procedures don't need — there are only tens of them) and loses governance (which procedures critically need). Procedures need `git`-style diffs and PR-style review, not cosine similarity.

### Option B: LangMem (LangChain) as runtime dependency for procedural memory

Use LangMem (LangChain's procedural-memory tool that updates prompt rules over time based on feedback). **Rejected** — research §6.5: LangMem is a LangChain-family tool; conflicts with Stream 3's "no full LangChain runtime dependency" policy (ADR-037). Adopt the _pattern_ (prompt rules updated over time), not the _platform_. See ADR-048 for the full framework-avoidance rationale.

### Option C: Automatic promotion (agent writes directly to live playbooks)

Let the agent write directly to `procedures/playbooks/` when it learns a new procedure. **Rejected** — research §6.5: the single worst procedural-memory failure mode. "An unvalidated procedure must never be automatically promoted." Explicitly rejected by the design guide and academic literature. A bad promoted procedure misleads every future execution (research R-6.1, High severity).

### Option D: No procedural memory subsystem (use system prompts only, hardcoded per agent)

Hardcode each agent's system prompt with its procedures; no procedural memory subsystem. **Rejected** — research §6.5: per-agent hardcoded prompts don't scale; can't be updated without deployment; no governance. This is the current state and exactly what Phase B B4 #13 flags as a gap.

### Option E: Store procedures in the Stream 3 knowledge base

Treat procedures as knowledge documents (SOPs). **Rejected** — research §6.5: knowledge base = externally authoritative documents (SOPs from hotel management). Procedural memory = agent-learned procedures (distilled from experience). Different authors, different governance, different lifecycles. They are complementary: a knowledge-base SOP can be the _source_ of a procedural-memory playbook (admin promotes an SOP to a playbook), but they are not the same table.

### Option F: File-based two-tier procedural memory (candidates/ vs playbooks/) + YAML front-matter + progressive disclosure + validation gate (replay OR repetition OR human review — never automatic) + pre-seeded hotel playbooks + per-tenant override + Phase 1 human-review gate + Phase 2+ automated capture/replay/repetition

`ProceduralMemory` interface with `listProcedures`/`readProcedure`/`proposeCandidate`/`promoteCandidate`/`deprecateProcedure`. File-based storage in `procedures/candidates/{tenantId}/` + `procedures/playbooks/{tenantId}/` + `procedures/playbooks/{default}/`. YAML front-matter schema. Progressive disclosure via `readProcedure` tool. Validation gate requires human review (Phase 1 minimum) or replay/repetition (Phase 2+). Pre-seeded hotel playbooks. Per-tenant override. Per research §6.

## 4. Decision

Adopt **Option F**. The Procedural Memory & Promotion Gate architectural contract is:

1. **File-based storage** (research §6.2) — procedures stored as version-controlled files (markdown with YAML front-matter), NOT in the vector store, NOT in Prisma:
   - `procedures/candidates/{tenantId}/` — agent-authored candidate procedures, marked `status: candidate` in front-matter.
   - `procedures/playbooks/{tenantId}/` — promoted, validated procedures marked `status: active` (or `deprecated`), the "law" the agent follows.
   - `procedures/playbooks/{default}/` — SmartAgentics pre-seeded hotel playbooks.
   - `procedures/archive/{tenantId}/` — auto-archived candidates older than 90 days (per ADR-042).

2. **YAML front-matter schema** (research §6.2) — each procedure file has:

   ```yaml
   ---
   name: check_in_guest
   description: Check in a guest with a confirmed reservation
   appliesTo: [FRONT_DESK, CHECK_IN]
   version: 3
   status: active # candidate | active | deprecated
   provenance:
     promotedFrom: [session_abc, session_def] # episodes that motivated this procedure
     validatedBy: human_review # human_review | replay | repetition
     approvedBy: manager@hotel.com
     approvedAt: 2026-09-01T10:00:00Z
   ---
   # Body: full procedure steps (markdown)
   ```

3. **Progressive disclosure** (research §6.2; Anthropic Agent Skills pattern) — the YAML front-matter (name/description/appliesTo/version/status/provenance) is always loadable into the agent's working memory `task` block (ADR-039 §2). The body (full procedure steps) is loaded on demand via a `readProcedure(name)` tool. The agent sees the menu, not every recipe.

4. **Promotion pipeline (the validation gate — never automatic)** (research §6.2):
   1. **Candidate capture**: during/after a session, the agent (or a Restate extraction workflow over episodes) drafts a candidate procedure and writes it to `procedures/candidates/{tenantId}/`.
   2. **Evidence attachment**: the candidate links to the episodes that motivated it (`provenance.promotedFrom: [sessionId, ...]`).
   3. **Validation gate** — at least one of:
      - **Replay**: the procedure is executed in a sandbox/staging environment and succeeds (Phase 2+ — requires Stream 5 agent runtime).
      - **Repetition**: the same procedure independently succeeded in N separate episodes (Phase 2+ — requires episodic reflection).
      - **Review**: a human (hotel manager, admin) approves the diff via a PMS UI (Phase 1 minimum viable gate).
   4. **Versioned write**: the procedure is promoted to `procedures/playbooks/{tenantId}/` with `version` incremented; never in-place mutation of a live procedure.
   5. **Scoped rollout**: new procedures apply to low-risk task classes first; regressions trigger rollback to the prior version.

5. **Pre-seeded hotel playbooks** (research §6.2) — SmartAgentics ships `procedures/playbooks/{default}/` with 10–15 hotel-domain playbooks:
   - `check_in_guest.md`, `check_out_guest.md`, `handle_overbooking.md`, `process_no_show.md`, `handle_complaint.md`, `escalate_to_manager.md`, `apply_rate_code.md`, `generate_invoice.md`, etc.
   - Authored by SmartAgentics (certified, `status: active`, `provenance.approvedBy: SmartAgentics`).
   - Can be overridden per-tenant in `procedures/playbooks/{tenantId}/` (same name = tenant override).
   - Deliver day-one value — every hotel agent ships with a working set of procedures, not an empty memory. This is a product differentiator.

6. **Retrieval at LLM call time** (research §6.2) — `OllamaRagGenerator` (Stream 3, ADR-030) loads the YAML headers of all active procedures for the tenant (`procedures/playbooks/{tenantId}/*.md` + `procedures/playbooks/{default}/*.md` minus overrides) into the `task` block of working memory. The agent can then call `readProcedure(name)` to load the full body of a relevant procedure. This is progressive disclosure — the agent sees the menu, not every recipe.

7. **SDK interface** (`ProceduralMemory`) (research §14):

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

8. **Phase 1 scope** (research §6.9): ship the file structure, the YAML schema, the pre-seeded hotel playbooks, the human-review promotion gate (PMS UI), and the `readProcedure` tool. Estimated effort: 1.5–2 weeks of Phase E.

9. **Phase 2+ defers** (research §6.9): automated candidate capture (Restate workflow over episodes); replay validation (requires Stream 5 sandbox); repetition validation (requires episodic reflection); cross-tenant procedure marketplace (AI-BOS vision — hotels share validated playbooks; SmartAgentics certifies them; revenue model).

10. **No new Prisma table in Phase 1** (research §6.8) — procedural memory is file-based. Optional `ProcedureVersion` table for audit metadata in Phase 2+ (if file-based versioning via `git` or simple file-version table becomes insufficient).

11. **Filesystem layout** (research §6.8) — new `procedures/` directory in the SmartAgentics data folder, per-tenant subdirectories. The PMS UI "Procedure Management" page (admin role) is the human-review promotion gate.

12. **Procedure file proliferation mitigation** (research R-6.2) — 90-day TTL on candidates (auto-archive if not promoted, per ADR-042); admin UI for curation. Prevents `candidates/` from becoming a graveyard.

13. **File-based storage non-transactionality mitigation** (research R-6.3) — write to a temp file then rename (atomic on most filesystems); `procedures/` is per-tenant so blast radius is limited. SQLite transactions cover PMS operations but not file operations; the temp-then-rename pattern is the file-system equivalent of atomicity.

14. **Pre-seeded playbook misfit mitigation** (research R-6.4) — per-tenant override directory; admin can edit/deprecate any default playbook. The default playbooks are a starting point, not a straitjacket.

## 5. Rationale

- **Procedural memory is the highest-leverage layer and the most dangerous if mismanaged** — research §6.3: it compounds across sessions and users (an agent that learns a better check-in procedure benefits every future check-in), but a bad procedure misleads every future execution with the agent's full confidence. The validation gate is non-negotiable.
- **The ecosystem explicitly flags procedural memory as "still early-stage"** — research §6.1, §6.3 (Mem0 State of AI Agent Memory 2026 report): SmartAgentics cannot buy this off-the-shelf and must design it deliberately. This is an opportunity, not a problem.
- **The file-based substrate is counter-intuitive but correct** — research §6.3: most teams reach for a vector store for everything, but procedures need governance (diffs, reviews, rollbacks), not fuzzy recall. A vector store gives fuzzy recall (which procedures don't need — there are only tens of them) and loses governance (which procedures critically need). "Choose the substrate for the hard problem, not the easy one" (design guide).
- **The two-tier `candidates/` vs `playbooks/` structure is the cheapest possible defense** — research §6.3: against "silent self-modification of the agent's own operating rules" — the single worst procedural-memory failure mode. The agent can be told, in its system prompt, that candidates are suggestions and playbooks are law.
- **Pre-seeded hotel playbooks deliver day-one value** — research §6.3: every hotel agent ships with a working set of procedures, not an empty memory. This is a product differentiator. The seed of a future procedure marketplace (AI-BOS vision).
- **The validation gate is the foundation for AI safety** — research §6.10: it's how we prevent agents from silently rewriting their own operating rules, which is the #1 procedural-memory failure mode cited across the literature. The design guide's central rule: "an unvalidated procedure must never be automatically promoted into permanent procedural memory."
- **Progressive disclosure (Anthropic Agent Skills pattern) gives built-in working-memory hygiene** — research §6.1, §6.2: short description always visible, full instructions loaded on demand. The agent sees the menu, not every recipe. This keeps the `task` block within its token budget (ADR-039 §2).
- **CoALA's three substrates drive the file-based decision** — research §6.1: in-weights (cannot update without retraining — ADR-001 forbids fine-tuning), in-code (cannot update without deployment), explicit instruction sets (updatable without touching model or code). Only explicit instruction sets — system prompts and managed rule libraries — are viable for SmartAgentics. Files are the substrate for explicit instruction sets.
- **Rejecting Prisma + sqlite-vec (Option A)** — research §6.5: loses governance; vector store is the wrong substrate for procedures.
- **Rejecting LangMem (Option B)** — research §6.5: LangChain-family tool; conflicts with framework-avoidance policy (ADR-037/048).
- **Rejecting automatic promotion (Option C)** — research §6.5: the single worst procedural-memory failure mode; explicitly rejected by design guide and academic literature.
- **Rejecting no-procedural-memory-subsystem (Option D)** — research §6.5: doesn't scale; can't update without deployment; no governance; exactly what Phase B B4 #13 flags as a gap.
- **Rejecting knowledge-base reuse (Option E)** — research §6.5: knowledge vs procedural is an ontological distinction (external authoritative vs internally learned); complementary, not the same.

## 6. Consequences

**Positive**:

- Procedural memory is the compounding layer — agents get better at their job over time, and the product differentiates from "just an LLM wrapper."
- Pre-seeded hotel playbooks deliver day-one value — every hotel agent ships with a working set of procedures.
- The validation gate is the foundation for AI safety — agents cannot silently rewrite their own operating rules.
- The file-based substrate gives governance (diffs, reviews, rollbacks, audit) for free via `git` or a simple file-version table.
- Progressive disclosure keeps the `task` block within its token budget.
- The two-tier `candidates/` vs `playbooks/` structure is the cheapest possible defense against silent self-modification.
- Feeds Stream 5 (Agent Runtime) — Phase 2+ automated candidate capture and replay validation depend on the agent runtime; procedural memory is the bridge between agent experience and agent behavior.
- Feeds AI-BOS vision — the pre-seeded hotel playbooks are the seed of a future procedure marketplace (hotels share validated playbooks; SmartAgentics certifies them; revenue model).

**Negative / obligations**:

- A bad promoted procedure misleads every future execution — research R-6.1 (High): mitigation = validation gate (human review minimum in Phase 1); `status: deprecated` for rollback; per-task-class scoped rollout (new procedures apply to low-risk tasks first).
- Procedure file proliferation — research R-6.2 (Medium): agents may draft many candidates; without curation, `candidates/` becomes a graveyard. Mitigation = 90-day TTL on candidates (auto-archive if not promoted, per ADR-042); admin UI for curation.
- File-based storage is not transactional with SQLite — research R-6.3 (Low): a crash mid-promotion could leave a procedure file half-written. Mitigation = write to a temp file then rename (atomic on most filesystems); `procedures/` is per-tenant so blast radius is limited.
- Pre-seeded hotel playbooks may not fit every property's workflow — research R-6.4 (Medium): mitigation = per-tenant override directory; admin can edit/deprecate any default playbook.
- Phase 1 ships only human-review gate — automated candidate capture, replay validation, and repetition validation are Phase 2+ (depend on Stream 5). Phase 1 procedures are entirely human-curated, which limits the "compounding" benefit until Phase 2+.
- The 10–15 pre-seeded hotel playbooks must be authored, versioned, and updatable without redeployment — Open Question #6 (research §19): who authors them (SmartAgentics product team? Hotel operations consultants?); how are they versioned and updated.
- The `readProcedure` tool must be added to the agent's tool set (Stream 5 concern) — Phase 1 ships the SDK interface; Stream 5 wires it into the agent's tool registry.
- The YAML front-matter schema must be documented and validated — invalid YAML must not break the `task` block compilation; a schema validator (e.g., zod) is required.
- The per-tenant override mechanism (same name = tenant override) must be documented — developers must understand the precedence rules.

**Dependencies on other ADRs**:

- Depends on ADR-001 (Reference Stack) — local-inference-only (no fine-tuning — procedural memory is the explicit-instruction-set substrate, not in-weights).
- Depends on ADR-008 (Event-Driven) — Restate workflows for Phase 2+ automated candidate capture.
- Depends on ADR-030 (RAG Pipeline) — `OllamaRagGenerator` extended with procedure-header loading into `task` block; `readProcedure` tool wired into agent tool set (Stream 5).
- Depends on ADR-038 (AI Memory Architecture) — the `MemoryStore` interface; `ProceduralMemory` sub-interface.
- Depends on ADR-039 (Memory Taxonomy) — §6 procedural memory contract; §2 working memory `task` block (procedure headers loaded here).
- Depends on ADR-041 (Permissions & Isolation) — `memory:promote:procedural` permission for the validation gate.
- Depends on ADR-042 (Retention & Decay) — 90-day TTL on candidates (auto-archive if not promoted).
- Depends on ADR-043 (Deletion & GDPR) — procedural playbooks promoted from a deleted user's episodes are independent of source; provenance link is severed; admin re-review (research R-11.4).
- Depends on ADR-044 (Security & Poisoning) — the validation gate is the procedural-memory-specific Layer 1 of the 6-layer defense; prevents procedural poisoning.
- Depends on ADR-047 (Provenance & Audit) — `provenance.promotedFrom` / `validatedBy` / `approvedBy` / `approvedAt` on every procedure.
- Feeds ADR-046 (Operations API) — the `ProceduralMemory` interface methods.
- Feeds Stream 5 (Agent Runtime) — `readProcedure` tool wired into agent tool registry; Phase 2+ automated candidate capture + replay validation + repetition validation depend on the agent runtime.
- Feeds Stream 6 (Multi-Agent Collaboration) — Phase 2+ shared procedural playbooks across agent teams.
- Feeds AI-BOS vision — pre-seeded hotel playbooks as the seed of a future procedure marketplace.

## 7. Review Conditions

This decision should be reviewed when ANY of the following triggers occurs:

1. **A bad promoted procedure is detected in production** (an agent consistently makes wrong decisions traceable to a playbook) — root-cause the validation-gate failure; verify the `status: deprecated` rollback mechanism; verify the per-task-class scoped rollout limited the blast radius; re-review the human-review gate.
2. **Stream 5 (Agent Runtime) lands the sandbox for replay validation** — evaluate the Phase 2+ replay-validation gate; benchmark the sandbox execution overhead; verify the `ValidationEvidence` schema captures replay results.
3. **Phase 2+ episodic reflection is available for repetition validation** — evaluate the Phase 2+ repetition-validation gate; verify the N-episode threshold; verify the consolidation workflow detects repetitions.
4. **A pre-seeded hotel playbook is found to be wrong or insufficient** — verify the per-tenant override directory works; verify the `status: deprecated` rollback; consider updating the default playbook in a SmartAgentics release.
5. **The `candidates/` directory becomes a graveyard** (proliferation risk realized) — verify the 90-day TTL auto-archive is running; consider tightening the candidate-capture criteria; verify the admin curation UI.
6. **A procedure file is corrupted by a crash mid-promotion** — verify the temp-then-rename atomicity; verify the per-tenant blast-radius limit; consider a file-system journaling wrapper.
7. **A tenant demands a custom procedure format** (beyond markdown+YAML) — evaluate extending the YAML schema; verify the schema validator handles the extension; verify the `readProcedure` tool parses the new format.
8. **A cross-tenant procedure-marketplace demand emerges** (AI-BOS vision) — evaluate the marketplace contract (how hotels share playbooks; how SmartAgentics certifies them; revenue model); verify the per-tenant override and deprecation mechanisms work at marketplace scale.
9. **A procedural-poisoning attack is detected** (a candidate crafted to pass human review but mislead execution) — root-cause the human-review failure; consider Phase 2+ replay-validation as a mandatory second gate for high-risk task classes; verify the `MemoryAccessLog` reconstruction.
10. **Annually**, as part of the regular ADR review cycle.
