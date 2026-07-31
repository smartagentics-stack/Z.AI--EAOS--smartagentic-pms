# SmartAgentics AI PMS — Build vs Buy Matrix

**Version:** 0.1 (DRAFT)
**Status:** PROTOTYPE — Phase 1 components only
**Created:** 2026-07-14
**Directive:** TRB-001, Deliverable 4

---

## Rule

> Never build infrastructure that already exists unless there is measurable business value in building it. The default is to integrate, not invent.

**Justification required for BUILD decisions.** The default is BUY or USE-EXISTING.

---

## Phase 1 Components

| Component | Build | Buy/Use | Decision | Justification |
|-----------|-------|---------|----------|---------------|
| Workflow Engine | ❌ | ✅ Restate | **USE** | Already validated in EAOS investigation. Exactly-once semantics proven. 663 workflows, 0 failures. |
| Database | ❌ | ✅ SQLite (offline) + PostgreSQL (cloud sync) | **USE** | SQLite is proven for offline-first. PostgreSQL for cloud. Both are mature. |
| Authentication | ❌ | ✅ Auth.js / Keycloak | **BUY/USE** | Authentication is solved. Don't build. Evaluate Auth.js for simplicity, Keycloak for enterprise. |
| AI Model Provider | ❌ | ✅ OpenAI/Anthropic API | **BUY** | Don't train models. Use APIs. Phase 1 uses one provider with cost tracking. |
| AI Evaluation | ❌ | ✅ Promptfoo / DeepEval | **BUY** | Evaluation frameworks exist. Don't build custom. Evaluate both, choose one. |
| AI Observability | ❌ | ✅ Langfuse | **BUY** | Langfuse provides prompt tracing, cost tracking, quality metrics. Don't build. |
| Vector Database | ❌ | ✅ pgvector | **USE** | If vector search is needed (Phase 2), pgvector extends PostgreSQL. No separate vector DB. |
| Frontend Framework | ❌ | ✅ Next.js (already chosen) | **USE** | Already in use. Don't change. |
| UI Components | ❌ | ✅ shadcn/ui (already chosen) | **USE** | Already in use. |
| Offline Sync | ✅ | ❌ | **BUILD** | Offline-first is core differentiator. Custom sync logic required for PMS domain. |
| PMS Domain Logic | ✅ | ❌ | **BUILD** | This is the product. Reservations, billing, housekeeping — this is what we're selling. |
| AI Assistant | ✅ | ❌ | **BUILD** (using BUY APIs) | PMS-specific assistant. Build the prompts/workflows, buy the model. |
| Installer | ✅ | ❌ | **BUILD** | Needs to handle offline install, LAN setup. Custom for our deployment model. |
| Logging | ❌ | ✅ Structured JSON logging (existing) | **USE** | Already implemented in EAOS. Don't rebuild. |
| Backup | ✅ | ❌ | **BUILD** | PMS-specific backup (SQLite backup verified in RR-007: 6ms backup, 3ms restore). |
| Reporting | ✅ | ❌ | **BUILD** | PMS-specific reports (occupancy, revenue, housekeeping). |

---

## Build Decisions — Justification

Each BUILD decision requires justification per the rule above.

### Offline Sync — BUILD
**Why not buy:** Offline-first sync for PMS domain objects (reservations, room status, billing) is not available off-the-shelf. Generic sync engines (Replicache, ElectricSQL) don't understand PMS conflict resolution (e.g., two front desks assigning the same room).
**Business value:** Offline-first is the #1 value proposition per PDD. This is what we're selling.

### PMS Domain Logic — BUILD
**Why not buy:** This IS the product. Buying a PMS would mean we're reselling, not building.
**Business value:** The entire product.

### AI Assistant — BUILD (using BUY APIs)
**Why not buy:** Generic AI assistants don't understand PMS operations. We build the prompts, tools, and workflows; we buy the model inference.
**Business value:** AI assistant is a differentiator.

### Installer — BUILD
**Why not buy:** Offline installer for Nigerian hotel environments (unreliable internet, LAN setup) requires custom logic.
**Business value:** Required for deployment to target market.

### Backup — BUILD
**Why not buy:** SQLite backup is trivial (already verified: 6ms). Custom backup is simpler than integrating a backup solution.
**Business value:** Data safety for PMS.

### Reporting — BUILD
**Why not buy:** PMS reports are domain-specific. Generic reporting tools require more integration than building from scratch.
**Business value:** Core PMS feature.

---

## Phase 2+ Components (Not Evaluated Yet)

These are NOT in Phase 1 and are NOT evaluated in this matrix. They will be evaluated when they enter Phase 2 scope:

- Knowledge Engine (likely LlamaIndex)
- AgentOS (likely custom, but evaluate LangGraph first)
- Multi-agent framework (likely LangGraph or CrewAI)
- Compliance framework (evaluate per industry)
- Advanced analytics (evaluate per requirement)

**Do not evaluate Phase 2+ components now.** That's scope creep.

---

## Review Schedule

This matrix is reviewed:
1. Before Phase 1 implementation starts (confirm all decisions)
2. When a component proves infeasible (re-evaluate alternatives)
3. At Phase 1 completion (inform Phase 2 matrix)

**A BUILD decision that proves too expensive or complex must be re-evaluated as a BUY decision.** The reverse is also true.
