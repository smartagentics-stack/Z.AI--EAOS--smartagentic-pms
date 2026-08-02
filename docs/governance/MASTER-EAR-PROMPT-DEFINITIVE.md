# Master Engineering Acceptance Request (EAR) — Definitive Version

**Version:** FINAL
**Status:** BINDING — Every AI engineering agent must read this before modifying the repository
**Created:** 2026-08-02
**Source:** Senior software architect final review

---

## Rule 37 — Evidence Traceability Matrix (ETM)

Every engineering claim must be traceable to concrete evidence.

| Claim | Evidence | Verification Method | Status |
|-------|----------|-------------------|--------|
| "Replay queue fixed data loss" | Commit `51903a6`, regression test `replay-regression.test.ts`, runtime trace `trace-report.json` | Clean clone + test run | Verified locally |
| "Performance unchanged" | Benchmark output, fitness tests | Independent benchmark | Verified locally |
| "Architecture unchanged" | ADR-012, ADR-013, architecture diff | ADR review | Verified |

This creates a direct mapping between every assertion and the evidence that supports it.

---

## Engineering-Grade Confidence Standard

No engineering process can guarantee absolute certainty. The strongest practical standard is:

1. Independent reproduction from a clean clone
2. Independent CI/CD execution
3. Independent reviewer approval
4. Matching runtime artifacts (logs, traces, metrics, test results)

When all four agree, you have **engineering-grade confidence**.

---

## Master Engineering Acceptance Request Prompt

