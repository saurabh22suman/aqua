# Project scope — Aqua

**A configurable operating system for sports and recreation businesses.**

| | |
|---|---|
| Document | Project scope |
| Version | 0.1 (draft) |
| Status | Pre-development |
| First vertical | Swimming academy + pool facility + café |
| First tenant | Aqua Club (reference implementation) |
| Target market | India — sports academies, clubs, gyms, recreation facilities |

---

## 1. What this product is

A multi-tenant SaaS platform where a single codebase serves many sports and recreation businesses, each configured differently through feature entitlements rather than custom code.

**It is not** a sports CRM. Feature parity with existing CRMs is table stakes, not a position. The category is already commoditised — ClubM360 alone advertises eighteen modules at ₹500/month.

**It is** an operational system built around things competitors do badly:

1. **Profit visibility, not just revenue.** Every competitor tracks money coming in. None found tracks it against coach cost. A 4-student batch with a coach on ₹800 a session loses ₹5,600 a month and nobody sees it. **This is the lead differentiator** — see §2.2.
2. **Collections.** Automated dunning, UPI auto-debit, and reconciliation of cash against online. Still valuable, but no longer unique — a gym-market player already claims it (§2.2).
3. **Role-shaped interfaces.** An owner, coach, receptionist, cleaner and parent have almost nothing in common. Every competitor ships them the same dashboard.
4. **Configurability without forking.** One deployment, one schema, per-tenant entitlements. An unusual customer must never mean a code branch.

### 1.1 Positioning statement

> For sports academies and recreation facilities in India that run on registers, spreadsheets and WhatsApp groups, Aqua is an operating system that collects the money, runs the day, and tells the owner what needs attention — configured to each business rather than forced into one template.

### 1.2 The wedge, stated plainly

Launch as **swimming and sports club management**, not as a general sports CRM. Expand outward only after the first vertical is proven:

```
Swimming club → Sports academy → Multi-sport club → Recreation facility
```

---

## 2. Market and competitive context

### 2.1 What competitors have converged on

Every serious Indian player advertises effectively the same set: members, batches, coaches, scheduling, attendance, payments, reporting, multi-location, enquiries, trials, WhatsApp, parent portal, UPI/Razorpay, GST invoices.

Feature completeness is no longer a differentiator. It is the price of entry.

### 2.2 The competitive landscape

**Research note (August 2026).** Most "best sports academy software" listicles are authored by vendors who rank themselves first. Every claim below is a marketing claim until verified in a demo. Sources: vendor sites, comparison articles, Tracxn.

#### Direct — sports academies

| Player | What they claim | Pricing |
|---|---|---|
| **Sportzy** | 400+ academies. Separate parent and coach apps. The incumbent with real distribution | Demo-gated |
| **Sportia** | QR attendance, CRM, coaching library, wearable sync | **₹999/month flat, any size** |
| **spynPRO / AcademyPRO** | WhatsApp reminders and receipts, **staff check-in/out**, expense tracking, digital waivers, branded app option | Custom, 7-day trial |
| **SharePlay Pro** | Android only | **Free up to 20 students** |
| **ClubM360** | 18 modules, facility booking included | ₹500–5,900 slabs + **2% on payments** |

Category reality: roughly ₹999–3,500/month for real use, with the full range ₹999–13,000 depending on athlete count.

#### Adjacent — gym and fitness, likely to expand into this space

GymForce, FitnessForce, Akton, PayLap, Traqade, Gymowl, OkFit, plus global Mindbody and Glofox. **This market is more mature than sports academies and its players are cheaper.** PayLap advertises from roughly ₹3,499 for twelve months. Akton advertises from ₹89 per unit.

#### Three findings that change the plan

**1. The collections wedge is already claimed in the adjacent market.** GymForce markets itself as the only platform built natively for Indian gyms combining UPI auto-debit, WhatsApp Business API and automatic GST invoicing, and claims to be the only one with native UPI auto-debit mandates while competitors require manual reconciliation.

That is almost exactly the wedge this document originally defined. It is not yet clearly present in *sports academies* — but the gap is narrower than assumed, and a gym player moving sideways closes it.

**2. Staff attendance is table stakes, not differentiation.** spynPRO already ships staff check-in and check-out. Building it (§5.10) was still correct — its absence would have been a missing expected feature — but it wins nothing on its own.

**3. Batch profitability appears genuinely unclaimed.** No competitor found surfaces batch revenue net of coach cost. This is downstream of work already scheduled in Phase 3 and is the strongest remaining differentiator. **See §1.2 — this is now the lead.**

#### ClubM360's exploitable weaknesses (still valid)

- **The 2% payment cut.** UPI carries zero MDR. They charge a percentage on rails that cost them nothing.
- **Undifferentiated interface.** Seven metrics at identical visual weight with no indication of what needs action.

### 2.3 Market size — be honest about the ceiling

| Measure | Figure |
|---|---|
| Sports academy companies in India (Tracxn, Jan 2026) | 226, of which 6 funded |
| Total sector funding, ten years | $1.37M |
| India sports coaching market (2025) | ~$254M, 6.85% CAGR |

At ₹3,000 average, 500 tenants is roughly ₹1.8 crore ARR — about $200K. **That is a strong owner-operated business and not a venture-scale one.** Near-zero investment in the sector over a decade suggests investors have reached the same conclusion.

Decide which one is being built. It changes hiring, pricing, and how much is spent acquiring each customer.

### 2.4 Pricing constraint

The competitive ceiling is roughly ₹1,000–3,500/month for most tenants. Every architectural and operational decision is downstream of that number.

**Implications, non-negotiable:**

