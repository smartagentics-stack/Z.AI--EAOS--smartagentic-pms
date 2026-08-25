# SmartAgentics Engineering Rule Registry

**Version:** 1.0
**Status:** BINDING — canonical source of truth for all engineering rules
**Created:** 2026-08-04
**Source:** EAR-EAP-PHASE-A-001 (Independent Engineering Acceptance Review)
**Enforcement Type:** Machine-Enforceable
**Verification Method:** `pnpm verify:governance`
**Responsible Verifier:** `packages/engineering-assurance/src/verifiers/governance-verifier.ts`
**Regression Test:** `packages/engineering-assurance/src/verifiers/__tests__/governance-verifier.test.ts`
**Falsification Criteria:** Delete this file → `pnpm verify:governance` exits with code 1

---

## Purpose

This document is the single source of truth for all engineering rules in the SmartAgentics AI PMS project. Every rule — whether Machine-Enforceable, Reviewer-Enforced, Process, or Documentation — is registered here with its classification, enforcement mechanism, source document, status, and dependencies.

No rule is considered adopted until it appears in this registry. No rule is considered enforceable unless its Enforcement Type is declared.

---

## Rule Classification System (Rule 43)

Every rule in this registry is classified as one of:

| Classification          | Meaning                                              | Verification               |
| ----------------------- | ---------------------------------------------------- | -------------------------- |
| **Machine-Enforceable** | Validated automatically by tooling (`pnpm verify:*`) | Verifier returns PASS/FAIL |
| **Reviewer-Enforced**   | Validated during Engineering Acceptance Review (EAR) | Reviewer judgment          |
| **Process Rule**        | Governs the engineering process; reviewer-validated  | Reviewer judgment          |
| **Documentation Rule**  | Governs documentation quality; reviewer-validated    | Reviewer judgment          |

---

## Summary Table (43 Rules)

| #   | Title                                     | Category      | Type     | Status |
| --- | ----------------------------------------- | ------------- | -------- | ------ |
| 1   | Evidence Before Conclusion                | Evidence      | Reviewer | Active |
| 2   | Single Variable Engineering               | Process       | Process  | Active |
| 3   | Mandatory Root Cause Analysis             | Evidence      | Reviewer | Active |
| 4   | Observability First                       | Evidence      | Machine  | Active |
| 5   | Canonical Domain Model                    | Architecture  | Machine  | Active |
| 6   | Mandatory Schema Validation               | Code Quality  | Machine  | Active |
| 7   | Production Quality Code Only              | Code Quality  | Reviewer | Active |
| 8   | Real Working Code Samples                 | Code Quality  | Reviewer | Active |
| 9   | Deep Technical Research                   | Process       | Process  | Active |
| 10  | Every Recommendation Must Include Proof   | Evidence      | Reviewer | Active |
| 11  | Mandatory Code Evidence                   | Evidence      | Machine  | Active |
| 12  | Engineering Verification Report           | Evidence      | Reviewer | Active |
| 13  | No Unsupported Claims                     | Evidence      | Machine  | Active |
| 14  | Mandatory Falsification                   | Evidence      | Reviewer | Active |
| 15  | Independent Reproduction                  | Evidence      | Machine  | Active |
| 16  | Separation of Duties                      | Process       | Process  | Active |
| 17  | Independent Audit Before Phase Transition | Process       | Process  | Active |
| 18  | Engineering Acceptance Review (EAR)       | Process       | Process  | Active |
| 19  | Git Evidence Required                     | Evidence      | Machine  | Active |
| 20  | CI/CD Evidence Required                   | Evidence      | Machine  | Active |
| 21  | Mandatory Real Code Evidence              | Evidence      | Reviewer | Active |
| 22  | Completion Criteria                       | Process       | Process  | Active |
| 23  | Evidence Hierarchy                        | Evidence      | Reviewer | Active |
| 24  | Evidence Quality Matrix                   | Evidence      | Reviewer | Active |
| 25  | Negative Evidence                         | Evidence      | Reviewer | Active |
| 26  | Rollback Evidence                         | Evidence      | Reviewer | Active |
| 27  | Performance Regression Gate               | Performance   | Machine  | Active |
| 28  | Security Verification Gate                | Security      | Machine  | Active |
| 29  | Architecture Drift Detection              | Architecture  | Machine  | Active |
| 30  | AI Confidence Declaration                 | Documentation | Reviewer | Active |
| 31  | Change Risk Classification                | Process       | Process  | Active |
| 32  | Dependency Impact Analysis                | Process       | Process  | Active |
| 33  | Release Readiness Checklist               | Process       | Process  | Active |
| 34  | AI Decision Log                           | Documentation | Reviewer | Active |
| 35  | Production Readiness Gate                 | Process       | Process  | Active |
| 36  | Governance Automation                     | Governance    | Machine  | Active |
| 37  | Evidence Traceability Matrix              | Evidence      | Reviewer | Active |
| 38  | Executable Evidence                       | Governance    | Machine  | Active |
| 39  | Engineering Traceability Block            | Process       | Machine  | Active |
| 40  | No Unsupported Engineering Claims         | Evidence      | Machine  | Active |
| 41  | Every Recommendation Must Be Executable   | Code Quality  | Reviewer | Active |
| 42  | Engineer Before You Prompt                | Process       | Hybrid   | Active |
| 43  | Every Rule Must Be Classified             | Governance    | Machine  | Active |
| 44  | Code First, Explanation Second            | Process       | Hybrid   | Active |
| 45  | Every Prompt Must Contain Working Code    | Code Quality  | Hybrid   | Active |
| 46  | Every Code Sample Must Be Verifiable      | Code Quality  | Reviewer | Active |
| 47  | Every Claim Must Have Executable Proof    | Evidence      | Machine  | Active |
| 48  | Engineering Diff Evidence                 | Evidence      | Machine  | Active |

