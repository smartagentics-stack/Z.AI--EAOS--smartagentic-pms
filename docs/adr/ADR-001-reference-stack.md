# ADR-001: SmartAgentics Phase 1 Reference Stack

**Version:** 1.0
**Status:** ACCEPTED
**Owner:** Architecture Office
**Created:** 2026-07-14
**Directive:** TRB-003, Instruction 6

---

## Context

TRB-003 directs that the technology stack be frozen unless a PoC proves it unsuitable. Technology changes require an ADR.

## Decision

The Phase 1 reference stack is:

| Layer                    | Technology           | Rationale                                                                       |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------- |
| Frontend                 | Next.js              | Already in use; React ecosystem; desktop-first UI                               |
| Backend                  | Node.js + TypeScript | Type safety; matches frontend language; good async for I/O                      |
| Workflow orchestration   | Restate              | Proven in EAOS investigation: 663 workflows, 0 failures, exactly-once semantics |
| Database (local)         | SQLite               | Offline-first; proven in EAOS (6ms backup, 3ms restore); zero-config            |
| Database (cloud, future) | PostgreSQL           | For future cloud sync; mature; supports pgvector if needed                      |
| Authentication           | Auth.js              | Don't build auth; Auth.js is simple, well-maintained                            |
| AI provider              | OpenAI (initially)   | Best capability; abstraction layer for future providers                         |
| AI evaluation            | Promptfoo            | Don't build evaluation; Promptfoo is purpose-built                              |
| AI observability         | Langfuse             | Don't build observability; Langfuse provides prompt tracing, cost tracking      |
| Vector search            | Deferred             | Not Phase 1; add when validated by customer needs                               |
| Local AI                 | Deferred             | Not Phase 1; add when customer validation makes it essential                    |

## Alternatives Considered

### Frontend

- **Alternative:** Native Windows app (Electron/Tauri)
- **Rejected:** Next.js is already in use; web UI is sufficient for Phase 1; native adds complexity without proven need

### Database

- **Alternative:** PostgreSQL for local (no SQLite)
- **Rejected:** SQLite is zero-config, offline-first, proven; PostgreSQL requires server process, more complex install

### Workflow orchestration

- **Alternative:** Temporal, Inngest, no orchestration
- **Rejected:** Restate is proven in this exact project (EAOS); Temporal is heavier; no orchestration doesn't meet durability requirements

### AI provider

- **Alternative:** Anthropic, local models
- **Rejected for Phase 1:** Anthropic is viable but OpenAI has broader ecosystem; local models are Phase 2+ (deferred per instruction)

## Consequences

### Positive

- Stack is proven (EAOS validated Restate + SQLite + Next.js)
- Minimal new technology risk
- Build vs Buy principle followed (Auth.js, Promptfoo, Langfuse are BUY decisions)
- TypeScript end-to-end reduces context switching

### Negative

- OpenAI dependency for AI (vendor lock-in risk mitigated by abstraction layer)
- SQLite may not scale to large multi-property (acceptable for Phase 1; PostgreSQL is future path)
- Next.js desktop-first means mobile is Phase 2+

### Risks

- **OpenAI cost escalation:** Mitigated by Economics Framework (M-011, M-012)
- **SQLite limitations:** Mitigated by PoC-01 (LAN sync) and PoC-02 (conflict resolution)
- **Offline AI unavailability:** Mitigated by PoC-03 (AI with intermittent internet)

## Change Control

This stack may only change when:

1. A PoC proves a technology unsuitable (document in ADR-###)
2. Customer evidence requires a different technology (document in ADR-###)
3. A BUY decision becomes available that's better than BUILD (update Build vs Buy Matrix)

**"I prefer a different technology" is not sufficient justification.** Evidence or PoC failure is required.

## Traceability

- **Evidence:** EAOS Investigation (Tasks 1-98), Build vs Buy Matrix (document 04)
- **Risks:** RR-VC (version control), AI cost risks (Economics Framework)
- **Tests:** PoC-01 through PoC-08 (document 12)
- **Metrics:** M-006 (offline), M-007 (sync), M-008 (backup), M-011 (AI cost)

---

## Amendment 1 — 2026-09-02 — Phase D Architecture Freeze

**Amendment Authority:** Phase D Architecture Freeze (per Senior Engineer Master Directive)

### Changes

1. **Local AI**: Reclassified from "Deferred" to "Architecture Contract — NOW; implementation Phase E." Reference: ADR-015 (Local AI Runtime), ADR-021 (Model Registry). The distinction between "implementation deferred" and "architectural contract NOW" is central to the AI-BOS upgrade.

2. **AI provider**: Updated from "OpenAI (initially)" to "Ollama (local, OpenAI-compatible HTTP API at localhost:11434) as primary; OpenAI as optional cloud fallback (Phase 2+)." Reference: ADR-015, ADR-049 (Agent Runtime). Offline-first principle requires local AI as primary.

3. **Vector search**: Reclassified from "Deferred" to "Architecture Contract — NOW; implementation Phase E." Reference: ADR-023 (Vector Store — sqlite-vec), ADR-024 (Hybrid Search). Required for offline RAG (ADR-030).

4. **PoC-01 and PoC-02**: Now formally specified in ADR-071 (PoC-01 LAN Sync + PoC-02 Conflict Resolution). These were previously referenced but undefined.

5. **Agent runtime**: Restate role extended from "workflow orchestration" to "agent runtime + workflow orchestrator + durability layer." Reference: ADR-049 (Agent Runtime), ADR-050 (Supervisor), ADR-051 (Planner), ADR-052 (Auditor).

### Rationale

Phase B identified ~30 of 35 offline AI capabilities as absent from the current architecture. Phase C research established evidence-based technology recommendations. Phase D formally records these as architecture contracts. The existing ADR-001 deferrals were appropriate for the original Phase 1 scope but are inadequate for the AI-BOS-compatible foundation.