- No per-seat or per-MAU vendor pricing anywhere in the stack. Students and parents are users; a per-MAU auth vendor would invert margins entirely.
- Infrastructure cost per tenant must sit in the low hundreds of rupees per month.
- Onboarding must be self-service or near-self-service. There is no budget for a two-week implementation per customer.
- Variable costs (WhatsApp, storage, payment fees) must be metered per tenant and either capped by plan or passed through.

### 2.5 Pricing model — revised

**The original slab model is exposed and should not ship as drafted.** It was built to match ClubM360, and ClubM360 turns out not to be the benchmark. A 900-member academy would pay ₹5,900 here against Sportia's ₹999 flat — a six-fold gap on exactly the customers hardest to replace.

Three options, to be decided before Phase 3:

| Option | Shape | Trade-off |
|---|---|---|
| **A — Flat** | One price, ~₹1,499, any size | Simplest sale, directly answers Sportia. Leaves money on large tenants |
| **B — Two tiers** | ₹999 under 150 members, ₹2,499 above | Keeps the small-academy entry point, caps the top-end gap at 2.5x |
| **C — Compressed slabs** | Four bands, ₹999 / ₹1,799 / ₹2,799 / ₹3,999 | Preserves size-based revenue, top band still ~4x Sportia |

**Recommendation: B.** Two numbers are explainable in a sales conversation; twelve are not, and the compressed top band still loses a head-to-head on price.

**Included at every level:** all core modules, facility booking, unlimited staff, unlimited parent and student accounts, **zero platform commission on payments**.

**Metered separately:** WhatsApp above the plan allowance (at cost plus a small margin), SMS, storage above 5 GB.

**Add-ons:** café/POS, advanced analytics, AI copilot — priced once built.

Position on the two things competitors do not offer: **no cut of your fees**, and **profit visibility per batch**.

### 2.6 Unit economics — worked example

A 300-member academy on the ₹2,900 slab:

| Line | Monthly |
|---|---|
| Revenue | ₹2,900 |
| WhatsApp — utility templates, ~1,800 msgs @ ~₹0.15 incl. BSP markup | −₹270 |
| WhatsApp GST (18%) | −₹49 |
| Infrastructure share (compute, DB, storage, egress) | −₹150 |
| Payment gateway (borne by tenant, not us) | ₹0 |
| Support (amortised, ~20 min/month) | −₹250 |
| **Contribution** | **≈ ₹2,180 (75%)** |

**The number that matters:** WhatsApp is the largest variable cost and scales with member count, not with plan price. It must be metered from day one.

Message category discipline is a direct margin lever — marketing templates cost roughly seven to eight times what utility templates cost. Every automated message the product sends (fee due, session reminder, attendance alert, receipt) must be classified and approved as a **utility** template. Marketing templates are used only for explicit campaigns the tenant initiates and pays for.

---

## 3. Users and roles

### 3.1 Platform roles (our company)

| Role | Purpose |
|---|---|
| Platform owner | Full access, billing, plan definition |
| Platform admin | Tenant provisioning, feature entitlements, configuration |
| Support agent | Read access, scoped tenant impersonation, audit trail |

### 3.2 Tenant roles

| Role | Primary job | Device |
|---|---|---|
| Owner | Money in, money out, is the business healthy | Phone, occasionally desktop |
| Admin / manager | Runs the operation day to day | Desktop + phone |
| Receptionist / front desk | Enquiries, walk-ins, fee collection, bookings | Desktop, high frequency |
| Coach / instructor | Attendance, assessments, session notes | Phone, poolside, one-handed |
| Accountant | Invoices, reconciliation, GST, reports | Desktop |
| Worker / ground staff | Task list, maintenance log | Phone, minimal |
| Student / member | Schedule, dues, progress | Phone / WhatsApp |
| Parent / guardian | Their child's schedule, dues, progress | **WhatsApp primarily** |
| Walk-in customer | Book a slot, pay | Web link, no account |

Roles are not hard-coded. They are named bundles of permissions, editable per tenant, with module access and location access as separate axes.

### 3.3 The parent assumption

**Parents will not install an app.** This is designed for, not worked around. Parents receive a WhatsApp message containing a signed magic link that opens a single server-rendered page. No login, no install, no bundle. Any feature that requires a parent to have an account is a feature that will not get used.

---

## 4. Scope by layer

### 4.1 Layer 1 — Platform / control plane (ours)

Tenant provisioning, plan and feature catalogue, per-tenant entitlement overrides, usage metering, subscription billing, support impersonation, system health, announcements, feature rollout and beta gating.

### 4.2 Layer 2 — Tenant application (what the customer buys)

Reached at `app.aqua.in/{tenant-slug}`, later at a custom domain. Carries the tenant's logo, colours, terminology, branch structure and enabled modules.

### 4.3 Layer 3 — Role experiences

Distinct entry surfaces per role, sharing components but not layouts. An owner opening the app sees money and exceptions. A coach opening the app sees today's sessions and a register. A worker sees a task list and nothing else.

### 4.4 Layer 4 — Vertical modules

Sport- or business-specific depth that sits on top of the core engine: swimming, football, badminton, gym, dance, café. Each is a set of entities, screens and rules gated behind feature entitlements.

### 4.5 Layer 5 — Intelligence

Operational analytics, then a data-grounded copilot that answers questions against the tenant's own records. Deferred until the schema is stable and there is real data in it.

---

## 5. Functional scope

Legend: **P1** Phase 1 · **P2** Phase 2 · **P3** Phase 3 · **P4** Phase 4 · **P5** Phase 5 · **L** later · **✕** out of scope

### 5.1 Platform foundation

