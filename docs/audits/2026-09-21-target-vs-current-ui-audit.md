# Target-vs-current UI audit — 2026-09-21

**Scope:** initial sampling across role surfaces and seven target boards in
`docs/images/`, followed by source review. Not an exhaustive state/a11y audit.
No product code changed. Execution handoff:
[`../ui-redesign-implementation-plan.md`](../ui-redesign-implementation-plan.md).

**Corrections after reviewing the conversation and source:** this document
originally overclaimed coverage and several missing features. The corrections
below supersede those earlier statements. Do not use the chat as a specification.

**Environment:** local docker Postgres reset with the standard demo seed
(`DEMO_MODE=true pnpm demo:reset`, 95 migrations), `DEMO_MODE=true pnpm dev`
at `localhost:3000`, `ops.localhost:3000` for the platform. Signed in as
Owner `+91 90000 00001`, Coach `+91 90000 00002`, Receptionist
`+91 90000 00004`, platform operator `ops@aqua.local`.

**Viewports (per AGENTS.md):** coach/reception 390×844; owner 390×844 **and**
1280×900; ops 1280×900.

**Evidence:** numbered screenshot series in `.playwright-mcp/audit/` (gitignored
local artifacts, not committed); suffixes mean this is not a verified count of
41 files. Some filenames misstate viewport: `31-parent-link-390.png` is actually
1280×900. Validate dimensions and repeat mobile/state checks before sign-off.

**Date note:** captures crossed midnight IST: Sunday 20 Sept empty check-ins,
then Monday 21 Sept populated check-ins. Compare like-for-like states.

---

## 1. P1 — broken critical flows on the audited `main` baseline

Priority correction: these are high-priority feature failures. They were called
P0 in the chat, without evidence of system-wide outage, data loss or compromise.

### 1.1 `/owner/reports` crashes for every owner

**Repro:** sign in as owner → Reports. Next.js error overlay (dev) / error
boundary (prod). Screenshot `18-owner-reports-1280.png`.

**Error:** Postgres `42803 — column "payments.received_at" must appear in the
GROUP BY clause or be used in an aggregate function`.

**Cause:** `lib/services/owner-analytics.ts:133-141` interpolates the timezone
three times (`select`, `groupBy`, `orderBy`). Drizzle binds each interpolation
as a separate parameter (`$1`, `$6`, `$7`), so Postgres cannot match the
GROUP BY expression to the SELECT expression:

```sql
select ("received_at" at time zone $1)::date::text, ...
group by ("received_at" at time zone $6)::date
order by ("received_at" at time zone $7)::date
```

**Why CI is green:** no test exercises `getMoneyAnalytics` /
`getMoneyAnalyticsAction`. `tests/mobile/owner-analytics.test.tsx` tests the
card components only; the service SQL is uncovered.

**Blast radius:** the whole owner Reports surface (all nine cards) — not just
the collections chart.

### 1.2 `/check-in/<token>` is 404 — the V-25 QR flow is unreachable

**Repro:** owner → Staff → Roster → "Premises check-in QR…" →
`/owner/staff/check-in-qr`, then open the printed URL. Plain-text
`404 not found` with HTTP 404. Screenshot evidence: console log in
`.playwright-mcp/audit/` (`/check-in/... 404`).

**Cause:** `middleware.ts` returns 404 for any apex path not in
`APEX_ALLOWLIST` (`middleware.ts:37-81`). The allowlist has `/login`,
`/owner`, `/coach`, `/reception`, `/parent`, `/p/`, `/api/*`, `/set-pin`,
`/sw.js`, but **not `/check-in/`**. `app/check-in/[token]/page.tsx` exists and
its service tests pass; the request never reaches it.

**Why CI is green:** `tests/tier1/premises-check-in.test.ts` and
`premises-qr.test.ts` call the resolver/service directly. No test drives the
route through the middleware. `scripts/e2e-host-boundary.ts` does exercise
middleware reachability, but omits `/check-in/`; extend that existing coverage.

