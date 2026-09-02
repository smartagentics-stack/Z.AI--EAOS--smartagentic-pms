# ADR-047: Memory Provenance & Audit

**ADR-ID:** ADR-047
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Stream 4 research established that AI memory operations require full provenance tracking — every memory write, read, update, and delete must be traceable to the agent, user, and session that performed the operation. This is essential for GDPR compliance (Article 15 — right of access), security auditing (detecting memory poisoning), and operational debugging.

## 2. Problem

The existing SmartAgentics `AuditEvent` model has no memory-specific fields. Without provenance, we cannot answer: "Who wrote this memory?", "Which agent read it?", "When was it last modified?", or "What session triggered this memory operation?" — all required for GDPR, security, and debugging.

## 3. Options

### Option A: Extend existing AuditEvent

Add memory-specific fields to the existing `AuditEvent` Prisma model. Risk: bloating a general-purpose audit table with memory-specific columns.

### Option B: Separate MemoryAccessLog table

Create a dedicated `MemoryAccessLog` Prisma table for memory operations, cross-referenced to `AuditEvent` via `correlationId`. Keeps the general audit table clean while providing memory-specific provenance.

### Option C: Memory provenance in MemoryRecord itself

Add `createdBy`, `createdByAgent`, `lastModifiedBy`, `lastModifiedByAgent` fields directly to `MemoryRecord`. Simpler but loses operation-level audit (only tracks last modifier, not full history).

## 4. Decision

Adopt **Option B** — separate `MemoryAccessLog` table with cross-reference to `AuditEvent`.

## 5. Rationale

- Keeps `AuditEvent` general-purpose (no schema bloat)
- Provides full operation-level audit (every read, write, update, delete)
- Cross-reference via `correlationId` enables unified audit queries
- Aligns with Stream 4 research recommendation (FC-4.5 resolution)
- GDPR Article 15 compliance: can reconstruct complete memory access history per user
- Security: enables detection of memory poisoning patterns (MINJA, AgentPoison)

## 6. Consequences

- New `MemoryAccessLog` Prisma table (additive — no existing table modified)
- Every `MemoryStore` operation must write a `MemoryAccessLog` entry
- Slight storage overhead (~1 row per memory operation)
- Enables full GDPR Article 15 data export for memory

## 7. Review Conditions

- Review if GDPR requirements expand (e.g., Article 22 — automated decision-making)
- Review if memory access volume creates performance issues (consider partitioning or archival)
- Review if `MemoryAccessLog` needs to integrate with Stream 8's RFC 6962 Merkle Tree audit