| Capability | Phase |
|---|---|
| Tenant creation, slug, status lifecycle | P1 |
| Branch / location hierarchy | P1 |
| User accounts, invitations, phone-based OTP login | P1 |
| Roles, permissions, module access, location scoping | P1 |
| Feature registry, plan features, tenant overrides | P1 |
| Per-feature configuration (JSON, developer-defined keys) | P1 |
| Tenant branding — logo, mark, club name | P1 — see §5.17 |
| Terminology overrides — vocabulary per tenant | P1 — see §5.17 |
| Constrained accent colour, six approved values, runtime token | P1 — see §5.17 |
| Audit log across all mutations | P1 |
| Settings, business hours, holidays, closures | P1 |
| Soft delete and restore | P1 |
| Custom fields on core entities | P4 |
| Multi-language (Hindi, Bengali) | P4 |
| Custom domain per tenant | L |

### 5.2 People

| Capability | Phase |
|---|---|
| Person record — unified base for all humans | P2 |
| Student / member profiles | P2 |
| Guardian linkage, one guardian to many children | P2 |
| Staff records — coaches, receptionists, workers | P2 |
| Emergency contacts, medical notes, consent flags | P2 |
| Document upload — ID, photo, medical certificate | P2 |
| Member status lifecycle — trial, active, paused, lapsed, left | P2 |
| Bulk import from Excel / CSV with column mapping and dry run | P2 |
| Digital ID card / QR | P3 |
| Staff attendance, shifts, leave and pay | P3 — see §5.10 |
| Statutory payroll filing (PF, ESI, TDS, Form 16) | ✕ |

### 5.3 Growth — enquiries and conversion

| Capability | Phase |
|---|---|
| Enquiry capture — walk-in, phone, web form | P2 |
| Lead pipeline with stages and owner | P2 |
| Follow-up tasks with due dates and reminders | P2 |
| Trial session booking and outcome | P2 |
| Conversion to member | P2 |
| Source attribution and conversion reporting | P2 |
| Referral tracking | P4 |
| Public self-registration page per tenant | P3 |
| WhatsApp and email campaigns | P5 |
| Discount codes and offers | P5 |

### 5.4 Programs and scheduling

| Capability | Phase |
|---|---|
| Sports / activity types | P2 |
| Programs — a sellable offering | P2 |
| Batches with capacity, days, time, coach, venue | P2 |
| Session generation from batch recurrence | P2 |
| Session cancellation, rescheduling, substitution | P2 |
| Coach assignment and availability conflicts | P2 |
| Compensatory / makeup sessions | P3 |
| Batch transfer for a member | P3 |
| Waitlists | P4 |
| Tournaments and fixtures | ✕ |

### 5.5 Attendance

| Capability | Phase |
|---|---|
| Session register, mark present / absent / late | P2 |
| **Offline marking with sync on reconnect** | P2 |
| Attendance history per member | P2 |
| Absence streak detection and alerts | P3 |
| Self check-in via QR | P3 |
| Coach self-attendance | P3 |
| Biometric / turnstile integration | L |

### 5.6 Memberships and money

| Capability | Phase |
|---|---|
| Membership plans — duration, session-count, one-time | P2 |
| Subscriptions with start, end, pause, resume | P2 |
| Invoice generation, GST-compliant numbering | P2 |
| Payment recording — **cash, UPI, bank transfer, online** | P2 |
| Razorpay payment links | P2 |
| Webhook handling with idempotency | P2 |
| Partial payments and outstanding balance | P2 |
| Automated dunning ladder — reminders at set intervals | P3 |
| **UPI auto-debit / e-mandate for recurring fees** | P3 |
| **Pre-debit notification before every auto-debit** | P3 — regulatory, see §7.3 |
| **Mandate opt-out and cancellation handling** | P3 |
| Refunds and credit notes | P3 |
| Daily collection summary and cash reconciliation | P2 |
| Expenses and petty cash | P5 |
| Tally / Zoho Books export | P5 |

### 5.7 Facilities and bookings

| Capability | Phase |
|---|---|
| Venue and facility definition — pool, court, turf | P3 |
| Lanes and sub-resources | P3 |
| Bookable slots with capacity and pricing | P3 |
| Booking by staff on behalf of a customer | P3 |
| Public booking page with payment | P3 |
| Cancellation window and policy | P3 |
| Maintenance windows and closures | P3 |
| Utilisation reporting | P3 |
| Recurring / block bookings | P4 |
| Equipment and locker allocation | L |

### 5.8 Swimming vertical

| Capability | Phase |
|---|---|
| Skill levels and progression ladder | P3 |
| Skill assessment against a rubric | P3 |
| Coach observations per session | P3 |
| Swimmer profile with progress history | P3 |
| Lane allocation within a batch | P3 |
| Pool chemistry log — chlorine, pH | P3 |
| Incident and safety log | P3 |
| Progress certificate generation | P4 |
| Timing and split records | L |

### 5.9 Communications

| Capability | Phase |
|---|---|
| WhatsApp utility templates — fee due, receipt, reminder, cancellation | P2 |
| Template registry and approval tracking | P2 |
| **Per-tenant message metering and quota** | P2 |
| Magic-link parent pages | P2 |
| Email fallback | P2 |
| In-app notification centre | P4 |
| Announcements and broadcast | P4 |
| Two-way WhatsApp inbox | L |

### 5.10 Staff attendance, shifts and pay

The largest expense line in an academy, and the reason the owner dashboard can show profit rather than only revenue.

**Why this is cheap for us and expensive for competitors:** the system already records which sessions were held, who coached them, and who substituted. Session-based coach pay is derived from data that exists rather than entered by hand.

#### Staff attendance

| Capability | Phase |
|---|---|
| Staff self check-in and check-out | P3 |
| Check-in via QR at the premises, or geofenced | P3 |
| Manual entry and correction by an admin, always audited | P3 |
| Late arrival and early departure flags against shift | P3 |
| Absence marking with reason | P3 |
| Monthly staff attendance summary | P3 |
| Coach's own session attendance derived from sessions held | P3 |
| Biometric device integration | L |

#### Shifts and leave

