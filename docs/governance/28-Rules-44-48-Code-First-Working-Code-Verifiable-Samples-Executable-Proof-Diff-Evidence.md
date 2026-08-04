# Rules 44-48 — Code First, Working Reference Code, Verifiable Samples, Executable Proof, Diff Evidence

**Version:** 1.0
**Status:** BINDING — supplements Engineering Assurance Framework v2.0
**Created:** 2026-08-04
**Source:** Senior Engineering Review of Rules 39-43 adoption (Principal Engineer directive)

Enforcement Type: Hybrid
Verification Method: pnpm verify:prompt, pnpm verify:security, pnpm verify:traceability, pnpm verify:governance
Responsible Verifier: packages/engineering-assurance/src/verifiers/prompt-structure-verifier.ts, forbidden-code-verifier.ts, traceability-verifier.ts
Regression Test: packages/engineering-assurance/src/verifiers/**tests**/
Falsification Criteria: See per-rule sections below.

---

## Purpose

These five rules strengthen the implementation discipline of the Engineering Assurance Framework. They were proposed during the senior engineering review of Rules 39-43 and adopted after the reviewer confirmed that "every governance rule that affects implementation includes production-ready code examples, unit test examples, verification commands, expected and failure outputs, rollback procedures, and a complete Engineering Traceability Block with evidence requirements."

The rules address five gaps:

1. **Implementation prompts lacked presentation ordering** (Rule 44)
2. **Pseudocode was accepted instead of production code** (Rule 45)
3. **Code samples lacked failure output and rollback** (Rule 46)
4. **Engineering claims lacked full executable proof** (Rule 47)
5. **Implementation prompts lacked before/after diffs** (Rule 48)

---

## Rule 44 — Code First, Explanation Second

Enforcement Type: Machine-Enforceable (Hybrid — verifier checks section order; reviewer evaluates quality)
Verification Method: pnpm verify:prompt (section ordering validation)
Responsible Verifier: packages/engineering-assurance/src/verifiers/prompt-structure-verifier.ts
Regression Test: packages/engineering-assurance/src/verifiers/**tests**/prompt-structure-verifier.test.ts
Falsification Criteria: An implementation prompt with Explanation before Code causes pnpm verify:prompt to return FAIL.

### Rule Statement

Implementation prompts SHALL present content in this priority order:

1. Problem
2. Code
3. Verification
4. Explanation

Code must appear before narrative explanation. This forces implementation-first engineering — the engineer must produce working code before explaining why.

### Enforcement

The prompt-structure-verifier checks that the `## Implementation` section appears before `## Explanation` (if Explanation is present). A prompt with Explanation before Implementation produces FAIL.

---

## Rule 45 — Every Prompt Must Contain Working Reference Code

Enforcement Type: Machine-Enforceable (Hybrid — verifier detects pseudocode patterns; reviewer evaluates code quality)
Verification Method: pnpm verify:security (pseudocode pattern detection)
Responsible Verifier: packages/engineering-assurance/src/verifiers/forbidden-code-verifier.ts
Regression Test: packages/engineering-assurance/src/verifiers/**tests**/forbidden-code-verifier.test.ts
Falsification Criteria: A source file or prompt containing pseudocode patterns (`...`, `/* implement */`, `// TODO`, `placeholder`) causes pnpm verify:security to return FAIL.

### Rule Statement

Every implementation prompt SHALL include:

- Real code (compilable, runnable)
- Real API (actual library imports, not hypothetical)
- Real function (actual function name, not placeholder)
- Real library (actual package, not conceptual)
- Production syntax (valid TypeScript/JavaScript, not pseudocode)

### Forbidden Patterns

| Pattern             | Example                               | Why Forbidden      |
| ------------------- | ------------------------------------- | ------------------ |
| Pseudocode          | `function foo() { /* implement */ }`  | Not runnable       |
| Placeholders        | `// TODO: add logic here`             | Not complete       |
| Omitted logic       | `...` in code blocks                  | Not verifiable     |
| Conceptual examples | `// you could do something like this` | Not committed code |

### Enforcement

The forbidden-code-verifier scans source files and prompt files for pseudocode patterns. Detection produces FAIL (not WARN — this is a blocking violation per the senior engineering review).

---

## Rule 46 — Every Code Sample Must Be Verifiable

Enforcement Type: Reviewer-Enforced
Verification Method: Engineering Acceptance Review (reviewer checks code sample completeness)
Responsible Verifier: N/A (reviewer-enforced)
Regression Test: N/A
Falsification Criteria: A reviewer rejects any code sample missing any of the 5 required elements.

### Rule Statement