**Blast radius:** V-25's entire staff-facing flow (the QR poster is printable
but useless), including the "under five seconds" acceptance criterion.

---

## 2. Coach — `docs/images/coach-target-design.png`

Coach captures: Today `01`, Schedule `02`, Register `03`, detail `04/04b`, Me `05/05b`.

| Target screen | Current | Gap |
| --- | --- | --- |
| 1. Dashboard — greeting + avatar, quote card, KPI row (Sessions / Total swimmers / Avg attendance), "Today's sessions" with status chips ("Starting in 15 min", "In 8 hours"), "Tasks & reminders" | `/coach` is a bare "Today" heading + session cards with a progress lane and "Open register". No greeting, no KPI row, no tasks/reminders, no status chips | **High.** The highest-frequency screen is the thinnest. KPIs exist in services (register counts, attendance %), so this is presentation work. |
| 2. Today's Session (List) — All / Ongoing / Upcoming / Completed tabs, batch cards with pool, time, enrolled avatars, "+8" overflow | `/coach/schedule` is a 7-day flat list; no tabs, no avatars, no status segmentation | **Medium.** Tabs are UI-only; avatar component already exists (`components/avatar.tsx`). |
| 3. Mark Attendance — counts chips (Enrolled 14 / Present 12 / Absent 2), search field, per-row P/A segmented buttons, single "Save Attendance (12/14)" | `/coach/register/[sessionId]` shows "0 of 12 marked", "Mark all 12 present", per-row ✓ / late / ✗ buttons. No enrolled/present/absent chips, no search, no explicit save (optimistic per-row writes), attendance % per row + Assess link (extra vs target) | **Medium.** Interaction model differs (per-row write vs batch save) — note the offline-sync design already writes per row, so a "Save" may be cosmetic only. |
| 4. Member Detail — tabs, attendance/session summaries, progress, notes and actions | Current is a single scroll with phone/medical/guardians, attendance grid and skill ladder | **High composition gap.** `member_notes` already exists with audited services. Decide coach visibility, roster scoping and authorisation before reuse; a new table is not established as necessary. |
| 5. More / Tools — My Profile, Session Resources, Member Progress, Attendance Reports, Announcements, WhatsApp Broadcast, Help & Support, Settings, Sync Status | `/coach/me` is identity + My shifts + Today's attendance + Leave + Sign out | **High structural divergence.** Target "More" is a tools hub; current "Me" is self-service. V-23–V-27 cards landed here, so this is now a mixed surface. Requires a nav-structure decision before code. |

---

## 3. Reception — `docs/images/receptionist-target-desgin.png`

Screens captured: Today Sunday (`06`), check-in expand (`06b`, `06c`),
staff attendance (`06d`), collect payment (`07`), add member (`08`),
enquiries (`09`), member detail top/bottom (`10`, `10b`), Me (`11`), café
(`12`), bookings (`13`), Today Monday + check-in list + staff reason panel
(`38`, `39`, `40`, `40b`, `41`).

