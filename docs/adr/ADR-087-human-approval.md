# ADR-087: Human Approval — Sync for HIGH, Async Dual-Control for CRITICAL

**ADR-ID:** ADR-087
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #21 ("Human approval") is classified as **"No"** — Stream 5 reserved `HumanApprovalRequest` table and Restate Pause & Resume pattern; Stream 6 added 4-level escalation (AUTO / NOTIFY / PAUSE_FOR_APPROVAL / ESCALATE_TO_HUMAN per ADR-065). Neither specifies the **financial/destructive/irreversible taxonomy that drives which level fires**, nor the **sync vs async + dual-control** mechanics. Stream 8 Foundational Conflict **FC-8.6** (High) flags this gap.

The Stream 8 research (s13) surveyed HITL patterns for AI agents:

- **Auth0 secure HITL for AI agents**: "Traditional synchronous authorization methods are difficult for agents, and asynchronous user confirmation lets agents pause and request human approval [without blocking]."
- **StackAI HITL design** (March 2026): "A human-in-the-loop approval workflow for AI agents is a runtime control pattern where an AI agent must request and receive a human decision [before proceeding]."
- **Backbase banking AI** (February 2026): "Human-in-the-loop requires human approval before the AI acts. The process stops and waits. Human-on-the-loop lets AI act autonomously while [humans monitor]."
- **Peakflo finance HITL governance** (April 2026): "Implement human-in-the-loop AI governance for finance — approval workflows, risk-based thresholds, oversight dashboards, [and control frameworks]."

Stream 5 §8.2 already established Vercel AI SDK `toolApproval` with 4 values (`'not-applicable' | 'approved' | 'user-approval' | 'never'`) and Restate Pause & Resume for blocking. Stream 6 ADR-065 established the 4-level escalation taxonomy and the `RestatePromise.race` with `ctx.sleep` for timeout. The missing piece is the **per-risk-class mapping** that decides when sync (HIGH) vs async dual-control (CRITICAL) fires — and the dual-control state machine (two distinct approvers, 24h cooling-off).

GDPR Article 22 (s09, s19) is the legal frame: any AI decision with `decisionEffectClass = LEGAL_EFFECT` or `SIMILARLY_SIGNIFICANT` requires human approval — never solely-automated. The human-approval workflow is therefore both a security control and a legal compliance mechanism.

## 2. Problem

Should SmartAgentics adopt sync-only approval, async-only approval, single-approver for all HIGH/CRITICAL, dual-control for all HIGH/CRITICAL, or a per-risk-class sync/async + single/dual-control split? Should the dual-control have a cooling-off period? What timeout applies to each mode?

## 3. Options

### Option A: Sync-only approval (always block with inline modal)

