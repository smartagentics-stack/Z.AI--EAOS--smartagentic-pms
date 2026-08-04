# Rule 38 — Executable Evidence

**Status:** BINDING — final rule of Engineering Assurance Framework
**Created:** 2026-08-03
**Source:** Principal engineer final review

Enforcement Type: Machine-Enforceable
Verification Method: pnpm verify (documentation claims must be backed by executable checks)
Responsible Verifier: packages/engineering-assurance/src/verifiers/ (all)
Regression Test: packages/engineering-assurance/src/verifiers/**tests**/
Falsification Criteria: A governance document that makes a claim but has no executable verifier backing that claim proves Rule 38 is violated.

---

> Every engineering claim must be backed by executable artifacts, not just documentation.

Documentation is useful. Code is stronger. Tests are stronger. CI is stronger. Independent reproduction is strongest.

If documentation and executable evidence disagree, executable evidence always wins.

This rule complements the Evidence Hierarchy (Rule 23) and makes it even harder for any AI—or human—to rely on assertions instead of verifiable results.

---

## Final Framework Declaration

**Engineering Governance Framework v1.0 — FEATURE-FROZEN**

- 38 engineering rules
- 27 governance documents
- 13 ADRs
- 1 engineering charter
- 1 master EAR prompt (definitive)

No new rules will be added. The next investment is automation (EAP Phase A-C).

**Engineering Charter:**

> Engineering decisions are accepted based on independently reproducible evidence—not confidence, authority, or AI assertions.
