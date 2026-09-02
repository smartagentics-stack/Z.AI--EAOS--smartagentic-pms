# ADR-064: Multi-Agent Conflict Resolution — Rule-Based Deterministic Arbitration by the Supervisor

**ADR-ID:** ADR-064
**Status:** ACCEPTED
**Context:** 2026-09-02
**Owner:** Architecture Office

---

## 1. Context

Phase B directive B4 #22 requires multi-agent collaboration; collaboration at scale inevitably produces disagreements. Phase B #25 ("AI Failure Recovery") and B4 #30 ("AI Auditability") require that disagreements be resolved deterministically and auditably — never silently. Stream 5 established the Supervisor (ADR-050) as the central orchestrator and the Auditor (ADR-052) as the post-hoc reviewer. Stream 5's R-5.20 risk noted that Stream 6 would extend the Supervisor's role with conflict arbitration.

Stream 6 research (`/home/z/my-project/phase-c-stream6-multi-agent-report.md`, §7) surveyed the classical multi-agent conflict-resolution literature. arXiv `https://arxiv.org/pdf/1401.4381` identifies "the most popular conflict resolution strategies, namely, **negotiation, mediation, and arbitration**." APXML multi-agent course (`https://apxml.com/courses/multi-agent-llm-systems-design-implementation/chapter-3-agent-communication-coordination/multi-agent-conflict-resolution`) lists "1. Rule-Based Resolution; 2. Negotiation Protocols; 3. Voting Mechanisms; 4. Mediation or Arbitration by a supervisor." The LinkedIn consensus: "The arbitration layer in a multi-agent system references a priority hierarchy that is **defined at deployment, not updated dynamically**." Arion Research (`https://www.arionresearch.com/blog/conflict-resolution-playbook`): "Meta-agents can monitor lower-level negotiations and decide when escalation is warranted. These supervisory agents don't make the decisions themselves — they decide when to escalate." JumpCloud: "Conflict Resolution Arbitration Logic is an orchestration protocol utilized by a supervisor agent to mediate disputes between two or more worker agents." Ailore: "frameworks for detecting, classifying, and escalating conflicts between agents when automated negotiation fails."

For SmartAgentics, the realistic Phase 2+ conflict scenarios in a Hotel PMS are **rare and low-stakes**:

- **Write-write conflicts** (two agents both want to update the same reservation) — already resolved by the single-writer `SessionContext` semantics in ADR-062. There is no actual conflict to arbitrate; the second writer waits.
- **Policy conflicts** (two agents disagree on the recommended action — e.g., FrontDesk agent says "upgrade the guest"; Finance agent says "the upgrade fee was not collected") — these are genuine disagreements requiring arbitration.

Phase 1 has exactly one agent (`ReservationAssistantAgent`), so conflict resolution is **trivially correct** — no conflicts are possible. The architecture contract reserves the conflict-resolution role for the Supervisor and ships the `ConflictResolutionPolicy` interface so that Phase 2+ multi-agent flows have a stable extension point.

## 2. Problem

Should SmartAgentics adopt negotiation protocols (multi-round agent-to-agent bargaining), voting mechanisms (majority-rule across agents), LLM-mediated debate (agents argue, an LLM judge picks a winner), last-writer-wins (no arbitration), a dynamic priority hierarchy (priority changes at runtime), or rule-based deterministic arbitration with a deployment-defined priority hierarchy and the Supervisor as arbitrator?

## 3. Options

### Option A: Negotiation protocols (multi-round agent-to-agent bargaining)

Rejected for Phase 1–2. Complexity (multi-round state machines, offer/counter-offer protocols) is unwarranted for a Hotel PMS where the rules are mostly deterministic (Finance constraints > Hospitality gestures). Reserved for Phase 3+ AI-BOS exploration.

### Option B: Voting mechanisms (majority-rule across agents)

Rejected for Phase 1–2. Small agent count (2–3 specialists per scenario) makes voting unwieldy. A 2-1 vote is just rule-by-majority; the Supervisor-as-arbitrator with a deployment-defined hierarchy is more auditable. Reserved for Phase 3+.

### Option C: LLM-mediated debate (agents argue, LLM judge picks winner)

Rejected for Phase 1–2. Cost (multiple LLM calls per conflict), latency (seconds per debate round), non-determinism (the same conflict may resolve differently on retry) — all unsuitable for a Hotel PMS where deterministic outcomes are required for auditability. Reserved for Phase 3+ AI-BOS exploration.

