# ADR-013: Observability Strategy

**Status:** ACCEPTED
**Date:** 2026-07-31
**Owner:** Architecture Office

## Context

SPIKE-01 Runs 1-6 used hypothesis-driven debugging: each run proposed a fix, tested it, and failed. Six runs consumed significant engineering time without identifying the root cause. The root cause (data model mismatch) was found in a single observability run that traced records through their complete lifecycle.

**Lesson:** When debugging fails repeatedly, stop guessing and start tracing. Evidence-driven debugging (observability) outperforms hypothesis-driven debugging (guessing) by orders of magnitude.

## Decision

**Every spike and production subsystem must include lifecycle tracing instrumentation from the start.**

### Required Instrumentation

1. **Message lifecycle tracing**: Every record/message must be traceable through all stages:
   - Created
   - Persisted (SQLite commit)
   - Queued (for replay/sync)
   - Serialized (before network send)
   - Transmitted (socket.write)
   - Received (socket data event)
   - Deserialized (JSON.parse)
   - Validated (Zod schema check)
   - Processed (INSERT/UPDATE)
   - Acknowledged (ack sent/received)

2. **Trace IDs**: Every message must carry:
   - `messageId`: unique per message
   - `connectionId`: unique per TCP connection
   - `replaySessionId`: unique per replay session
   - `sequenceInReplay`: position within replay batch

3. **Socket metrics**: Log at every connection state transition:
   - `bytesWritten`, `bytesRead`, `bufferSize`, `destroyed`, `readyState`

4. **Database verification**: At key points (pre-test, post-connect, during-disconnect, post-test):
   - `SELECT COUNT(*)`, `MIN(sequenceNumber)`, `MAX(sequenceNumber)`
   - Per-client counts

5. **Missing record identification**: When data loss is detected, identify records by **ID** (not just count). Trace each missing record to its last successful lifecycle stage.

### Implementation

The `ReplicationTracer` class (`spikes/SPIKE-01/src/trace.ts`) implements this strategy. It is the reference implementation for future spikes and production code.

### Evidence Escalation Protocol (Rule 18)

When the same defect persists after 3 controlled single-variable experiments:
1. Stop proposing fixes
2. Freeze implementation
3. Enter Observability Phase (increase instrumentation, don't change behavior)
4. Produce defect localization report
5. Only after failure is localized may a new hypothesis be proposed

## Alternatives Rejected

- **Log-only debugging (console.log)**: Rejected. Doesn't provide structured lifecycle tracking. Cannot trace individual records.
- **External APM tools**: Rejected for Phase 1. Adds operational complexity. The tracer is in-process and sufficient.
- **Post-mortem debugging**: Rejected. Finding bugs after the fact is too slow. Instrumentation must be proactive.

## Consequences

**Positive:**
- Bugs are found by tracing, not guessing
- Defect localization is immediate (last successful stage = failure point)
- Evidence-based debugging replaces hypothesis-driven debugging
- Reproducible: trace logs can be re-analyzed

**Negative:**
- Slight performance overhead (trace recording) — negligible at Phase 1 scale
- Additional code complexity (tracer module) — justified by the 6:1 debugging improvement

## Evidence

- SPIKE-01 Runs 1-6: 6 hypothesis-driven runs, 0 root causes found
- SPIKE-01 Observability Phase: 1 evidence-driven run, root cause found immediately
- Root cause was at `insertAttempted → insertComplete` stage — only visible with lifecycle tracing

## Traceability

- Related: ADR-012 (Canonical Domain Model), Senior Engineering Operating Rules Rule 7 and Rule 18
- Reference implementation: `spikes/SPIKE-01/src/trace.ts`
- Evidence: `spikes/SPIKE-01/trace-report.json`
