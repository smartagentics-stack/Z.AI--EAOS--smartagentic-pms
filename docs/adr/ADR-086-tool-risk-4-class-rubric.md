# ADR-086: Tool Risk 4-Class Rubric — Low/Medium/High/Critical + Approval Rules

**ADR-ID:** ADR-086
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B B4 #20 ("Tool permissions") is classified as **"No"** — Stream 5 reserved `ToolPermission` with a 4-class risk taxonomy (LOW/MEDIUM/HIGH/CRITICAL) but did NOT specify the per-class approval workflow rules (sync vs async, single-approver vs dual-control, timeout, escalation). Stream 8 Foundational Conflict **FC-8.5** (High) flags this gap.

The Stream 8 research (s10) is unambiguous about why a rubric is mandatory:

- **Praesidia rate-limiting research** (March 2026): "An agent that decides to call a tool — send an email, write to a database, call an external API — may trigger a chain of side effects that [compound beyond the original request]."
- **OWASP LLM06:2025 Excessive Agency** (s01): agents with too much autonomy, too many tools, too-broad tool permissions, or too-permissive tool inputs can take actions beyond what the user intended.
- **Sweet Security privilege-abuse research** (August 2026): "Privilege Abuse in AI agents is a runtime identity risk: valid credentials become dangerous when an agent's current task, tool chain, or [context expands beyond original authorization]."

The 4-class rubric must distinguish **reversible-persistent from irreversible/external-egress** — these have materially different approval requirements. A 3-class rubric (LOW/MEDIUM/HIGH) cannot make this distinction; a 5+ class rubric adds complexity without security benefit. The rubric must also specify the side-effect classification (`PURE_READ` / `WRITE_IN_SESSION` / `WRITE_PERSISTENT` / `WRITE_IRREVERSIBLE` / `EXTERNAL_EGRESS`) that complements the risk class, and the per-class approval policy (auto / sync single-approver / async dual-control) with timeouts and waiting periods.

## 2. Problem

Should SmartAgentics adopt a 3-class rubric, a 4-class rubric, a 5+ class rubric, or per-tool custom approval policies? What approval policy, timeout, and waiting period apply to each class?

## 3. Options

### Option A: 3-class rubric (LOW/MEDIUM/HIGH)

Rejected. Cannot distinguish reversible-persistent (`createReservation`) from irreversible/external-egress (`voidPostedFolio`, `sendEmail`), which have materially different approval requirements (single-approver sync vs dual-control async).

### Option B: 5+ class rubric

Rejected. Adds complexity without security benefit; the 4-class covers the design space. A 5th class (e.g., "EXTERNAL_EGRESS") is better modeled as a `sideEffectClass` orthogonal dimension than as a separate risk class.

### Option C: Per-tool custom approval policies (no rubric)

Rejected. Unscalable; the rubric provides a default that 95% of tools use without customization. Per-tool customization is reserved for the rare tool that needs different rules (e.g., a tool with regulatory waiting periods).

### Option D: 4-class rubric (LOW/MEDIUM/HIGH/CRITICAL) + side-effect classification + per-class approval policy

Adopted. The 4-class rubric covers the design space; the orthogonal `sideEffectClass` dimension captures the external-egress case without inflating the rubric.

## 4. Decision

Adopt **Option D** — the 4-class tool risk rubric with per-class approval rules.

### 4-class risk rubric

