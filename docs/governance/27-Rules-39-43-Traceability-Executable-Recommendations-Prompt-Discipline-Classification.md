# Rules 39-43 — Traceability, Executable Recommendations, Prompt Discipline, Rule Classification

**Version:** 1.0
**Status:** BINDING — supplements Engineering Assurance Framework v2.0
**Created:** 2026-08-04
**Source:** Independent Engineering Acceptance Review (EAR-EAP-PHASE-A-001) — Principal Engineer directive
**Enforcement Type:** Hybrid
**Verification Method:** `pnpm verify:traceability`, `pnpm verify:security`, `pnpm verify:prompt`, `pnpm verify:governance`
**Responsible Verifier:** `packages/engineering-assurance/src/verifiers/traceability-verifier.ts`, `forbidden-code-verifier.ts`, `prompt-structure-verifier.ts`, `governance-verifier.ts`
**Regression Test:** `packages/engineering-assurance/src/verifiers/__tests__/traceability-verifier.test.ts`, `forbidden-code-verifier.test.ts`, `prompt-structure-verifier.test.ts`, `governance-verifier.test.ts`
**Falsification Criteria:** See per-rule sections below.

---

## Purpose

These five rules strengthen the Engineering Assurance Framework v2.0 by converting principles into machine-checkable enforcement. They were proposed during the EAR-EAP-PHASE-A-001 review of EAP Phase A and adopted after senior engineering review.

The rules address four gaps exposed by the EAR:

1. **Implementation claims lacked structured traceability** (Rule 39)
2. **Bare "Done." / "Implemented." claims were accepted without evidence** (Rule 40)
3. **Implementation recommendations contained pseudocode instead of executable code** (Rule 41)
4. **Implementation prompts lacked mandatory engineering analysis sections** (Rule 42)
5. **Governance rules had no enforcement classification, causing drift between intent and tooling** (Rule 43)

---

## Rule 39 — Engineering Traceability Block

**Enforcement Type:** Machine-Enforceable
**Verification Method:** `pnpm verify:traceability`
**Responsible Verifier:** `packages/engineering-assurance/src/verifiers/traceability-verifier.ts`
**Regression Test:** `packages/engineering-assurance/src/verifiers/__tests__/traceability-verifier.test.ts`
**Falsification Criteria:** A source-modifying commit missing any required section of the Engineering Traceability Block causes `pnpm verify:traceability` to exit with code 1.

### Rule Statement

Every implementation claim SHALL include an Engineering Traceability Block in the exact format specified below. A claim without the block is not a claim — it is an assertion, and assertions are the lowest tier of evidence (Rule 23).

### Required Format

```
ENGINEERING TRACEABILITY BLOCK
==============================
Task: <one-line description>
Related ADR: ADR-XXX (or "none")
Related Rule: Rule XX

Files Modified:
- path/to/file.ts

Functions Modified:
- functionName() — lines X-Y — reason for change

Tests Added:
- path/to/test.test.ts — test name

Commit: <sha>
Branch: <name>

Verification:
  Command: pnpm verify:<subcommand>
  Expected: PASS (or specified outcome)
  Failure Mode: <what would cause FAIL>

Reproduction:
  git clone <repo-url>
  cd <repo-name>
  pnpm install --frozen-lockfile
  git checkout <sha>
  pnpm verify:<subcommand>
```

### Required Sections

The traceability-verifier scans the last 10 source-modifying commits and requires these sections (matched by regex):

| Section              | Pattern                                    | Required |
| -------------------- | ------------------------------------------ | -------- |
| Task                 | `^Task:\s*.+`                              | Yes      |
| Files Modified       | `^Files Modified:\s*\n(\s*-\s*.+\n?)+`     | Yes      |
| Functions Modified   | `^Functions Modified:\s*\n(\s*-\s*.+\n?)+` | Yes      |
| Commit               | `^Commit:\s*[0-9a-f]{7,40}`                | Yes      |
| Verification Command | `^Verification:\s*\n\s*Command:\s*.+`      | Yes      |
| Expected             | `^Expected:\s*.+`                          | Yes      |

### Scope