Every code block in an implementation prompt SHALL include:

1. **How to run** — executable shell command
2. **Expected output** — concrete result (e.g., "PASS", "exit 0", "stdout contains X")
3. **Failure output** — what happens when it fails (e.g., "TypeError", "exit 1")
4. **Test** — Vitest/Jest spec with at least one `it()` block
5. **Rollback** — `git revert <hash>` or equivalent

### Example

```
Code:
  const cache = new LRUCache<string, SyncRecord>({ max: 10000, ttl: 1000 * 60 * 30 });

How to run:
  pnpm test

Expected output:
  PASS

Failure output:
  TypeError: LRUCache is not a constructor

Test:
  it('creates cache with correct config', () => {
    const cache = new LRUCache({ max: 10000, ttl: 60000 });
    expect(cache.max).toBe(10000);
  });

Rollback:
  git revert <commit-hash>
```

---

## Rule 47 — Every Engineering Claim Must Have Executable Proof

Enforcement Type: Machine-Enforceable
Verification Method: pnpm verify:traceability (expanded required sections)
Responsible Verifier: packages/engineering-assurance/src/verifiers/traceability-verifier.ts
Regression Test: packages/engineering-assurance/src/verifiers/**tests**/traceability-verifier.test.ts
Falsification Criteria: A source-modifying commit missing any of the 11 required sections causes pnpm verify:traceability to return FAIL.

### Rule Statement

Every engineering claim of implementation SHALL include ALL of the following:

1. Task
2. Files Modified
3. Functions Modified
4. Commit (hex hash)
5. Git Diff (or reference to diff)
6. Verification Command
7. Expected Output
8. Raw Output (actual execution result)
9. Failure Output (what would cause FAIL)
10. Reproduction (clone + checkout + verify commands)
11. Tests (unit test file references)

### Enforcement

The traceability-verifier scans the last 10 source-modifying commits and requires all 11 sections. Missing any section produces FAIL.

### Relationship to Rule 39

Rule 39 requires 6 sections (Task, Files Modified, Functions Modified, Commit, Verification Command, Expected). Rule 47 expands this to 11 sections, adding: Git Diff, Raw Output, Failure Output, Reproduction, Tests. Rule 47 is a superset of Rule 39 — compliance with Rule 47 implies compliance with Rule 39.

---

## Rule 48 — Engineering Diff Evidence

Enforcement Type: Machine-Enforceable
Verification Method: pnpm verify:traceability (diff block detection)
Responsible Verifier: packages/engineering-assurance/src/verifiers/traceability-verifier.ts
Regression Test: packages/engineering-assurance/src/verifiers/**tests**/traceability-verifier.test.ts
Falsification Criteria: A source-modifying commit missing a diff block (lines starting with `+` or `-` in a code block) causes pnpm verify:traceability to return FAIL.

### Rule Statement

Every implementation prompt SHALL include the exact before/after code diff for every file modification. The diff SHALL use standard unified diff format with `+` and `-` prefixes.

### Example

Instead of saying "modify traceability-verifier.ts", show:

```diff
-export const REQUIRED_SECTIONS = [
-  "Task",
-  "Commit"
-];
+export const REQUIRED_SECTIONS = [
+  "Task",
+  "Files Modified",
+  "Functions Modified",
+  "Commit",
+  "Git Diff",
+  "Verification",
+  "Expected Output",
+  "Failure Output",
+];
```

### Why This Matters

A diff block allows another AI or human engineer to apply the patch directly using `git apply`. This transforms implementation guidance from "describe what to do" to "here is the exact change."

### Enforcement

The traceability-verifier checks commit messages for diff blocks — lines starting with `+` or `-` within a code block (delimited by triple backticks). A commit without a diff block produces FAIL.

---

## Summary Table

| Rule | Title                                              | Type         | Enforcement        | Status |
| ---- | -------------------------------------------------- | ------------ | ------------------ | ------ |
| 44   | Code First, Explanation Second                     | Process      | Machine + Reviewer | Active |
| 45   | Every Prompt Must Contain Working Reference Code   | Code Quality | Machine + Reviewer | Active |
| 46   | Every Code Sample Must Be Verifiable               | Code Quality | Reviewer           | Active |
| 47   | Every Engineering Claim Must Have Executable Proof | Evidence     | Machine            | Active |
| 48   | Engineering Diff Evidence                          | Evidence     | Machine            | Active |

---

## Change Log

| Date       | Commit        | Change                                                                    |
| ---------- | ------------- | ------------------------------------------------------------------------- |
| 2026-08-04 | (this commit) | Initial creation. Rules 44-48 defined with Enforcement Type declarations. |
