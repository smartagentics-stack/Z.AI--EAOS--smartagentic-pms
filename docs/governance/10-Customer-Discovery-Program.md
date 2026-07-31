# SmartAgentics Customer Discovery Program

**Version:** 1.0
**Status:** READY FOR EXECUTION
**Owner:** Customer Validation Office
**Created:** 2026-07-14
**Directive:** TRB-003, Instruction 1

---

## ⚠️ Execution Requirement

**This document is an instrument, not evidence.** It must be executed by a human (you or your team) interviewing real hotel operators. I cannot interview hotels. The Evidence Register (EV-###) entries can only be created after interviews are conducted.

**Target:** 15-20 hotels. Five reveals themes; 15-20 reveals patterns.

---

## Interview Script

### Introduction (2 minutes)

```
"Hello, I'm [name] with SmartAgentics. We're building hotel management software designed for Nigerian hotels. I'm not here to sell anything today — I want to understand how your hotel operates and what challenges you face. This will take 30-40 minutes. Is that okay?"

[If yes, continue. If no, ask for a better time.]

"Everything you share is confidential. We're using this to make sure we build something that actually solves real problems, not what we think your problems are."
```

### Section 1: Business Profile (5 minutes)

```
1. How many rooms does your hotel have?
2. What type of property is this? (business hotel, leisure, boutique, guesthouse, serviced apartment)
3. How many staff do you have? (front desk, housekeeping, management)
4. What's your typical occupancy rate? (percentage range)
5. What do you currently use to manage reservations and operations?
   - [ ] Paper-based
   - [ ] Excel/spreadsheet
   - [ ] Basic PMS software (which one?)
   - [ ] Enterprise PMS (which one?)
   - [ ] Other: _____
6. How reliable is your internet connection?
   - [ ] Always available
   - [ ] Occasional outages (hours)
   - [ ] Frequent outages (daily)
   - [ ] Very unreliable
7. How reliable is your electricity?
   - [ ] Always available
   - [ ] Occasional outages
   - [ ] Frequent outages (daily)
   - [ ] Very unreliable
8. Do you use a generator? How often?
```

### Section 2: Operational Pain Points (10 minutes)

**Do NOT lead with solutions. Ask about problems.**

```
9. Walk me through a typical check-in. What happens from when a guest arrives to when they get their room key?
10. What about walk-ins — how do you handle guests who arrive without a reservation?
11. How do you handle billing? What happens at check-out?
12. What's the most common mistake that happens at your front desk?
13. How do you coordinate housekeeping? How do you know which rooms are ready?
14. How do you track inventory (room supplies, amenities, F&B)?
15. How do you do accounting? What's the hardest part?
16. What reports do you currently generate? How long does it take?
17. Have you ever experienced revenue leakage or fraud? Can you describe?
```

### Section 3: Technology (5 minutes)

```
18. Do you have a desktop computer at the front desk? Laptop?
19. Do staff use Android phones for work? iPhones?
20. Do you have a local network (LAN) connecting multiple computers?
21. Do you use a printer? What for?
22. Do you have POS/payment devices? Which ones?
23. How do you back up your data currently?
24. What software do you wish worked better?
```

### Section 4: AI Interest (8 minutes)

**Do NOT ask "Do you want AI?"** This leads the customer.

```
25. What repetitive work consumes the most time at your hotel?
26. Which reports take the longest to prepare?
27. What mistakes happen most often?
28. If software could automate one task tomorrow, what would it be?
29. If software could predict one thing about your business, what would you want to know?
30. How do you currently forecast occupancy or revenue?
```

### Section 5: Budget and Willingness to Pay (5 minutes)

```
31. What do you currently pay for software (if anything)? Monthly or annual?
32. If software could solve your biggest problem, what would it be worth per month?
33. Do you prefer monthly subscription or one-time purchase?
34. Would you be willing to be a beta tester for new software? (free or discounted, in exchange for feedback)
```

### Closing (2 minutes)

```
"Thank you for your time. This is incredibly valuable. 

Two questions:
35. Is there anything I should have asked but didn't?
36. Do you know other hotel operators who might be willing to talk to us?

[If yes, ask for introduction/contact]

We'll share what we learn with you before we launch. Thank you."
```

---

## Interview Recording Template

**After each interview, fill this out within 24 hours while memory is fresh.**

```
Interview ID: INT-###
Date: YYYY-MM-DD
Hotel: [name or code]
Interviewer: [name]
Duration: [minutes]

Business Profile:
- Rooms: [number]
- Type: [type]
- Staff: [number]
- Occupancy: [range]
- Current PMS: [system]
- Internet: [reliability]
- Power: [reliability]

Top 3 Pain Points (in customer's words):
1. [verbatim quote]
2. [verbatim quote]
3. [verbatim quote]

Automation Desires (what they'd automate):
1. [verbatim quote]
2. [verbatim quote]

Budget Range: [₦/month]
Willingness to Pay: [High/Medium/Low/None]
Beta Willingness: [Yes/No]

Key Insights:
- [insight 1]
- [insight 2]
- [insight 3]

Evidence Register Entries Created:
- EV-###: [summary]
- EV-###: [summary]

Follow-up Needed:
- [action items]
```

---

## Analysis Framework

After all 15-20 interviews are complete:

### Step 1: Pain Point Frequency
Count how many hotels mentioned each pain point. Rank by frequency.

| Pain Point | Hotels Mentioning | % of Interviews |
|-----------|-------------------|----------------|
| [pain point] | [count] | [%] |

### Step 2: Pain Point Severity
For each pain point, assess severity:
- **Critical:** Hotel loses money or guests because of this
- **High:** Causes significant time/effort
- **Medium:** Annoying but workable
- **Low:** Nice to fix but not urgent

### Step 3: Willingness to Pay Analysis
- How many hotels expressed willingness to pay?
- What price range did they suggest?
- Does the price cover our costs (per Economics Framework)?

### Step 4: Feature Demand
- Which features were requested most?
- Which features are painkillers vs nice-to-haves?
- Cross-reference with our Phase 1 Scope — does customer demand match?

### Step 5: Segment Patterns
- Are there different hotel segments with different needs?
- Should we target a specific segment first?

---

## Exit Criteria

The Customer Discovery Program is complete when:
1. **15-20 interviews conducted** (not 5, not 10)
2. **Pain point frequency table** populated
3. **Evidence Register** contains EV-### entries for each interview
4. **RTM** has at least 10 validated customer needs
5. **PDD** reviewed against evidence — confirmed or revised
6. **Phase 1 Scope** frozen based on evidence (not assumptions)
7. **Economics Framework** populated with real budget/volume numbers

**If customer evidence contradicts the PDD, the PDD is revised, not the customers.**

---

## What I Cannot Do

- I cannot conduct interviews
- I cannot generate fake Evidence Register entries
- I cannot decide which customer needs are real without hearing them

**This program requires human execution.** The instrument is ready. The execution is yours.