### Option D: Dynamic priority hierarchy (priority changes at runtime)

Rejected. Per the LinkedIn consensus: "defined at deployment, not updated dynamically" — dynamic priorities are a security and auditability risk. The hotel organizational hierarchy is the priority hierarchy; it does not change at runtime.

### Option E: Last-writer-wins (no arbitration)

Rejected. Loses auditability; can corrupt state. The Supervisor must classify and resolve conflicts deliberately, not silently let the last write win.

### Option F: Rule-based deterministic arbitration with deployment-defined priority hierarchy

Adopted. The Supervisor is the arbitrator. The priority hierarchy is deployment-defined (tenant-configurable; default is industry-standard). Negotiation/voting/mediation deferred to Phase 3+. Unresolvable conflicts escalate to human per ADR-065.

## 4. Decision

Adopt **Option F** — rule-based deterministic arbitration by the Supervisor with a deployment-defined priority hierarchy.

### Supervisor's conflict-resolution role

The Supervisor's `ConflictResolutionPolicy` follows a four-step protocol:

1. **Detect**: two agents returned conflicting recommendations or both attempted to mutate the same state (the latter is structurally prevented by ADR-062 single-writer semantics — but the Supervisor still detects the _attempt_ and logs it).
2. **Classify**: write-write conflict (resolve via single-writer — no actual arbitration needed) vs. policy conflict (resolve via priority hierarchy).
3. **Resolve**: apply the deployment-defined priority hierarchy.
4. **Escalate** (if unresolvable): to a human per ADR-065 (escalation trigger: "unresolvable conflict").

This matches the Arion Research framing: "Meta-agents [Supervisor] can monitor lower-level negotiations and decide when escalation is warranted. These supervisory agents don't make the decisions — they decide when to escalate."

### `ConflictResolutionPolicy` interface (new file, additive)

```typescript
// Pseudocode — contract only, NOT for Phase 1 implementation
export interface ConflictResolutionPolicy {
  resolve(conflict: AgentConflict): ConflictResolution;
}

export interface AgentConflict {
  correlationId: string;
  tenantId: string;
  sessionId: string;
  conflictingAgents: Array<{ agentId: AgentId; recommendation: AgentRecommendation }>;
  conflictType: 'write-write' | 'policy';
  detectedAt: Date;
}

export interface ConflictResolution {
  outcome: 'resolved-by-priority' | 'resolved-by-single-writer' | 'escalated';
  winnerAgentId?: AgentId;
  rationale: string;
  escalatedToUserId?: string;
}
```

### Deployment-defined priority hierarchy

The priority hierarchy is **deployment-defined** (not dynamic) and tenant-configurable. The default hierarchy reflects the hotel organizational structure:

| Conflict type                    | Priority rule                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Cross-department policy conflict | **Finance constraints > Hospitality gestures** (money is a harder constraint than hospitality gesture) |
| Cross-role policy conflict       | **Admin > Manager > FrontDesk > Agent**                                                                |
| Same-department write-write      | Resolved by single-writer `SessionContext` (ADR-062) — no arbitration                                  |

The hierarchy is configured per `AgentContract.escalationChain` (per ADR-065) and the tenant's `Department` entity (Phase B #31). The Supervisor reads the hierarchy at conflict-detection time; it does not modify it.

### `ConflictResolution` Prisma table (new, rare, audit-only)

One row per conflict: `id`, `correlationId`, `tenantId`, `sessionId`, `conflictType`, `conflictingAgents` (JSON), `resolutionOutcome`, `winnerAgentId`, `rationale`, `escalatedToUserId`, `detectedAt`, `resolvedAt`. This table is rare (Phase 2+ conflicts are uncommon); it exists for audit and for tuning the priority hierarchy.

### Phase 1 trivially-correct behavior

Phase 1 ships the `ConflictResolutionPolicy` interface with a single implementation that trivially passes — there is one agent, so no conflicts are possible. The priority hierarchy is configured but unused. The contract is in place for Phase 2+ multi-agent flows.

## 5. Rationale

