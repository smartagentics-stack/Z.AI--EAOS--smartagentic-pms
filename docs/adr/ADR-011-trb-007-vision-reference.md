# ADR-011: TRB-007 as Vision Architecture Reference

**Status:** ACCEPTED | **Date:** 2026-07-14 | **Owner:** Architecture Office

## Decision

TRB-007 is Vision-level architecture reference, NOT implementation. All 12 capabilities are Future Vision. No governance overridden. Phase 1 Scope unchanged.

## Alternatives Rejected

Implement in Phase 1 (violates scope/policy), Ignore (capabilities forgotten), Partial implementation (violates clarification)

## Consequences

Capabilities captured, architecture extensible, no scope creep. SDK interfaces provide sufficient extension points.

---

## Amendment 1 — 2026-09-02 — Phase D Architecture Freeze

**Amendment Authority:** Phase D Architecture Freeze (per Senior Engineer Master Directive)

### Changes

1. **Reclassification of TRB-007 capabilities**: The following capabilities are reclassified from "Future Vision" to "Architecture Contract — NOW" (implementation may be incremental, but the architectural contract must exist before PMS implementation):

   - Local AI Runtime (ADR-015)
   - Local Model Management / Registry (ADR-021)
   - Hardware Capability Detection (ADR-016)
   - Local Embeddings (ADR-022)
   - Offline Knowledge / RAG (ADR-028, ADR-030)
   - AI Memory (ADR-038)
   - AI Supervisor (ADR-050)
   - AI Planner (ADR-051)
   - AI Auditor (ADR-052)
   - AI Tool Registry (ADR-054)
   - Agent Permissions (ADR-055)
   - Human Approval (ADR-087)
   - Multi-Agent Architecture (ADR-060, architecture only — no Phase 1 implementation)
   - AI Observability (ADR-059, ADR-091)
   - AI Auditability (ADR-084, ADR-085)
   - AI Evaluation (ADR-090)
   - Plugin Architecture (architecture contract — implementation deferred)
   - Offline AI Services Abstraction (ADR-015 extends to embeddings, reranking)
   - Cloud AI Abstraction (ADR-015 allows OpenAI as optional fallback)

2. **SDK extension points**: The original claim "SDK interfaces provide sufficient extension points for all 12 capabilities" is **INACCURATE** for the AI-BOS target architecture. Phase B verified that the SDK has only 5 basic AI interfaces (AIProvider, AIEvaluator, AIBudgetEnforcer, AIRequest, AIUsage) — insufficient for Model Registry, Memory, Agent Runtime, Tool Registry, Knowledge, RAG, Security, or Sync. Phase D adds ~30 new SDK interfaces via ADR-015 through ADR-096.

3. **Remaining Future Vision** (NOT reclassified — genuinely deferred):
   - Dynamic AI Agent Builder (no-code agent creation)
   - Full AI Business Operating System
   - Multi-industry platform (hospital/school/manufacturing)
   - Autonomous model training
   - Blockchain (explicitly rejected for Phase 1)

### Rationale

Phase B identified that ADR-011's "Future Vision" classification for ~25 capabilities conflicts with the Senior Engineer's directive that offline AI is "part of the foundation of this project." The distinction between "implementation deferred" and "architectural contract NOW" is central to the AI-BOS upgrade.