- **Applies to:** Commits that modify source files (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs`, `.java`)
- **Does NOT apply to:** Merge commits, documentation-only commits, evidence-only commits
- **Retroactivity:** Commits before `2026-08-04` (adoption date) are exempt. The verifier uses `git log --since="2026-08-04"` to avoid flagging historical debt.

### Enforcement

```bash
pnpm verify:traceability
# Expected on clean repo: PASS — all commits include Engineering Traceability Block
# Failure: FAIL — "<sha>: missing traceability sections: Task, Files Modified, ..."
```

---

## Rule 40 — No Unsupported Engineering Claims

**Enforcement Type:** Machine-Enforceable (for files and commits) + Reviewer-Enforced (for conversation)
**Verification Method:** `pnpm verify:security` (Phase 2: commit message scan)
**Responsible Verifier:** `packages/engineering-assurance/src/verifiers/forbidden-code-verifier.ts`
**Regression Test:** `packages/engineering-assurance/src/verifiers/__tests__/forbidden-code-verifier.test.ts`
**Falsification Criteria:** A commit message or markdown file containing a bare claim phrase ("Done.", "Implemented.", etc.) without an evidence block within 5 lines causes `pnpm verify:security` to return WARN.

### Rule Statement

The following bare phrases are FORBIDDEN in any engineering artifact unless immediately followed (within 5 lines) by an evidence block containing at minimum: file path, verification command, expected result:

- "Done."
- "Completed."
- "Implemented."
- "Fixed."
- "Resolved."
- "Finished."

### Scan Scope

| Artifact                              | Scanned By                           | Mechanism                        |
| ------------------------------------- | ------------------------------------ | -------------------------------- |
| Git commit messages (last 20)         | `forbidden-code-verifier.ts` Phase 2 | `git log --format=%B`            |
| Markdown documentation (`.md`)        | `forbidden-code-verifier.ts` Phase 1 | `readdirSync` + regex            |
| Engineering reports (`evidence/*.md`) | `forbidden-code-verifier.ts` Phase 1 | Same as above                    |
| PR descriptions                       | Reviewer-Enforced                    | Not machine-scanned (GitHub API) |
| AI conversation responses             | Reviewer-Enforced                    | Not on disk                      |

### Evidence Block Pattern

A bare claim is forgiven if any of these patterns appears within 5 lines (before or after):

- `Files Modified:`
- `Verification:`
- `Expected:`
- `Commit:`
- `Git diff`
- `Engineering Traceability`

### Enforcement

```bash
pnpm verify:security
# Expected: FAIL if any bare claim without evidence block is found
# Bare implementation claims without the required Engineering Traceability
# Block SHALL produce FAIL. The verifier may optionally support WARN mode
# during migration, but FAIL is the required enforcement level once the
# migration period ends.
```

---

## Rule 41 — Every Implementation Recommendation Must Be Executable

**Enforcement Type:** Reviewer-Enforced
**Verification Method:** Engineering Acceptance Review (reviewer judgment)
**Responsible Verifier:** N/A (reviewer-enforced)
**Regression Test:** N/A
**Falsification Criteria:** A reviewer rejects any implementation recommendation missing any of the 9 required items.

### Rule Statement

Every implementation recommendation SHALL include ALL of the following. Omission of any item is a Rule 41 violation:

1. **Real production code** — no pseudocode, no placeholders, no `...`, no omitted logic, no conceptual examples
2. **Exact file path** — where the code goes
3. **Exact function signature** — function name, parameters, return type
4. **Complete implementation sample** — compilable, runnable
5. **Expected runtime behavior** — concrete: "PASS", "exit 0", "stdout contains X"
6. **Verification command** — executable shell command
7. **Regression test** — Vitest/Jest spec with at least one `it()` block
8. **Falsification test** — proof that the verifier can FAIL (delete an input, expect non-zero exit)
9. **Failure output** — what the verifier reports when the check fails

### Forbidden Patterns

| Pattern             | Example                               | Why Forbidden      |
| ------------------- | ------------------------------------- | ------------------ |
| Pseudocode          | `function foo() { /* implement */ }`  | Not runnable       |
| Placeholders        | `// TODO: add logic here`             | Not complete       |
| Omitted logic       | `...` or `// rest of implementation`  | Not verifiable     |
| Conceptual examples | `// you could do something like this` | Not committed code |
| Abstract advice     | "Consider using a factory pattern"    | Not executable     |

### Enforcement

This rule is reviewer-enforced because it governs recommendation quality, not code state. A reviewer rejects any recommendation missing any of the 9 items by quoting Rule 41 and listing the missing items.

---

## Rule 42 — Engineer Before You Prompt

**Enforcement Type:** Hybrid (Machine-Enforceable for stored prompts + Reviewer-Enforced for conversation)
**Verification Method:** `pnpm verify:prompt` (for `.md` files containing `ENGINEERING IMPLEMENTATION DIRECTIVE` or in `prompts/` directory)
**Responsible Verifier:** `packages/engineering-assurance/src/verifiers/prompt-structure-verifier.ts`
**Regression Test:** `packages/engineering-assurance/src/verifiers/__tests__/prompt-structure-verifier.test.ts`
**Falsification Criteria:** A prompt file missing any of the 15 mandatory sections causes `pnpm verify:prompt` to exit with code 1.

### Rule Statement

Every implementation prompt stored in the repository SHALL contain these 15 sections in the specified order:

1. **Problem Definition** — what is broken or missing
2. **Root Cause Analysis** — identified cause, or "Unknown — evidence-gathering plan attached"
3. **Constraints** — what cannot be changed (time, budget, dependencies, ADRs)
4. **Architecture Impact** — how the solution fits into the existing system
5. **Files to Modify** — exact file paths that will be changed
6. **Functions to Modify** — exact function signatures that will be changed
7. **Production Code** — the actual code change (real, compilable, runnable)
8. **Unit Tests** — Vitest/Jest specs with at least one `it()` block
9. **Integration Tests** — how the change integrates with existing systems
10. **Verification Commands** — executable shell commands to prove the change works
11. **Expected Output** — concrete: "PASS", "exit 0", "stdout contains X"
12. **Failure Output** — what happens when verification fails
13. **Rollback Procedure** — `git revert <hash>` or equivalent
14. **Engineering Traceability Block** — commit hash, related ADR, related Rule
15. **Evidence Required Before Completion** — what evidence must be produced before the task is considered complete

