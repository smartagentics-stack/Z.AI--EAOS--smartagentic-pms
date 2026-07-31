# SmartAgentics Coding Rules

**Version:** 1.0 (CONFIRMED)
**Status:** BINDING — all implementation code must follow these rules
**Created:** 2026-07-14
**Sources:** CLAUDE.md (skill), EAOS Investigation Discipline (Tasks 1-98), TRB-001

---

## Confirmed Interpretations

These interpretations were confirmed by the user on 2026-07-14 and are binding for all future work:

1. **CLAUDE.md governs code quality; TRB-001 governs architecture scope.** The Simplicity First rule (CLAUDE.md §2) does NOT override architecture decisions made through the Engineering Review Gate. Multi-tenant, offline-first, and AI evaluation abstractions are architectural decisions, not code complexity.

2. **CLAUDE.md applies to code, not documentation.** Governance documents, PDD, scope definitions, build vs buy matrices, and success metrics are explicitly exempt. Documentation must be explicit and complete, not "minimal."

3. **"Trivial" is defined conservatively.** A task is trivial ONLY if ALL three conditions are met:
   - (a) It touches one file
   - (b) It has no architectural impact
   - (c) Failure is immediately visible
   
   Everything else follows full discipline. This prevents the "I thought it was trivial" trap that the EAOS investigation exposed (40+ tasks diagnosing what looked like trivial timeouts).

4. **Rule 5 added (from EAOS).** Validate Measurement Before Trusting It.

---

## The Five Binding Rules

### Rule 1: Think Before Coding (CLAUDE.md §1)

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Rule 2: Simplicity First (CLAUDE.md §2)

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

**Note:** This governs code, not architecture. Architecture scope is governed by TRB-001 and the Engineering Review Gate.

### Rule 3: Surgical Changes (CLAUDE.md §3)

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### Rule 4: Goal-Driven Execution (CLAUDE.md §4)

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### Rule 5: Validate Measurement Before Trusting It (EAOS Lesson)

**Before acting on a metric, error count, or test result, verify the measurement system is correct.**

- A failing test might mean broken code — or a broken test.
- A high error rate might mean a broken system — or a broken client.
- A slow metric might mean a slow system — or a slow measurement tool.

**Always check the measurement before diagnosing the problem.**

**EAOS precedent:** 40+ tasks investigated "server-side availability degradation" that was actually a 10s client-side timeout vs 12s workflow execution (Task 98, INV-005). The measurement system (endurance runner) was the problem, not the system under test.

---

## Trivial Task Definition

A task is trivial ONLY if ALL three conditions are met:
1. Touches one file
2. Has no architectural impact
3. Failure is immediately visible

If any condition is NOT met, the task follows full discipline (Engineering Review Gate, ADR if architectural, tests required, etc.).

**Examples:**
- Trivial: Fixing a typo in a button label (one file, no architecture, immediately visible)
- NOT trivial: "Just add a quick logging statement" (may affect performance, may not be immediately visible if logging is async)
- NOT trivial: "Just change this config value" (may have architectural impact on other components)

---

## Scope of Rules

| Artifact Type | Rules Apply? | Governing Framework |
|---------------|-------------|---------------------|
| Implementation code (TypeScript, Python, etc.) | YES — all 5 rules | CLAUDE.md + EAOS + TRB-001 |
| Test code | YES — all 5 rules | CLAUDE.md + EAOS |
| Configuration files | YES — Rules 1, 3, 4, 5 | CLAUDE.md + EAOS |
| Governance documents (PDD, scope, matrices) | NO — documentation exemption | TRB-001 |
| Architecture documents (ADRs, RFCs) | NO — documentation exemption | TRB-001 |
| Investigation artifacts (hypothesis register, evidence register) | NO — documentation exemption | EAOS Investigation Protocol |
| Scripts (build, deploy, test runners) | YES — all 5 rules | CLAUDE.md + EAOS |

---

## Relationship to Other Frameworks

This document governs **how code is written**. Other documents govern other concerns:

- **TRB-001 / Engineering Governance Manual** — governs what gets built and whether it passes the Review Gate
- **EAOS Investigation Protocol** — governs how technical investigations are conducted
- **Phase 1 Scope** — governs what is in scope for Phase 1
- **Success Metrics** — governs when features are "done"
- **Build vs Buy Matrix** — governs whether to build or integrate

When in conflict, the order of precedence is:
1. Success Metrics (defines "done")
2. Phase 1 Scope (defines what to build)
3. Engineering Review Gate (defines whether to proceed)
4. These Coding Rules (define how to write the code)
5. Build vs Buy Matrix (defines whether to build or buy)

---

## Change Control

These rules may only be changed by:
1. User confirmation (as happened on 2026-07-14)
2. TRB review and approval
3. Documenting the change in an ADR

**"These rules are too strict for this task" is not a valid reason to skip them.** If a rule genuinely doesn't apply, flag it explicitly and get confirmation before proceeding.