| Capability | Phase |
|---|---|
| Shift templates and weekly roster | P3 |
| Roster publication to staff | P3 |
| Leave types with balances — casual, sick, unpaid | P3 |
| Leave request, approval, rejection | P3 |
| Leave impact on the roster and on batch coverage | P3 |
| Substitution assignment when a coach is absent | P3 |
| Holiday calendar per location | P1 |
| Shift swap between staff | P5 |
| Overtime rules | P5 |

#### Compensation

| Capability | Phase |
|---|---|
| Pay rules per staff member — monthly, per session, per hour, per head | P3 |
| Multiple rules on one person (a coach on a retainer plus per-session top-up) | P3 |
| Rate variation by program or batch | P3 |
| **Automatic computation of session-based pay from sessions actually held** | P3 |
| Substitution credited to whoever actually took the session | P3 |
| Attendance-linked deduction for monthly staff | P3 |
| **Advances and salary loans with repayment schedule** | P3 |
| Bonus and incentive as ad-hoc lines | P3 |
| Draft payout sheet per month, per location | P3 |
| Review, adjust, approve, lock | P3 |
| Payout recording — cash, bank transfer, UPI | P3 |
| Payslip generation as PDF, shareable on WhatsApp | P3 |
| Payout history per staff member | P3 |
| Bulk bank transfer file export (NEFT/RTGS format) | P5 |
| Statutory deductions and filings | ✕ — see below |

#### Explicitly not built

Statutory payroll — PF, ESI, professional tax, TDS computation, Form 16, quarterly returns — stays out of scope. It is a compliance product with its own liability, most tenants at this size operate below the thresholds that make it mandatory, and getting it wrong creates legal exposure for the customer.

**Instead:** a clean export of gross earnings per staff member per month, formatted for import into Zoho Payroll, RazorpayX Payroll, or the tenant's accountant's spreadsheet. If a tenant grows past the threshold, they use a real payroll product and we hand it the numbers.

#### Access control

Compensation data is the most sensitive information in the tenant. It gets its own permissions, separate from general staff management:

- `staff.read` — see the staff list and contact details
- `staff.attendance` — mark and view staff attendance
- `staff.roster` — build and publish shifts
- `staff.pay.read` — see pay rules and payout amounts
- `staff.pay.write` — set rates, approve payouts

A receptionist who can mark staff attendance must not be able to see what the head coach earns. Every view of pay data is written to the audit log, including reads.

### 5.11 Operations

| Capability | Phase |
|---|---|
| Task assignment to staff | P3 |
| Maintenance schedule and log | P3 |
| Worker daily task view | P3 |
| Checklists | P5 |
| Asset register | L |

### 5.12 Café and commerce

**Member account charging is in MVP scope (Phase 2). Full café POS is not, and stays Phase 5.**

A parent's child buys something at the café; staff charge it to the member account; it appears as a line item on the member's next invoice. One screen, a charges table, an invoice line. It reuses the billing infrastructure (C-28 money primitives, C-32 invoices) rather than standing up a parallel system — this is a billing feature that happens to originate at a café counter, not a commerce module.

Full POS — menu, modifiers, inventory, tables, thermal printing, shift-end cash reconciliation — stays Phase 5, deliberately. Reasons:

1. **Offline-first is mandatory there and higher-stakes than attendance.** A dropped attendance mark is invisible until someone checks; a dropped café order loses money with a customer standing at the counter waiting for their change. That is a harder offline problem than the one this session just spent a full TDD cycle closing for attendance, not an easier one.
2. **It requires hardware integration** — thermal printers, cash drawers, possibly card readers — which member charging does not.
3. **The market has specialists** (café/restaurant POS vendors) we will not beat on POS features. Member-account charging is not a POS feature; it is a billing feature, and billing is the wedge (§1).

| Capability | Phase |
|---|---|
| **Charge to member account — staff find member, add a charge, it lands on the next invoice** | **P2** |
| Menu and product catalogue | P5 |
| POS order entry, **offline-capable** | P5 |
| Table and counter management | P5 |
| Payment against member account or direct | P5 |
| Inventory with stock levels and thresholds | P5 |
| Daily sales and expense reporting | P5 |
| Kitchen display / thermal printing | L |
| Supplier and purchase orders | L |

**Open decisions, not made here:**

1. Does a charge require the member to be present and identified (e.g. a QR/ID scan), or can staff charge from a name search alone? Affects both fraud surface and how fast the staff screen needs to be at a counter with a queue.
2. What happens to unbilled charges when a member leaves (C-08 lifecycle)? Silently written off, blocks the leave transition until settled, or converted to a one-off final invoice?
3. Is there a credit limit per member, and if so, is it a hard block or a warning to staff?

### 5.13 Reporting

| Capability | Phase |
|---|---|
| Owner dashboard — collections, dues, members, attendance, utilisation | P2 |
| Revenue by program, batch, month | P3 |
| **Staff cost by batch, program and location** | P3 |
| **Batch profitability — revenue minus coach cost** | P3 |
| **Monthly profit and loss — collections minus staff cost; expense lines join in Phase 5 (§5.6)** | P3 |
| Attendance and retention reports | P3 |
| Enquiry funnel and conversion | P3 |
| Coach load, utilisation and cost per session | P3 |
| Staff attendance and leave summary | P3 |
| Scheduled email reports | P4 |
| CSV export of any report | P3 |
| Custom report builder | ✕ |

### 5.14 Intelligence

| Capability | Phase |
|---|---|
| Churn risk scoring on attendance and payment signals | P6 |
| Renewal likelihood | P6 |
| Natural-language querying over tenant data | P6 |
| Recommended actions on the owner dashboard | P6 |

### 5.15 Automation

