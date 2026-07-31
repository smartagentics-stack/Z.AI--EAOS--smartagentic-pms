# SmartAgentics Engineering Governance Manual

**Version:** 0.1 (DRAFT — pending TRB approval)
**Status:** PROTOTYPE — must pass its own Engineering Review Gate before becoming authoritative
**Created:** 2026-07-14
**Directive:** TRB-001

---

## 0. Purpose and Self-Retirement Criteria

### Purpose

This manual is the constitution of the SmartAgentics AI PMS project. No subsystem enters implementation without passing through the Engineering Review Gate defined herein.

### Self-Retirement Criteria (when is this manual "done"?)

This manual is PROTOTYPE until the following conditions are met:

1. **First feature passes the gate:** At least one Phase 1 feature has passed through the full Engineering Review Gate (Section 4) and either shipped or been rejected based on evidence.
2. **First ADR approved:** At least one Architecture Decision Record has been produced, reviewed, and approved.
3. **First evidence-based rejection:** At least one proposed feature has been rejected based on the Evidence Register or Customer Validation Program (proving the gate works, not just exists).
4. **TRB review:** This manual has been reviewed by the Technical Review Board and either approved or revised.

**Until these conditions are met, this manual is a draft. No other deliverables are blocked by it — but no implementation may proceed either.**

---

## 1. Engineering Principles

These principles are derived directly from the EAOS investigation (Tasks 1-98) and are non-negotiable.

### 1.1 Evidence Over Assumption

Never promote a hypothesis, feature, or architecture because it "looks plausible." Promotion requires predefined acceptance criteria, satisfied by reproducible evidence.

**EAOS precedent:** H-002 (HTTP/2 stream exhaustion) was plausible but REJECTED when stream_gap stayed at 1 across 663 workflows. The "90-minute cliff" was a client-side timeout bug (H-006), not server degradation.

### 1.2 Validate Measurement Before Diagnosing Problems

Never diagnose infrastructure failure before validating the measurement system. If metrics show a problem, first verify the metrics are correct.

**EAOS precedent:** 40+ tasks investigated "server-side availability degradation" that was actually a 10s client timeout vs 12s workflow execution. The measurement system (endurance runner) was the problem, not the system under test.

### 1.3 Separate Observation from Inference

Observations are facts. Inferences are interpretations. Never state an inference as if it were an observation.

**EAOS precedent:** "retries open new h2 streams" was stated as fact but was inferred, not observed. The stream gap never grew, disproving the inference.

### 1.4 One Variable at a Time

Controlled experiments change exactly one variable. Combined changes cannot distinguish which variable caused the outcome.

**EAOS precedent:** TEST 1 initially combined stream limit increase + room recycling. Reviewer correctly flagged this as unable to distinguish which fix mattered. Tests were separated.

### 1.5 Phase Discipline

No skipping horizons. No labeling Vision features as Production-ready. No implementation before scope freeze.

### 1.6 Build vs Buy Default

Never build infrastructure that already exists unless there is measurable business value in building it. The default is to integrate, not invent.

---

## 2. Architecture Maturity Model

Every subsystem, feature, and capability is classified at exactly one level. No capability may be labeled at a higher level than its evidence supports.

| Level | Meaning | Criteria |
|-------|---------|----------|
| **VISION** | Idea exists, no evidence | No customer validation, no technical validation |
| **RESEARCH** | Technical exploration underway | Investigating feasibility, no commitment to build |
| **PROTOTYPE** | Working demo, not production | Proves concept, not hardened, no SLA |
| **VALIDATED** | Evidence supports building | Customer validation + technical validation complete |
| **PHASE 1** | Scheduled for Phase 1 MVP | Passed Engineering Review Gate, scope frozen |
| **PHASE 2** | Scheduled for Phase 2 | Passed gate, deferred from Phase 1 |
| **PRODUCTION** | Deployed to production | Passed Release Review Gate, monitored |
| **OPTIMIZED** | Production + tuned | Performance validated, cost optimized |

**Rule:** A capability may only be discussed at its current level or one level above (as a target). Discussing a VISION feature as if it were PRODUCTION is forbidden.

---

## 3. Documentation Artifacts

### 3.1 Architecture Decision Records (ADR)

Every significant decision gets an ADR. Format:

```
ADR-###
Title: [decision title]
Date: YYYY-MM-DD
Status: PROPOSED | ACCEPTED | SUPERSEDED | DEPRECATED
Context: [why this decision is needed]
Decision: [what was decided]
Consequences: [what this means]
Alternatives: [what was considered and rejected]
Evidence: [what evidence supports this]
Traceability: [links to requirements, tests, risks]
```

