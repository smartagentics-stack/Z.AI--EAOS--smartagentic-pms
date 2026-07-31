# SmartAgentics AI Development Policy

**Version:** 1.0
**Status:** BINDING — applies to all AI-generated proposals
**Owner:** AI Office
**Created:** 2026-07-14
**Directive:** TRB-002 (AI Development Policy)

---

## Purpose

Every AI-generated proposal must include a confidence assessment. This prevents speculative ideas from being treated as engineering facts.

**This is distinct from the Hypothesis Register.** Hypotheses are about technical mechanisms (e.g., "stream exhaustion causes the cliff"). AI Development Policy confidence is about proposals (e.g., "we should build a multi-agent orchestration layer").

---

## Confidence Levels

| Level | Meaning | Action Allowed |
|-------|---------|---------------|
| **Very Low** | Brainstorm only | Discussion, no design, no implementation |
| **Low** | Needs research | Research, prototyping allowed, no production design |
| **Medium** | Prototype recommended | Prototype build allowed, no production commitment |
| **High** | Ready for implementation planning | Engineering Review Gate, ADR, implementation planning |
| **Very High** | Backed by implementation and evidence | Production deployment allowed |

---

## Rules

1. **Every AI proposal must state its confidence level.** No exceptions. If the confidence is not stated, the proposal is invalid.

2. **Confidence must be justified.** State WHY this confidence level was chosen. "I think this is good" is not justification. "3 customers requested this in interviews (EV-004, EV-007, EV-009)" is justification.

3. **Confidence limits action.** A Medium-confidence proposal cannot skip to implementation. It must go through prototyping first.

4. **Confidence can only increase with evidence.** "I'm more sure now" is not sufficient. New evidence (customer interviews, test results, benchmarks) is required to raise confidence.

5. **Confidence can decrease.** If evidence contradicts the proposal, confidence drops. If it drops below Medium, any prototype work pauses.

---

## Confidence Assessment Template

```
Proposal: [what is being proposed]
Confidence: [Very Low | Low | Medium | High | Very High]

Justification:
- Customer evidence: [EV-### references, or "none"]
- Technical evidence: [test results, benchmarks, or "none"]
- Prototype evidence: [prototype outcomes, or "none"]
- Production evidence: [deployment results, or "none"]

What would raise confidence:
- [specific evidence needed]

What would lower confidence:
- [specific evidence that would contradict]

Allowed next action:
- [based on confidence level, per table above]
```

---

## Examples

### Example 1: Multi-agent orchestration (Phase 2+ proposal)

```
Proposal: Build a multi-agent orchestration layer for SmartAgentics
Confidence: Very Low

Justification:
- Customer evidence: none (no customer has requested multi-agent)
- Technical evidence: none (not prototyped)
- Prototype evidence: none
- Production evidence: none

What would raise confidence:
- Customer request for coordinated multi-agent behavior
- Prototype demonstrating value over single-agent

What would lower confidence:
- Customer interviews showing single-agent is sufficient

Allowed next action: Discussion only. No design, no implementation.
```

### Example 2: Offline-first PMS (Phase 1 core feature)

```
Proposal: Build offline-first PMS that works without internet
Confidence: High

Justification:
- Customer evidence: EV-001, EV-003, EV-005 (3 customers cited internet reliability as #1 problem)
- Technical evidence: EAOS investigation proved offline SQLite + sync works (663 workflows, 0 failures)
- Prototype evidence: EAOS endurance tests
- Production evidence: none yet (Phase 1 not deployed)

What would raise confidence:
- Successful pilot deployment

What would lower confidence:
- Customer interviews revealing internet is actually reliable

Allowed next action: Implementation planning. Pass through Engineering Review Gate.
```

---

## Relationship to Other Artifacts

- **Hypothesis Register:** Technical hypotheses about how systems work
- **Evidence Register:** Customer/market evidence
- **Engineering Review Gate:** Gate that proposals pass through (requires High confidence)
- **Architecture Maturity Model:** Tracks maturity of capabilities (correlates with confidence)

---

## Audit

The AI Office reviews all AI-generated proposals quarterly to verify:
1. Confidence levels are honestly assessed
2. Confidence has not been inflated without evidence
3. Low-confidence proposals have not been implemented
4. High-confidence proposals have supporting evidence

**Inflating confidence without evidence is a governance violation.** It is the AI equivalent of the EAOS "plausible = confirmed" error.
