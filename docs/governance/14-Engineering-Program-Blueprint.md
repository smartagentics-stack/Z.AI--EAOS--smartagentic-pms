# SmartAgentics Engineering Program Blueprint

**Version:** 1.0
**Status:** BINDING — single source of truth for program execution
**Owner:** Executive Office
**Created:** 2026-07-14
**Directive:** TRB-004

---

## ⚠️ This Is the Last Standalone Document

Per TRB-004: documentation freeze after this. Future outputs are customer evidence, structured backlog items, PoC results, working software, pilot deployments, and measured outcomes. New documents only when implementation feedback reveals a governance gap.

**Migration path:** This blueprint should eventually become a structured database (JSON/YAML or proper tool). For now, it is structured markdown — tables, not prose.

---

## 1. Program Phase

**Current Phase:** Discovery

| Phase | Objective | Exit Criterion | Status |
|-------|-----------|----------------|--------|
| Discovery | Validate customer problems | 15-20 interviews completed, EV-### entries created | **CURRENT** |
| Validation | Confirm product-market fit | PDD validated, Phase 1 scope frozen | Blocked by Discovery |
| Engineering | Build Phase 1 MVP | All PoCs pass, acceptance metrics met | Blocked by Validation |
| Pilot | Deploy to 2-3 hotels | 30-day pilot data collected | Blocked by Engineering |
| Production | Commercial release | Production Readiness Review passed | Blocked by Pilot |
| Scale | Multi-property, expansion | Sustainable growth validated | Blocked by Production |

---

## 2. Work Item Hierarchy

```
Strategic Goal
    ↓
Epic
    ↓
Capability
    ↓
Feature
    ↓
Story
    ↓
Task
    ↓
Acceptance Test
    ↓
Implementation
    ↓
Verification
    ↓
Deployment
```

**Rule:** No work item exists outside this hierarchy. No skipping levels.

---

## 3. Backlog Structure

### 3.1 Backlog Schema