### 3.2 Request for Comments (RFC)

For proposals not yet ready for ADR. Format:

```
RFC-###
Title: [proposal title]
Author: [name]
Date: YYYY-MM-DD
Status: DRAFT | DISCUSSION | ACCEPTED | REJECTED
Problem: [what problem does this solve]
Proposal: [what is proposed]
Alternatives: [what else was considered]
Open Questions: [what needs to be resolved]
```

### 3.3 Hypothesis Register

For technical hypotheses (derived from EAOS). Format:

```
H-###
Hypothesis: [statement]
Status: ACTIVE | SUPPORTED | REJECTED | SUPERSEDED
Confidence: Low | Medium | High | Very High
Acceptance Criteria: [what evidence supports it]
Rejection Criteria: [what evidence rejects it]
Predictions: [testable predictions]
```

### 3.4 Evidence Register

For product/customer evidence. Format:

```
EV-###
Feature: [what feature this evidence relates to]
Evidence Type: Customer Interview | Market Research | Technical Test | Benchmark
Source: [who/what provided the evidence]
Date: YYYY-MM-DD
Finding: [what was found]
Confidence: Low | Medium | High
Phase Implication: [which phase this affects]
```

### 3.5 Risk Register

For tracked risks. Format:

```
RR-###
Risk: [description]
Probability: Low | Medium | High
Impact: Low | Medium | Critical
Status: OPEN | MITIGATED | RESOLVED
Mitigation: [what is being done]
Owner: [who is responsible]
```

### 3.6 Experiment Register

For controlled experiments. Format:

```
EXP-###
Question: [what is being tested]
Variable Changed: [the single variable]
Expected Outcome: [prediction, written BEFORE experiment]
Success Threshold: [what constitutes pass]
Failure Threshold: [what constitutes fail]
Status: PLANNED | COMPLETED | BLOCKED | ABORTED | INVALIDATED
Result: [actual outcome]
Verdict: [which hypothesis is affected]
```

### 3.7 Technical Debt Register

For deferred work. Format:

```
TD-###
Debt: [description]
Location: [where in codebase]
Reason: [why it was deferred]
Impact: [what it affects]
Priority: Low | Medium | High
Resolution Plan: [when/how it will be addressed]
```

---

## 4. Engineering Review Gate

**No subsystem enters implementation without passing this gate.** This is the core of the manual.

### 4.1 Gate Checklist

For every proposed subsystem or feature, the following must be answered:

| # | Question | Required Output |
|---|----------|----------------|
| 1 | What is the business problem? | Problem statement with customer evidence |
| 2 | What are the measurable acceptance criteria? | Success metrics with thresholds |
| 3 | What is the maturity level? | VISION / RESEARCH / PROTOTYPE / VALIDATED / PHASE 1 / etc. |
| 4 | Build vs Buy analysis? | Completed Build vs Buy Matrix entry with justification |
| 5 | What are the risks? | Risk Register entries (technical, operational, financial, security) |
| 6 | What is the implementation complexity? | Complexity estimate, dependencies, maintenance cost |
| 7 | What testing/evaluation is required? | Test plan, benchmarks, evaluation criteria |
| 8 | If AI is involved, what are the AI evaluation criteria? | Hallucination rate, accuracy, latency, cost thresholds |
| 9 | What are the offline/DR/scalability implications? | Offline behavior, DR plan, scaling characteristics |
| 10 | Has an ADR been produced? | ADR with traceability links |
| 11 | Is there customer evidence? | Evidence Register entry (if none, feature remains VISION) |

### 4.2 Gate Outcomes

- **APPROVED:** All questions answered, evidence sufficient, feature proceeds to implementation
- **DEFERRED:** Insufficient evidence or capacity; feature moves to later phase
- **REJECTED:** Evidence contradicts the feature, or it fails Build vs Buy analysis
- **BLOCKED:** External dependency missing (e.g., waiting for customer validation)

**A feature that is "plausible" but lacks evidence is DEFERRED, not APPROVED.**

---

## 5. Review Processes

### 5.1 Build Review Gate (before implementation starts)

Review the Engineering Review Gate output for a feature. If APPROVED, implementation may begin.

### 5.2 Release Review Gate (before production deployment)

Review implementation against acceptance criteria. If metrics are met, feature may deploy. If metrics are not met, feature returns to development.

### 5.3 Production Readiness Review (before customer-facing launch)

Review production deployment for: monitoring, alerting, runbooks, DR plan, cost ceilings, compliance. If any are missing, launch is blocked.

---

## 6. Engineering Knowledge Graph (Traceability)

