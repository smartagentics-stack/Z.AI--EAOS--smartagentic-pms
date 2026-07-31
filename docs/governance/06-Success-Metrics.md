# SmartAgentics AI PMS — Success Metrics

**Version:** 0.1 (DRAFT — pending customer validation)
**Status:** PROTOTYPE — metrics must be validated against customer needs
**Created:** 2026-07-14
**Directive:** TRB-001, Deliverable 6

---

## Principle

These metrics are **engineering contracts**, not aspirations. If a metric is not met, the feature has not shipped. There is no "close enough."

Each metric has:
- **Threshold:** the minimum acceptable value
- **Target:** the value we aim for
- **Measurement:** how we measure it
- **Consequence:** what happens if not met

---

## PMS Core Metrics

### M-001: Zero Overbooking (Reservations)
- **Threshold:** 0 overbooking incidents per month
- **Target:** 0 (non-negotiable)
- **Measurement:** Database constraint violations + customer reports
- **Consequence:** Feature does not ship. Billing errors from overbooking are unacceptable.
- **EAOS precedent:** Exactly-once semantics (0 duplicates) was proven across 663 workflows. Same discipline.

### M-002: Check-in Speed
- **Threshold:** <5 seconds (p95)
- **Target:** <3 seconds (p95)
- **Measurement:** Client-side timing from check-in request to confirmation
- **Consequence:** If p95 >5s, investigate. Front desk cannot wait longer than 5s during guest interaction.

### M-003: Billing Consistency
- **Threshold:** 100% accounting consistency
- **Target:** 100% (non-negotiable)
- **Measurement:** Nightly reconciliation: sum of all charges = sum of all invoices = sum of all payments
- **Consequence:** Any discrepancy blocks release. Billing errors destroy trust.

### M-004: Room Status Accuracy
- **Threshold:** 99% accuracy (room status matches physical state)
- **Target:** 99.5%
- **Measurement:** Daily audit: sample 10 rooms, compare system status to physical status
- **Consequence:** <99% triggers investigation. Housekeeping workflow must reflect reality.

### M-005: Report Generation Speed
- **Threshold:** <10 seconds for standard reports
- **Target:** <5 seconds
- **Measurement:** Time from report request to display
- **Consequence:** >10s makes reports unusable for operational decisions.

---

## Offline Metrics

### M-006: Offline Operation Duration
- **Threshold:** 8 hours continuous operation without internet
- **Target:** 24 hours
- **Measurement:** Deploy in environment with internet disabled; verify all PMS functions work
- **Consequence:** <8h is unacceptable for target market (unreliable internet). This is the #1 value proposition.

### M-007: LAN Sync
- **Threshold:** 0 duplicate transactions across sync
- **Target:** 0 (non-negotiable)
- **Measurement:** Run 2+ instances on LAN, perform operations, verify no duplicates after sync
- **Consequence:** Any duplicate is a data integrity failure. EAOS proved 0 duplicates across 663 workflows; same standard.

### M-008: Backup & Restore
- **Threshold:** Backup <30s, Restore <60s
- **Target:** Backup <10s, Restore <30s
- **Measurement:** Time full database backup and restore operations
- **EAOS precedent:** SQLite backup verified at 6ms, restore 3ms (RR-007). Targets are conservative.
- **Consequence:** Slow backup/restore puts data at risk.

---

## AI Metrics

### M-009: AI Hallucination Rate
- **Threshold:** <5% on golden test suite
- **Target:** <2%
- **Measurement:** Golden test suite of PMS questions with known-correct answers. AI response scored for factual accuracy.
- **Consequence:** >5% blocks AI deployment. Hallucinated reservation data or billing information is unacceptable.
- **Note:** "Hallucination" = AI states false information as fact. Does not include "I don't know" responses.

### M-010: AI Latency
- **Threshold:** <3 seconds (p95) for AI assistant responses
- **Target:** <2 seconds (p95)
- **Measurement:** Time from user query to AI response display
- **Consequence:** >3s makes AI assistant unusable in operational context.

### M-011: AI Cost Per Workflow
- **Threshold:** <₦50 ($0.03) average per AI-assisted workflow
- **Target:** <₦20 ($0.012)
- **Measurement:** Track API costs per AI-assisted operation (check-in, report, query)
- **Consequence:** >₦50 threatens profitability. Trigger cost optimization (caching, model routing, simpler prompts).

### M-012: AI Budget Enforcement
- **Threshold:** 100% of budget alerts fire at 80% and 100% of monthly tenant budget
- **Target:** 100%
- **Measurement:** Simulate budget exhaustion; verify alerts and cutoff
- **Consequence:** No budget enforcement = uncontrolled costs = bankruptcy risk.

---

## Operational Metrics

### M-013: Installer Success Rate
- **Threshold:** 95% of fresh installs complete without manual intervention
- **Target:** 99%
- **Measurement:** Track install completion across test deployments
- **Consequence:** <95% means installer is too fragile for target market (non-technical hotel staff).

### M-014: System Uptime
- **Threshold:** 99.5% uptime during business hours
- **Target:** 99.9%
- **Measurement:** Track system availability 6am-11pm (hotel operating hours)
- **Consequence:** <99.5% means hotel operations are disrupted.

### M-015: Data Integrity
- **Threshold:** 0 data loss events
- **Target:** 0 (non-negotiable)
- **Measurement:** Nightly integrity check: all reservations, billing, and room status records are consistent
- **Consequence:** Any data loss is a critical incident. Feature does not ship if data loss is possible.

---

## Measurement Validation (addresses EAOS Lesson 1.2)

**Before trusting any metric, validate the measurement system.**

| Metric | Validation Method |
|--------|-------------------|
| M-001 (overbooking) | Deliberately attempt duplicate booking; verify it's blocked |
| M-006 (offline) | Deploy without internet; verify functions work |
| M-007 (sync duplicates) | Deliberately create conflict; verify resolution |
| M-009 (hallucination) | Golden test suite reviewed by domain expert |
| M-011 (cost) | Compare API provider billing against our tracking |

**EAOS precedent:** The "90-minute cliff" was a measurement artifact (client-side timeout). Every metric here must be validated to ensure we're measuring what we think we're measuring.

---

## Phase 1 Release Gate

Phase 1 may be released to paying customers ONLY when:
1. All threshold metrics are met (not just targets)
2. All measurement validations are complete
3. At least 1 beta customer has used the system for 30+ days
4. No critical incidents (data loss, billing error, security breach)
5. TRB signs off on Production Readiness Review

**"Close to the threshold" is not "met."** Metrics are contracts.
