# SmartAgentics AI PMS — Phase 1 Scope Freeze

**Version:** 0.1 (DRAFT — pending PDD validation)
**Status:** PROPOSED — not frozen until PDD is validated by customer evidence
**Created:** 2026-07-14
**Directive:** TRB-001, Deliverable 3

---

## Freeze Conditions

**This scope is NOT frozen yet.** It becomes frozen when:
1. PDD (Deliverable 2) is validated by customer interviews (Deliverable 11)
2. TRB reviews and approves
3. Evidence Register (Deliverable 5) supports each item

**Once frozen, no items may be added.** Items may be removed if implementation reveals they are not feasible. No new features enter Phase 1 after freeze.

---

## Phase 1 Scope (Proposed)

### Tier 1: Core PMS (must ship)

| # | Feature | Rationale | Success Metric |
|---|---------|-----------|----------------|
| 1 | Reservations management | Core PMS function | Zero overbooking |
| 2 | Check-in / Check-out | Core PMS function | Check-in <5 seconds |
| 3 | Billing & invoicing | Core PMS function | 100% accounting consistency |
| 4 | Housekeeping management | Core PMS function | Room status always current |
| 5 | Room & inventory management | Core PMS function | Room status accurate |
| 6 | Reporting & dashboards | Core PMS function | Reports generate <10s |
| 7 | Role management | Multi-user access | Roles enforced 100% |
| 8 | Offline-first operation | Primary value proposition | Works 8h without internet |
| 9 | LAN sync | Multi-computer hotels | Zero duplicate transactions |
| 10 | Backup & restore | Data safety | Backup <30s, restore <60s |

### Tier 2: AI Integration (must ship, scoped)

| # | Feature | Rationale | Success Metric |
|---|---------|-----------|----------------|
| 11 | One AI assistant (natural language PMS queries) | Differentiator | Hallucination <5%, latency <3s |
| 12 | AI evaluation framework | Verify AI works | Golden test suite passes |
| 13 | Cost tracking | Prevent bankruptcy | Cost per query tracked, budget alarms |

### Tier 3: Operations (must ship)

| # | Feature | Rationale | Success Metric |
|---|---------|-----------|----------------|
| 14 | Logging | Debugging & audit | All operations logged |
| 15 | Installer | Deployable | Fresh install <15 min |

---

## Explicitly Excluded from Phase 1

### Architecture (Vision/Research, not Phase 1)
- AI Kernel (18 engines)
- AgentOS
- Multi-agent orchestration
- Knowledge graph
- Process mining
- Enterprise Intelligence Layer

### Modules (Future phases)
- Hospital module
- School module
- Retail module
- Manufacturing module
- Government module
- Any non-PMS industry module

### Features (Future phases)
- Mobile applications
- API platform
- Marketplace
- White-label
- Multi-model AI routing
- Custom model training
- Real-time collaboration
- Advanced analytics

---

## Phase 1 Acceptance Criteria (Overall)

Phase 1 is complete when ALL of the following are true:

1. **All Tier 1 features ship** and meet their success metrics
2. **All Tier 2 features ship** — AI assistant works, evaluation framework passes, cost tracking active
3. **All Tier 3 features ship** — logging and installer work
4. **Customer validation:** At least 1 paying customer uses the system in production for 30+ days
5. **No critical bugs:** Zero data loss events, zero billing inconsistencies, zero security incidents
6. **Cost viability:** AI costs are within budget (average <₦50 per workflow)
7. **Offline verified:** System functions 8+ hours without internet in customer deployment

**If any of these are not met, Phase 1 is not complete.**

---

## Dependencies

| Dependency | Status | Blocks |
|-----------|--------|--------|
| Customer validation (Deliverable 11) | Not started | Scope freeze |
| PDD validation (Deliverable 2) | DRAFT | Scope freeze |
| Build vs Buy Matrix (Deliverable 4) | DRAFT | Implementation start |
| AI Evaluation Framework (Deliverable 7) | Not started | AI assistant deployment |
| AI Economics Framework (Deliverable 8) | Not started | AI assistant deployment |

---

## Change Control

Once frozen, this scope changes only through:
1. TRB review
2. Evidence-based justification (customer feedback, technical infeasibility, cost overrun)
3. ADR documenting the change
4. Impact assessment on all other items

**"Good idea" is not sufficient justification for a scope change.**
