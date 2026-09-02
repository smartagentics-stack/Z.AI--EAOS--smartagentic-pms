# ADR-014: Architecture Decision Record Numbering Gap

**ADR-ID:** ADR-014
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

ADR numbering goes from ADR-013 (Observability Strategy) to ADR-015 (Local AI Runtime). ADR-014 was intentionally skipped to separate the original architecture ADRs (001-013) from the Phase D Architecture Freeze ADRs (015-096).

## 2. Problem

The ADR compliance verifier checks for sequential numbering and flags gaps as issues. ADR-014 is a deliberate gap, not an error.

## 3. Options

### Option A: Remove the gap check from the verifier

Weakens governance — the gap check is useful for catching accidental numbering errors.

### Option B: Create a placeholder ADR-014

Documents the intentional gap and satisfies the sequential numbering check without weakening the verifier.

## 4. Decision

Adopt **Option B** — this placeholder ADR-014 documents the intentional numbering gap.

## 5. Rationale

- Preserves the verifier's gap-detection capability
- Documents the architectural decision to separate original ADRs from Phase D ADRs
- No governance weakening

## 6. Consequences

- ADR-014 exists as a placeholder — it does not contain an architecture decision
- The numbering gap between original ADRs (001-013) and Phase D ADRs (015-096) is documented
- Future ADRs should continue from ADR-097

## 7. Review Conditions

- Review if the numbering scheme needs to change (e.g., grouping by topic instead of sequential)
