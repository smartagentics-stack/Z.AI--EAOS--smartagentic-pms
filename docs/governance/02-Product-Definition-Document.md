# SmartAgentics AI PMS — Product Definition Document (PDD)

**Version:** 0.1 (DRAFT)
**Status:** PROTOTYPE — pending customer validation (Deliverable 11)
**Created:** 2026-07-14
**Directive:** TRB-001, Deliverable 2

---

## What This Document Is

A PDD answers five questions. That's all. It is not an architecture document, not a feature list, not a roadmap. If a section doesn't answer one of the five questions, it doesn't belong here.

---

## 1. What Exactly Are We Selling?

An offline-first Hotel Property Management System with integrated AI assistant, designed for Nigerian and African hospitality markets where internet connectivity is unreliable.

**The product is:**
- A hotel management application that works without internet
- AI-powered assistance for common hotel operations (reservations, check-in, billing, reporting)
- LAN-syncable across multiple computers in a hotel
- Backed up locally and to cloud when internet is available

**The product is NOT:**
- An enterprise AI platform (that's a future vision, not this product)
- A multi-industry platform (PMS only for Phase 1)
- A SaaS-only product (must work offline)
- A general-purpose AI assistant (AI is embedded in PMS workflows, not standalone)

---

## 2. Who Is Buying It?

**Primary customer:** Independent hotels and small hotel chains (5-50 rooms) in Nigeria and similar markets.

**Characteristics:**
- Currently using paper, Excel, or basic PMS software
- Limited or unreliable internet connectivity
- Budget-conscious (₦50,000-₦500,000/month software budget range)
- Staff with basic computer literacy, not technical
- Owner-operated or small management team

**Secondary customer:** Mid-tier hotels (50-150 rooms) seeking modernization.

**NOT the customer (yet):**
- International hotel chains (different requirements, budget, sales cycle)
- Other industries (hospital, school, retail — these are future modules, not Phase 1)
- Enterprise IT departments (we sell to hotel owners, not IT)

---

## 3. What Problems Are We Solving?

### Problem 1: Software stops working when internet goes down
**Current state:** Cloud-based PMS software becomes unusable during internet outages, which are common.
**Our solution:** Offline-first architecture; PMS functions fully without internet.

### Problem 2: Hotel operations are manual and error-prone
**Current state:** Paper-based or Excel-based reservation management leads to overbooking, lost reservations, billing errors.
**Our solution:** Structured PMS workflows with validation, automated conflict detection.

### Problem 3: Reporting is difficult and infrequent
**Current state:** Owners lack visibility into occupancy, revenue, housekeeping status because reporting requires manual compilation.
**Our solution:** Real-time dashboards and automated report generation.

### Problem 4: Staff training is expensive and slow
**Current state:** Complex PMS software requires extensive training; high staff turnover means repeated training costs.
**Our solution:** AI assistant that guides staff through operations in natural language; simpler workflows.

### Problem 5: Software is too expensive for the value delivered
**Current state:** Existing PMS software is either too expensive (international enterprise) or too basic (local solutions).
**Our solution:** Pricing aligned to Nigerian market, with AI capabilities that were previously inaccessible.

---

## 4. Why Will Customers Pay?

### Reason 1: Operational continuity
Hotels lose revenue when they can't check in guests during internet outages. Offline-first means the hotel never stops operating.

### Reason 2: Error reduction
Overbooking costs a hotel the room rate plus reputational damage. Billing errors cost time and customer trust. Structured PMS prevents these.

### Reason 3: AI assistance at accessible price
AI-powered reporting, forecasting, and operational guidance was previously only available to large hotels with IT departments. We make it accessible to independent hotels.

### Reason 4: Simplicity
Staff can use natural language to interact with the system rather than memorizing complex menu structures. Reduces training time and turnover costs.

### Reason 5: Local support and pricing
Naira-denominated pricing, local support, understanding of local market conditions.

---

## 5. What Is NOT Included? (Phase 1)

**Explicitly excluded from Phase 1:**

- Multi-industry modules (hospital, school, retail, etc.)
- Enterprise AI Kernel (18 engines)
- AgentOS
- Multi-agent orchestration
- Knowledge graph / RAG infrastructure
- Process mining / business intelligence
- Marketplace / plugin ecosystem
- Mobile applications (Phase 1 is desktop-first)
- Multiple AI model providers (Phase 1 uses one provider with cost tracking)
- Custom AI model training
- Real-time collaboration features
- API platform for third-party integrations
- White-label customization

**These are Vision or Phase 2+ capabilities.** They are explicitly out of Phase 1 scope to ensure the MVP ships.

---

## Validation Status

**This PDD is a DRAFT.** Before it becomes authoritative, the following must happen:

1. **Customer Validation Program (Deliverable 11):** Interview 5+ potential customers to validate:
   - Is offline-first actually the #1 pain point?
   - Is the budget range accurate?
   - Are the problems ranked correctly?
   - Would they actually pay for this?

2. **Evidence Register (Deliverable 5):** Populate with evidence from customer interviews.

3. **Phase 1 Scope Freeze (Deliverable 3):** Lock scope based on validated PDD.

**Until customer validation is complete, this PDD is a hypothesis, not a product definition.**

---

## Success Criteria for This Document

This PDD is "done" when:
- 5+ customer interviews have been conducted
- At least 3 customers confirm the problems are real and correctly ranked
- At least 2 customers express willingness to pay in the stated range
- Evidence Register contains entries supporting each problem statement
- TRB reviews and approves

**If customer validation contradicts this PDD, the PDD is revised, not the customers.**