---

## Detailed Registry

### Rule 1 — Evidence Before Conclusion

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** Engineering Acceptance Review
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md` (index); original: Master Prompt v1.0
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** —

### Rule 2 — Single Variable Engineering

- **Category:** Process
- **Type:** Process Rule
- **Enforcement Mechanism:** Code review / EAR
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 1

### Rule 3 — Mandatory Root Cause Analysis

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** Engineering Acceptance Review
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 1, Rule 4

### Rule 4 — Observability First

- **Category:** Evidence
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify:evidence` (checks for trace-report.json)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `evidence-verifier.ts`
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** —

### Rule 5 — Canonical Domain Model

- **Category:** Architecture
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify:serialization` (round-trip test)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** ADR-012 (Canonical SyncRecord Model)
- **Related Verification Tool:** `serialization-verifier.ts`
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 6

### Rule 6 — Mandatory Schema Validation

- **Category:** Code Quality
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify:serialization` (Zod schema check)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** ADR-012
- **Related Verification Tool:** `serialization-verifier.ts`
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** —

### Rule 7 — Production Quality Code Only

- **Category:** Code Quality
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** Code review / EAR
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `forbidden-code-verifier.ts` (partial — detects placeholders)
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 8

### Rule 8 — Real Working Code Samples

- **Category:** Code Quality
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** Code review / EAR
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** —

### Rule 9 — Deep Technical Research

- **Category:** Process
- **Type:** Process Rule
- **Enforcement Mechanism:** EAR (reviewer evaluates research depth)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** —

### Rule 10 — Every Recommendation Must Include Proof

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 1

### Rule 11 — Mandatory Code Evidence

- **Category:** Evidence
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify` (all verifiers)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** All verifiers
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 21

### Rule 12 — Engineering Verification Report

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR (report template check)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `report-generator.ts` (generates reports)
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 10

### Rule 13 — No Unsupported Claims

- **Category:** Evidence
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify:security` (Rule 40 bare-claim scan — proposed)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `forbidden-code-verifier.ts` (proposed enhancement)
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 1

### Rule 14 — Mandatory Falsification

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR (falsification test required in review)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** Unit tests with falsification cases
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 15

### Rule 15 — Independent Reproduction

- **Category:** Evidence
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** CI (`pnpm verify` from clean clone)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** CI pipeline
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 20

### Rule 16 — Separation of Duties

- **Category:** Process
- **Type:** Process Rule
- **Enforcement Mechanism:** EAR (implementer ≠ verifier)
- **Source Document:** `docs/governance/22-Independent-Engineering-Acceptance-Policy.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `363f11f`
- **Rule Dependencies:** Rule 18

### Rule 17 — Independent Audit Before Phase Transition

- **Category:** Process
- **Type:** Process Rule
- **Enforcement Mechanism:** EAR (mandatory before phase transition)
- **Source Document:** `docs/governance/21-Independent-Audit-Before-Phase-Transition.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `77c6ae9`
- **Rule Dependencies:** Rule 18

### Rule 18 — Engineering Acceptance Review (EAR)

- **Category:** Process
- **Type:** Process Rule
- **Enforcement Mechanism:** EAR (formal review template)
- **Source Document:** `docs/governance/22-Independent-Engineering-Acceptance-Policy.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `363f11f`
- **Rule Dependencies:** Rule 16, Rule 17

### Rule 19 — Git Evidence Required

- **Category:** Evidence
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify` (report-generator captures commit hash)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `report-generator.ts`
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** —