### Ordering Constraint (Rule 44)

Sections SHALL appear in the order listed above. Code (section 7) must appear before Explanation (if present). This forces implementation-first engineering.

### Detection Criteria

A file is considered an "implementation prompt" if ANY of:

- Filename contains `.PROMPT.md` (case-insensitive)
- File is under `prompts/` or `docs/prompts/` directory
- File content contains `ENGINEERING IMPLEMENTATION DIRECTIVE`

### Enforcement

```bash
pnpm verify:prompt
# Expected on clean repo: PASS — no implementation prompts, or all have 15 sections in order
# Failure: FAIL — "<file>: missing sections: Root Cause Analysis, Evidence, ..."
# Failure: FAIL — "<file>: section ordering violation (Code must appear before Explanation)"
```

---

## Rule 43 — Every Governance Rule Must Be Classified

**Enforcement Type:** Machine-Enforceable
**Verification Method:** `pnpm verify:governance` (Rule 43 classification check — to be implemented in a future commit)
**Responsible Verifier:** `packages/engineering-assurance/src/verifiers/governance-verifier.ts` (enhanced)
**Regression Test:** `packages/engineering-assurance/src/verifiers/__tests__/governance-verifier.test.ts`
**Falsification Criteria:** A rule document missing the `Enforcement Type:` declaration causes `pnpm verify:governance` to exit with code 1.

### Rule Statement

Every governance rule document SHALL declare its enforcement classification in a structured block at the top of the document. A rule without classification causes `verify:governance` to FAIL.

### Required Classification Block

Placed immediately after the document title:

```
Enforcement Type: Machine-Enforceable | Reviewer-Enforced | Hybrid
Verification Method: <verifier name or "manual review">
Responsible Verifier: <verifier file path or "N/A">
Regression Test: <test file path or "N/A">
Falsification Criteria: <how to prove the rule can be violated>
```

### Classification Types

| Type                | Meaning                                           | Example                              |
| ------------------- | ------------------------------------------------- | ------------------------------------ |
| Machine-Enforceable | Validated automatically by tooling                | `pnpm verify:*` returns PASS/FAIL    |
| Reviewer-Enforced   | Validated during Engineering Acceptance Review    | Reviewer judgment                    |
| Hybrid              | Partially automated, partially reviewer-validated | Prompt structure + reviewer judgment |

### Enforcement

The governance-verifier scans every `docs/governance/*-Rule*.md` and `docs/governance/27-Rules-*.md` file for the `Enforcement Type:` declaration. Missing declaration → FAIL.

```bash
pnpm verify:governance
# Expected: PASS — all rule docs declare Enforcement Type
# Failure: FAIL — "<doc>: missing 'Enforcement Type:' declaration (Rule 43 violation)"
```

**Note:** The full Rule 43 enforcement (scanning ALL rule docs for classification) is implemented in a future commit. This document declares its own classification (above) to bootstrap the rule.

---

## Summary Table

| Rule | Title                                   | Type         | Enforcement        | Status |
| ---- | --------------------------------------- | ------------ | ------------------ | ------ |
| 39   | Engineering Traceability Block          | Process      | Machine            | Active |
| 40   | No Unsupported Engineering Claims       | Evidence     | Machine + Reviewer | Active |
| 41   | Every Recommendation Must Be Executable | Code Quality | Reviewer           | Active |
| 42   | Engineer Before You Prompt              | Process      | Hybrid             | Active |
| 43   | Every Rule Must Be Classified           | Governance   | Machine            | Active |

---

## Relationship to Existing Rules

| New Rule | Strengthens                                                                                     | Reason                              |
| -------- | ----------------------------------------------------------------------------------------------- | ----------------------------------- |
| 39       | Rule 9 (Engineering Traceability), Rule 21 (Mandatory Real Code Evidence)                       | Adds required format                |
| 40       | Rule 1 (Evidence Before Conclusion), Rule 13 (No Unsupported Claims)                            | Adds forbidden phrases + scan scope |
| 41       | Rule 2 (Always Back Every Recommendation with Working Code), Rule 8 (Real Working Code Samples) | Adds 9 required items               |
| 42       | Rule 3 (Mandatory Root Cause Analysis), Rule 9 (Deep Technical Research)                        | Adds 10 mandatory prompt sections   |
| 43       | Rule 36 (Governance Automation), Rule 38 (Executable Evidence)                                  | Adds classification requirement     |

---

## Change Log

| Date       | Commit        | Change                                                                    |
| ---------- | ------------- | ------------------------------------------------------------------------- |
| 2026-08-04 | (this commit) | Initial creation. Rules 39-43 defined with Enforcement Type declarations. |
