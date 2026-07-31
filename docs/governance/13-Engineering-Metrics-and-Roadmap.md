# SmartAgentics Engineering Metrics & Roadmap Classification

**Version:** 1.0
**Status:** BINDING
**Owner:** Quality Office (metrics) + Executive Office (roadmap)
**Created:** 2026-07-14
**Directive:** TRB-003, Instructions 8, 9

---

## Part 1: Engineering Health Metrics (Instruction 8)

### Metrics Definition

| Metric | Definition | Target | Measurement |
|--------|-----------|--------|-------------|
| Lead time for changes | Time from commit to production | <3 days | Git commit timestamp → deployment timestamp |
| Deployment frequency | How often we deploy | ≥1/week | Count of deployments per week |
| Defect escape rate | Bugs found in production vs test | <5% | (prod bugs / total bugs) × 100 |
| Mean time to recovery (MTTR) | Time from incident to resolution | <4 hours | Incident timestamp → resolution timestamp |
| Test coverage | % of code covered by tests | ≥70% | Coverage tool output |
| Requirements traceability coverage | % of features with full RTM chain | 100% for Phase 1 | RTM completeness check |
| ADR completion rate | % of architectural decisions with ADRs | 100% for significant decisions | ADR count / decision count |
| PoC success rate | % of PoCs that meet acceptance criteria | ≥75% | PoC results |
| Customer-request fulfillment rate | % of customer requests implemented | Track (no target — informs prioritization) | Implemented requests / total requests |

### Measurement Cadence

| Metric | Cadence | Owner |
|--------|---------|-------|
| Lead time | Weekly | Engineering Office |
| Deployment frequency | Weekly | Operations Office |
| Defect escape rate | Monthly | Quality Office |
| MTTR | Per incident | Operations Office |
| Test coverage | Weekly | Quality Office |
| RTM coverage | Per feature | Product Office |
| ADR completion | Per decision | Architecture Office |
| PoC success | Per PoC | Engineering Office |
| Customer-request fulfillment | Monthly | Customer Validation Office |

### Dashboard

These metrics are reviewed:
- **Weekly:** Engineering team reviews lead time, deployment frequency, test coverage
- **Monthly:** Executive Office reviews all metrics for trends
- **Quarterly:** Full metrics review with TRB

**Metric degradation triggers investigation, not excuses.** If lead time doubles, find out why. If defect escape rate rises, improve testing. This is the EAOS discipline applied to engineering process.

---

## Part 2: Roadmap Classification (Instruction 9)

### Classification System

Every capability is tagged as one of:

| Tag | Meaning | Implementation |
|-----|---------|---------------|
| **Now** | Phase 1 — current implementation | In scope, being built or about to be built |
| **Next** | Phase 2 — after Phase 1 validation | Planned, not started, waiting for Phase 1 evidence |
| **Later** | Validated roadmap — proven need, not yet scheduled | Evidence exists, timing TBD |
| **Future Vision** | Long-term aspiration — no evidence yet | Vision only, no commitment |

### Classification Rules