| Risk class   | Definition                                                                         | Approval policy                                                                                                                                                                                                    | Timeout | Examples (Stream 5 §8.4)                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LOW**      | Pure read; no side effects; no PII exposure beyond standard query                  | Auto-execute; standard audit only                                                                                                                                                                                  | N/A     | `searchKnowledgeBase`, `getGuestProfile`, `getReservationDetails`, `readInventory`                                                                                    |
| **MEDIUM**   | Write to session-scoped state only; reversible; no PII exposure beyond the session | Auto-execute; Supervisor pre-execution audit entry                                                                                                                                                                 | N/A     | `draftReservation`, `updateHousekeepingStatus` (session), `updateInventory` (session)                                                                                 |
| **HIGH**     | Write to persistent storage; financial impact; reversible with effort              | **Synchronous** HumanApproval (single approver; Restate `awakeable` blocks; default 5-min timeout → auto-reject + notify)                                                                                          | 5 min   | `createReservation`, `modifyReservation`, `cancelReservation`, `issueInvoice`, `issueRefund`, `updateHousekeepingStatus` (persistent), `updateInventory` (persistent) |
| **CRITICAL** | Irreversible; admin-destruction; external egress; legal-effect (GDPR Art. 22)      | **Asynchronous** dual-control HumanApproval (two distinct managers; Restate Pause & Resume; default 24h timeout → auto-reject + escalate; 24h waiting period after first approval before second approval accepted) | 24h     | `cancelPaidInvoice`, `voidPostedFolio`, `deleteUser`, `sendEmail` (external egress), `escalateToManager`, `shareGuestDataWithThirdParty`                              |

### Side-effect classification (orthogonal dimension, new field on `Tool`)

| `sideEffectClass`    | Definition                                     | Default rate limit  |
| -------------------- | ---------------------------------------------- | ------------------- |
| `PURE_READ`          | No side effects                                | 100 calls/min/agent |
| `WRITE_IN_SESSION`   | Writes only to session-scoped state            | 30 calls/min/agent  |
| `WRITE_PERSISTENT`   | Writes to a Prisma mutable table               | 10 calls/min/agent  |
| `WRITE_IRREVERSIBLE` | Cannot be undone by the agent                  | 2 calls/hour/agent  |
| `EXTERNAL_EGRESS`    | Calls any URL/IP outside local SQLite + Ollama | 5 calls/min/agent   |

### New `Tool` fields (ADR-048 amendment, additive)

| Field             | Type                                       | Purpose                                    |
| ----------------- | ------------------------------------------ | ------------------------------------------ |
| `riskClass`       | Enum (LOW/MEDIUM/HIGH/CRITICAL)            | Already in Stream 5; made NOT NULL         |
| `sideEffectClass` | Enum (5 values above)                      | New                                        |
| `approvalPolicy`  | Enum (NONE/SYNC_SINGLE/ASYNC_DUAL_CONTROL) | New                                        |
| `approvalTimeout` | Int (seconds)                              | New; default 300 (HIGH) / 86400 (CRITICAL) |
| `waitingPeriod`   | Int (seconds)                              | New; default 0 (HIGH) / 86400 (CRITICAL)   |
| `rateLimitConfig` | JSON                                       | New; overrides per-tool rate limit         |
| `breakerTtl`      | Int (seconds)                              | New; default 300 — circuit breaker reset   |

### Approval policy mapping

| Risk class | `approvalPolicy`     | Approvers             | Waiting period                                      | UI                                                                                              |
| ---------- | -------------------- | --------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| LOW        | `NONE`               | 0                     | N/A                                                 | N/A                                                                                             |
| MEDIUM     | `NONE` (with audit)  | 0                     | N/A                                                 | N/A                                                                                             |
| HIGH       | `SYNC_SINGLE`        | 1                     | 0                                                   | Inline modal: "Approve / Reject / Modify args"                                                  |
| CRITICAL   | `ASYNC_DUAL_CONTROL` | 2 (distinct managers) | 24h between first and second approval (cooling-off) | Manager dashboard queue; first approval → "pending second approval" → second approval → execute |

### Phase 1 scope

- 4-class rubric applied to all ~15 Phase 1 tools (Stream 5 §8.4 list).
- `Tool` fields populated (metadata only; no new code beyond the rubric).
- Approval workflow UI is implemented under ADR-087.

## 5. Rationale