| Capability | Phase |
|---|---|
| Developer-defined rules with admin-configurable thresholds | P3 |
| Example: membership expiring in N days → WhatsApp reminder | P3 |
| Example: attendance below N% → notify coach and guardian | P3 |
| Example: inventory below threshold → create task | P5 |
| **Visual workflow builder** | ✕ for v1 — see §9 |

### 5.16 Onboarding presets

A preset is a named starting configuration a new tenant picks during signup: *"I'm a swimming academy."* Applying it turns on the right modules, sets the vocabulary, and seeds enough starting data that the club can begin working the same day rather than facing an empty product with forty settings.

**Why this matters more than it sounds.** Onboarding friction is listed in §11 as a high-likelihood, high-impact risk, and at this ARPU there is no budget for a guided implementation per customer. A preset is the cheapest possible substitute for a human onboarding a customer — it is seed data and an entitlement set, not new code.

#### The presets

| Preset | Modules enabled | Terminology | Seeded on day one |
|---|---|---|---|
| Swimming academy | Batches, attendance, fees, pool booking, skill levels, facility logs | swimmer, batch, lane, coach | Beginner → Intermediate → Advanced levels; freestyle, backstroke, breaststroke, breathing skills with rubrics; monthly and quarterly plan shapes; pool facility with lanes; chemistry log template |
| Football academy | Batches, attendance, fees, turf booking | player, squad, ground, coach | Age groups U8/U10/U12/U14/U16; position field; term-based plan shapes; turf facility |
| Badminton / racquet club | Court booking, memberships, attendance, fees | member, court, coach | Court facility with numbered courts; hourly slot template; peak and off-peak pricing shapes; monthly membership |
| Gym / fitness studio | Memberships, attendance, class schedule, fees | member, class, trainer | Monthly, quarterly, annual plan shapes; class capacity defaults; trainer role |
| Dance / martial arts studio | Batches, attendance, fees, levels | student, batch, instructor | Belt or grade ladder; assessment rubric skeleton; monthly plan shapes |
| Multi-sport club | All program modules, multiple facilities | member, program, coach | Empty programs with a prompt to add sports; generic membership shapes |
| Start from scratch | Core only | member, batch, coach | Nothing. For anyone who wants to build it themselves |

#### What a preset sets

| Layer | Applied |
|---|---|
| Feature entitlements | The module set for that business type |
| Terminology | The `terminology` map on the tenant |
| Roles | Role templates with sensible permissions for that vertical |
| Programs | One or more starter programs |
| Skill ladder | Levels, skills and rubrics where the vertical has them |
| Membership plan **shapes** | Names and durations — **never prices** |
| Facilities | Pool with lanes, courts, turf, studio as applicable |
| Batch scaffolding | A couple of example batches the owner edits or deletes |
| Message templates | The utility templates that vertical actually needs |
| Dashboard layout | Which cards the owner sees first |

#### Rules

These are what keep presets from quietly becoming per-customer forks.

1. **Applied once, then forgotten.** A preset is a starting state, not a live link. Editing a preset later must never mutate an existing tenant. Presets are versioned, and the applied version is recorded for analytics only.
2. **Everything a preset does is doable by hand.** A preset is a shortcut, never a capability. If a preset can create something the UI cannot, that is a bug.
3. **Reversible during onboarding.** Switching preset before finishing setup discards and re-seeds. After the first real member is created, it is locked — a change is manual from then on.
4. **No prices are seeded.** Plan *shapes* only — "Monthly, 30 days" with the amount blank and required. A seeded ₹3,000 that a club forgets to change becomes a support ticket and a billing dispute.
5. **Seeded data is clearly marked and bulk-deletable.** Example batches carry an "example" flag and a one-tap "remove sample data" action.
6. **Presets are data, not code.** A new vertical is a new preset definition, reviewed and merged. It is never a branch, a flag in application logic, or a special case.

#### Not in scope

Tenants cannot create, save or share their own presets. Presets are authored by us. A tenant-authored preset library is a marketplace feature and belongs nowhere near v1.

#### Phase

**P4**, as part of self-service onboarding. Until then, tenants are provisioned by us with a seed script — which is the same mechanism without a UI on top, so the preset definitions should be written in Phase 1 and used internally from the first tenant onward.

### 5.17 Branding and vocabulary

The cheapest personalisation in the product, and close to all of the personalisation worth having. A club's logo on the parent page and its own words in the interface deliver most of the "this is ours" feeling. Theming does not, and costs far more.

#### Logo and mark

| Item | Detail |
|---|---|
| Wordmark | Horizontal logo for app headers, login, and document letterheads |
| Square mark | For avatars, favicon, WhatsApp header images, narrow layouts |
| Formats | SVG preferred, PNG accepted. Transparent background required |
| Limits | 500 KB, minimum 512 px on the long edge |
| Fallback | Initials mark generated from the club name in the tenant's accent — every tenant has a mark from minute one, whether they upload one or not |

**Where it appears — this list is the actual deliverable:**

| Surface | Why it matters |
|---|---|
| App header, all roles | Daily reinforcement for staff |
| Login screen | First impression, and reassurance they are in the right place |
| **Parent magic-link pages** | **The highest-value surface.** Parents have never heard of us — to them, this page *is* the club |
| Invoice and receipt PDFs | Goes to parents, often forwarded, sometimes to an accountant |
| Payslip PDFs | Goes to staff |
| WhatsApp template header images | Where the template category supports it |
| Public booking and self-registration pages | Facing people who are not yet customers |

#### Vocabulary

Every club calls its people something different — swimmer, player, student, member, trainee. The wrong word makes software feel like it was built for somebody else.

Overridable terms are a **closed set** defined by us, never free-form:

`member` · `batch` · `coach` · `session` · `program` · `facility` · `guardian` · `enquiry`

Each override supplies singular and plural forms explicitly. This is not find-and-replace on rendered strings — see the architecture document for why that distinction matters more than it appears to.