Every artifact links to related artifacts. This creates full traceability from idea to implementation.

```
Requirement (from customer evidence)
    │
    ├── Evidence Register entry (EV-###)
    ├── ADR (ADR-###)
    ├── RFC (RFC-###)
    ├── Design document
    ├── Source code (linked by module)
    ├── Tests (linked by test suite)
    ├── Benchmarks (linked by benchmark suite)
    ├── Risks (RR-###)
    ├── Hypotheses (H-###)
    ├── Experiments (EXP-###)
    ├── Documentation
    └── Release Notes
```

**Implementation:** This is initially a set of cross-referenced markdown documents. If the project grows, migrate to a structured knowledge graph tool. **Do not build a custom knowledge graph tool — that is not Phase 1 scope.**

---

## 7. Sequencing (addresses TRB-001 Gap 3)

The TRB-001 directive lists 15 deliverables. They must be sequenced, not attempted simultaneously. **Customer validation comes before scope freeze.**

### Week 1-2: Foundation + Customer Validation (parallel)
- Deliverable 1: This Governance Manual (DRAFT)
- Deliverable 11: Customer Validation Program (START — interview 5+ potential customers)

### Week 3: Product Definition (informed by customer validation)
- Deliverable 2: Product Definition Document
- Deliverable 5: Evidence Register (populated from customer validation)
- Deliverable 6: Success Metrics (informed by customer needs)

### Week 4: Scope Freeze
- Deliverable 3: Phase 1 Scope (frozen, informed by PDD and evidence)
- Deliverable 4: Build vs Buy Matrix (for Phase 1 components only)

### Week 5+: Engineering Depth
- Deliverable 7: AI Evaluation Framework (before any AI implementation)
- Deliverable 8: AI Economics Framework (before any AI deployment)
- Deliverable 9: Architecture Maturity Model (apply to all 18 chapters)
- Deliverable 10: ADRs (produce as decisions are made)

### Deferred (post-Phase 1)
- Deliverable 13: AI Kernel Specification (RESEARCH level, not Phase 1)
- Deliverable 14: AgentOS Specification (RESEARCH level, not Phase 1)
- Deliverable 15: Enterprise Reference Architecture classification (do for Phase 1 chapters only)

---

## 8. Capacity Reality Check (addresses TRB-001 Gap 1)

### 8.1 Honest Assessment

The TRB-001 directive's 15 deliverables require approximately 3 months for a team of 3-5 engineers. If the team is smaller, the scope must be smaller.

### 8.2 Phase 1 Capacity Assumption

This manual assumes:
- 1 Principal Engineer (architecture, governance, review)
- 2-3 Senior Engineers (implementation)
- 1 Product Manager (customer validation, PDD)
- 3-6 months timeline
- ₦3.5M (~$2,300 USD) Phase 1 budget

**If this capacity is not available, Phase 1 scope must be reduced accordingly.** The Governance Manual does not assume infinite capacity.

### 8.3 What This Manual Does NOT Do

- Does not design AI engines (that's research, not governance)
- Does not implement features (that's Phase 1, after gate approval)
- Does not freeze architecture (that's premature; see Section 0)
- Does not build custom tooling when existing tools suffice (Build vs Buy)

---

## 9. Relationship to EAOS Investigation

This manual is the product-level application of the engineering discipline demonstrated in the EAOS investigation (Tasks 1-98).

| EAOS Lesson | Governance Manual Application |
|-------------|-------------------------------|
| Evidence over assumption | Section 1.1, Engineering Review Gate |
| Validate measurement first | Section 1.2, Success Metrics must be validated |
| Separate observation from inference | Section 1.3, Evidence Register |
| One variable at a time | Section 1.4, Experiment Register |
| Phase discipline | Section 1.5, Architecture Maturity Model |
| Build vs Buy | Section 1.6, Build vs Buy Matrix |
| Hypothesis testing | Section 3.3, Hypothesis Register |
| Investigation protocol | Section 4, Engineering Review Gate |
| Root cause reports | Section 3.1, ADRs |

**The EAOS investigation's greatest lesson was that 40 tasks of investigation found the problem was a client-side timeout, not server infrastructure. This manual ensures the same discipline is applied to product decisions — verify the customer need before freezing the architecture.**

---

## 10. Approval

This manual is DRAFT until approved by the Technical Review Board.

**Approval conditions:**
1. TRB reviews this manual
2. At least one feature passes through the Engineering Review Gate
3. At least one feature is rejected based on evidence (proving the gate works)
4. Manual is marked ACCEPTED

**Until approved, this manual governs provisionally. No implementation may proceed, but governance work may continue.**