- **FC-8.5 closure**: the per-class approval workflow rules (sync vs async, single vs dual control, timeout, waiting period) are now specified.
- **OWASP LLM06:2025 closure** (s01): the rubric prevents excessive agency by requiring approval for any tool with side effects beyond session-scoped state.
- **Praesidia principle** (s10): "an agent may trigger a chain of side effects" — the `sideEffectClass` dimension captures this; rate limiting per `(agentId, toolId, tenantId)` triple (ADR-094) contains runaway loops.
- **Dual-control for CRITICAL** is the industry standard for irreversible financial actions (segregation of duties). The 24h cooling-off prevents rubber-stamp second approval.
- **5-dimension tool abuse prevention** (rate limiting + zod validation + idempotency keys + circuit breaker + side-effect classification) wraps around the rubric — defense-in-depth.
- **Verifier rule enforcement**: VERIFY-AI-SECURITY-01 fails CI for any `Tool` missing `riskClass`, `sideEffectClass`, `approvalPolicy`, `approvalTimeout`, or `waitingPeriod` — a developer cannot add a tool without classifying it.
- **3-class rejected, 5+ class rejected**: the 4-class covers the design space without inflation; external-egress is captured as `sideEffectClass` rather than as a 5th risk class.

## 6. Consequences

- ADR-048 amendment adds 6 fields to `Tool` (all additive).
- New `ApprovalPolicy` enum.
- New `ApprovalRequest` Prisma table (extends Stream 5's `HumanApprovalRequest`).
- ~15 Phase 1 tools each get metadata (`riskClass`, `sideEffectClass`, `approvalPolicy`, `approvalTimeout`, `waitingPeriod`, `rateLimitConfig`, `breakerTtl`).
- **Risk: risk classification is subjective.** A tool author may misclassify a CRITICAL tool as HIGH. Mitigation: Phase D ADR review by Architecture Office; verifier rule (VERIFY-AI-SECURITY-01) flags any tool without `riskClass`.
- **Risk: dual-control requires two distinct managers; small hotels may have only one manager on duty (night shift).** Mitigation: documented operational policy; Phase 2+ "break-glass" override with full audit + next-day manager review.
- **Risk: 24h cooling-off may be too long for genuine urgent CRITICAL actions** (e.g., voiding a fraudulent invoice to stop a chargeback). Mitigation: per-tool override of `waitingPeriod` with senior-manager approval; default 24h is conservative.
- **Risk: rate-limit values may be wrong for real hotel workloads.** Mitigation: per-tenant overrides via `AIConfiguration` (ADR-095); tune in Phase 2 based on production telemetry from `AIAuditEvent`.
- Dependencies: Stream 5 `Tool` and `ToolPermission` (ADR-048); ADR-087 (Human Approval Workflow); ADR-094 (Agent Sandbox & Egress Control for rate limiting); ADR-095 (per-tenant AI configuration).
- Phase 1 effort: ~1 week (metadata on ~15 tools); the approval workflow UI is counted under ADR-087.

## 7. Review Conditions

- Review if a tool author disputes a classification (e.g., argues `cancelPaidInvoice` should be HIGH not CRITICAL) — would require Architecture Office adjudication.
- Review if Phase 2+ break-glass override is needed for small hotels with single-manager night shifts — would add an override workflow with full audit.
- Review if the default 24h CRITICAL cooling-off proves too long for urgent fraud-response actions — would require per-tool `waitingPeriod` override with senior-manager approval.
- Review if rate-limit defaults prove wrong for real hotel workloads — would tune via `AIConfiguration` (ADR-095) per-tenant overrides.
- Review if a 5th risk class is demanded by a regulator (e.g., "PROHIBITED" for tools that should never be exposed to AI) — would extend the rubric.
- Review if Phase 2+ requires tool deprecation (a previously-LOW tool becomes CRITICAL after a security incident) — would require a tool-version migration workflow.
- Review if a community tool-risk standard emerges (e.g., OWASP Agentic Applications standardizes a rubric) that should replace the SmartAgentics-owned 4-class model.