Defaults arrive from the onboarding preset (§5.16) and are editable afterwards in settings.

#### Accent colour — constrained, not free

**Six pre-validated accent colours. Not a colour picker.**

```
Mango (default) · Marine · Indigo · Plum · Forest · Slate
```

Each is contrast-tested against the surfaces and guaranteed not to collide with the semantic palette. The tenant picks a hue; the system generates the ramp.

**Locked regardless of choice, non-negotiable:**

- Green stays paid and present. Red stays overdue and absent. Amber stays needs-attention. The design thesis is that colour means money and attendance state — a free picker destroys it. A club that picks red would have red meaning both "our brand" and "this member has not paid"
- Surfaces stay the neutral deck. No coloured page backgrounds
- Typography, spacing, radii and shadows never vary
- **Layouts never vary.** Per-tenant layouts are precisely the fork the entitlement architecture exists to avoid

#### Explicitly not offered

| Not offered | Why |
|---|---|
| Free colour picker | Breaks the semantic palette, and makes the product look worse while carrying our name |
| Custom fonts | Typography is the identity; also a bundle and licensing problem |
| Per-tenant layouts or custom screens | A fork by another name |
| Tenant-uploaded CSS | Unsupportable, unversionable, a security surface |
| Dark mode selection | Deferred product-wide; users are outdoors in daylight |
| Fully white-labelled apps with no mention of us | Revisit only if a tenant asks and will pay for it |

**Testing cost is the reason for the constraint.** Every theme is a theme to QA forever — contrast on every control, focus rings, status pills, charts, PDFs, the parent page. Six accents is a testable matrix. Infinite accents is not, for a two-person team at this ARPU.

---

## 6. Non-functional requirements

### 6.1 Performance budget — enforced in CI

| Metric | Target |
|---|---|
| First-load JS, gzipped | < 150 KB |
| Largest Contentful Paint, 4G, mid-tier Android | < 2.5 s |
| Time to Interactive, same conditions | < 3.5 s |
| API p95 response | < 300 ms |
| Attendance mark → visible feedback | < 100 ms (optimistic) |
| Lighthouse performance, mobile | > 90 |

A build that exceeds the JS budget fails. This is the only defence against gradual bloat.

### 6.2 Offline behaviour

| Surface | Requirement |
|---|---|
| Attendance marking | Full offline queue, sync on reconnect, conflict resolution last-write-wins per session |
| Café POS | Full offline (Phase 5) |
| Everything else | Graceful degradation with a clear offline banner |

### 6.3 Availability and data

- Target uptime 99.5% (roughly 3.6 hours downtime/month allowance — honest for a small team, do not promise four nines)
- Automated daily backups, 30-day retention, **restore tested quarterly**
- Point-in-time recovery on the primary database
- Tenant data export on demand in open formats

### 6.4 Accessibility and device support

- Android 9+, iOS 15+, Chrome and Safari current minus two
- Minimum touch target 44 × 44 px
- Base font 16 px on all inputs (prevents iOS zoom-on-focus)
- Visible keyboard focus, `prefers-reduced-motion` respected
- Colour never the sole carrier of meaning — status always has a label or icon
- Legible in direct sunlight: high contrast, no low-opacity greys on white

### 6.5 Localisation

- English at launch
- Hindi and Bengali by Phase 4
- Per-tenant terminology overrides from Phase 1 — "student" vs "member" vs "player" vs "swimmer" is a configuration value, not a hard-coded string
- All currency in INR, `en-IN` formatting, IST display with UTC storage

---

## 7. Compliance and legal

### 7.1 DPDP Act — children's data

**This is the most under-considered risk in the category and a genuine sales asset.**

The product will hold names, photographs, attendance patterns, medical notes and progress records for a population that is majority minors. India's Digital Personal Data Protection Act imposes specific obligations for children's data, including verifiable parental consent and restrictions on tracking and targeted advertising directed at children.

**Requirements:**

| Requirement | Phase |
|---|---|
| Date of birth captured, minor status derived automatically | P2 |
| Guardian relationship recorded and required for minors | P2 |
| Consent capture at registration, versioned, timestamped, with audit trail | P2 |
| Consent withdrawal mechanism | P3 |
| Data export on request | P3 |
| Deletion / erasure workflow with retention exceptions documented | P3 |
| No behavioural tracking or ad pixels on any parent- or student-facing surface — **ever** | P1 |
| Privacy policy and data processing terms per tenant | P2 |
| Breach notification runbook | P3 |

**Withdrawal is per-purpose**, scoped to `consents.purpose` — never a single global action:

| Purpose withdrawn | Consequence |
|---|---|
| Communications | Suppressible messages stop: attendance alerts, progress notes, announcements, campaigns. Membership continues |
| Photography | Existing media deleted, future upload blocked. Membership continues |
| Processing | The academy cannot lawfully record attendance or assessments for that child — membership cannot continue as normal. Undesigned; see open question 7 and task V-45a |

**Why some messages survive a communications withdrawal:** fee reminders and receipts are addressed to the guardian regarding their own contractual obligation to the academy — they concern the guardian's data and obligations, not the processing of the child's personal data. Pre-debit notices are separately mandated by the RBI e-mandate framework regardless of consent state. Attendance alerts, progress notes and announcements exist only because we hold communications consent for the child; they end with it. The reasoning is written down deliberately — without it, someone will simplify this incorrectly later.

Every tenant is a data fiduciary; we are a processor. The data processing agreement is part of onboarding, not an afterthought.

### 7.2 Tax and invoicing

- GST-compliant invoice numbering — sequential, per financial year, per branch, gapless
- Tenant GSTIN captured and printed
- HSN/SAC codes on line items
- Credit notes properly linked to original invoices
- E-invoicing applies only above turnover thresholds; most tenants will fall below, but the invoice model must not preclude it

