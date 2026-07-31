# SmartAgentics Engineering Economics Framework

**Version:** 0.1 (DRAFT — to be populated with real numbers)
**Owner:** Executive Office (with input from all offices)
**Created:** 2026-07-14
**Directive:** TRB-002 (Engineering Economics)

---

## Purpose

Track the economics of the entire platform, not just AI API costs. This allows prioritization based on value, not just technical interest.

**This expands the AI Economics concept (Deliverable 8) to cover all costs.** AI cost is one line item; this framework covers eight.

---

## Cost Categories

| Category | Description | Measurement Unit | Phase 1 Estimate |
|----------|-------------|-----------------|-----------------|
| **Development effort** | Engineer time to build | Person-hours | TBD |
| **Maintenance effort** | Ongoing engineer time to maintain | Person-hours/month | TBD |
| **Infrastructure cost** | Servers, databases, storage | ₦/month | TBD |
| **AI inference cost** | LLM API calls | ₦/request, ₦/month | TBD (see M-011: <₦50/workflow) |
| **Support cost** | Customer support time | Person-hours/month | TBD |
| **Training cost** | Staff training materials and time | ₦/deployment | TBD |
| **Opportunity cost** | What we're NOT building instead | Person-hours | TBD |
| **Revenue impact** | Revenue generated or saved | ₦/month | TBD |

---

## Value Categories

| Category | Description | Measurement Unit | Phase 1 Target |
|----------|-------------|-----------------|----------------|
| **Direct revenue** | Customer subscription fees | ₦/customer/month | TBD |
| **Cost savings** | Time saved vs paper/Excel | Hours/month/customer | TBD |
| **Error reduction** | Fewer overbooking/billing errors | Errors/month reduction | TBD |
| **Customer retention** | Reduced churn from better operations | Retention % | TBD |

---

## ROI Calculation

For each Phase 1 feature:

```
ROI = (Value over 12 months) / (Development cost + 12 months maintenance)

Decision rule:
- ROI > 3.0: Prioritize
- ROI 1.0 - 3.0: Include if capacity allows
- ROI < 1.0: Defer unless strategic
```

---

## Per-Feature Economics Template

```
Feature: [name]
REQ ID: [from RTM]

Costs:
- Development effort: [hours] × [₦/hour] = [₦]
- Maintenance effort: [hours/month] × [₦/hour] × 12 = [₦/year]
- Infrastructure cost: [₦/month] × 12 = [₦/year]
- AI inference cost: [₦/request] × [requests/month] × 12 = [₦/year]
- Support cost: [hours/month] × [₦/hour] × 12 = [₦/year]

Total 12-month cost: [₦]

Value:
- Direct revenue: [₦/customer/month] × [customers] × 12 = [₦/year]
- Cost savings: [hours/month] × [₦/hour] × [customers] × 12 = [₦/year]
- Error reduction: [errors/month] × [₦/error] × 12 = [₦/year]

Total 12-month value: [₦]

ROI: [value] / [cost] = [ratio]

Decision: [Prioritize | Include if capacity | Defer]
```

---

## Budget Enforcement

### Phase 1 Budget: ₦3.5M (~$2,300 USD)

| Allocation | Amount | % |
|-----------|--------|---|
| Development (person-hours) | TBD | 60% target |
| Infrastructure (12 months) | TBD | 15% target |
| AI inference (12 months) | TBD | 10% target |
| Support/training | TBD | 10% target |
| Contingency | TBD | 5% target |

**If any category exceeds its allocation, the Executive Office must approve a reallocation or scope reduction.**

### AI-Specific Budget (subset of AI inference)

Per M-012 (Success Metrics):
- Budget alerts at 80% and 100% of monthly tenant budget
- Average cost per workflow < ₦50 (M-011)
- If AI costs exceed budget, trigger: caching, model routing to cheaper models, or feature reduction

---

## Tracking

The Executive Office reviews economics:
1. **Before implementation:** Feature must have ROI estimate
2. **During implementation:** Track actual development hours vs estimate
3. **After deployment:** Track actual AI/infrastructure costs vs estimate
4. **Quarterly:** Review all features for ongoing ROI

**Variance > 20% between estimate and actual triggers a review.** If a feature costs 20% more than estimated, either the estimate was wrong (improve estimation) or the implementation is inefficient (improve engineering).

---

## What This Framework Does NOT Do

- Does not track individual developer productivity (that's a management concern, not an economics concern)
- Does not optimize for minimum cost regardless of value (ROI balances both)
- Does not replace the Engineering Review Gate (economics is one input, not the only input)

---

## Phase A Population

This framework is DRAFT until Phase A (Customer Validation) provides:
1. Real customer count estimates (for revenue projections)
2. Real workflow volume estimates (for AI cost projections)
3. Real infrastructure requirements (for infrastructure cost projections)

**Do not fill in estimates without evidence.** "TBD" is honest; guessed numbers are dangerous.