### Rule 20 — CI/CD Evidence Required

- **Category:** Evidence
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** CI pipeline (`pnpm verify` step — proposed for CI)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** CI pipeline
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 19

### Rule 21 — Mandatory Real Code Evidence

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR (code must accompany claim)
- **Source Document:** `docs/governance/22-Independent-Engineering-Acceptance-Policy.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `363f11f`
- **Rule Dependencies:** Rule 11

### Rule 22 — Completion Criteria

- **Category:** Process
- **Type:** Process Rule
- **Enforcement Mechanism:** EAR (criteria must be defined before work starts)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** —

### Rule 23 — Evidence Hierarchy

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR (reviewer applies hierarchy)
- **Source Document:** `docs/governance/23-Engineering-Assurance-Framework-Addendum.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `d57e7e6`
- **Rule Dependencies:** Rule 1

### Rule 24 — Evidence Quality Matrix

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR
- **Source Document:** `docs/governance/23-Engineering-Assurance-Framework-Addendum.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `d57e7e6`
- **Rule Dependencies:** Rule 23

### Rule 25 — Negative Evidence

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR (absence of evidence must be explained)
- **Source Document:** `docs/governance/23-Engineering-Assurance-Framework-Addendum.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `d57e7e6`
- **Rule Dependencies:** Rule 23

### Rule 26 — Rollback Evidence

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR (rollback plan required)
- **Source Document:** `docs/governance/23-Engineering-Assurance-Framework-Addendum.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `d57e7e6`
- **Rule Dependencies:** —

### Rule 27 — Performance Regression Gate

- **Category:** Performance
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** CI (performance test threshold — proposed)
- **Source Document:** `docs/governance/23-Engineering-Assurance-Framework-Addendum.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** — (not yet implemented)
- **Last Updated Commit:** `d57e7e6`
- **Rule Dependencies:** —

### Rule 28 — Security Verification Gate

- **Category:** Security
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify:security` + `pnpm verify:dependencies`
- **Source Document:** `docs/governance/23-Engineering-Assurance-Framework-Addendum.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `forbidden-code-verifier.ts`, `dependency-verifier.ts`
- **Last Updated Commit:** `d57e7e6`
- **Rule Dependencies:** —

### Rule 29 — Architecture Drift Detection

- **Category:** Architecture
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify:architecture`
- **Source Document:** `docs/governance/23-Engineering-Assurance-Framework-Addendum.md`
- **Status:** Active (verifier has known glob bug — B2 from EAR)
- **Related ADR(s):** ADR-006, ADR-009, ADR-012
- **Related Verification Tool:** `architecture-drift-verifier.ts`
- **Last Updated Commit:** `d57e7e6`
- **Rule Dependencies:** —

### Rule 30 — AI Confidence Declaration

- **Category:** Documentation
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR (statements must be tagged: observed/inference/recommendation)
- **Source Document:** `docs/governance/23-Engineering-Assurance-Framework-Addendum.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `d57e7e6`
- **Rule Dependencies:** Rule 23

### Rule 31 — Change Risk Classification

- **Category:** Process
- **Type:** Process Rule
- **Enforcement Mechanism:** EAR (risk level must be declared)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** —

### Rule 32 — Dependency Impact Analysis

- **Category:** Process
- **Type:** Process Rule
- **Enforcement Mechanism:** EAR (impact analysis required)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `dependency-verifier.ts` (partial)
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 31

### Rule 33 — Release Readiness Checklist

- **Category:** Process
- **Type:** Process Rule
- **Enforcement Mechanism:** EAR (checklist must be completed)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 31, Rule 32

### Rule 34 — AI Decision Log

- **Category:** Documentation
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR (AI decisions must be logged)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** —

### Rule 35 — Production Readiness Gate

- **Category:** Process
- **Type:** Process Rule
- **Enforcement Mechanism:** EAR (gate must pass before production)
- **Source Document:** `docs/governance/24-Engineering-Assurance-Framework-v2.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `04884d8`
- **Rule Dependencies:** Rule 27, Rule 28, Rule 33

### Rule 36 — Governance Automation

- **Category:** Governance
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify` (all verifiers)
- **Source Document:** `docs/governance/25-Rule-36-Governance-Automation.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** All verifiers in `packages/engineering-assurance/`
- **Last Updated Commit:** `5dc4e7f`
- **Rule Dependencies:** Rule 38

### Rule 37 — Evidence Traceability Matrix

- **Category:** Evidence
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR (ETM must accompany evidence)
- **Source Document:** `docs/governance/MASTER-EAR-PROMPT-DEFINITIVE.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** `e6f7d8b`
- **Rule Dependencies:** Rule 23

