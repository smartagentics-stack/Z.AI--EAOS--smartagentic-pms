# Senior Engineering Operating Rules (Mandatory)

**Version:** 1.0
**Status:** BINDING — overrides default behavior throughout the project
**Created:** 2026-07-31
**Source:** Senior engineering review of SPIKE-01 investigation (Runs 1-6 + Observability Phase)

---

These rules override default behavior and must be followed throughout the project. They are derived from the EAOS investigation discipline (Tasks 1-98) and the SPIKE-01 experience where 6 runs of hypothesis-driven debugging failed but 1 run of evidence-driven debugging (observability) succeeded.

---

## Rule 1 — Evidence Before Implementation

Never guess. Never assume. Never fabricate.

Every recommendation, architectural decision, optimization, protocol change, or implementation proposal must be supported by measurable engineering evidence.

If sufficient evidence does not exist:
- State that clearly.
- Explain exactly what evidence is missing.
- Design an experiment to obtain that evidence.
- Do not continue implementation until the evidence exists.

---

## Rule 2 — Always Back Every Recommendation with Working Code

Every engineering recommendation must include production-quality sample code.

The sample code must:
- compile successfully
- match the current project stack
- be executable inside the current development environment
- follow project coding standards
- demonstrate exactly how the recommendation is implemented

Do not provide pseudo-code unless specifically requested.

If code cannot be executed in the current environment, explain why.

---

## Rule 3 — Deep Technical Research Before Advising

Before making recommendations:
- research the problem thoroughly
- compare multiple engineering approaches
- identify industry best practices
- compare trade-offs
- identify known production implementations
- explain why the chosen approach is preferred

Do not stop at the first reasonable answer.

The objective is engineering accuracy, not response speed.

---

## Rule 4 — Show Engineering Proof

Every recommendation must include proof.

Proof may include:
- executable code
- successful compilation
- successful test execution
- benchmark results
- instrumentation output
- log evidence
- protocol traces
- database verification
- reproduced bug
- successful fix verification

If no proof exists, explicitly state:

> This recommendation has not yet been proven.

---

## Rule 5 — Verify Every Code Sample

Never assume sample code works.

Before presenting code:
- verify imports
- verify APIs
- verify syntax
- verify compatibility with project dependencies
- verify framework version compatibility
- verify package compatibility

If compatibility cannot be verified, clearly state the limitation.

---

## Rule 6 — No Placeholder Engineering

Avoid placeholders. Avoid TODO implementations. Avoid fake implementations. Avoid mocked success.

If something cannot be implemented yet, explain why and what is required.

---

## Rule 7 — Observability Before More Hypotheses

When multiple implementation attempts fail:

Do not continue creating new hypotheses. Instead:
- improve observability
- increase instrumentation
- collect more evidence
- identify the exact failure location
- then propose the next hypothesis

Never iterate blindly.

---

## Rule 8 — Single Variable Engineering

Every experiment must change exactly one variable.

Everything else must remain identical.

The report must clearly state:
- what changed
- why it changed
- what remained unchanged
- expected outcome
- measured outcome

---

## Rule 9 — Engineering Traceability

Every engineering decision must be traceable.

For every recommendation include:
- objective
- hypothesis
- implementation
- verification
- measured evidence
- conclusion
- recommendation

No undocumented engineering decisions.

---

## Rule 10 — Production-Grade Standards

All generated code should be suitable for production unless explicitly instructed otherwise.

Use:
- proper error handling
- structured logging
- resource cleanup
- type safety
- validation
- dependency injection where appropriate
- unit tests where appropriate
- integration tests where appropriate

Avoid demonstration-quality code.

---

## Rule 11 — Respect Project Architecture

Never introduce code that violates:
- approved ADRs
- approved TRBs
- Phase scope
- Engineering policies
- AI policies
- Architecture boundaries

If a request conflicts with governance:
- stop
- explain the conflict
- request authorization

Do not silently violate project governance.

---

## Rule 12 — Continuous Verification

Implementation is not complete until it has been verified.

Verification includes:
- compilation
- linting
- testing
- execution
- benchmark (where applicable)
- acceptance criteria
- regression check

Do not report success until verification passes.

---

## Rule 13 — Explain Why, Not Only What

Every recommendation should include:
- why this approach is correct
- why alternatives were rejected
- expected benefits
- risks
- trade-offs
- impact on the current architecture

Engineering decisions should be justified, not merely presented.

---

## Rule 14 — Preserve Engineering Discipline

Never optimize prematurely. Never redesign without evidence. Never expand scope unnecessarily.

Prefer the smallest change that can prove or disprove the hypothesis.

Follow:

> Observe → Measure → Prove → Implement → Verify → Conclude.

---

## Rule 15 — Repository Safety

No significant engineering work may remain only in the local environment.

For every completed engineering milestone:
- commit
- push to the remote repository
- verify the remote contains the expected artifacts

This prevents loss from environment resets.

---

## Rule 16 — State Confidence Explicitly

Every recommendation must end with a confidence assessment.

Use only:
- Proven
- High Confidence
- Moderate Confidence
- Low Confidence
- Unverified

The confidence level must match the available engineering evidence.

Never overstate certainty.

---

## Rule 17 — Cite the Basis for Every Recommendation

For each recommendation, clearly identify whether it is based on:
- Project evidence (tests, logs, benchmarks, experiments)
- Official documentation
- Established industry practice
- Source code inspection
- Academic research
- Engineering inference (clearly labeled as inference)

Do not present inference as proven fact.

---

## Rule 18 — Evidence Escalation Protocol (Critical)

When the same defect persists after **three** controlled, single-variable experiments:

1. Stop proposing additional fixes.
2. Freeze the implementation.
3. Enter an **Observability Phase** by increasing instrumentation and traceability rather than changing behavior.
4. Produce a defect localization report identifying the exact stage where the failure occurs.
5. Only after the failure has been localized with evidence may a new implementation hypothesis be proposed.

This rule prevents endless cycles of speculative fixes and keeps development aligned with evidence-based engineering practices.

---

## Provenance

These rules were derived from:
- EAOS Investigation (Tasks 1-98): evidence-over-assumption discipline, hypothesis register, investigation protocol
- SPIKE-01 Runs 1-6: 6 runs of hypothesis-driven debugging failed to identify root cause
- SPIKE-01 Observability Phase: 1 run of evidence-driven debugging (lifecycle tracing) found the exact failure point in minutes
- The root cause was a data model mismatch (flat vs nested record structure), not a protocol/transport/state machine issue — confirming that observability must precede hypotheses

**The single most important lesson:** When debugging fails repeatedly, stop guessing and start tracing. Evidence-driven debugging (observability) outperforms hypothesis-driven debugging (guessing) by orders of magnitude.
