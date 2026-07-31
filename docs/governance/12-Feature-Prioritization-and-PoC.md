# SmartAgentics Feature Prioritization & PoC Framework

**Version:** 1.0
**Status:** BINDING for Phase 1 feature selection
**Owner:** Executive Office (with Product, Architecture, Engineering offices)
**Created:** 2026-07-14
**Directive:** TRB-003, Instructions 3, 4, 5

---

## Part 1: Requirements Engineering Chain (Instruction 3)

Every feature follows this chain. No feature skips.

```
Customer Statement (from interview — verbatim quote)
        ↓
Business Need (what problem are we solving)
        ↓
Business Requirement (what the business must do)
        ↓
System Requirement (what the system must do)
        ↓
Functional Requirement (specific behavior)
        ↓
Acceptance Criteria (measurable threshold)
        ↓
Test Cases (how we verify)
        ↓
Implementation (code module)
        ↓
Verification (test results)
```

**Rule:** A feature cannot enter implementation until it has passed through this chain and been entered in the RTM (Requirements Traceability Matrix, document 05).

### Example: Offline Check-in

```
Customer Statement: "When internet goes down, we can't check in guests and they wait at reception." (INT-003)

Business Need: Hotels must be able to check in guests without internet dependency.

Business Requirement: The PMS must operate core functions without internet connectivity.

System Requirement: The PMS must perform check-in, reservation, and billing operations using only local data.

Functional Requirement: The check-in workflow must complete using local database, queue sync operations for when connectivity returns, and resolve conflicts without data loss.

Acceptance Criteria: Check-in completes in <5 seconds with no internet connection (M-002). Zero duplicate transactions after sync (M-007).

Test Cases: TC-001 (offline check-in), TC-002 (sync after reconnection), TC-003 (conflict resolution)

Implementation: pms/checkin module, sync/queue module

Verification: Test results pass acceptance criteria thresholds.

RTM Entry: REQ-001
```

---

## Part 2: Feature Prioritization Scoring (Instruction 4)

### Scoring Criteria

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Customer demand | 30% | How many customers requested this? (from interviews) |
| Revenue impact | 20% | Does this directly drive revenue or reduce cost? |
| Development effort | 15% | How much engineering time? (lower effort = higher score) |
| Operational risk reduction | 15% | Does this reduce errors, data loss, or operational risk? |
| Competitive differentiation | 10% | Does this differentiate us from competitors? |
| AI value | 10% | Does this leverage AI meaningfully? |

### Scoring Scale (1-5 per criterion)

| Score | Meaning |
|-------|---------|
| 5 | Exceptional — strongly meets criterion |
| 4 | Strong — clearly meets criterion |
| 3 | Moderate — partially meets criterion |
| 2 | Weak — marginally meets criterion |
| 1 | Minimal — barely meets criterion |

### Calculation

```
Weighted Score = (Customer demand × 0.30)
               + (Revenue impact × 0.20)
               + (Development effort × 0.15)  [inverted: 5=easy, 1=hard]
               + (Operational risk reduction × 0.15)
               + (Competitive differentiation × 0.10)
               + (AI value × 0.10)

Range: 1.0 to 5.0
```

### Decision Rules

| Weighted Score | Decision |
|---------------|----------|
| ≥ 4.0 | **Phase 1** — include in MVP |
| 3.0 – 3.9 | **Phase 2** — defer unless capacity allows |
| 2.0 – 2.9 | **Later** — reconsider after Phase 1 validation |
| < 2.0 | **Reject** — do not build |

### Phase 1 Feature Scoring Template

| Feature | Customer Demand (30%) | Revenue Impact (20%) | Dev Effort (15%) | Risk Reduction (15%) | Differentiation (10%) | AI Value (10%) | Weighted Score | Decision |
|---------|----------------------|---------------------|------------------|---------------------|----------------------|----------------|----------------|----------|
| [feature] | [1-5] | [1-5] | [1-5] | [1-5] | [1-5] | [1-5] | [calc] | [Phase 1/2/Later/Reject] |

**This table is populated after Customer Discovery and Competitive Intelligence are complete.** Do not score features without evidence.

---

## Part 3: Technical Proofs of Concept (Instruction 5)

### PoC List (highest-risk technical assumptions first)

| PoC # | Name | Risk Addressed | Acceptance Criteria | Status |
|-------|------|----------------|---------------------|--------|
| PoC-01 | Offline LAN Synchronization | Two front desks edit same reservation; sync must resolve without data loss | 0 duplicate transactions across 2 clients over 1h of concurrent operation | PLANNED |
| PoC-02 | Local-first Database Conflict Resolution | SQLite on two clients; conflict resolution rules for PMS domain | Defined conflict resolution for: room assignment, reservation, billing. All conflicts resolve automatically or flag for human review. | PLANNED |
| PoC-03 | AI Assistant with Intermittent Internet | AI works when internet available, degrades gracefully when not | AI assistant responds <3s when online; when offline, returns "AI unavailable, here are PMS functions you can use" within 1s | PLANNED |
| PoC-04 | Backup and Restore Workflow | Data can be backed up and restored reliably | Backup <30s (M-008), restore <60s (M-008), 100% data integrity after restore | PLANNED |
| PoC-05 | Windows Installer and Update | Non-technical hotel staff can install and update | Fresh install completes <15 min (M-013), update preserves data, no manual intervention | PLANNED |
| PoC-06 | Android Companion Connectivity | Android phone can connect to PMS for basic operations | Phone connects to desktop PMS over LAN; can view reservations, check room status | PLANNED |
| PoC-07 | AI Evaluation Pipeline | AI responses can be evaluated for quality | Golden test suite with 50+ PMS questions; hallucination rate <5% (M-009); automated regression on prompt changes | PLANNED |
| PoC-08 | AI Cost Monitoring | AI costs are tracked and budget-limited | Per-request cost tracked; budget alerts at 80%/100%; average <₦50/workflow (M-011) | PLANNED |

### PoC Rules

1. **Each PoC has clear acceptance criteria** — no vague "see if it works"
2. **Each PoC is time-boxed** — maximum 3-5 days per PoC
3. **PoC failure does not kill the project** — it reveals risk that must be mitigated
4. **PoC success does not guarantee production** — it proves feasibility, not quality
5. **PoCs are logged in the Experiment Register** (EXP-###)

### PoC Priority Order

Execute in this order (highest risk first):
1. PoC-01 (Offline LAN Sync) — core differentiator, highest technical risk
2. PoC-02 (Conflict Resolution) — depends on PoC-01
3. PoC-07 (AI Evaluation) — required before any AI feature ships
4. PoC-08 (AI Cost Monitoring) — required before AI deployment
5. PoC-04 (Backup/Restore) — data safety
6. PoC-05 (Installer) — deployability
7. PoC-03 (AI Intermittent) — AI resilience
8. PoC-06 (Android Companion) — can defer if capacity-limited

---

## Relationship to Other Artifacts

- **RTM (05):** PoC results feed back into requirements (may add/modify/delete)
- **Build vs Buy Matrix (04):** PoC may prove a BUY decision is better than BUILD
- **Success Metrics (06):** PoC acceptance criteria reference metrics (M-###)
- **Economics Framework (09):** PoC results inform cost estimates
- **Engineering Review Gate:** PoCs must pass through gate before becoming production features

---

## What This Document Does NOT Do

- Does not score features (requires customer evidence first)
- Does not implement PoCs (that's engineering work)
- Does not replace the Engineering Review Gate (PoC success is one input)

**This document is the framework. Execution requires customer evidence and engineering effort.**
