# SmartAgentics AI PMS — Engineering Verification & Evidence Policy

**Version:** 1.0
**Status:** BINDING — applies to every engineering task, every prompt, and every response
**Created:** 2026-07-31
**Source:** Senior engineering review of SPIKE-01 investigation

---

## Rule 1 — No Unsupported Claims

The AI must never state "Fixed", "Completed", "Passed", "Verified", or "Working" unless it produces evidence that can be independently verified. Every conclusion must reference the evidence that supports it.

## Rule 2 — Every Engineering Claim Must Produce Proof

### A. Git Evidence
Provide: commit hash, branch, `git status`, `git diff`, `git show <commit>`, files changed.

### B. Source Code Evidence
Provide: file, function, line numbers, reason for change. Do not merely say "Implemented."

### C. Complete Code
Whenever code changes are made, provide the complete updated function (or class/module if the change spans it), not only a diff or summary. If the change affects multiple files, identify each affected file and include the relevant updated code sections so they can be reviewed directly.

## Rule 3 — Execution Evidence

Every execution must include: exact command, stdout, stderr, exit code, execution time. Not "Tests passed." Instead: complete raw output.

## Rule 4 — Reproduction Evidence

Every engineering task must include how another engineer can reproduce it, with exact commands and expected output.

## Rule 5 — Falsification Test

Every engineering claim must explain what result would prove this claim is false.

## Rule 6 — CI Evidence

Every significant engineering task must include: GitHub Actions run, workflow ID, status, logs, artifacts.

## Rule 7 — Test Coverage Evidence

Provide: new tests added, regression tests, files, coverage, assertions.

## Rule 8 — Architecture Evidence

Every architectural change must include: ADR updated, reason, alternatives rejected, trade-offs, risk assessment.

## Rule 9 — Observability Evidence

Whenever debugging is performed, provide: trace IDs, logs, lifecycle events, metrics, raw JSON. Not summaries.

## Rule 10 — Performance Evidence

Any performance claim must include measured values: latency p50/p95/p99, RSS memory, CPU, disk IO, network. No estimated values.

## Rule 11 — Database Evidence

Whenever database code changes, show: schema, migration, before, after, query plan, sample rows.

## Rule 12 — API Evidence

For every API, show: request, response, headers, status, timing, errors.

## Rule 13 — Serialization Evidence

Every serialization change must include: original object, serialized, database, deserialized, equality check (`expect(deserialized).toStrictEqual(original)`).

## Rule 14 — Runtime Validation

Every boundary must have runtime validation (e.g., `SyncRecordSchema.parse(message)`). Never rely on TypeScript alone.

## Rule 15 — Independent Verification

Every important milestone must be verifiable without the AI. Possible independent validators: GitHub Actions, another developer, another AI session, clean environment, Docker container, fresh clone, automated regression tests. If none exist, the milestone is not yet verified.

## Rule 16 — Evidence Before Conclusion

The AI must never conclude that a bug is fixed, a hypothesis is proven, a spike is complete, or a feature is production-ready until the supporting evidence has been presented first. Conclusions must always follow evidence, never precede it.

---

## Mandatory Verification Report Template

Every engineering milestone must finish with the following report:

```
VERIFICATION REPORT

Task:                    [description]
Claim:                   [what is claimed]
Evidence:
  Files Changed:         [list]
  Commit Hash:           [hash]
  Commands Executed:     [list]
  stdout:                [raw output]
  stderr:                [raw output]
  Exit Code:             [code]
  Regression Tests:      [list]
  CI Run:                [URL/ID]
  Artifacts Produced:    [list]
  Reproduction Steps:    [commands]
  Expected Output:       [description]
  Failure Conditions:    [what would prove claim false]
  Known Risks:           [list]
  Confidence Level:      [Proven | High | Moderate | Low | Unverified]
```

No milestone is complete without this report.

---

## Mandatory AI Review Request

At the end of every engineering task, the AI must respond to this verification request:

```
ENGINEERING VERIFICATION REQUEST

Do not summarize your work.
For every engineering claim you made, provide verifiable evidence.

1. GIT EVIDENCE
   - Commit hash, branch, git status, git diff, git show <commit>

2. SOURCE CODE
   - Every file changed, complete updated functions/classes, exact line numbers, explanation

3. EXECUTION EVIDENCE
   - Exact commands, complete stdout, complete stderr, exit code, execution duration

4. TEST EVIDENCE
   - Every test executed, raw results, coverage, regression tests added

5. CI EVIDENCE
   - Workflow run ID, status, logs, artifacts

6. PERFORMANCE EVIDENCE
   - CPU, memory, latency, throughput, network

7. OBSERVABILITY
   - Trace logs, lifecycle logs, metrics, JSON traces

8. DATABASE EVIDENCE
   - Schema changes, sample rows, queries, migrations

9. REPRODUCTION
   - Every command required for independent reproduction from clean clone

10. FALSIFICATION
    - Exactly what result would prove the implementation is incorrect

11. LIMITATIONS
    - Explicitly state any work that could not be verified, assumptions made, evidence that cannot be produced

If any requested evidence cannot be produced, explicitly state:
"I cannot provide evidence for this claim."

Do not replace missing evidence with summaries or assumptions.
```

---

## Provenance

Derived from the SPIKE-01 investigation where:
- 6 runs of hypothesis-driven debugging produced claims without sufficient evidence
- 1 run of evidence-driven debugging (observability) found the root cause
- The root cause was a data model mismatch, not a transport issue — invisible without lifecycle tracing

This policy ensures that evidence always precedes conclusions, preventing the "plausible = confirmed" error that plagued early investigation runs.

Complements: Senior Engineering Operating Rules (doc 18), Evidence-First Debugging Methodology (doc 19).