### Rule 38 — Executable Evidence

- **Category:** Governance
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify` (documentation claims must be backed by executable checks)
- **Source Document:** `docs/governance/26-Rule-38-Executable-Evidence.md`
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** All verifiers
- **Last Updated Commit:** `8cc2280`
- **Rule Dependencies:** Rule 23, Rule 36

### Rule 39 — Engineering Traceability Block

- **Category:** Process
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify:traceability` (proposed — scans commit messages)
- **Source Document:** Proposed in `docs/governance/27-Rules-39-43-*.md` (not yet created)
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `traceability-verifier.ts` (proposed)
- **Last Updated Commit:** — (not yet adopted)
- **Rule Dependencies:** Rule 21, Rule 38

### Rule 40 — No Unsupported Engineering Claims

- **Category:** Evidence
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify:security` (proposed — scans for bare "Done."/"Implemented." without evidence)
- **Source Document:** Proposed in `docs/governance/27-Rules-39-43-*.md` (not yet created)
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `forbidden-code-verifier.ts` (proposed enhancement)
- **Last Updated Commit:** — (not yet adopted)
- **Rule Dependencies:** Rule 1, Rule 13

### Rule 41 — Every Recommendation Must Be Executable

- **Category:** Code Quality
- **Type:** Reviewer Enforced
- **Enforcement Mechanism:** EAR (reviewer rejects recommendations without executable guidance)
- **Source Document:** Proposed in `docs/governance/27-Rules-39-43-*.md` (not yet created)
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** —
- **Last Updated Commit:** — (not yet adopted)
- **Rule Dependencies:** Rule 2, Rule 8

### Rule 42 — Engineer Before You Prompt

- **Category:** Process
- **Type:** Hybrid (Machine + Reviewer)
- **Enforcement Mechanism:** `pnpm verify:prompt` (proposed — validates prompt structure) + EAR
- **Source Document:** Proposed in `docs/governance/27-Rules-39-43-*.md` (not yet created)
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `prompt-structure-verifier.ts` (proposed)
- **Last Updated Commit:** — (not yet adopted)
- **Rule Dependencies:** Rule 3, Rule 9

### Rule 43 — Every Rule Must Be Classified

- **Category:** Governance
- **Type:** Machine-Enforceable
- **Enforcement Mechanism:** `pnpm verify:governance` (proposed — checks every rule doc declares Enforcement Type)
- **Source Document:** Proposed in `docs/governance/27-Rules-39-43-*.md` (not yet created)
- **Status:** Active
- **Related ADR(s):** —
- **Related Verification Tool:** `governance-verifier.ts` (proposed enhancement)
- **Last Updated Commit:** — (not yet adopted)
- **Rule Dependencies:** Rule 36, Rule 38

---

## Known Issues

### Issue 1: Rule Numbering Discrepancy

The repository contains THREE overlapping rule numbering systems:

1. **`docs/governance/18-Senior-Engineering-Operating-Rules.md`** — Rules 1-18 with titles like "Evidence Before Implementation", "Always Back Every Recommendation with Working Code", etc. These are the **original operating rules** from the EAOS investigation.

2. **`docs/governance/20-Engineering-Verification-Evidence-Policy.md`** — Rules 1-16 with titles like "No Unsupported Claims", "Every Engineering Claim Must Produce Proof", etc. These are the **verification evidence policy** rules.

3. **`docs/governance/24-Engineering-Assurance-Framework-v2.md`** — Rules 1-35 with titles like "Evidence Before Conclusion", "Single Variable Engineering", etc. This is the **canonical consolidated index** and is the numbering used in this registry.

**Resolution:** This registry uses the numbering from system 3 (doc 24) as canonical, because it is the latest consolidated index and the one referenced in the Engineering Charter. Systems 1 and 2 are older formulations of the same principles. A future commit should add "Superseded by canonical numbering in doc 24" headers to docs 18 and 20.

### Issue 2: Rules 36-38 Not in Original Index

Rules 36, 37, and 38 were added AFTER doc 24's "Complete Rule Index" was written. They exist in their own dedicated documents but were never added to the doc 24 index. This registry corrects that omission.

### Issue 3: Rules 39-43 Are Proposed, Not Adopted

Rules 39-43 were proposed during the EAR-EAP-PHASE-A-001 review. They are listed here as "Proposed" for tracking purposes. They become "Active" only after `docs/governance/27-Rules-39-43-*.md` is created and adopted via the Engineering Review Gate.

---

## Change Log

| Date       | Commit        | Change                                                                                                  |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| 2026-08-04 | (this commit) | Initial creation. Registered all 38 active rules + 5 proposed rules (39-43). Documented 5 known issues. |