### 7.3 Payments

- No card data ever touches our systems — Razorpay hosted flows only
- Settlement reconciliation reporting
- Refund policy surfaced to the payer before payment
- **We take zero commission on tenant payment volume.** This is a positioning commitment and should be stated in the pricing page.

#### Recurring mandates — RBI framework

Fee sizes here sit comfortably inside the favourable band: recurring auto-debits up to ₹15,000 per transaction clear without additional authentication once the mandate is registered. Academy fees of ₹2,000–5,000 will never approach that ceiling.

**But the mandate framework carries an obligation with a product consequence:**

| Requirement | Consequence |
|---|---|
| One-time mandate authentication via OTP or UPI PIN | Onboarding friction at subscription creation |
| **Advance pre-debit notification before every charge** | **A monthly moment where every customer is reminded they can cancel** |
| Customer may opt out of an individual debit or revoke the mandate at any time | Churn surface, not just compliance |
| No charge to the customer for using the facility | |

Sources disagree on the notification window — 24 hours in some, 72 in others. **Verify against Razorpay's current documentation before building.** The gateway handles the mechanics; what it cannot handle is the retention consequence.

**Design implication:** the pre-debit notice is a monthly touchpoint with every paying parent. Treat it as a product surface, not a compliance email. It should carry the club's branding, state what the fee covers, and ideally show something of value — attendance that month, a progress note. A bare "we will debit ₹3,000 tomorrow" is an invitation to cancel.

### 7.4 Content and safety

- Photographs of minors: upload restricted by role, no public URLs, signed time-limited links only
- No public directory of members
- Staff access to student records scoped by branch and batch

---

## 8. Design scope

The visual direction is defined in the accompanying UI direction file. Scope commitments:

| Item | Commitment |
|---|---|
| Design tokens | Single source of truth in Tailwind config, no ad-hoc hex values |
| Palette | Deck / marine / water / mango. Mango is actions only, water is data, green and red are payment and attendance state |
| Type | Bricolage Grotesque display, Instrument Sans body, self-hosted and subset, 45 KB total |
| Components | shadcn/ui copy-paste. **No component library dependency** |
| Icons | Lucide, individually imported. Never a barrel import, never emoji |
| Shadows | Exactly two levels, defined once |
| Radii | 20 px cards, 14 px controls, full pill buttons |
| Dark mode | Deferred — users are outdoors in daylight |
| Empty states | Every list has a designed empty state with a verb CTA, built with the list, not after |
| Loading | Skeletons, never spinners |
| Signature | The lane strip, reused across owner, coach and parent surfaces |

Design rules live in `DESIGN.md` at the repo root and are referenced in every AI code-generation prompt. Without this the generated UI drifts back to shadowed blue cards within a week.

---

## 9. Explicitly out of scope

Naming these prevents the most common failure mode — building a platform instead of a product.

| Not building | Why |
|---|---|
| Visual workflow builder | Configuration in v1 is developer-defined with admin-set thresholds. A rules engine is a product of its own |
| Custom page or form builder | Same |
| Database / schema builder | Same |
| Microservices | Wrong economics at this ARPU. A monolith serves this load for years |
| Database-per-tenant | Unnecessary complexity at MVP scale. Shared schema with row-level isolation |
| Native mobile apps at launch | PWA first. Native only if offline attendance or POS demands it |
| Tournament and fixture management | Not needed by the first vertical |
| Statutory payroll filing (PF, ESI, TDS, Form 16) | Compliance product with real legal liability. Most tenants sit below the thresholds. We export gross earnings for a real payroll tool instead. **Staff attendance, shifts and payout computation are in scope** — see §5.10 |
| Marketplace / member discovery | Different product |
| Our own payment rails | Never |
| Video and content delivery | Not the job |

---

## 10. Phases

Timelines assume a small team (one to two developers using AI assistance) working consistently. They are deliberately less optimistic than a feature list suggests, because payments, WhatsApp and multi-tenancy each consume more time than they appear to.

### Phase 0 — Discovery
**2 weeks · no code**

Shadow the reference business end to end. Document how customers arrive, how enquiries are handled, how batches are managed, how attendance is actually recorded, how fees are collected including cash, how pool bookings happen, what goes into registers and WhatsApp groups, and what happens when someone does not pay.

**Deliverables:** current-state process map, list of every artefact currently in use (registers, spreadsheets, WhatsApp groups), the real fee structure with every exception, data inventory for migration.

**Exit criteria:** you can describe a full month of the business without asking a question.

---

### Phase 1 — Platform foundation
**5–6 weeks**

Tenancy, identity, authorisation, entitlements, audit. The reusable engine.

**Scope:** tenant and branch model, RLS-enforced isolation, phone OTP authentication, roles and permissions, feature registry with plan and tenant-override resolution, tenant branding and terminology, settings, audit log, soft delete, design system and app shell, CI with performance budget.

**Deliverables:** a deployable application where a platform admin can create a tenant, invite an owner, toggle features, and where the owner sees only their own data.

**Exit criteria:** two tenants exist in the same database and it is provably impossible for one to read the other's rows, verified by an automated test that attempts it.

---

### Phase 2 — Operating core
**8–10 weeks**

The part the customer actually pays for.

**Scope:** people and guardians, enquiries and follow-ups, programs, batches, session generation, attendance with offline sync, membership plans and subscriptions, invoicing, payment recording for cash and online, **member account charging** (§5.12 — the café line item, not the POS), Razorpay integration with idempotent webhooks, WhatsApp utility templates with per-tenant metering, magic-link parent pages, owner dashboard, Excel importer, consent capture.

**Deliverables:** a business can run its full monthly cycle in the product.

**Exit criteria:** the reference business records one complete month — enquiries through to collected fees — without falling back to the register.

---

