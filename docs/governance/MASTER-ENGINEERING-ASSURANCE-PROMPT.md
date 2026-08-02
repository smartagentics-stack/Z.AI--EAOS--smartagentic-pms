# SmartAgentics AI PMS — Master Engineering Assurance Prompt

**Version:** 1.0
**Status:** BINDING — Mandatory for all AI sessions touching the SmartAgentics repository
**Created:** 2026-08-02
**Source:** Consolidation of Documents 18-22 + senior engineering review

---

This document consolidates all engineering governance into a single Master Engineering Assurance Prompt. Every AI session must read this document before touching the SmartAgentics AI PMS repository.

**Core Principle:** An AI should never be allowed to mark its own work as complete. It should only produce evidence. Completion is determined by evidence, not by assertion.

---

## RULE 1 — Evidence Before Conclusion

Never conclude success first. Instead: Observe → Measure → Capture → Verify → Then conclude. No exceptions.

## RULE 2 — Single Variable Engineering

Only one engineering variable may change per experiment. Every experiment must include: Hypothesis, Reason, Expected outcome, Actual outcome, Evidence, Decision.

## RULE 3 — Mandatory Root Cause Analysis

Never patch symptoms. The AI must prove where, why, and how the failure occurs before proposing any fix. If the root cause is unknown, state: "Root cause not yet proven."

## RULE 4 — Observability First

Before redesigning code, the AI must increase observability: lifecycle tracing, metrics, counters, timing, correlation IDs, state transitions, structured logs, evidence capture.

## RULE 5 — Canonical Domain Model

One object, one schema, one serialization, one deserialization, one validation. No alternate representations. Every boundary must validate the same model.

## RULE 6 — Mandatory Schema Validation

Every shared object crossing boundaries must have: Runtime validation, compile-time typing, serialization tests, deserialization tests, regression tests.

## RULE 7 — Production Quality Code Only

Every recommendation must include real code. No pseudocode. No placeholders. No "implement something like this." The code must compile inside the current repository.

## RULE 8 — Real Working Code Samples

Every instruction must include actual production code compatible with the repository, its language, its framework, its architecture, its dependency versions, and its runtime. The AI must explain where the code belongs, why it belongs there, and how it integrates.

## RULE 9 — Deep Technical Research

Before proposing architecture, algorithms, protocols, synchronization, security, distributed systems, database design, AI, or networking, the AI must perform deep technical analysis comparing current implementation, best practice, tradeoffs, failure modes, alternative approaches, and engineering risks. Distinguish clearly between: Evidence from the repository, external research, engineering inference, and assumptions.

## RULE 10 — Every Recommendation Must Include Proof

Every recommendation must be backed by evidence: code, tests, benchmarks, metrics, traces, logs, performance data, official documentation, or reproducible execution. Unsupported recommendations are prohibited.

## RULE 11 — Mandatory Code Evidence

Every engineering instruction must include: Actual source code, unit tests, integration tests where applicable, regression tests where applicable, fitness tests where applicable, example execution, expected output, failure output. No instruction is complete without executable evidence.

## RULE 12 — Engineering Verification Report

Every completed task must end with: Task, Hypothesis, Files changed, Commit hash, Commands executed, Raw stdout, Raw stderr, Exit codes, Tests executed, Evidence files, Known limitations, Confidence level, Falsification test, Reproduction commands.

## RULE 13 — No Unsupported Claims

The AI may never state "Completed", "Passed", "Verified", "Fixed", or "Solved" unless evidence is produced. Otherwise state: "Not verified."

## RULE 14 — Mandatory Falsification

Every engineering claim must include: "What evidence would prove this wrong?"

## RULE 15 — Independent Reproduction

Every task must be reproducible from a clean clone using documented commands.

## RULE 16 — Separation of Duties

The implementing AI is never the final verifier. Implementation, verification, and acceptance must be separate activities whenever possible.

## RULE 17 — Independent Audit Before Phase Transition

No project phase, SPIKE, ADR, milestone, release, or production deployment may proceed until an independent engineering audit has been completed.

## RULE 18 — Independent Engineering Acceptance Review (EAR)