Every work item has these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ID | string | YES | Unique identifier (EXEC-###, PROD-###, ENG-###, AI-###, QA-###, DEV-###) |
| Title | string | YES | Short description |
| Backlog | enum | YES | Executive / Product / Engineering / AI / QA / DevOps |
| Type | enum | YES | Epic / Capability / Feature / Story / Task |
| Owner | enum | YES | Office (from document 07) |
| Priority | enum | YES | P0 (critical) / P1 (high) / P2 (medium) / P3 (low) |
| Status | enum | YES | BACKLOG / IN_PROGRESS / BLOCKED / DONE / CANCELLED |
| Depends_On | list | YES | IDs this item depends on (empty if none) |
| Blocks | list | YES | IDs this item blocks (empty if none) |
| Effort | enum | YES | S (1-2d) / M (3-5d) / L (1-2w) / XL (2w+) |
| Risk | enum | YES | Low / Medium / High |
| Acceptance_Criteria | string | YES | Measurable threshold |
| Evidence | list | NO | EV-### references (required for Product backlog) |
| Phase | enum | YES | Discovery / Validation / Engineering / Pilot / Production / Scale |

### 3.2 Backlogs

#### Executive Backlog

| ID | Title | Type | Owner | Priority | Status | Depends_On | Blocks | Effort | Risk | Acceptance | Phase |
|----|-------|------|-------|----------|--------|------------|--------|--------|------|-----------|-------|
| EXEC-001 | Customer Discovery Program | Epic | Customer Validation | P0 | IN_PROGRESS | [] | [PROD-001] | L | Medium | 15-20 interviews completed | Discovery |
| EXEC-002 | Competitive Intelligence | Epic | Customer Validation | P0 | BACKLOG | [] | [PROD-002] | M | Low | 10+ PMS evaluated | Discovery |
| EXEC-003 | Phase 1 Scope Freeze | Epic | Executive | P0 | BLOCKED | [EXEC-001, EXEC-002] | [ENG-001] | S | Medium | Scope frozen, ADR produced | Validation |
| EXEC-004 | Pilot Deployment | Epic | Executive | P1 | BLOCKED | [ENG-001] | [] | L | High | 2-3 hotels, 30 days | Pilot |

#### Product Backlog

| ID | Title | Type | Owner | Priority | Status | Depends_On | Blocks | Effort | Risk | Acceptance | Evidence | Phase |
|----|-------|------|-------|----------|--------|------------|--------|--------|------|-----------|----------|-------|
| PROD-001 | Populate Evidence Register | Epic | Product | P0 | BLOCKED | [EXEC-001] | [EXEC-003] | M | Low | EV-### for each interview | [] | Discovery |
| PROD-002 | Populate RTM | Epic | Product | P0 | BLOCKED | [EXEC-001, EXEC-002] | [EXEC-003] | M | Medium | REQ-### with full traceability | [] | Discovery |
| PROD-003 | Score features | Task | Product | P0 | BLOCKED | [PROD-001] | [EXEC-003] | S | Low | All Phase 1 features scored | [] | Discovery |
| PROD-004 | Revise PDD | Task | Product | P0 | BLOCKED | [PROD-001] | [] | S | Low | PDD matches evidence | [] | Discovery |

*Feature items (PROD-010+) added after customer evidence. Do not fabricate.*

#### Engineering Backlog (Track B — parallel to customer discovery)

| ID | Title | Type | Owner | Priority | Status | Depends_On | Blocks | Effort | Risk | Acceptance | Phase |
|----|-------|------|-------|----------|--------|------------|--------|--------|------|-----------|-------|
| ENG-000 | Engineering Bootstrap | Epic | Engineering | P0 | BACKLOG | [] | [ENG-001] | L | Medium | Repo structure, CI, tests, logging all working | Discovery |
| ENG-001 | Phase 1 Implementation | Epic | Engineering | P0 | BLOCKED | [EXEC-003, ENG-000] | [EXEC-004] | XL | High | All Phase 1 features meet metrics | Engineering |
| ENG-010 | SPIKE-01: Offline LAN Sync | Task | Engineering | P0 | BACKLOG | [ENG-000] | [ENG-001] | L | High | 0 duplicate transactions, 1h concurrent, <1s sync | Validation |
| ENG-011 | SPIKE-02: Conflict Resolution | Task | Engineering | P0 | BACKLOG | [ENG-010] | [ENG-001] | M | High | All conflict types resolve correctly | Validation |
| ENG-012 | SPIKE-04: Backup/Restore | Task | Engineering | P0 | BACKLOG | [ENG-000] | [ENG-001] | S | Medium | Backup <30s, restore <60s | Validation |
| ENG-013 | SPIKE-05: Windows Installer | Task | Engineering | P0 | BACKLOG | [ENG-000] | [ENG-001] | M | Medium | Install <15min, auto-update works | Validation |

#### AI Backlog

| ID | Title | Type | Owner | Priority | Status | Depends_On | Blocks | Effort | Risk | Acceptance | Phase |
|----|-------|------|-------|----------|--------|------------|--------|--------|------|-----------|-------|
| AI-001 | AI Assistant | Epic | AI | P0 | BLOCKED | [EXEC-003] | [ENG-001] | L | High | Hallucination <5%, latency <3s | Engineering |
| AI-010 | PoC-07: AI Evaluation Pipeline | Task | AI | P0 | BACKLOG | [] | [AI-001] | M | High | Golden suite passes, <5% hallucination | Validation |
| AI-011 | PoC-08: AI Cost Monitoring | Task | AI | P0 | BACKLOG | [] | [AI-001] | S | Medium | Cost tracked, budget alerts at 80%/100% | Validation |
| AI-012 | PoC-03: AI Intermittent Internet | Task | AI | P1 | BACKLOG | [] | [AI-001] | M | Medium | Graceful degradation when offline | Validation |

#### QA Backlog

| ID | Title | Type | Owner | Priority | Status | Depends_On | Blocks | Effort | Risk | Acceptance | Phase |
|----|-------|------|-------|----------|--------|------------|--------|--------|------|-----------|-------|
| QA-001 | Test Strategy | Epic | Quality | P0 | BACKLOG | [EXEC-003] | [ENG-001] | M | Medium | Strategy documented, reviewed | Validation |
| QA-010 | Smoke test framework | Task | Quality | P0 | BACKLOG | [QA-001] | [ENG-001] | S | Low | Framework runs, validates instrumentation | Validation |
| QA-011 | Acceptance test suite | Task | Quality | P0 | BLOCKED | [ENG-001] | [] | L | Medium | All M-### metrics tested | Engineering |

#### DevOps Backlog

| ID | Title | Type | Owner | Priority | Status | Depends_On | Blocks | Effort | Risk | Acceptance | Phase |
|----|-------|------|-------|----------|--------|------------|--------|--------|------|-----------|-------|
| DEV-001 | CI/CD Pipeline | Epic | Operations | P1 | BACKLOG | [EXEC-003] | [ENG-001] | M | Medium | Automated build, test, deploy | Validation |
| DEV-002 | Monitoring Setup | Task | Operations | P1 | BACKLOG | [DEV-001] | [] | S | Low | Langfuse + system metrics | Engineering |
| DEV-003 | Update Mechanism | Task | Operations | P1 | BACKLOG | [ENG-013] | [] | M | Medium | Updates preserve data | Engineering |

---

## 4. Dependency Model

### 4.1 Two Parallel Tracks (per TRB-005)

**Track A — Customer Validation (human, sequential):**
```
EXEC-001 (Customer Discovery)
    ↓
PROD-001 (Evidence Register) + PROD-002 (RTM)
    ↓
PROD-003 (Score features) + PROD-004 (Revise PDD)
    ↓
EXEC-003 (Phase 1 Scope Freeze)
```

**Track B — Engineering Foundation (can start NOW, no customer dependency):**
```
ENG-000 (Engineering Bootstrap)
    ↓
ENG-010, ENG-011, ENG-012, ENG-013, AI-010, AI-011 (Architecture Spikes)
```

**Convergence (both tracks meet):**
```
Track A (Scope Freeze) + Track B (Spikes pass)
    ↓
ENG-001 (Phase 1 Implementation)
    ↓
EXEC-004 (Pilot Deployment)
```

**Critical insight:** Track B does NOT wait for Track A. Engineering backbone + architecture spikes can proceed in parallel with customer discovery. This eliminates idle time.

### 4.2 Critical Path (revised)

The critical path is now the LONGER of:
- Track A: Customer Discovery → Scope Freeze (human-dependent, ~4-6 weeks)
- Track B: Bootstrap → Spikes (engineering-dependent, ~3-4 weeks)

If Track A takes longer (likely), Track B results wait for scope freeze. If Track B takes longer, scope freeze waits for spike validation.

**Bottleneck removed:** Engineering team is no longer idle waiting for customer interviews.

### 4.3 Parallel Work (Track B — can proceed without customer evidence)

| ID | Title | Why it can proceed |
|----|-------|-------------------|
| ENG-010 | PoC-01: Offline LAN Sync | Technical proof, no customer dependency |
| ENG-012 | PoC-04: Backup/Restore | Technical proof, no customer dependency |
| AI-010 | PoC-07: AI Evaluation Pipeline | Technical proof, no customer dependency |
| AI-011 | PoC-08: AI Cost Monitoring | Technical proof, no customer dependency |
| QA-010 | Smoke test framework | Technical infrastructure |
| DEV-001 | CI/CD Pipeline | Technical infrastructure |

**Recommendation:** While waiting for customer discovery, engineering team executes PoCs in parallel. This is not blocked by the critical path.

---

## 5. Artifact Lifecycle

| Artifact Type | Created In | Updated In | Retired In |
|--------------|-----------|-----------|-----------|
| Evidence (EV-###) | Discovery | Ongoing | Never (historical record) |
| Requirement (REQ-###) | Discovery/Validation | When customer needs change | When feature retired |
| ADR (ADR-###) | Any phase | When superseded | When deprecated |
| Work Item (backlog IDs) | Any phase | Ongoing | When DONE/CANCELLED |
| PoC (EXP-###) | Validation | When complete | Never (historical record) |
| Test Case (TC-###) | Engineering | When requirements change | When feature retired |
| Risk (RR-###) | Any phase | Ongoing | When resolved |
| Metric (M-###) | Validation | Ongoing | When metric retired |

**Rule:** Artifacts are never deleted. They are retired with a reason. This preserves the reasoning trail (EAOS lesson: hypotheses are never deleted, only rejected/superseded).

---

## 6. Review Cycles

| Cycle | Frequency | Attendees | Purpose |
|-------|-----------|-----------|---------|
| Daily Standup | Daily | Engineering team | Blockers, progress |
| Backlog Review | Weekly | Office leads | Triage, prioritize |
| Engineering Review Gate | Per feature | Architecture + Engineering | Approve/defer/reject implementation |
| Phase Gate Review | Per phase | TRB / SEPB | Approve phase exit |
| Retrospective | Per phase | All | Process improvement |

---

## 7. Success Criteria (Program-Level)

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Customer interviews completed | 15-20 | Count of INT-### |
| Evidence entries created | ≥30 (2+ per interview) | Count of EV-### |
| Requirements traced | 100% of Phase 1 features | RTM completeness |
| PoCs passed | ≥6 of 8 | PoC results |
| Phase 1 features shipped | All Tier 1 (10) + Tier 2 (3) + Tier 3 (2) | Feature status = DONE |
| Pilot deployments | 2-3 hotels | Deployment count |
| Pilot duration | 30+ days per hotel | Days in production |
| Critical incidents | 0 | Incident count |
| Customer willingness to pay | ≥2 customers sign contract | Signed contracts |

---

## 8. Documentation Freeze

**Effective now:** No new standalone documents unless implementation reveals a governance gap.

Existing documents (00-13, ADR-001) are FROZEN. They may be updated when:
- Customer evidence contradicts them (PDD, Scope, RTM revised)
- Implementation reveals missing content (new ADRs, new PoCs)
- A governance gap blocks execution (new document created with justification)

**Forbidden:** Creating new documents because "we should have one for X." If X is not blocking execution, X waits.

---

## 9. SEPB Master Prompt (replaces all prior TRB prompts)

> **Act as the SmartAgentics Engineering Program Board (SEPB), composed of the CTO, Chief Architect, Principal Software Engineer, Principal AI Engineer, Product Director, Program Manager, DevSecOps Lead, QA Director, Customer Research Lead, and Engineering Operations Lead.**
>
> **Your responsibility is to maximize delivery certainty—not document volume.**
>
> Before proposing any work:
> 1. Determine whether the project is in Discovery, Validation, Engineering, Pilot, Production, or Scale.
> 2. Reject any artifact that duplicates an existing one.
> 3. Prefer structured engineering data over narrative documents.
> 4. Organize work into epics, capabilities, features, stories, and tasks with explicit dependencies.
> 5. Define owners, acceptance criteria, metrics, risks, effort, and blockers for every work item.
> 6. Surface the critical path and recommend only the highest-leverage next actions.
> 7. Produce implementation-ready outputs rather than additional governance unless governance gaps are blocking execution.
> 8. Optimize for delivering a validated Phase 1 product that can be piloted with real customers while preserving the long-term SmartAgentics platform vision.

---

## 10. Next Actions (ranked by leverage)

| Priority | Action | Owner | Blocked By | Output |
|----------|--------|-------|-----------|--------|
| 1 | Execute Customer Discovery (15-20 interviews) | Customer Validation | Nothing (HUMAN ACTION) | EV-### entries |
| 2 | Execute PoC-01 (Offline LAN Sync) | Engineering | Nothing | PoC result |
| 3 | Execute PoC-07 (AI Evaluation Pipeline) | AI | Nothing | PoC result |
| 4 | Execute Competitive Intelligence (10+ PMS) | Customer Validation | Nothing (HUMAN ACTION) | Competitive matrix |
| 5 | Execute PoC-04 (Backup/Restore) | Engineering | Nothing | PoC result |
| 6 | Set up CI/CD pipeline | Operations | Nothing | DEV-001 |
| 7 | Populate RTM after interviews | Product | Action #1 | REQ-### entries |
| 8 | Score features after RTM | Product | Action #7 | Feature scores |
| 9 | Freeze Phase 1 Scope | Executive | Actions #1, #2, #7, #8 | Scope frozen |

**Actions #1 and #4 require human execution.** Actions #2, #3, #5, #6 can proceed in parallel by the engineering team. Actions #7-9 are blocked until #1 completes.
