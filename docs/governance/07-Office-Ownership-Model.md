# SmartAgentics Office Ownership Model

**Version:** 1.0
**Status:** BINDING — every artifact has exactly one owning office
**Created:** 2026-07-14
**Directive:** TRB-002 (Stage 2 — Ownership)

---

## Purpose

Every artifact in the SmartAgentics project belongs to exactly one office. Without ownership, no work starts. This prevents orphaned documents and unclear responsibility.

---

## Offices

| Office | Owns | Phase 1 Lead (if team is small) |
|--------|------|--------------------------------|
| **Product Office** | PDD, Evidence Register, Customer Validation, RTM (customer needs) | Product Manager |
| **Architecture Office** | SAERA, ADRs, Architecture Maturity Model, Build vs Buy Matrix | Principal Engineer |
| **Engineering Office** | Implementation, Code, Technical Debt Register, Installer | Senior Engineer(s) |
| **AI Office** | AI Evaluation Framework, AI Economics, AI Assistant design | AI Engineer (or Principal Eng in small team) |
| **Quality Office** | Success Metrics, Test Cases, RTM (acceptance criteria), Smoke Tests | QA Engineer (or Senior Eng) |
| **Security Office** | Security architecture, Compliance, Audit trails | Security Lead (or Principal Eng) |
| **Operations Office** | Deployment, Monitoring, DR, Installer validation | DevOps (or Senior Eng) |
| **Customer Validation Office** | Customer interviews, Market research, Competitive analysis | Product Manager |
| **Executive Office** | Phase scope, Budget, Roadmap, Go/No-Go decisions | CTO / Project Lead |

---

## Ownership Rules

1. **One owner per artifact.** No shared ownership. If two offices need to modify an artifact, the owning office approves the change.
2. **Owner is accountable.** If an artifact is wrong, the owner is responsible.
3. **Owner can delegate.** The owning office can ask another office to draft content, but the owner approves it.
4. **No orphaned artifacts.** If an artifact doesn't have an owner, it is not part of the project.

---

## Artifact Ownership Map

| Artifact | Owner | Current Status |
|----------|-------|----------------|
| 00-Coding-Rules.md | Engineering Office | BINDING |
| 01-Engineering-Governance-Manual.md | Architecture Office | DRAFT |
| 02-Product-Definition-Document.md | Product Office | DRAFT |
| 03-Phase-1-Scope.md | Executive Office | DRAFT (not frozen) |
| 04-Build-vs-Buy-Matrix.md | Architecture Office | DRAFT |
| 05-Requirements-Traceability-Matrix.md | Product Office | PROTOTYPE (empty) |
| 06-Success-Metrics.md | Quality Office | DRAFT |
| Evidence Register | Customer Validation Office | Not yet created |
| ADRs | Architecture Office | Not yet created |
| Risk Register | Architecture Office | Not yet created |
| Hypothesis Register | Architecture Office | Carried from EAOS |
| Experiment Register | Engineering Office | Carried from EAOS |
| Technical Debt Register | Engineering Office | Not yet created |
| Customer Interview Notes | Customer Validation Office | Not yet created |

---

## Small Team Adaptation

For Phase 1 with a small team (1-3 people), one person may own multiple offices. The roles consolidate as:

- **Principal Engineer:** Architecture + Engineering + AI + Security (technical roles)
- **Product Manager:** Product + Customer Validation (customer-facing roles)
- **QA/DevOps:** Quality + Operations (delivery roles)
- **Executive:** Executive (always separate — this is the decision-maker)

**When one person owns multiple offices, they must explicitly switch hats.** "I'm reviewing this as Architecture Office" vs "I'm reviewing this as Engineering Office" — the perspectives are different.