Rejected. Sync blocking is appropriate for HIGH (5-min user-facing modal) but inappropriate for CRITICAL (24h dual-control would block the agent's exclusive handler indefinitely). Async is required for CRITICAL.

### Option B: Async-only approval (always queue to dashboard)

Rejected. Async is too slow for HIGH-risk decisions where the user is present and waiting (e.g., `createReservation` while the guest is at the front desk). Sync inline modal is the right UX for HIGH.

### Option C: Single-approver for all HIGH/CRITICAL

Rejected. Dual control is the industry standard for irreversible financial actions (segregation of duties, Peakflo s13). Single-approver for `voidPostedFolio` would allow one manager to void paid invoices without oversight.

### Option D: Email-based approval

Partially rejected. Email is async and good for non-urgent CRITICAL notifications, but email is spoofable and not real-time. Phase 1 = in-app dashboard only; Phase 2+ may add email notifications (not approval, just notification).

### Option E: SMS-based approval

Rejected. SMS is spoofable; not appropriate for irreversible financial actions.

### Option F: No timeout (wait forever for approval)

Rejected. Violates Stream 5's "AI failure must never become PMS failure" principle; a stuck approval would block the agent indefinitely.

### Option G: Per-risk-class sync (HIGH) + async dual-control (CRITICAL) with timeouts and 24h cooling-off

Adopted. Extends Stream 5 `HumanApprovalService` + Stream 6 ADR-065 4-level escalation with the per-class mechanics.

## 4. Decision

Adopt **Option G** — the sync-vs-async + dual-control human approval workflow.

### Per-risk-class approval matrix

| Risk class | Approval mode                       | Approvers             | Timeout                                        | Waiting period                                      | UI                                                                                              |
| ---------- | ----------------------------------- | --------------------- | ---------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| LOW        | Auto                                | 0                     | N/A                                            | N/A                                                 | N/A                                                                                             |
| MEDIUM     | Auto + audit                        | 0                     | N/A                                            | N/A                                                 | N/A                                                                                             |
| HIGH       | **Synchronous**                     | 1 (single approver)   | 5 min → auto-reject + notify                   | 0                                                   | Inline modal: "Approve / Reject / Modify args"                                                  |
| CRITICAL   | **Asynchronous** + **dual control** | 2 (distinct managers) | 24h → auto-reject + escalate to senior manager | 24h between first and second approval (cooling-off) | Manager dashboard queue; first approval → "pending second approval" → second approval → execute |

### Synchronous mode (HIGH) — 7-step flow

1. Agent calls HIGH-risk tool → Vercel AI SDK `toolApproval: 'user-approval'` fires.
2. Supervisor creates a Restate `awakeable<ApprovalPayload>()` → gets a unique `approvalToken`.
3. Supervisor writes `HumanApprovalRequest` row with `approvalToken`, `riskClass=HIGH`, `expiresAt=now+5min`.
4. Supervisor emits `HUMAN_APPROVAL_REQUESTED` event → UI subscribes (WebSocket / Restate Signal).
5. UI shows inline modal to the originating user (or to a manager if the user lacks approval authority).
6. User clicks Approve/Reject → UI calls `POST /api/approvals/{token}` → Restate resolves the awakeable.
7. Supervisor resumes: Approve → execute tool; Reject → log `HUMAN_APPROVAL_REJECTED` + agent apologizes; Timeout → log `HUMAN_APPROVAL_TIMEOUT` + auto-reject.

### Asynchronous dual-control mode (CRITICAL) — 7-step flow

1. Agent calls CRITICAL-risk tool → Vercel AI SDK `toolApproval: 'never'` fires (never auto-execute).
2. Supervisor creates two `awakeable<boolean>()` → `firstApprovalToken`, `secondApprovalToken`.
3. Supervisor writes `HumanApprovalRequest` row with `firstApprovalToken`, `riskClass=CRITICAL`, `expiresAt=now+24h`, `firstApproverRole` (e.g., `manager_on_duty`), `secondApproverRole` (e.g., `general_manager`), `waitingPeriodHours=24`.
4. Supervisor emits `HUMAN_APPROVAL_REQUESTED` event → manager dashboard surfaces it.
5. First manager clicks Approve → `firstApprovalToken` resolved → `DUAL_CONTROL_FIRST_APPROVED` event → status becomes `pending_second_approval` + `earliestSecondApprovalAt = now + 24h`.
6. After 24h cooling-off, second manager (must be a distinct user from the first) clicks Approve → `secondApprovalToken` resolved → `DUAL_CONTROL_SECOND_APPROVED` → execute tool.
7. If either approval is Rejected, or 24h timeout → log + auto-reject + escalate to senior manager.

### `ApprovalPayload` (alterations-capable, per ADR-065)

Per Reddit r/AI_Agents caution: "HITL should not be theater." The approval payload carries alterations (e.g., "approved but with amount reduced to $X"). The Supervisor validates alterations against `ToolPermission` constraints before applying.

### Phase 1 scope

- Sync mode (HIGH) — full impl, inline modal UI.
- Async dual-control mode (CRITICAL) — full impl, manager dashboard UI.
- Backend: ~1 week (Restate awakeable + dual-control state machine).
- Frontend: ~3 weeks (inline modal + manager dashboard + WebSocket subscription).

## 5. Rationale

- **FC-8.6 closure**: the financial/destructive/irreversible taxonomy drives which approval level fires (HIGH sync vs CRITICAL async dual-control).
- **GDPR Article 22 compliance** (s09, s19): `LEGAL_EFFECT` decisions require human approval — never solely-automated. The workflow is both a security control and a legal compliance mechanism.
- **Auth0 principle** (s13): sync is difficult for agents; async lets agents pause without blocking. HIGH = sync (user present); CRITICAL = async (managers may be off-shift).
- **Backbase distinction** (s13): human-in-the-loop (CRITICAL, dual-control) vs human-on-the-loop (HIGH, single-approver sync) — the rubric captures both.
- **Peakflo principle** (s13): finance HITL governance requires approval workflows, risk-based thresholds, oversight dashboards — all materialized.
- **Dual-control = segregation of duties** — the industry standard for irreversible financial actions. The 24h cooling-off prevents rubber-stamp second approval.
- **Restate `awakeable` + `ctx.sleep` race** (Stream 6 ADR-065) is the canonical HITL pattern: durable, replayable, exactly-once. No external approval system in Phase 1 (offline-first).
- **Workflows-as-Tools isolation** (ADR-065) solves the exclusive-handler blocking risk — the approval wait happens in `HumanApprovalService`, not in the agent's handler.
- **Alterations-capable payload** matches the Reddit r/AI_Agents caution: HITL should enable meaningful human review, not just rubber-stamp.

## 6. Consequences

- Extends Stream 5 `HumanApprovalRequest` table with `firstApproverRole`, `secondApproverRole`, `waitingPeriodHours`, `earliestSecondApprovalAt`, `firstApprovedAt`, `firstApproverId`, `secondApproverId`.
- New UI views: inline approval modal, manager dashboard queue.
- New `AIAuditEvent` event types: `HUMAN_APPROVAL_REQUESTED`, `HUMAN_APPROVAL_GRANTED`, `HUMAN_APPROVAL_REJECTED`, `HUMAN_APPROVAL_TIMEOUT`, `DUAL_CONTROL_FIRST_APPROVED`, `DUAL_CONTROL_SECOND_APPROVED`.
- **Risk: dual-control requires two distinct managers; small hotels may have only one manager on duty (night shift).** Mitigation: documented operational policy; Phase 2+ "break-glass" override with full audit + next-day manager review.
- **Risk: 24h cooling-off may be too long for genuine urgent CRITICAL actions** (e.g., voiding a fraudulent invoice). Mitigation: per-tool override of `waitingPeriodHours` with senior-manager approval; default 24h is conservative.
- **Risk: the UI inline modal for HIGH-risk approvals may be missed if the user navigates away.** Mitigation: 5-min timeout → auto-reject; the agent apologizes and asks the user to retry.
- **Risk: `HumanApprovalService` single point of failure.** Mitigation: Restate journaling of all approval calls; on crash, recovery replays.
- **Risk: approver offline → approval never resolves.** Mitigation: timeout + escalation chain (Stream 6 ADR-065).
- **Risk: multiple concurrent approvals for same task.** Mitigation: `awakeable` is one-shot; second resolve is rejected by Restate.
- Dependencies: Stream 5 `HumanApprovalService` + `HumanApprovalRequest` table; Stream 6 ADR-065 4-level escalation; Restate `awakeable` + `ctx.sleep`; UI WebSocket subscription; ADR-086 (tool risk rubric drives the per-class mapping).
- Phase 1 effort: ~4 weeks (the dominant cost in Stream 8 Phase 1) — backend ~1 week, frontend ~3 weeks.

## 7. Review Conditions

- Review if Phase 2+ HITL frequency is higher than expected (every HIGH-risk tool requires approval) — would justify adding a batch approval queue to `HumanApprovalService`.
- Review if the default 5-min (HIGH) / 24h (CRITICAL) timeout proves wrong for hotel shifts (8 hours) — would require per-`AgentContract` tuning.
- Review if Phase 3+ AI-BOS requires dual-control for additional tool classes beyond CRITICAL — would extend the per-class matrix.
- Review if a community HITL standard emerges (e.g., a standardized approval-payload schema) that should replace the SmartAgentics-owned `ApprovalPayload`.
- Review if a PMS feature requires external approval system integration (ServiceNow / Jira for IT-change approvals) — would add an adapter implementing `HumanApprovalService`.
- Review if the Supervisor's alteration-validation logic misses constraint types not anticipated in Phase 1 — would extend the validation rule set.
- Review if break-glass override is needed for small hotels with single-manager night shifts — would add an override workflow with full audit + next-day senior-manager review.
