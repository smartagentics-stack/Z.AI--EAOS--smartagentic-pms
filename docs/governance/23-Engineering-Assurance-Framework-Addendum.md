# SmartAgentics AI PMS — Engineering Assurance Framework Addendum

**Version:** 1.0
**Status:** BINDING — supplements Master Engineering Assurance Prompt
**Created:** 2026-08-02
**Source:** Senior architect review of Master Engineering Assurance Prompt v1.0

Enforcement Type: Hybrid
Verification Method: pnpm verify (multiple verifiers) + Engineering Acceptance Review
Responsible Verifier: packages/engineering-assurance/src/verifiers/ (multiple)
Regression Test: packages/engineering-assurance/src/verifiers/**tests**/
Falsification Criteria: Individual rules have individual falsification criteria; see each rule's section.

---

## Rules 24-30

### Rule 24 — Evidence Quality Matrix

Not all evidence has the same reliability. Every evidence item must be classified:

| Evidence                 | Reliability | Independent? |
| ------------------------ | ----------- | ------------ |
| AI explanation           | Low         | No           |
| Source code              | Medium      | No           |
| Git diff                 | Medium      | No           |
| Local test run           | High        | No           |
| CI run                   | Very High   | Yes          |
| Independent reproduction | Highest     | Yes          |

Weak evidence may never be presented as conclusive.

### Rule 25 — Negative Evidence

Every engineering report must answer:

- What failed?
- What assumptions were wrong?
- What hypotheses were rejected?
- What evidence contradicts the preferred solution?

Failures must be recorded as carefully as successes.

### Rule 26 — Rollback Evidence

Every architectural change must include:

- How to revert it
- How to verify rollback
- Which data is affected
- Whether rollback is safe

### Rule 27 — Performance Regression Gate

Every change must explicitly state whether it affects: latency, CPU, RAM, storage, network, startup time. If performance changed, provide benchmark evidence.

### Rule 28 — Security Verification Gate

Every feature must state whether it introduces or affects: authentication, authorization, SQL injection, XSS, CSRF, secrets, encryption, audit logs, multi-tenancy, row-level security. If applicable, require security evidence.

### Rule 29 — Architecture Drift Detection

Every change must answer:

- Does this violate an ADR?
- Does it supersede an ADR?
- Does it require a new ADR?
- Does it change the architecture baseline?

### Rule 30 — AI Confidence Declaration

For every significant statement, classify as one of:

- VERIFIED
- REPOSITORY EVIDENCE
- TEST EVIDENCE
- CI EVIDENCE
- EXTERNAL RESEARCH
- ENGINEERING INFERENCE
- ASSUMPTION

Assumptions must never be presented as established facts.

---

## Updated Rule 23 — Evidence Hierarchy (Revised)

When evidence conflicts, trust it in this order (highest to lowest):

1. Independent reproduction from a clean clone
2. Independent CI/CD execution
3. Independent reviewer approval
4. Runtime traces, logs, metrics, and profiling
5. Regression and integration test results
6. Unit test results
7. Git history and diffs
8. Source code inspection
9. Engineering reasoning
10. AI narrative

A human reviewer outranks machine-generated logs when interpreting engineering significance. The AI's narrative must never override stronger evidence.

---

## Provenance

Rules 24-30 and the revised Rule 23 were added because:

- Rule 24 (Evidence Quality Matrix): Prevents weak evidence from being presented as conclusive
- Rule 25 (Negative Evidence): SPIKE-01 Runs 1-6 were failures that were initially underreported
- Rule 26 (Rollback Evidence): Critical as SmartAgentics grows and changes become harder to revert
- Rule 27 (Performance Regression Gate): Prevents silent performance degradation
- Rule 28 (Security Verification Gate): PMS handles guest data, payment data — security cannot be optional
- Rule 29 (Architecture Drift Detection): Prevents accumulated small changes from violating ADRs
- Rule 30 (AI Confidence Declaration): Prevents the "plausible = confirmed" error that plagued early SPIKE-01 runs

The revised Rule 23 adds "Independent reviewer approval" at position 3 because human judgment in interpreting engineering significance is more reliable than raw logs alone.
