# SmartAgentics AI PMS — Engineering Assurance Framework v2.0

**Version:** 2.0
**Status:** BINDING — supplements Master Engineering Assurance Prompt
**Created:** 2026-08-02
**Source:** Principal software engineer review of v1.0 framework

Enforcement Type: Hybrid
Verification Method: pnpm verify (multiple verifiers) + Engineering Acceptance Review
Responsible Verifier: packages/engineering-assurance/src/verifiers/ (multiple)
Regression Test: packages/engineering-assurance/src/verifiers/**tests**/
Falsification Criteria: Individual rules have individual falsification criteria; see each rule's section.

---

## Engineering Charter

> **Engineering decisions are accepted based on reproducible evidence, not on confidence, authority, or AI assertions.**

This single sentence is the guiding philosophy for the SmartAgentics AI PMS project. It encapsulates the intent of all 35 rules and serves as the project's engineering charter.

---

## Rules 31-35

### Rule 31 — Change Risk Classification

Every engineering task must include a risk assessment:

| Risk     | Meaning                                                        | Approval Required    |
| -------- | -------------------------------------------------------------- | -------------------- |
| Low      | Documentation, tests, comments                                 | Self-approval        |
| Medium   | Internal implementation                                        | Peer review          |
| High     | Database, synchronization, networking                          | Architecture review  |
| Critical | Authentication, payments, multi-tenancy, production migrations | EAR + human approval |

Different risk levels require different approval workflows.

### Rule 32 — Dependency Impact Analysis

Every change must explicitly identify:

- Packages affected
- Modules affected
- APIs affected
- Database schema impact
- Backwards compatibility
- Migration requirements

### Rule 33 — Release Readiness Checklist

Before merging into main, require confirmation that:

- Build passes
- Tests pass
- Fitness tests pass
- Regression tests pass
- Documentation updated
- ADR updated if needed
- Rollback documented
- Performance reviewed (Rule 27)
- Security reviewed (Rule 28)
- Acceptance review completed (Rule 18)

### Rule 34 — AI Decision Log

Whenever the AI makes a non-trivial engineering decision, record:

- Alternatives considered
- Why alternatives were rejected
- Selected solution
- Supporting evidence
- Risks
- Assumptions

This creates a permanent engineering history.

### Rule 35 — Production Readiness Gate

Before production deployment, require evidence for:

- Backup strategy
- Recovery strategy
- Monitoring
- Alerting
- Logging
- Health checks
- Rollback validation
- Disaster recovery testing

---

## Strengthened Rule 30 — AI Confidence Declaration (Tagged Statements)

Every engineering statement must be tagged with its evidence classification:

```
[Repository Evidence]
This code exists in src/sync-client.ts at line 128.

[Test Evidence]
Regression test replay-regression.test.ts passed (5/5, exit 0).

[CI Evidence]
Workflow "CI" run #148 succeeded on ubuntu-latest.

[Engineering Inference]
This change is expected to reduce latency based on reduced TCP write calls.

[Assumption]
This benchmark assumes WAL mode remains enabled in production.
```

Untagged statements are prohibited. This removes ambiguity about what is known versus inferred.

---

## Strengthened Rule 18 — Engineering Acceptance Report (EAR) Template

Every completed SPIKE or milestone must produce a formal acceptance report:

```
ENGINEERING ACCEPTANCE REPORT (EAR)

Scope:                    [What was investigated/built]
Repository Version:       [commit hash]
Reviewer:                 [Name or "Independent Verification AI"]
Date:                     [YYYY-MM-DD]

Acceptance Criteria:      [List all criteria with pass/fail status]
Evidence Reviewed:        [List all evidence files, test outputs, traces]
Outstanding Risks:        [List risks that remain after acceptance]
Known Limitations:        [List what was NOT verified]

Recommendation:           [Summary of findings]
Decision:                 [Check one]
  □ Accepted
  □ Accepted with Conditions
  □ Requires Rework
  □ Rejected

Conditions (if applicable): [What must be done before full acceptance]
```

This becomes the official record for every completed SPIKE or milestone.

