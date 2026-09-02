# ADR-058: Deterministic Operations Boundary — AI/Non-AI Boundary, Deterministic Core

**ADR-ID:** ADR-058
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #26 ("AI failure must never become PMS failure") is operationalized by ADR-057's five-layer failure-recovery architecture. The _foundational_ principle behind B4 #26 — that AI should sit _beside_ the PMS, not _inside_ it — is articulated by hospitality.today (`https://www.hospitality.today/article/why-ai-needs-to-sit-beside-your-pms-not-inside-it`, May 18 2026, read in full):

> "AI fits in a hotel stack as a probabilistic layer wrapped around deterministic cores. Not inside them. Not in place of them. Beside them."

> "A PMS, a CRS, a channel manager, a payment processor, and a billing engine all share one property. They are exact. A reservation either exists or it does not. A rate is what it is. A folio either balances or it does not. A payment processes successfully or it fails with a specific error code."

> "When systems of record drift, the cascade is not theoretical. Inventory desynchronizes across distribution. Revenue ledgers do not match payment processors. The audit trail breaks. Guests are charged twice, or not at all, or for rooms they did not book. None of this is recoverable by a model that learned from the last five hundred similar interactions. It is recoverable only by a system that was exact in the first place."

> "What happens when the model is wrong? If the answer involves human review, reconciliation passes, or 'the system flags edge cases for operator approval,' then the model is not a system of record. It is an advisory layer with a marketing budget."

Stream 5 research (`/home/z/my-project/phase-c-stream5-agent-runtime-report.md`, §16) also cited Microsoft Agent Framework's guidance ("If you can write a function to handle the task, do that instead of using an AI agent") and LangChain's ("finding the simplest solution possible, and only increasing complexity when needed. This might mean not building agentic systems at all"). The architectural encoding is a three-tier classification of every PMS operation, enforced by a verifier rule that flags LLM calls in DETERMINISTIC-CORE paths.

## 2. Problem

How should SmartAgentics encode the AI/non-AI boundary as an _architectural principle_ — not a guideline — so that no PMS feature can accidentally put an LLM call in the critical path of a deterministic business operation?

## 3. Options

### Option A: AI-native PMS (AI is the system of record)

Explicitly rejected per hospitality.today. "AI-first PMS" is a marketing pitch, not an architecture. The deterministic cores (reservations, billing, check-in/out) must remain exact; AI cannot be the system of record.

### Option B: AI-everywhere (every PMS operation has an AI step)

Rejected: adds latency, cost, and failure modes to operations that don't benefit from AI. Many PMS operations (folio totaling, tax calculation, room assignment) are pure computation — an LLM call would only add error.

### Option C: AI-nowhere (no AI in PMS)

Rejected: AI genuinely improves guest messaging, search, and policy Q&A. The architecture should accommodate AI where it adds value, not ban it.

### Option D: Three-tier classification (DETERMINISTIC-CORE / AI-AUGMENTED / AI-ONLY) enforced by a verifier rule

Every PMS operation is classified into one of three tiers, declared in the feature's architecture doc, and enforced by a static-analysis verifier rule in CI.

## 4. Decision

Adopt **Option D** — encode the AI/non-AI boundary as a three-tier classification, enforced by a verifier rule.

### Three-tier classification

1. **DETERMINISTIC-CORE** (no AI in critical path): reservations, billing, check-in/out, room assignment, inventory, payment processing, audit log. These operations have a deterministic TypeScript implementation that is the _primary_ path. AI may _suggest_ (draft a reservation, recommend a room upgrade, propose a refund amount) but cannot _commit_ without human approval. **The PMS continues operating normally if all AI is removed.**

2. **AI-AUGMENTED** (AI improves the UX but is not required): guest messaging (drafting replies), search (natural-language query → deterministic search), classification (intent routing), summarization (conversation summaries for the next agent/human). These operations have a deterministic fallback (canned responses, keyword search, manual routing, human-written summaries). AI is the _preferred_ path; the deterministic fallback is the _guaranteed_ path.

3. **AI-ONLY** (the operation only makes sense with AI): natural-language "ask the assistant" chat, RAG-based policy Q&A, conversational itinerary planning. These operations have no deterministic equivalent — if AI is unavailable, the operation is unavailable, but it does not block any DETERMINISTIC-CORE operation.

### Architectural enforcement

- **DETERMINISTIC-CORE** operations are implemented as Restate Workflows _without_ any LLM call in the critical path. AI may be a _side_ step (e.g., "after creating the reservation, asynchronously ask the AI to draft a welcome message") but never a _blocking_ step.
- **AI-AUGMENTED** operations are implemented as Restate Workflows with an LLM step; on LLM failure, the workflow takes the deterministic fallback branch (`AIFailureRecoveryPolicy.getManualFallback` per ADR-057).
- **AI-ONLY** operations are implemented as agent invocations through the Supervisor (ADR-050); on failure, they return a friendly "AI unavailable" message; no PMS feature depends on them.