- **B4 #22 + B4 #25 + B4 #30 satisfaction**: disagreements are resolved deterministically and auditably; never silently; never with corruption.
- **Rule-based deterministic is the right Phase 1–2 choice**: hotel rules are mostly deterministic (Finance constraints > Hospitality gestures; Admin > Manager > FrontDesk > Agent). Negotiation/voting/debate add complexity unwarranted for the rule complexity.
- **Deployment-defined priority hierarchy** matches the LinkedIn consensus ("defined at deployment, not updated dynamically"). Dynamic priorities are a security and auditability risk.
- **Single-writer `SessionContext` (ADR-062) prevents write-write conflicts structurally** — the Supervisor only needs to arbitrate _policy_ conflicts, which are rarer and more meaningful.
- **Supervisor as arbitrator** matches the industry consensus (Restate, AWS Bedrock, LangChain, Databricks all converge on supervisor-mediated hierarchy). Peer-to-peer / decentralized conflict resolution is harder to audit and harder to enforce permission narrowing.
- **Unresolvable conflicts escalate to human** (per ADR-065) — never silent failure, never agent deadlock. This matches the Ailore framing: "frameworks for detecting, classifying, and escalating conflicts when automated negotiation fails."
- **Phase 1 ships the contract** (`ConflictResolutionPolicy` interface + priority hierarchy config) with a trivially-correct single-agent implementation. Phase 2+ swaps in the real arbitration logic; the interface is stable.
- **Negotiation / voting / mediation / LLM-debate reserved for Phase 3+** — additive extensions to `ConflictResolutionPolicy`, not replacements. Phase 3+ AI-BOS dynamic agent fleets may warrant them; Phase 1–2 does not.
- **`ConflictResolution` table is rare** (Phase 2+ conflicts are uncommon) — audit and tuning overhead is minimal.

## 6. Consequences

- New SDK interface `ConflictResolutionPolicy` in `packages/sdk/src/ai/collaboration.ts` (additive).
- New Prisma table `ConflictResolution` (rare; audit-only) — additive.
- Stream 5's `AgentSupervisorWorkflow` is extended to call the `ConflictResolutionPolicy` after agent responses are gathered (Phase 2+; Phase 1 trivially passes).
- The `Department` entity (Phase B #31) is the source of truth for cross-department priority rules — coordination with Stream 7 (Offline Sync & Data Architecture).
- **R-6.7.1 risk (deployment-defined hierarchy may be wrong for some hotels)**: mitigated by tenant-configurability; default is industry-standard.
- **R-6.7.2 risk (Phase 2+ conflicts rarer than expected → contract over-engineered)**: mitigated by low contract cost (interface + priority table + rare audit table); over-engineering risk is low.
- **R-6.7.3 risk (unresolvable conflicts escalate too often → human fatigue)**: mitigated by per-`AgentContract` escalation thresholds; Supervisor batches low-priority escalations.
- Dependencies: ADR-050 (Supervisor); ADR-052 (Auditor); ADR-062 (`SessionContext` single-writer); ADR-065 (escalation); Phase B #31 `Department` entity (Phase 2+ dependency). **No new runtime dependencies.**
- Phase 3+ may add negotiation/voting/mediation as `ConflictResolutionPolicy` implementations for cross-tenant procedure conflicts and AI-BOS agent marketplace disputes.

## 7. Review Conditions

- Review if Phase 2+ conflict frequency is higher than expected (e.g., daily FrontDesk-vs-Finance conflicts over upgrade fees) — would justify earlier adoption of negotiation or mediation patterns.
- Review if the deployment-defined priority hierarchy proves insufficient for some hotels (e.g., a hotel where Housekeeping has higher authority than FrontDesk for room-status decisions) — would require tenant-specific hierarchy overrides.
- Review if Phase 3+ AI-BOS agent marketplace disputes warrant LLM-mediated debate (e.g., two third-party agents disagree on the best rebooking strategy) — would add a `debate` mode to `ConflictResolutionPolicy`.
- Review if `ConflictResolution` audit table grows faster than expected — would justify per-tenant partitioning or 7-year archival.
- Review if a community multi-agent conflict-resolution standard emerges (e.g., a standardized priority-hierarchy schema) that should replace the SmartAgentics-owned model.
- Review if a PMS feature requires dynamic priority (e.g., during a crisis, the on-call manager gets elevated authority) — would require a separate `CRISIS_OVERRIDE` flow with its own audit semantics distinct from the deployment-defined hierarchy.
- Review if the Supervisor's conflict-detection logic misses conflict types not anticipated in Phase 1 (e.g., resource conflicts where two agents both want exclusive access to a room) — would extend the `AgentConflict.conflictType` enum.