1. **No capability is "Now" without customer evidence** (EV-### in Evidence Register)
2. **No capability is "Next" without a validated "Now"** it depends on
3. **"Later" requires evidence but not timing** — we know we need it, just not when
4. **"Future Vision" is honest** — we aspire but have no evidence
5. **Capabilities can move down** (Now → Next → Later → Future Vision) if evidence contradicts them
6. **Capabilities can move up** (Future Vision → Later → Next → Now) only with new evidence

### Phase 1 Roadmap Classification

| Capability | Tag | Evidence | RTM ID |
|-----------|-----|----------|--------|
| Reservations management | Now | PENDING customer validation | REQ-TBD |
| Check-in / Check-out | Now | PENDING customer validation | REQ-TBD |
| Billing & invoicing | Now | PENDING customer validation | REQ-TBD |
| Housekeeping management | Now | PENDING customer validation | REQ-TBD |
| Room & inventory management | Now | PENDING customer validation | REQ-TBD |
| Reporting & dashboards | Now | PENDING customer validation | REQ-TBD |
| Role management | Now | PENDING customer validation | REQ-TBD |
| Offline-first operation | Now | PENDING customer validation | REQ-TBD |
| LAN sync | Now | PENDING customer validation | REQ-TBD |
| Backup & restore | Now | PENDING customer validation | REQ-TBD |
| One AI assistant | Now | PENDING customer validation | REQ-TBD |
| AI evaluation framework | Now | Engineering requirement (not customer) | REQ-TBD |
| Cost tracking | Now | Engineering requirement (not customer) | REQ-TBD |
| Logging | Now | Engineering requirement | REQ-TBD |
| Installer | Now | Deployment requirement | REQ-TBD |

**Note:** All "Now" items are PENDING customer validation. They remain "Now" only if customer evidence supports them. If evidence contradicts, they move to "Next" or "Later."

### Phase 2+ Roadmap Classification

| Capability | Tag | Evidence |
|-----------|-----|----------|
| Multi-property support | Next | PENDING customer validation |
| Android companion app | Next | PENDING customer validation |
| AI cost optimization (model routing) | Next | PENDING Phase 1 cost data |
| Advanced analytics | Later | PENDING customer validation |
| Knowledge base / RAG | Later | PENDING customer validation |
| Multi-agent orchestration | Future Vision | None — no customer request |
| AgentOS | Future Vision | None — no customer request |
| AI Kernel (18 engines) | Future Vision | None — no customer request |
| Enterprise Intelligence Layer | Future Vision | None — no customer request |
| Marketplace / plugins | Future Vision | None — no customer request |
| Multi-industry modules (hospital, school, retail) | Future Vision | None — no customer request |
| Custom AI model training | Future Vision | None — no customer request |
| White-label customization | Future Vision | None — no customer request |

### TRB-007 Capabilities (Vision Architecture Reference — ADR-011)

All TRB-007 capabilities are Future Vision. None are authorized for implementation. See `docs/TRB-007-Vision-Architecture-Reference.md`.

| Capability | Tag | Evidence | Promotion Requirement |
|-----------|-----|----------|----------------------|
| 1. Offline AI Operating System (AIOS) | Future Vision | None | Customer evidence + technical spike + ERG |
| 2. Offline Local Model Management | Future Vision | None | Customer evidence + hardware feasibility spike + build vs buy |
| 3. Offline Knowledge & Retrieval Layer | Future Vision | None | Customer evidence + local vector search spike |
| 4. Offline Agent Memory System | Future Vision | None | Customer evidence + security review |
| 5. Department AI Agent Framework | Future Vision | None | Phase 1 AI assistant proves base case + per-department ERG |
| 6. Dynamic AI Agent Builder | Future Vision | None | Customer evidence + security review |
| 7. Multi-Agent Collaboration Runtime | Future Vision | None | Customer evidence that single-agent is insufficient |
| 8. AI Tool Registry | Future Vision | None | Customer evidence + security review |
| 9. Offline AI Services (OCR, STT, etc.) | Future Vision | None | Customer evidence + per-service feasibility spike |
| 10. Offline Learning Pipeline | Future Vision | None | Phase 1 AI evaluation proves base case + privacy review |
| 11. AI Runtime Resilience | Future Vision | None | Customer evidence + degradation spike |
| 12. Enterprise AI Configuration Layer | Future Vision | None | Multi-property/multi-tenant evidence + ERG |

**No TRB-007 capability may skip the promotion process:** customer evidence → Engineering Review Gate → AI Development Policy confidence → Architecture Maturity Model progression → ADR → Build vs Buy → Success Metrics.

### The 18-Chapter Enterprise Architecture Classification

| Chapter | Tag | Note |
|---------|-----|------|
| 1. SAERA | Future Vision | Reference architecture for future enterprise state |
| 2. AI Kernel | Future Vision | No evidence of need |
| 3. AgentOS | Future Vision | No evidence of need |
| 4. Multi-Agent Framework | Future Vision | No evidence of need |
| 5. Memory & Knowledge | Later | May be needed for AI assistant Phase 2 |
| 6. Workflow Engine | Now | Restate (proven in EAOS) |
| 7. Offline-First AI | Later | Phase 2 if customer validation supports |
| 8. Security, Governance, Multi-Tenant | Now (basics) / Later (full) | Basic security in Phase 1; full multi-tenant in Phase 2 |
| 9. Developer SDK | Future Vision | No evidence of need |
| 10. Industry Module Architecture | Future Vision | No evidence of need |
| 11. AI Evaluation | Now | Required before AI deployment |
| 12. AI Economics | Now | Required for cost control |
| 13. Decision Governance | Later | Phase 2 for approval workflows |
| 14. AI Observability | Now | Langfuse in Phase 1 |
| 15. Compliance & Audit | Later | Phase 2 for regulated industries |
| 16. Disaster Recovery | Now (basics) / Later (full) | Basic backup in Phase 1; full DR in Phase 2 |
| 17. Enterprise Intelligence | Future Vision | No evidence of need |
| 18. Engineering Governance | Now | This framework |

---

## What This Document Does NOT Do

- Does not set metric targets that are unrealistic (targets are conservative for Phase 1)
- Does not promise Future Vision capabilities will ever be built (they're aspirations, not commitments)
- Does not replace the Engineering Review Gate (metrics inform, gate decides)

**The roadmap is evidence-driven. Capabilities move between tags only when evidence supports the change.**