| Target screen | Current | Gap |
| --- | --- | --- |
| 1. Dashboard — greeting, notification bell, KPI cards (Check-ins / Enquiries / Payments), "Today's tasks" list | `Today` heading, quick-action cards (Collect payment, Café, Bookings), Today's check-ins, Staff attendance. No greeting, no KPI cards, no task list | **Medium.** Counts are derivable from existing services. |
| 2. Member Search — tabs All/Active/Inactive/Pending, avatar rows with status chips | **No member search surface on reception at all** (only Add member and member detail by URL). Search exists owner-side only (`components/global-search.tsx`) | **High.** Target's screen 2 has no counterpart. |
| 3. Member Detail — tabs Overview/Fees/Attendance/Notes, plan + days-left chip, Mark Attendance / Collect Payment actions | Reception member page reuses owner panels: identity card, ENROLMENT (transfer/enrol), MEMBERSHIP, INVOICES, Guardians, Consent. No tabs, no attendance view, no collect-payment action from the member | **High.** |
| 4. New Enquiry — full form (source, child age, interested in, preferred time, batch, notes) | Quick-capture (name/phone/source) + list; detail page exists for the rest | **Low/Medium.** |
| 5. Collect Payment — amount presets, method selection, QR, recorded payment | Captured the no-QR state. `components/collect-payment.tsx:60-73` already has optional amount entry for a configured UPI QR; this screen displays a QR without recording a payment | **Journey gap.** Evaluate populated state and member/invoice recording path before claiming controls are absent. R1 is counter-recorded, not QR-only. |
| 6. Today's Check-ins — status tabs and times | Per-session accordions and avatar rows. Checked-in state already includes `markedAt` formatted in IST (`components/reception-check-ins.tsx:208-215`) | **Medium organisation gap**, not a missing-timestamp defect. |
| 7. Session View — member list with Checked in state, "Mark All Checked In" | The accordion is the implementation; **no "mark all"** on reception (coach register has `markAllPresent`, `components/register-board.tsx:71`) | **Medium.** |
| 8. Staff Attendance — date header, per-row Present/Absent segmented, notes, "Save Attendance" | Per-row Present/Absent → inline "Mark present — why?" panel with quick reasons (No login yet / Forgot to check in / Phone not with them) and a **required** reason, Confirm/Cancel. Writes immediately per row; no date header, no batch save | **Low/Medium.** Functionally richer than the earlier "reason panel deferred" note; interaction model differs. |
| 9. Announcements — composer with audience/channel/schedule | Owner-only (`/owner/announcements`); reception has no entry point | **Medium.** |
| 10. More / Tools — Enquiries, Members, Payments, Sessions, Staff Attendance, Announcements, Help & Support, Settings | Bottom nav is Today / Add member / Enquiries / Me; `/reception/me` mirrors coach Me | **High structural.** No More/Tools surface. |

---

## 4. Owner — two desktop boards, with a separate mobile requirement

Both `owner-target-design.png` and `owner-webapp-target-design.png` depict
desktop web apps. The earlier “mobile” label was incorrect.

Screens captured: home 390 (`14`, `14b`) and 1280 (`15`), members (`16`),
member detail 1280 (`17`) and 390 (`32`), fees (`19`), schedule (`20`),
programs (`21`), staff (`22`), announcements (`23`), settings (`24`),
roster (`25`, `25b`), leave (`26`), check-in QR (`27`), reports (crash, `18`).

| Target screen | Current | Gap |
| --- | --- | --- |
| Dashboard — money summaries, attendance/capacity and attention items | Registers hero, small operational KPIs, quick links and lanes; desktop stretches this layout | **High composition gap.** `OwnerShell` already mounts `FacilitySwitcher`, hidden intentionally for single-location tenants. Header placement and notification affordances differ from targets. Revenue targets remain a domain decision. |
| Members Management — dense table (Name, Age, Category, Plan, Batch, Status, Attendance %, Actions), status tabs, pagination | Card list: name, code, location, phone, joined, status chip; "All statuses" select; no columns, no attendance %, no plan/batch, no pagination | **High on desktop.** U-10 made the shell responsive; content stayed mobile-shaped. |
| Member Detail — tabs Overview/Attendance/Progress/Notes, profile info grid, current plan + days-left, attendance donut, upcoming sessions | Tabs Overview/Payments/Progress/Notes/Documents (U-03), status panel, enrolment, membership, invoices, guardians, consent, identity card block, attendance grid further down. No profile grid, plan card, donut, or upcoming sessions | **Medium.** Identity card block repeats the name below it (visual redundancy). |
| Enquiries — table with source, status, follow-up | Not captured in this pass (list exists owner-side) | **Unverified.** |
| Schedule & Batches — time × day grid, All locations filter | Day-grouped list ("Week of 14 Sept"), Week/Month toggle, Prev/Today/Next; `components/owner-schedule-grid.tsx` deliberately stacks seven day sections for 390px. Every session shows "No location" (seed gap) | **Medium** on desktop (target is a grid). |
| Fees & Payments — Overview/Transactions/Dues/Invoices/Plans tabs, KPI cards | Tabs + Overview cards; all ₹0.00 because the demo seed records no payments | **Product OK, demo-data gap** (see §7). |
| Coaches & Staff — table with role tabs, phone, email, actions | List with avatars, role, "has login", Roster/Invitations/Add staff | **Medium.** |
| Reports & Analytics — KPI row and charts | Cards exist but Reports crashes (§1.1). Expenses are explicitly unavailable; member mix is lifecycle status, not sport category | **Blocked by P1.** Chart labels and grouping must match available data. |
| Settings — tabs (Club Profile, Locations, Plans & Pricing, Notifications, Integrations, Account) | Settings index with grouped cards; subpages exist | **Low/Medium.** |