---

## Complete Rule Index (35 Rules)

| Rule | Title                                     | Source                                     |
| ---- | ----------------------------------------- | ------------------------------------------ |
| 1    | Evidence Before Conclusion                | Master Prompt v1.0                         |
| 2    | Single Variable Engineering               | Master Prompt v1.0                         |
| 3    | Mandatory Root Cause Analysis             | Master Prompt v1.0                         |
| 4    | Observability First                       | Master Prompt v1.0                         |
| 5    | Canonical Domain Model                    | Master Prompt v1.0                         |
| 6    | Mandatory Schema Validation               | Master Prompt v1.0                         |
| 7    | Production Quality Code Only              | Master Prompt v1.0                         |
| 8    | Real Working Code Samples                 | Master Prompt v1.0                         |
| 9    | Deep Technical Research                   | Master Prompt v1.0                         |
| 10   | Every Recommendation Must Include Proof   | Master Prompt v1.0                         |
| 11   | Mandatory Code Evidence                   | Master Prompt v1.0                         |
| 12   | Engineering Verification Report           | Master Prompt v1.0                         |
| 13   | No Unsupported Claims                     | Master Prompt v1.0                         |
| 14   | Mandatory Falsification                   | Master Prompt v1.0                         |
| 15   | Independent Reproduction                  | Master Prompt v1.0                         |
| 16   | Separation of Duties                      | Master Prompt v1.0                         |
| 17   | Independent Audit Before Phase Transition | Master Prompt v1.0                         |
| 18   | Engineering Acceptance Review (EAR)       | Master Prompt v1.0 + strengthened v2.0     |
| 19   | Git Evidence Required                     | Master Prompt v1.0                         |
| 20   | CI/CD Evidence Required                   | Master Prompt v1.0                         |
| 21   | Real Runtime Evidence Required            | Master Prompt v1.0                         |
| 22   | Completion Criteria                       | Master Prompt v1.0                         |
| 23   | Evidence Hierarchy (revised)              | Master Prompt v1.0 + revised v1.0 addendum |
| 24   | Evidence Quality Matrix                   | Addendum v1.0                              |
| 25   | Negative Evidence                         | Addendum v1.0                              |
| 26   | Rollback Evidence                         | Addendum v1.0                              |
| 27   | Performance Regression Gate               | Addendum v1.0                              |
| 28   | Security Verification Gate                | Addendum v1.0                              |
| 29   | Architecture Drift Detection              | Addendum v1.0                              |
| 30   | AI Confidence Declaration (strengthened)  | Addendum v1.0 + strengthened v2.0          |
| 31   | Change Risk Classification                | v2.0                                       |
| 32   | Dependency Impact Analysis                | v2.0                                       |
| 33   | Release Readiness Checklist               | v2.0                                       |
| 34   | AI Decision Log                           | v2.0                                       |
| 35   | Production Readiness Gate                 | v2.0                                       |

---

## Framework Status

| Component                        | Status                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Engineering Governance Framework | **VERIFIED** (reviewed, version-controlled, agreed upon)                             |
| SPIKE-01                         | **PARTIALLY VERIFIED** (pending EAR: independent verification, CI, endurance re-run) |
| SPIKE-07+                        | **BLOCKED** until SPIKE-01 EAR conditions are satisfied                              |

---

## Provenance

Version 2.0 was created because:

- Rule 31 (Change Risk Classification): Different changes need different approval levels
- Rule 32 (Dependency Impact Analysis): Prevents cascading breakage from unanalyzed changes
- Rule 33 (Release Readiness Checklist): Prevents incomplete merges
- Rule 34 (AI Decision Log): Creates permanent engineering history for AI-made decisions
- Rule 35 (Production Readiness Gate): Prevents deploying without DR/monitoring/rollback
- Strengthened Rule 30: Tagged statements eliminate ambiguity between fact and inference
- Strengthened Rule 18: Formal EAR template creates official acceptance record
- Engineering Charter: Single guiding principle for the entire project

**Total: 35 rules, 25 governance documents, 13 ADRs, 1 engineering charter.**