### Verifier rule (new, additive to existing 3 rules per worklog line 7464)

- A code-level verifier (extending the existing architecture-drift-verifier pattern) flags any LLM call in a DETERMINISTIC-CORE feature's critical path. The rule is a static-analysis check (AST-level): any call to `AIProvider.generate()` or `AgentRuntime.runTask()` or Vercel AI SDK's `generateText()` / `streamText()` in a file under `packages/pms/src/<deterministic-feature>/` is flagged.
- Phase 1's DETERMINISTIC-CORE features are: `reservations`, `billing`, `check-in-out`, `room-management`, `inventory`, `payment-processing`.
- AI-AUGMENTED features: the verifier requires a deterministic fallback branch (verified by AST analysis of error-handling paths).
- AI-ONLY features: no constraint.

### Feature-tier declaration

- Every PMS feature declares its tier in the feature's architecture doc (per-document, not a Prisma field). The verifier rule reads the tier declaration.

### Core operating mode

The PMS's "core operating mode" (reservations, billing, check-in/out, room management, inventory) is DETERMINISTIC-CORE. AI can be _removed_ from the PMS (e.g., Ollama not installed, out of memory, model corrupted) and the PMS continues to operate. The AI assistant widget shows an "AI unavailable — using manual mode" banner; all PMS features work normally.

## 5. Rationale

- **hospitality.today alignment**: "AI fits in a hotel stack as a probabilistic layer wrapped around deterministic cores. Not inside them. Not in place of them. Beside them." The three-tier classification is the architectural encoding of this principle.
- **B4 #26 satisfaction**: by construction, DETERMINISTIC-CORE operations have no AI in their critical path. If AI is removed, the PMS continues to operate.
- **Microsoft Agent Framework alignment**: "If you can write a function to handle the task, do that instead of using an AI agent." SmartAgentics writes functions for the deterministic cores; reserves AI for AI-AUGMENTED and AI-ONLY operations.
- **LangChain alignment**: "finding the simplest solution possible, and only increasing complexity when needed. This might mean not building agentic systems at all."
- **Verifier rule prevents drift**: without the static-analysis check, a developer could accidentally add an LLM call to the reservation-creation critical path. The verifier runs in CI; any new LLM call in a DETERMINISTIC-CORE feature requires an ADR amendment.
- **Reservations / billing / check-in/out**: AI may _draft_ (write to a draft table) but cannot _commit_ without human approval (per ADR-057 manualFallback; per ADR-054 `toolApproval` for HIGH/CRITICAL tools).
- **Audit trail integrity**: hospitality.today — "the audit trail breaks" when systems of record drift. The DETERMINISTIC-CORE classification prevents drift by ensuring the audit log records exact actions, not probabilistic ones.
- **Three tiers, not two**: the AI-ONLY tier accommodates genuine AI-only features (chat, RAG Q&A) without forcing them into AI-AUGMENTED (where they'd require a deterministic fallback that doesn't exist).

## 6. Consequences

- A new verifier rule (LLM-call-in-deterministic-core-detector) is added to CI (extends the existing 3-rule verifier per worklog line 7464). FC-5.5.
- A `feature.tier` field is added to feature architecture docs (per-document, not Prisma).
- Every new PMS feature requires a Phase D ADR review to classify its tier. Misclassification is caught by the verifier.
- **Drift over time**: a DETERMINISTIC-CORE feature may gradually accrete AI dependencies. Mitigation: the verifier runs in CI; any new LLM call in a DETERMINISTIC-CORE feature requires an ADR amendment.
- Phase 1's `ReservationAssistantAgent` is AI-ONLY (the assistant); the underlying reservation creation flow is DETERMINISTIC-CORE. The verifier rule is added to CI in Phase 1.
- Dependencies: existing architecture-drift-verifier (extended with one new rule); existing PMS UI routes (which are the deterministic-core implementations); ADR-057 (manual fallback semantics).
- This is the architectural encoding of the AI-BOS "AI failure must never become PMS failure" principle (B4 #26). Every AI-BOS capability must declare its tier.
- Future AI-BOS capabilities (Future Vision 35d dynamic no-code agent builder, 35h AI Builder) must classify their generated agents into one of the three tiers.

## 7. Review Conditions

- Review if the verifier rule produces false positives that block legitimate AI-side-step use cases (e.g., asynchronous post-commit draft generation) — would refine the rule with an `async-only` exemption.
- Review if Phase 2+ adds a fourth tier (e.g., AI-ADVISORY for read-only AI suggestions inside DETERMINISTIC-CORE features) — would amend the classification.
- Review if the hospitality.today principle is updated or extended by new industry guidance — would re-evaluate the three-tier model.
- Review if a PMS feature is misclassified at Phase D ADR review and the misclassification is discovered in production — would trigger an ADR amendment and a re-audit of related features.
- Review if AI-ONLY features grow to dominate the PMS UI — would justify re-evaluating whether some AI-ONLY features should have AI-AUGMENTED deterministic fallbacks for resilience.
