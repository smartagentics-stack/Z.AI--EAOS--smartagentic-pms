# Rule 36 — Governance Automation

**Status:** BINDING — final rule of Engineering Assurance Framework v2.0
**Created:** 2026-08-02
**Source:** Principal engineer final review

Enforcement Type: Machine-Enforceable
Verification Method: pnpm verify (all verifiers)
Responsible Verifier: packages/engineering-assurance/src/verifiers/ (all)
Regression Test: packages/engineering-assurance/src/verifiers/**tests**/
Falsification Criteria: A governance rule that exists only as documentation and has no executable verifier proves Rule 36 is violated for that rule.

---

> Every governance rule that can be automatically verified must eventually be enforced by tooling rather than manual review.

The goal:

```
Human reviews architecture.
Automation reviews compliance.
```

## Automation Roadmap

### Phase A — Governance Automation (executable checks)

```
pnpm verify:governance   — Check all governance docs exist and are referenced
pnpm verify:evidence     — Check evidence files exist for every claim
pnpm verify:adr          — Check ADR numbering, references, and traceability
pnpm verify:phase        — Check phase transition gates are satisfied
pnpm verify:performance  — Check performance regression evidence
pnpm verify:security     — Check security verification gate
```

### Phase B — Engineering Dashboard

Reports: ADR compliance, test coverage, regression status, performance history, evidence completeness, governance compliance, EAR readiness, phase readiness.

### Phase C — AI Engineering Reviewer Agent

A dedicated reviewer agent that: never writes production code, only audits, checks governance compliance, validates evidence, challenges unsupported claims, produces Engineering Acceptance Reports (EARs).

This creates clean separation of duties between implementation and review (Rule 16).

---

## Framework Freeze Declaration

**Engineering Governance Framework v1.0 is FEATURE-FROZEN.**

36 rules. 25 governance documents. 13 ADRs. 1 engineering charter.

No new rules will be added. The next investment is automation — turning governance from documents into executable checks.

That transition — from written policy to automated enforcement — is what will make SmartAgentics AI PMS engineering process scalable and sustainable.
