# Evidence-First Debugging Methodology

**Version:** 1.0
**Status:** BINDING — supplements Senior Engineering Operating Rules
**Created:** 2026-07-31
**Source:** SPIKE-01 investigation (Runs 1-7 + Observability Phase)

---

## The Lesson

SPIKE-01 took 7 runs to solve a data loss bug. The root cause was a data model mismatch (flat SQLite columns vs nested payload object). 

- **6 runs of hypothesis-driven debugging** (guessing at transport-layer causes) failed to find it
- **1 run of evidence-driven debugging** (lifecycle tracing) found it immediately
- The bug was in the **data model**, not the transport — no transport-layer fix could have solved it

This document codifies the methodology that worked.

---

## The Methodology

### When debugging a persistent defect:

```
1. OBSERVE — Instrument the system, don't change behavior
2. CAPTURE — Collect evidence at every lifecycle stage
3. LOCALIZE — Identify the exact stage where failure occurs
4. PROVE — Show the object at each stage (JSON.stringify, not summary)
5. FIX — Make the smallest possible change
6. VERIFY — Re-run under identical conditions
```

### When NOT to debug:

- Do NOT propose hypotheses before observing
- Do NOT change code before localizing the failure
- Do NOT guess at causes — trace them

### Evidence Escalation Protocol (Rule 18):

After 3 failed single-variable experiments:
1. STOP proposing fixes
2. FREEZE the implementation
3. ENTER Observability Phase (instrument, don't change behavior)
4. PRODUCE defect localization report
5. ONLY THEN propose a new hypothesis

---

## Lifecycle Tracing Pattern

Every record/message must be traceable through all stages:

```
Created → Persisted → Queued → Serialized → Transmitted →
Received → Deserialized → Validated → Processed → Acknowledged
```

### Implementation:

```typescript
interface ReplayTrace {
  recordId: string;
  created?: number;
  sqliteCommitted?: number;
  replayQueued?: number;
  socketWriteStart?: number;
  socketWriteEnd?: number;
  packetReceived?: number;
  jsonParsed?: number;
  insertAttempted?: number;
  insertComplete?: number;
  ackSent?: number;
  ackReceived?: number;
}
```

When a defect occurs, the trace shows the **last successful stage** — that's where the failure happened.

### Example from SPIKE-01:

```
Record A-10:
  created ✅
  sqliteCommitted ✅
  replayQueued ✅
  socketWriteStart ✅
  socketWriteEnd ✅ (ok: true)
  packetReceived ✅
  jsonParsed ✅
  insertAttempted ✅
  insertComplete ❌ ← FAILURE HERE
  ackSent ❌
  ackReceived ❌
```

This immediately pointed to the INSERT statement, not the network.

---

## Canonical Domain Model Principle

**One object shape per entity. No exceptions.**

- Define a canonical model with Zod
- Validate at all boundaries (network, database, internal)
- Store complex objects as JSON in SQLite (not flat columns)
- Serialize/deserialize at DB boundaries
- Never support multiple formats for the same entity

### Why:

SPIKE-01's bug was caused by SQLite storing `payload: { name, value, timestamp }` as flat columns. `SELECT *` returned flat fields, not the nested object. The server's INSERT tried `record.payload.name` → `undefined.name` → crash.

One canonical model with JSON storage eliminates this entire class of bugs.

---

## Provenance

This methodology was derived from:
- SPIKE-01 Runs 1-6: 6 failed hypothesis-driven attempts
- SPIKE-01 Observability Phase: 1 successful evidence-driven attempt
- Senior Engineering Operating Rules (Rule 7, Rule 18)
- ADR-012 (Canonical Domain Model)
- ADR-013 (Observability Strategy)