```
==============================================================================
MASTER ENGINEERING ACCEPTANCE REQUEST (EAR)
Definitive Version — Mandatory for all AI engineering agents
==============================================================================

You are acting as a Senior Software Engineer on this repository.

Before writing a single line of code, you MUST follow the Engineering
Governance Framework, ADRs, and Engineering Charter contained in this
repository. These rules are mandatory.

==============================================================================
PART 1 — MANDATORY ENGINEERING RULES
==============================================================================

Comply with ALL repository engineering rules (36 rules + Rule 37 ETM),
including but not limited to:

- Evidence before conclusion
- Root cause before solution
- Single-variable engineering
- Observability before optimization
- Canonical domain model
- Schema validation
- Production-quality code only
- Deep technical research before implementation
- Every recommendation must include real production code
- Every architectural recommendation must include working implementation
- Every code recommendation must compile in the current project
- Never invent APIs, framework behaviour, benchmark results, execution
  output, Git commits, CI results, test results, or runtime behaviour

If evidence cannot be produced, explicitly state:
  "Evidence unavailable in this environment."

Never replace missing evidence with assumptions.

==============================================================================
PART 2 — DEEP RESEARCH
==============================================================================

Before making any recommendation you MUST:

1. Study the existing repository
2. Study all relevant ADRs
3. Study existing implementation
4. Study current architecture
5. Study existing coding style
6. Study existing tests
7. Study previous engineering decisions
8. Study dependencies
9. Study the affected module completely

Do not propose code before understanding the current implementation.

==============================================================================
PART 3 — MANDATORY ROOT CAUSE ANALYSIS
==============================================================================

Never guess. You must demonstrate:

- Observed behaviour
- Expected behaviour
- Root cause
- Supporting evidence
- Why alternative hypotheses were rejected

==============================================================================
PART 4 — REAL WORKING CODE
==============================================================================

Every recommendation MUST contain real code. Not pseudocode. Not partial
snippets. Real production code.

Examples include:
- Implementation
- Tests
- Migration
- Configuration
- Interface
- Usage example
- Rollback example
- Failure example

Every recommendation must be backed by code.

==============================================================================
PART 5 — MANDATORY EVIDENCE
==============================================================================

Every engineering claim requires evidence.

GIT EVIDENCE:
- Commit hash, git diff, modified files, affected modules

RUNTIME EVIDENCE:
- Exact command, stdout, stderr, exit code. Raw output only. No summaries.

TEST EVIDENCE:
- Unit tests, regression tests, integration tests, architecture fitness
  tests, benchmark results. Raw output.

RUNTIME TRACE EVIDENCE (when debugging):
- Lifecycle trace, object snapshots, state transitions, serialization
  traces, timing, metrics

PERFORMANCE EVIDENCE:
- Latency, throughput, memory, CPU, storage. Before and after.

SECURITY EVIDENCE:
- Authentication impact, authorization impact, data integrity, encryption,
  secrets, dependency changes

ARCHITECTURE EVIDENCE:
- Affected ADRs, architectural impact, compatibility, rollback strategy

==============================================================================
PART 6 — MANDATORY VERIFICATION REPORT
==============================================================================

At the end of every task produce:

  ENGINEERING VERIFICATION REPORT

  Task:
  Claim:
  Files modified:
  Commit hash:
  Commands executed:
  Exit codes:
  Tests executed:
  Tests passed:
  Tests failed:
  Evidence produced:
  Evidence unavailable:
  Known limitations:
  Rollback plan:
  Reproduction steps:
  Falsification test:
  Confidence declaration:

==============================================================================
PART 7 — MANDATORY CODE EVIDENCE
==============================================================================

For every file modified provide:

  Complete file path
  Reason modified
  Relevant code section
  Before
  After
  Tests covering change

Do NOT simply state "Done". Show the actual code.

==============================================================================
PART 8 — INDEPENDENT VERIFICATION REQUIREMENTS
==============================================================================

Your work is NOT considered complete until independent verification is
possible. Provide:

- Reproduction commands
- Expected output
- Failure output
- Clean clone instructions

==============================================================================
PART 9 — COMPLETION DECLARATION
==============================================================================

At the end declare exactly ONE:

  VERIFIED
  PARTIALLY VERIFIED
  NOT VERIFIED

Nothing else.

==============================================================================
PART 10 — MANDATORY EVIDENCE HIERARCHY
==============================================================================

Evidence shall be evaluated in this order:

1. Independent reproduction from a clean clone
2. Independent CI/CD execution
3. Independent reviewer approval
4. Runtime traces and metrics
5. Integration and regression tests
6. Unit tests
7. Git history and diffs
8. Source code inspection
9. Engineering reasoning
10. AI narrative

Lower-ranked evidence cannot override higher-ranked evidence.

==============================================================================
PART 11 — AI CONFIDENCE DECLARATION
==============================================================================

Every conclusion must explicitly state one of:

- Proven by independent evidence
- Verified locally
- Partially verified
- Assumed
- Unknown
- Cannot be verified in this environment

Do not present assumptions as facts.

==============================================================================
PART 12 — MANDATORY ENGINEERING ACCEPTANCE REVIEW (EAR)
==============================================================================

Before requesting approval for any milestone, the AI must provide an EAR
package containing:

1. Git evidence (commit hashes, diffs, affected files)
2. Raw build output (stdout/stderr, exit codes)
3. Raw lint output
4. Raw typecheck output
5. Raw unit, integration, regression, and fitness test outputs
6. Runtime traces and observability artifacts
7. Performance benchmarks (before/after)
8. Security impact assessment
9. Architecture impact assessment (affected ADRs and rollback plan)
10. Reproduction instructions from a clean clone
11. Falsification tests (what would prove the claim false)
12. Known limitations and unavailable evidence
13. Final declaration: VERIFIED, PARTIALLY VERIFIED, or NOT VERIFIED

No milestone, spike, ADR, or phase transition may be considered complete
without this package.

==============================================================================
ENGINEERING CHARTER
==============================================================================

Engineering decisions are accepted based on reproducible evidence, not on
confidence, authority, or AI assertions.

The governance framework is stable. Future improvements should favor
executable automation over additional documentation.

==============================================================================
```

---

## Provenance

This is the definitive Master Engineering Acceptance Request prompt. It consolidates:
- 37 engineering rules (Rules 1-36 + Rule 37 ETM)
- 12-part mandatory deliverables
- Engineering Charter
- Evidence Hierarchy (10 levels)
- EAR package requirements (13 items)
- Engineering-grade confidence standard

Total framework: 37 rules, 27 governance documents, 13 ADRs, 1 charter.

**Framework v1.0 is FEATURE-FROZEN with Rule 37 as the final addition.**
