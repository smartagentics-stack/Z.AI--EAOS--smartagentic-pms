# Rule 18 — Independent Audit Before Phase Transition

**Status:** BINDING — supplements Engineering Verification & Evidence Policy (doc 20)
**Created:** 2026-08-02
**Source:** Senior engineering review of SPIKE-01 verification audit

---

## Rule

No project may advance from one major phase or spike to the next based solely on the development AI's completion report.

Before authorizing the next phase, an independent engineering audit must verify:

1. **Git history** matches the reported work
2. **Source code** exists and matches the claimed implementation
3. **Tests** reproduce the claimed results
4. **Benchmarks** are reproducible
5. **CI** passes independently
6. **Performance metrics** are derived from raw artifacts
7. Any **discrepancies** are resolved before approval

Only after this audit may a spike be marked ADOPT and the next spike begin.

## Implementation

The audit follows the 12-part Engineering Verification Audit format:
1. Git evidence
2. File evidence
3. Spike evidence
4. Test evidence (raw execution)
5. Fitness test evidence (raw execution)
6. CI evidence
7. Source code review (complete files)
8. Endurance evidence (raw JSON)
9. Reproduction commands
10. Falsification conditions
11. Remaining risks
12. Final declaration (VERIFIED / PARTIALLY VERIFIED / NOT VERIFIED)

## Provenance

This rule was added after the SPIKE-01 verification audit revealed:
- TypeScript errors that the AI's self-report missed
- A temporary file accidentally committed
- CI never triggered
- The AI declared "ADOPT" before independent verification was complete

The audit process caught these issues. Without it, they would have been missed.