---

## 5. Ops — `docs/images/ops-target-design.png`

Ops captures: overview `28`, tenants `29`, detail `30`, features `33/33b`,
presets `34`, leads `35`, activity `36`, configuration `37`.

| Target screen | Current | Gap |
| --- | --- | --- |
| Overview — KPI cards (active/trial/at-risk tenants, open ops tasks), Needs attention table, tenant health table, recent activity | "No metrics snapshot yet — the platform.metrics-snapshot job runs nightly", empty Needs attention, Quick actions, Recent activity. No KPI cards until the job runs | **Medium.** Target's stat cards are absent by design until the job runs; demo never runs it. |
| Tenants — operational table and filters | Responsive cards use `md:hidden`; table uses `hidden md:block` | **No confirmed a11y duplication.** Two DOM branches do not imply two accessible branches. CSS-hidden content is normally excluded; test the accessibility tree. |
| Tenant detail — health/plan/locations/WhatsApp cards, About, configuration provenance, permissions matrix, audit mutations | Overview tab (status actions, settings table, stat cards), Configuration tab with per-key source chips and "Why this value?" (matches target's provenance concept well), Entitlements/Locations/Messaging/Audit tabs | **Low.** Permissions matrix not seen; health/WhatsApp cards absent. |
| Effective configuration — resolved values, provenance, role permission preview, config audit log | Configuration tab delivers values + provenance; permission preview not seen | **Low.** |
| Features / Presets / Leads / Activity / WhatsApp | All present. **`messaging` still shows GA while WhatsApp is a mock** (`/ops/features`; role-surfaces-plan §6 known defect, still open). `billing` GA is now defensible (invoices/payments shipped) | **Low.** |
| — | Date filters use native `type="date"` → MM/DD/YYYY in an en-US browser (`36`) | **Low** (see §6.3). |

---

## 6. Cross-cutting detail findings

1. **"Unpaid · unpaid" duplicated label** on coach and reception Me cards and
   in the leave-type select. Cause: `components/my-leave-card.tsx:56` appends
   `" · unpaid"` to the type *name*, which is already "Unpaid". Shows as
   `Unpaid · unpaid` in the DOM (`05`, `11`). One-line fix.
2. **"Failed to fetch" transient** seen once on the owner member page
   (`ERR_CONNECTION_RESET` / `ERR_CONNECTION_REFUSED` in console) — dev-server
   connection churn during compilation, gone on reload. Not a product bug.
3. **Date input format inconsistency:** native `type="date"` fields
   (`components/booking-form.tsx:174`, `components/activity-filter-bar.tsx:83,94`,
   `components/member-subscription-panel.tsx:232,245`) render MM/DD/YYYY under
   an en-US browser, while the roster builder renders DD/MM/YYYY
   (`25`) and display dates use `en-IN` formatting (`lib/time/tz.ts:122,147`).
   `app/layout.tsx:35` is `lang="en"`, which is valid. Pick a tested input
   convention; changing it to `en-IN` does not guarantee native date formatting.
4. **Check-in QR page prints the raw signed token** across three wrapped lines
   under the QR (`27`). Visually noisy; preserve an accessible copy/open-link
   fallback. A short code needs an actual resolver. Copyability itself is not a
   new security flaw: the QR encodes the same signed URL.
5. **Ops responsive DOM** (§5): do not treat CSS-hidden variants as an a11y
   defect without rendered evidence.
6. **Native blue checkbox** on the leave-types editor (`26`) is unstyled
   against DESIGN.md tokens.
7. **Next.js dev-tools badge** overlaps the bottom nav / ops sidebar in dev
   screenshots — dev-only, ignore.
8. **Contrast omission:** source token pairs calculate to ink-3/paper 3.35:1,
   ink-3/deck 2.91:1 and white/mango 2.61:1. Normal text requires 4.5:1.
   `Button.tsx:24` uses white-on-accent at 13–15px; meaningful muted text also
   needs remediation. Tokens being approved does not make every pairing safe.
9. **Reception/coach render a stretched mobile layout at 1280** — expected
   (field surfaces are mobile-only), noted so it isn't mistaken for a bug.

---

## 7. Demo-seed gaps that block manual verification

These were observed fixture limitations. Seed attribution is provisional until
the generator/service and stored rows are checked; “demo data” is not proof
that a production code path is correct. They limited populated-state assessment:

1. **No café menu items** → `/reception/cafe` shows "No menu items yet"
   (`12`); the order/bill/settle flow cannot be walked.
2. **No shifts or published roster** → owner Roster empty (`25b`), staff
   "My shifts" empty on both Me surfaces.
3. **No leave requests** → owner Leave queue empty (`26`); approval flow
   cannot be walked end-to-end.
4. **No payments or invoices** → every money surface reads ₹0.00 (`19`);
   reports (once fixed) would render flat.
5. **Sessions carry no location** → "No location" on every owner schedule row
   (`20`).
6. **Past/current-week session times stored as if IST were UTC:** e.g. Sep 14
   "Morning Masters" is `06:00 UTC` (renders 11:30 IST) while Sep 21 is
   `00:30 UTC` (renders 06:00 IST). The current week looks wrong on the
   schedule; next week looks right.
7. **No platform metrics snapshot** → ops Overview has no KPI cards (`28`);
   the nightly `platform.metrics-snapshot` job has never run in the demo.
8. **No staff attendance rows** → board is all "Not marked" until someone
   taps (which the audit deliberately avoided confirming).

---

## 8. What this pass could not verify

- The QR check-in end-to-end (§1.2 blocks it).
- Reports rendering (§1.1).
- Reception session-level bulk check-in on a populated day (Sunday was empty;
  Monday's list was captured but "mark all" doesn't exist).
- Café order → bill → settle, because the demo has no menu.
- Leave request → approval, because the demo has no requests.
- Populated money states (dues, transactions, receipts).
- Owner enquiry table and ops permissions matrix (not captured).
- Parent/member app screens — out of R1 scope by the 2026-09-18 decision; the
  zero-JS `/p/[token]` link works (`31`) and matches the S5 commitment.

---

## 9. Proposed fix order

1. **Fix the two P1s with regression tests** (both are
   "shipped but unreachable/broken"):
   - `owner-analytics.ts` GROUP BY parameterization + a service test that runs
     `getMoneyAnalytics` against the hermetic DB.
   - Add `/check-in/` to `APEX_ALLOWLIST` + a middleware allowlist test that
      verifies the intended host matrix. Extend `e2e-host-boundary.ts`; do not
      auto-allow all routes or expose `/ops` on the tenant host.
2. **Accessibility and wording:** repair contrast and the duplicated unpaid
   label (including the select), using existing meaningful tests where possible.
3. **Demo-seed coverage** for café menu, shifts + published roster, one leave
   request, a handful of payments/invoices, session locations, and the
   metrics snapshot — unblocks every later manual pass.
4. **Coach Today dashboard** (KPIs + tasks + status chips) — highest-frequency
   surface, no schema needed.
5. **Reception member lookup + task navigation**, within current four-item/no-More
   policy unless the product owner explicitly revises it.
6. **Owner desktop content** (members table, dashboard money KPIs) — the
   webapp target is the gap, not mobile.
7. **Decision-dependent items:** coach note permissions/visibility (existing
   notes schema), pay surfaces V-28–V-34, and revenue targets for the arc.

Use the UR plan's exact task order; this list is rationale, not a second queue.

---

## 10. Visual element diff vs the target boards (why the screens read bland)

Element-level comparison at crop zoom. "Verdict" is against `DESIGN.md` and
`docs/sports-club-ui-direction.html`, not against the boards' decoration.

| Target element (where it appears) | Current | Verdict |
| --- | --- | --- |
| **Soft-tinted icon squares** | Used inconsistently across summaries and rows | Use where they aid scanning; semantic colours retain meaning. Do not make every KPI a decorative card |
| **Display-scale figures** | Owner secondary KPIs are 17px; the populated owner hero already uses 38px (`owner-dashboard.tsx:90`) | Improve hierarchy contextually; the display scale is not unused |
| **Trend deltas** | Current analytics returns the requested period, not a prior-period comparison | Define periods, denominator and queries first; not presentation-only work |
| **Charts** | Analytics components exist behind the broken Reports page; owner home has none | Fix §1.1, then place real supported series appropriately. Target/expense series need actual domain support |
| **Segmented pill tabs with counts** (reception 6, owner members/fees) | Owner member detail and fees only; missing on coach schedule, reception check-ins, reception member search | **Build** |
| **State chips with time** | Check-in timestamps already exist; session relative-time presentation differs | Inspect populated states, then add only useful missing context |
| **Attendance controls** | Selected register marks already use good/warn/late soft fills and `aria-pressed` (`register-board.tsx:19-22,305-317`) | Preserve unmarked/selected distinction and Late; do not colour inactive controls as if selected |
| **Person avatars** | Present on staff/check-ins/coach list; owner member surfaces lack person avatars | U-09 tail. Keep TenantMark for academy identity; no photo uploads in current R1 scope |
| **Session grid** | Day-grouped list; colour in capacity lane | Desktop grid is appropriate; arbitrary category colours need a separate palette decision |
| **Date strip** ("Mon, 15 Sep 2026" with calendar icon) | Page heading only | **Build** (small) |
| **Identity header** | Owner shows club identity/sign-out; global search and conditional location selector already exist | Improve composition and discoverability; bell/inbox work needs an actual destination |
| **Task/reminder rows with due times** ("Due by 10:00 AM", "3 swimmers pending") | Owner-only "Needs you today"; coach and reception have no task surface | **Build** (coach 1, reception 1) |
| **Section title + "View all" link** | Rare ("View all" absent; settings/needs-you are standalone) | **Build** (small) |
| **Photos / illustrations / waves / weather** | R1 has no photo uploads; decorative illustrations/gradients are restricted | Existing HTML reference explicitly uses lightweight SVG waves. Weather is not inherently banned; it needs product justification. DPDP is not a blanket legal photo ban |
| **"More" navigation** | Target boards use it as the fourth item; current uses Me/Settings | Conflicts with current no-More policy, not the four-item count. Requires an explicit decision |
| **Bold (700) headings and heavy numbers** | 600 max | **Banned** — type scale tops at 600 |

**Revised conclusion:** the earlier “one third” estimates were unmeasured and
are withdrawn. The substantial gap is composition, information architecture,
desktop density, readable hierarchy and complete state coverage. More cards
and icon chips alone will not fix it. Approved runtime accents include marine;
mango is not mandatory. Trends/targets need data contracts, colour needs
contrast testing, and target differences need product-context decisions.

**Money follow-up:** `owner-analytics.ts:172-185` converts money sums to Number
and reduces them in JS, contrary to the bigint-paise contract. UR-01 must
separate exact totals from bounded chart coordinates; SQL repair is not enough.