### Phase 3 — Swimming vertical, staff pay and go-live
**7–8 weeks**

**Scope:** facilities, lanes, bookable slots, public booking page, closures and maintenance, skill levels and assessments, coach observations, progress history, pool chemistry and incident logs, automated dunning ladder, UPI auto-debit, absence alerts, QR self check-in, public self-registration.

**Plus staff attendance and pay:** staff check-in, shift roster, leave with balances, substitution handling, pay rules, session-based payout computation, advances, monthly payout sheet with approval, payslips.

**Plus the reporting suite,** now including batch profitability and monthly P&L — which only becomes possible once staff cost exists.

**Deliverables:** first tenant fully live, running the business in production, registers retired.

**Exit criteria:** the owner would be materially inconvenienced if the product disappeared. That is the only meaningful definition of live.

---

### Phase 4 — Multi-tenant readiness
**5–6 weeks**

Deliberately placed **before** café. Tenants two through ten matter more to the business than a second module for tenant one.

**Scope:** platform control plane (tenant provisioning, feature catalogue, plan management), self-service onboarding wizard **built on the preset definitions from §5.16**, usage metering and quota enforcement, subscription billing for our own SaaS fees, support impersonation with full audit, custom fields, multi-language, referrals, waitlists, in-app notifications, scheduled reports, certificates.

**Deliverables:** a new tenant can be onboarded without a developer.

**Exit criteria:** three to five paying tenants live, at least one onboarded end to end without engineering involvement.

---

### Phase 5 — Commerce and operations depth
**6–8 weeks**

**Scope:** café menu, offline-capable POS, table management, inventory with thresholds, payment against member accounts, expenses, staff shifts and leave, checklists, campaigns, discount codes, accounting export.

**Note:** offline-first POS is a genuinely different engineering problem — local persistence, sync conflict resolution, and eventually hardware. Do not treat it as another CRUD module.

---

### Phase 6 — Intelligence
**Ongoing, after data accumulates**

Churn and renewal risk scoring, natural-language querying grounded in tenant data, recommended actions surfaced in context on the owner dashboard rather than as a separate chatbot page.

The value here comes from the data model, not the model. It is not a moat on its own and should not be pulled forward.

---

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Cross-tenant data leak | Low | **Fatal** | RLS at database level, mandatory scoped accessor, lint rule, automated isolation test in CI |
| Distribution — no channel to reach customers 2–50 | **High** | **Critical** | **Sportzy claims 400+ academies; we have zero.** Nothing in this plan addresses distribution. Needs its own document and an owner before Phase 3 ends |
| Differentiation erodes — a gym-market player moves sideways | **High** | High | GymForce already claims UPI auto-debit plus WhatsApp plus GST in the gym market (§2.2). Lead on batch profitability, which nobody claims |
| Price war — Sportia at ₹999 flat, SharePlay free under 20 | High | High | Revised pricing (§2.5). Compete on profit visibility and zero commission, never on headline price |
| Market ceiling lower than hoped | Medium | Medium | 226 academy companies, $254M coaching market. Plan as an owner-operated business unless evidence says otherwise (§2.3) |
| Mandate pre-debit notice drives cancellations | Medium | Medium | Treat the notice as a branded value touchpoint, not a compliance email (§7.3) |
| Onboarding friction — migrating from registers and Excel | High | High | Importer as a first-class feature in Phase 2, not a script. Onboarding presets (§5.16) so a new tenant starts with a working configuration rather than an empty product |
| WhatsApp cost overrun | Medium | Medium | Utility templates only, per-tenant metering from Phase 2, quota enforcement in Phase 4 |
| Scope creep into no-code platform | **High** | High | §9 exists specifically to prevent this. Re-read it before each phase |
| Café becoming a second product | Medium | High | Deferred to Phase 5, deliberately behind multi-tenant readiness |
| Price war to the bottom | Medium | Medium | Compete on zero payment commission and collections outcomes, not headline price |
| Single reference customer distorts the product | Medium | Medium | Get tenant two from a different sport before Phase 4 ends |
| DPDP non-compliance | Low | High | Built into Phase 2, not retrofitted |
| Solo-team bus factor | High | High | Boring stack, documented decisions, no clever abstractions |

---

## 12. Success metrics

### Phase 3 (first tenant live)

- Registers and spreadsheets retired for core operations
- 90%+ of sessions have attendance marked within the session day
- Outstanding dues reduced measurably against the pre-launch baseline
- Owner opens the app on five or more days per week

### Phase 4 (early traction)

- Three to five paying tenants
- Time from signup to first attendance marked under 48 hours
- At least one tenant onboarded without engineering help
- Monthly logo churn under 5%

### Phase 5 and beyond

- Twenty-five or more paying tenants
- Gross margin above 70% after all variable costs
- Net revenue retention above 100% via plan upgrades
- Support burden under 30 minutes per tenant per month

---

## 13. Open questions

1. Where do tenants two through ten come from? Distribution has no owner and no plan.
2. Is the reference business willing to be a named case study with real numbers?
3. Do we charge for the swimming vertical separately, or bundle it to win the wedge?
4. Which WhatsApp BSP, and is direct Cloud API access worth the setup cost from day one?
5. What is the actual cash-versus-online split at the reference business? This determines how much reconciliation tooling Phase 2 needs.
6. Trial length and structure — free trial, paid pilot, or founding-customer pricing?
7. Retention versus erasure under DPDP — GST record retention against erasure rights, AND what happens when core processing consent is withdrawn for an enrolled member (active subscription, live UPI mandate, attendance history, member status; task V-45a). Same Indian legal counsel conversation; required before V-47 and V-45a execute.
8. Member account charging (§5.12): does a charge require the member present and identified, or can staff charge from a name search alone? What happens to unbilled charges when a member leaves? Is there a credit limit, and is it a hard block or a warning?
