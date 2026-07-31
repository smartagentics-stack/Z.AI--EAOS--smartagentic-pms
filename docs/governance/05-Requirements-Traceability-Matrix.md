# SmartAgentics Requirements Traceability Matrix (RTM)

**Version:** 0.1 (DRAFT — populated as requirements are gathered)
**Status:** PROTOTYPE — empty until Customer Validation (Phase A) produces requirements
**Owner:** Product Office
**Created:** 2026-07-14
**Directive:** TRB-002 (Requirements Engineering)

---

## Purpose

Every requirement traces from customer need through implementation to verification. Nothing exists without traceability. This prevents scope drift.

**This is the one component that was genuinely missing from the governance framework.** Evidence Register tracks what customers said; RTM tracks what we're building in response.

---

## Traceability Chain

```
Customer Need (from interview)
    ↓
Business Requirement (why we're building it)
    ↓
System Requirement (what the system must do)
    ↓
Functional Requirement (specific behavior)
    ↓
Non-Functional Requirement (constraints: performance, security, etc.)
    ↓
Acceptance Criteria (measurable threshold)
    ↓
Test Cases (how we verify)
    ↓
Implementation (code module)
    ↓
Verification (test results)
    ↓
Deployment (release)
```

Every requirement must have all links. If a link is missing, the requirement is not ready for implementation.

---

## RTM Template

| Req ID | Customer Need | Business Req | System Req | Functional Req | Non-Functional Req | Acceptance Criteria | Test Cases | Implementation | Status | Owner |
|--------|--------------|-------------|-----------|----------------|-------------------|-------------------|-----------|----------------|--------|-------|
| REQ-001 | [interview ref] | [why] | [what] | [behavior] | [constraints] | [metric] | [test IDs] | [module] | [state] | [office] |

---

## Status Values

- **IDENTIFIED:** Customer need captured, not yet analyzed
- **ANALYZED:** Business/system requirements written
- **SPECIFIED:** Functional/non-functional requirements written
- **GATED:** Passed Engineering Review Gate
- **IMPLEMENTED:** Code written
- **TESTED:** Test cases pass
- **VERIFIED:** Acceptance criteria met
- **DEPLOYED:** In production
- **RETIRED:** No longer needed

---

## Initial Requirements (to be populated in Phase A)

**The RTM is empty until Customer Validation (Phase A) produces requirements.** Do not invent requirements without customer evidence.

### Example entry (template only — not a real requirement):

| Req ID | Customer Need | Business Req | System Req | Functional Req | Non-Functional Req | Acceptance Criteria | Test Cases | Implementation | Status | Owner |
|--------|--------------|-------------|-----------|----------------|-------------------|-------------------|-----------|----------------|--------|-------|
| REQ-001 | EV-001: "Internet goes down, we can't check in guests" | Hotel must operate without internet | PMS functions offline | Check-in, reservations, billing work without network | Offline operation ≥8h (M-006) | Check-in completes <5s offline | TC-001: offline check-in test | pms/checkin module | IDENTIFIED | Engineering |

---

## Rules

1. **No requirement without a customer need.** Every REQ-### traces to an EV-### (Evidence Register entry).
2. **No implementation without a gated requirement.** Code cannot start until status = GATED.
3. **No deployment without verification.** Status cannot become DEPLOYED until VERIFIED.
4. **Every link is a real document/test/module.** "TBD" is acceptable temporarily; blank is not.
5. **Changes require ADR.** If a requirement changes after GATED, an ADR must document why.

---

## Relationship to Other Artifacts

- **Evidence Register (EV-###):** Source of customer needs
- **Success Metrics (M-###):** Source of acceptance criteria
- **ADRs (ADR-###):** Document requirement changes
- **Risk Register (RR-###):** Risks associated with requirements
- **Test Cases (TC-###):** Verify acceptance criteria

---

## Phase A Population Plan

When Customer Validation Program (Deliverable 11) runs:
1. Each customer interview produces Evidence Register entries (EV-###)
2. Each EV-### that represents a real need becomes a Customer Need in RTM
3. Product Office analyzes needs → Business Requirements
4. Architecture Office analyzes → System Requirements
5. Engineering Office analyzes → Functional/Non-Functional Requirements
6. Quality Office defines → Acceptance Criteria + Test Cases
7. RTM is reviewed at Engineering Review Gate before implementation

**The RTM is the bridge between customer evidence and implementation. Without it, we have evidence but no traceable path to code.**