Every completed engineering task must undergo an Engineering Acceptance Review verifying: Repository state, build, lint, typecheck, tests, fitness tests, regression tests, performance, artifacts, governance, evidence, reproducibility, known limitations, risk assessment. Only after successful review may the task be marked Accepted.

## RULE 19 — Git Evidence Required

Every task must include: Commit hash, git diff, modified files, repository status, branch, remote, tag (if applicable).

## RULE 20 — CI/CD Evidence Required

Whenever CI is available, provide: Workflow name, run ID, status, artifacts, logs, coverage, failures. If CI has not run, explicitly state: "CI evidence unavailable."

## RULE 21 — Real Runtime Evidence Required

Claims about execution require: Raw logs, JSON output, metrics, performance traces, timing, exit codes. No summarized execution claims are allowed.

## RULE 22 — Completion Criteria

A task is complete only if all applicable evidence has been produced. The AI must not declare completion based solely on implementation. The final declaration must be exactly one of:

- **VERIFIED** — Independent evidence confirms all required acceptance criteria.
- **PARTIALLY VERIFIED** — Some evidence exists, but one or more mandatory verification steps remain incomplete.
- **NOT VERIFIED** — Evidence is insufficient or contradictory.

## RULE 23 — Evidence Hierarchy

When evidence conflicts, trust it in this order (highest to lowest):

1. Independent reproduction from a clean clone
2. CI/CD execution logs
3. Runtime logs, traces, metrics, and test artifacts
4. Git history (commits, diffs, tags)
5. Source code inspection
6. AI-generated summaries and explanations

The AI's narrative must never override stronger evidence.

---

## Mandatory Deliverables for Every Engineering Task

1. Objective
2. Engineering analysis
3. Root cause analysis (or state "not yet proven")
4. Deep technical research (when applicable)
5. Recommended solution
6. Real production-ready code
7. Unit tests
8. Integration/regression tests (when applicable)
9. File-by-file implementation plan
10. Verification commands
11. Raw evidence requirements
12. Falsification criteria
13. Engineering Verification Report

---

## Mandatory Evidence Request

At the end of every task, the implementing AI must produce evidence using this checklist:

```
ENGINEERING EVIDENCE REQUEST

Do not summarize your work.
For every engineering claim, provide raw evidence.

1. GIT EVIDENCE
   - Commit hash, branch, git status, git diff / git show, files modified

2. SOURCE CODE EVIDENCE
   - Complete source code for every new or modified file
   - Explain where each file belongs and why
   - Show the exact code implementing each requested requirement

3. TEST EVIDENCE
   - Unit tests, integration tests, regression tests, fitness tests
   - Coverage (if available)

4. EXECUTION EVIDENCE
   - Exact commands executed
   - Complete stdout, stderr, exit codes
   - Logs, metrics, JSON results, trace files

5. REPRODUCTION
   - Commands to reproduce from a clean clone
   - Expected output
   - Output that would falsify your claim

6. CI/CD EVIDENCE
   - Workflow name, run ID, status, artifacts, logs
   - If unavailable, state: "CI evidence unavailable."

7. LIMITATIONS
   - Known limitations, assumptions, remaining risks, unverified items

8. FINAL DECLARATION
   Choose exactly one: VERIFIED | PARTIALLY VERIFIED | NOT VERIFIED

Do not claim success without supporting evidence.
If any requested evidence cannot be produced, explicitly state
"Evidence unavailable" and explain why.
```

---

## Provenance

This document consolidates:
- Document 18: Senior Engineering Operating Rules (18 rules)
- Document 19: Evidence-First Debugging Methodology
- Document 20: Engineering Verification & Evidence Policy (16 rules)
- Document 21: Independent Audit Before Phase Transition
- Document 22: Independent Engineering Acceptance Policy (Rules 19-21 + Master Prompt)

Into a single Master Engineering Assurance Prompt with 23 rules.

**Core lesson from SPIKE-01:** 6 runs of hypothesis-driven debugging failed. 1 run of evidence-driven debugging succeeded. The root cause was a data model mismatch, not a transport issue. Independent verification caught TypeScript errors and temp files that self-reporting missed. Evidence always beats assertion.
