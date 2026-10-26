# Screen contracts — route, role and task map

Lane: **Screen contracts** (`design/screen-contracts`), 26 October 2026.
Scope: `docs/design-system/screens.md`, `flows.md`, `component-usage.md` and
`screen-previews/`. This lane writes documentation only — no product code, no
shared primitive, no route.

Companion documents: [visual contract](visual-contract.md) (tokens and shell),
[motion](motion.md), [PWA](pwa.md), [delivery lanes](delivery.md), and the
incumbent root [DESIGN.md](../../DESIGN.md) which still owns token values and
the shipped owner composition contract.

## How to read this contract

- **Route** — the URL the screen is served at. Every route below exists in
  `app/` today; no route in this document is a proposal to add one.
- **Gate** — the permission or feature key a caller must hold. The page guard
  and the Server Action guard are separate: a gate here describes the *page*,
  and every action behind it re-checks its own key.
- **States** — the honest set of states the screen must handle, including the
  ones that are currently unhandled (they are listed as defects, not as
  features).
- Detailed contracts are given for the screens the redesign wave will touch
  first. Every other route is inventoried with its gate, its task and its
  current state coverage, so a later page task starts from a map instead of
  from a guess.

## Scope of this contract

This contract covers the tenant surfaces (owner, coach, reception, worker,
parent), the auth entry points and the operator console. It does not cover the
platform's internal job workers, the database, or the message-capture
pipeline.

<!-- screen-contract:scope-prefixes
/owner
/coach
/reception
/worker
/parent
/login
/set-pin
/check-in
/ops
-->

<!-- screen-contract:not-a-screen
fixture
-->

A route whose path contains `fixture` is a local component/test fixture route
(a test fixture is not a product screen and must never be exposed publicly).

## Roles, surfaces and the gate model

| Role | Surface | Home | Role gate |
| --- | --- | --- | --- |
| Owner | owner | `/owner` | full catalogue minus `attendance.mark` |
| Administrator | owner | `/owner` | full catalogue minus `attendance.mark` and `staff.pay.*` |
| Accountant | owner | `/owner` → redirected to `/owner/fees` | finance-grade subset; no `dashboard.view` |
| Receptionist | reception | `/reception` | front-desk subset; no `staff.pay.*` |
| Coach | coach | `/coach` | `attendance.read`, `attendance.mark`, `members.read.assigned`, `programs.read`, `levels.read`, `levels.assess`, `staff.self` |
| Curriculum lead | coach | `/coach` | coach set plus `levels.write` |
| Worker | worker | `/worker` | `staff.self` only |
| Parent | none | `/p/[token]` | signed link token; no tenant session |
| Operator (admin/viewer) | ops | `/ops` | platform session cookie; `viewer` is read-only |

Rules that hold across every screen in this document:

1. **Surface is a frame, not a permission.** A role outside the surface gets
   `404`, never a partial page — a probing caller must not learn the surface
   exists.
2. **A page gate never authorizes an action.** Every action re-checks its own
   permission key and its own tenant and location scope.
3. **A destination without the permission is not rendered.** No tile, tab or
   shortcut is shown unless the action it leads to would be allowed.
4. **Money is bigint paise** and every date on screen is Asia/Kolkata.
   Compact money on summaries, exact paise on ledgers and receipts.
5. **Accent is an action and identity colour**, never a status colour.

## Shared shell contract

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Owner | `lg` (≥1024px): viewport-bound sidebar (240px) + sticky top bar with record search + content capped at 1280px | four-item bottom nav; the same search stays in the mobile header, never as a fifth item |
| Coach | not a supported target | four-item bottom nav, `390×844` |
| Reception | not a supported target | four-item bottom nav, `390×844` |
| Worker | not a supported target | no bottom nav — self-service cards and sign-out only |
| Parent | not a supported target | single-column server-rendered page, zero client JavaScript |
| Ops | desktop-first at `1280×900`: 240px dark sidebar + data tables | best-effort only; not a supported target |

Shell rules that every screen inherits:

- One vertical scroll owner (the page). The sidebar has its own scroll region
  when the nav overflows; branding and sign-out stay reachable.
- The bottom navigation is fixed, exactly four items, and clears
  `env(safe-area-inset-bottom)`.
- 44px minimum touch targets; inputs are 16px so iOS does not zoom on focus.
- A sticky bar reserves its own space; it never covers the last field, the
  consent block or a focused control.
- Tables may scroll sideways inside their own labelled region; the page never
  scrolls sideways.
- The session must always be endable: a role without a Settings destination
  gets a shell-level sign-out.

## Viewport and evidence contract

| Screen family | Mandatory viewports |
| --- | --- |
| Owner | `390×844`, `1280×900`, plus `1024×768` and a short `1280×600` for shell work; widths immediately either side of the `lg` breakpoint; 200% zoom |
| Coach, reception, worker | `390×844` |
| Parent token page | `390×844` and `1280×900`; the production artifact must be checked for zero JavaScript |
| Ops | `1280×900` |

Evidence for a screen change records: branch, revision plus dirty diff, server
working directory, URL, build mode (dev or production), role, viewport, and
what was observed. A screenshot alone is not evidence that an action works,
and a green build is not evidence of visual quality.

## The eight-screen reference, applied selectively

The eight-screen illustration is a direction, not a route list. Aqua already
has the surfaces those screens imply; the job is to make each one honest, not
to add eight routes.

| Reference screen | Aqua decision | Where it lives |
| --- | --- | --- |
| Intro/splash | Native PWA launch appearance and icon only. No artificial timed splash, no network delay, no branding animation | PWA lane owns the manifest and icon; no route |
| Welcome | A one-line purpose statement only where it earns its place (first entry, or a screen that is genuinely unfamiliar). Returning staff go straight to work; no interstitial | No route. The purpose line lives inside the first screen of each surface |
| Login | Restyle the existing phone / code / PIN journey. Same authentication, same recovery, same session | `/login`, `/login/reset`, `/login/link/[token]`, `/set-pin` |
| Onboarding | Optional role-relevant first-use help and the owner setup checklist. Skippable, never a carousel on every login | `/owner/onboarding` (owner only). Other roles get a contextual hint, not a flow |
| Home | Role-specific tasks, truthful summaries, useful charts | `/owner`, `/coach`, `/reception`, `/worker`, `/ops` |
| Profile | The existing account surface, role-appropriate editable details and sign-out | `/coach/me`, `/reception/me`, `/worker` and the account block at the foot of `/owner/settings` |
| Settings | Grouped operational settings, with personal Appearance and motion preference discoverable | `/owner/settings` and its category screens; personal appearance belongs to the account block, not to academy settings |
| Subscription | The existing owner-visible membership and billing context only. No forced upsell, no paywall, no invented platform plans | `/owner/settings/plans` (what plans exist) and `/owner/fees` (what was charged) |

Three things this redesign will **not** do:

- No new customer platform is created out of the illustration. The parent
  surface stays the signed link; there is no member app, no member login and
  no member push.
- No timed splash, no forced welcome carousel, no subscription paywall.
- No invented data to fill a screen. Unavailable is `—` with the reason; a
  real zero says so in words.

## Owner surface

Role: owner, administrator, accountant (accountant is redirected). Frame: the
owner shell. Entry: `/owner`.

| Route | Gate | Primary task | States |
| --- | --- | --- | --- |
| `/owner` | `dashboard.view` (a role without it is redirected to `/owner/fees`) | Read the day: what happened, what is owed, what needs a decision | populated · quiet day · empty academy · chart unavailable · loading · error |
| `/owner/members` | `members.read` | Find a member; open the record | populated · filtered · no results · empty academy · loading · error |
| `/owner/members/new` | `members.write` | Create a member record | blank · validation error · saving · saved · duplicate phone |
| `/owner/members/import` | `members.write` | Import members from a spreadsheet | blank · preview · partial match · committed · row errors |
| `/owner/members/[memberId]` | `members.read` | One member: status, enrolment, fees, attendance, notes | populated · payer-only projection · not found · loading · error |
| `/owner/members/[memberId]/edit` | `members.write` | Change a member record | populated · validation error · saving · saved · not found |
| `/owner/fees` | `reports.financial` | Money: dues, invoices, transactions | populated · empty · filtered · voided · reversed · read-only for a role without `payments.record` |
| `/owner/enquiries` | `enquiries.read` | Work the enquiry pipeline | populated · stage filter · no results · empty · loading · error |
| `/owner/enquiries/[enquiryId]` | `enquiries.read` | One enquiry: stage, follow-ups, trial, conversion | populated · not found · loading · error |
| `/owner/programs` | `programs.read` | Programs and the batches inside them | populated · empty · over-capacity batch · loading · error |
| `/owner/batches/[batchId]` | `programs.read` | One batch: roster, capacity, waitlist | populated · full · waitlist present · not found |
| `/owner/sessions` | `programs.write` | Manage upcoming sessions: cancel, reschedule, substitute | populated · empty · conflict · cancelled · loading · error |
| `/owner/schedule` | `attendance.read` | Read the schedule grid | populated · quiet week · loading · error |
| `/owner/staff` | `staff.read` | The team and each person's access | populated · empty · loading · error |
| `/owner/staff/new` | `staff.write` | Add a staff member | blank · validation error · saved |
| `/owner/staff/[staffId]` | `staff.read` | One staff member: access, curriculum-lead designation | populated · not found · read-only |
| `/owner/staff/invitations` | `staff.invite` | Outstanding invitations | populated · empty · expired · revoked |
| `/owner/staff/invitations/new` | `staff.invite` | Invite a staff member | blank · validation error · sent |
| `/owner/staff/leave` | `staff.roster` | Leave types and the request queue | populated · empty · pending decision · error |
| `/owner/staff/roster` | `staff.roster` | Build and publish the weekly roster | populated · unpublished · published · conflict |
| `/owner/staff/check-in-qr` | `staff.roster` | The premises check-in QR | populated · regenerating · error |
| `/owner/reports` | `reports.operational` | Operational reports: attendance, funnel, retention, coach load, utilisation | populated · insufficient history · empty · error per card · loading |
| `/owner/reports/collections` | `reports.financial` | Daily collections and the cash count | populated · not confirmed · confirmed · closed · reopen refused |
| `/owner/settings` | `settings.manage` | Grouped settings, account block, sign-out | populated · category open · setup incomplete · empty categories |
| `/owner/settings/academy` | `settings.manage` | Academy profile: name, currency, time zone, GSTIN | populated · validation error · saved |
| `/owner/settings/activities` | `settings.manage` | The activities this academy offers | populated · empty · saved |
| `/owner/settings/alerts` | `settings.manage` | Absence alert thresholds | populated · validation error · saved |
| `/owner/settings/branding` | `settings.manage` | Display name, short name, accent | populated · validation error · saved |
| `/owner/settings/configuration` | `settings.manage` | Request a platform-owned setting change | populated · pending request · rejected |
| `/owner/settings/holidays` | `settings.manage` | Days the academy is closed | populated · empty · saved |
| `/owner/settings/locations` | `settings.manage` | Locations, addresses and business hours | populated · single site · multi site · validation error · saved |
| `/owner/settings/menu` | `settings.manage` | The café menu | populated · empty · archived item |
| `/owner/settings/payment-qrs` | `settings.manage` | Payment QR codes the payer scans | populated · empty · inactive · validation error |
| `/owner/settings/plans` | `settings.manage` | Membership plans the academy sells | populated · empty · archived plan |
| `/owner/settings/skills` | `settings.manage` plus feature `swim.levels` (editing needs `levels.write`) | The skill ladder and its rubrics | module off · populated · empty · read-only ladder |
| `/owner/settings/terminology` | `settings.manage` | The words this academy uses | populated · validation error · saved |
| `/owner/announcements` | `messaging.send` | Compose and send an announcement; read the notification inbox | populated · no audience · sent · failed |
| `/owner/onboarding` | `members.read` | The first-run setup checklist | not started · in progress · complete |

### `/owner` — Owner Home

**Who.** Owner and administrator. The accountant holds no `dashboard.view` and
is redirected to `/owner/fees`; they never see a partial dashboard.

**Primary task.** Know the state of the academy today and decide what to do
next. The owner reviews; they do not mark registers or run the counter from
this screen.

**Composition (desktop, ≥1024px).** Identity header (academy mark, scoped
location, full date, account control) → summary row of four `StatCard`
tiles (`Collected today`, `Overdue`, `Active <members>`, `<Sessions> today`)
→ exactly one dominant action (**Collect payment**, only with
`payments.record`, pointing at the dues list where an invoice can actually be
settled) plus quiet `Add <member>` and `Capture enquiry` links → a 60/40 split
of **Today** (divided class rows with time, batch, coach, occupancy and
register completion) and **Needs you today** (at most three `AttentionRow`s
with reason, age and destination) → a chart band with one wide metric panel
and one compact payment-mix chart.

**Composition (mobile, `390×844`).** Header → dominant action → summary 2×2 →
exceptions → today's classes → trend → quick links. No row scrolls sideways;
the bottom navigation is unchanged and clears the safe area.

**States.** Populated; quiet day (the day names the next class with coach,
date, time and occupancy — never an empty block); new academy (the onboarding
hint appears only when no checklist step is complete); chart unavailable (the
chart band degrades to a stated panel instead of taking the page down);
loading (skeletons that preserve layout); error (the page stays, the failing
block says so and offers retry).

**Semantics that must not drift.** Register state is *completion* — "12 of 12
marked" — and is never called attendance. Occupancy over capacity is its own
warning. Unmarked attendance is unknown, not zero. Comparison text sits
beside the chart with both exact IST ranges; an empty previous range says "No
previous collections in the comparison range" and never a percentage.

**Keyboard.** Search field first in the top bar; every tile and row is
reachable by Tab and activates on Enter; the chart has a keyboard-reachable
**View data table**; focus is never hidden by the sticky top bar.

**Offline and recovery.** No offline writes on this screen. When the reads
fail, the page keeps its shell and names the block that failed; a retry sits
next to the failure.

**Shared components.** `components/owner-shell.tsx`, `components/owner-dashboard.tsx`,
`components/owner-home-charts.tsx`, `components/ui/StatCard.tsx`,
`components/ui/AttentionRow.tsx`, `components/ui/LaneStrip.tsx`,
`components/ui/SectionHeader.tsx`, `components/ui/StatusBadge.tsx`,
`components/ui/CountChip.tsx`, `components/facility-switcher.tsx`,
`components/global-search.tsx`.

### `/owner/members` — Members

**Primary task.** Find a member and open the record. This is the long page:
many rows, a search that filters, and a row that is the destination.

**Mobile (`390×844`).** Search field at the top, then a divided list (one
container, `divide-y`, no card per row). Rows are two lines: identity and
status first, supporting metadata second. A long name truncates; an amount
never collides with a status pill. `Add <member>` is a quiet action above the
list, not a floating button covering the last row.

**Desktop (`1280×900`).** Aligned columns with money right-aligned and a
stable row height; the identity column is the row destination and the status
is a pill. Filter and search state stay in the URL so a shared link opens the
same view and Back returns to the same position.

**States.** Populated; filtered (the filter is named in the header and the
counts describe the filtered set); no results (one sentence plus the verb
that changes it); empty academy (the designed empty state with an import or
add verb); loading skeletons that match row geometry; error that keeps the
search field's contents.

**Keyboard and recovery.** Search is the first focusable control and filters
as the user types. Row navigation is Tab plus Enter. A failed load keeps the
query and offers retry beside the failure. Filters are URL state, so Back
restores the previous filter set.

**Shared components.** `components/members-board.tsx`,
`components/ui/DataTable.tsx`, `components/ui/Row.tsx`,
`components/ui/EmptyState.tsx`, `components/ui/StatusBadge.tsx`. A loading
state uses a layout-preserving placeholder; the foundation lane has not
delivered a skeleton primitive yet, so the loading markup stays as it is
rather than pretending to be one.

### `/owner/fees` — Fees and payments

**Gate.** `reports.financial` to open. Inside: `invoices.read` to read,
`invoices.write` to raise, `payments.record` to record,
`payments.read` to read the ledger, `payments.refund` to reverse, and
`settings.manage` to void a live receivable.

**Primary task.** Answer "who owes what, and has it been paid?" and settle an
open invoice at the counter.

**Composition.** Tabs are URL state (`?tab=`) — dues, invoices, transactions.
The selected tab only appears once its data is ready. Money is exact paise
here, not compact. A reversal is stated beside the total and is ledger-only:
it is never netted into the collected figure.

**Mobile (`390×844`).** One tab at a time, a two-line row per invoice or
payment, and a sticky action bar that reserves its own space so it never
covers the last row. Recording a payment is a full page (a sheet would hide
the fields), with the invoice summary pinned at the top.

**Desktop (`1280×900`).** Aligned table, money right-aligned, a summary strip
above it. The drill-down from Home lands on the dues tab with the facility
and period preserved.

**States.** Populated; empty ("Nothing due right now" is a real statement —
not a zero); filtered; voided (struck through, still readable); reversed;
read-only for a role without `payments.record` — the record control is
absent, not disabled-and-broken; loading; error that keeps entered values
after a failed save.

**Keyboard.** Tabs are a tablist with arrow-key movement; the amount field is
16px, right-aligned and tabular; validation errors are announced and focus
moves to the first invalid field.

**Offline and recovery.** Money never goes offline. If the network drops
mid-record, the form says the payment was not confirmed and asks the caller
to check before retrying — never a double submit, never an optimistic success.

**Shared components.** `components/fees/fees-tabs.tsx`,
`components/fees/fees-invoice-list.tsx`, `components/payment-record-form.tsx`,
`components/ui/DataTable.tsx`, `components/ui/StatusBadge.tsx`,
`components/ui/StickyActionBar.tsx`, `components/ui/Button.tsx`,
`components/ui/FieldError.tsx`.

### `/owner/settings` — Settings hub

**Gate.** `settings.manage`. The accountant (no `settings.manage`) therefore
has no Settings destination and gets a shell-level sign-out instead.

**Primary task.** Find and change one setting without reading a wall of
options. The page is six categories, each with a one-line summary; opening a
category shows only that category's destinations.

**Composition.** Mobile and desktop share the same list: category rows at
44px+ with an icon, a label, a summary line and a chevron. The account block
(name, phone, sign-out) sits at the foot of the page, and — once the
foundation ships the Appearance control — the personal Appearance and motion
preference live here, in the account block, not in an academy category.

**States.** Category closed; category open; setup incomplete (the onboarding
row is shown once, and disappears when the checklist is complete); empty
category; loading; error.

**Keyboard.** Each category is a link with an accessible name that includes
the destination ("Locations — every site, its address and its business
hours"); the back link returns to the hub and keeps focus.

**Shared components.** `components/ui/BackLink.tsx`,
`components/ui/SectionHeader.tsx`, `components/ui/Button.tsx`,
`components/tenant-sign-out.tsx`.

### `/owner/reports` — Operational reports

**Gate.** `reports.operational`. Financial reporting is a different gate and a
different route (`/owner/reports/collections`, `reports.financial`).

**Primary task.** Answer one operational question at a time and drill through
to the records behind the figure.

**Composition.** One card per report. A card that has no data is one honest
sentence, never an empty chart frame. Insufficient history says so ("Not
enough attendance history") instead of computing a rate from two marks. A
failed card keeps the rest of the page and puts the retry next to the
failure. The ECharts island is a lazy `lg+` island; below `lg` the same
panel renders its accessible data table so a phone never downloads the engine.

**Keyboard and states.** Every chart has a keyboard-reachable **View data
table** with the same numbers, a stated period and units, and a drill-through
that carries the same scope. Reduced motion removes the entrance animation.
Loading uses skeletons, not spinners.

**Shared components.** `components/reports/report-card-error.tsx`,
`components/reports/analytics-cards.tsx`, `components/charts/echarts-owner.tsx`,
`components/ui/EmptyState.tsx`, `components/ui/StatusBadge.tsx`.

## Coach surface

Role: coach, curriculum lead. Frame: bottom navigation, mobile only.
Entry: `/coach`.

| Route | Gate | Primary task | States |
| --- | --- | --- | --- |
| `/coach` | `attendance.read` (marking needs `attendance.mark`) | Today's sessions and their marking progress | sessions today · nothing today but something this week · nothing at all · loading · error |
| `/coach/register/[sessionId]` | `attendance.read`, marking `attendance.mark` | Mark the register | offline available · offline pending · offline unavailable · session not found · sync failed · marked |
| `/coach/schedule` | `attendance.read` | The coach's week | populated · quiet week · loading · error |
| `/coach/members` | `members.read.assigned` | Find a swimmer on the coach's own batches | populated · filtered · no results · empty · loading · error |
| `/coach/members/[memberId]` | `members.read.assigned` | One swimmer: attendance, progress | populated · progress module off · not found · error |
| `/coach/members/[memberId]/assess` | `levels.assess` plus feature `swim.levels` | Record a skill assessment | populated · module off · not allowed · saved · error |
| `/coach/curriculum` | `levels.read` plus feature `swim.levels`; editing `levels.write` | Read and (for a curriculum lead) maintain the ladder | module off · populated · read-only · error |
| `/coach/me` | `staff.self` | Own shifts, own attendance, own leave, sign-out | populated · empty · pending · error |

### `/coach` — Coach Today

**Primary task.** Act in the next ten minutes. Today's sessions are the
dominant element; the week's grid lives at `/coach/schedule` and the roster
lookup at `/coach/members`.

**Mobile (`390×844`).** One card per session: time, batch, enrolled count and
a lane strip showing marking progress, then a visible "Open register"
affordance. The colour of the strip carries meaning: `water` normally, `warn`
when under-filled, `late` when there is a problem. A session with nobody
enrolled says "No one enrolled" rather than 0/0.

**Empty states.** Nothing today but a session within seven days: name the next
session and offer "Open register" only when it is today or tomorrow —
otherwise offer "Show on schedule". Nothing in the next seven days: one
quiet sentence pointing at the owner. Never an empty block.

**Keyboard and recovery.** Cards are links, reachable by Tab and activated by
Enter. A failed load keeps the Today framing and offers a retry.

**Shared components.** `components/ui/LaneStrip.tsx`, `components/ui/CountChip.tsx`,
`components/ui/EmptyState.tsx`, `components/ui/Button.tsx`.

### `/coach/register/[sessionId]` — The register

**Primary task.** Mark who attended, as fast as the poolside allows.

**Mobile (`390×844`).** A divided list of swimmers, each row one tap to mark.
The page is scrolled by the coach's thumb, so the marked state must be
readable in sunlight: a status word, not colour alone. The back link is a
44px target.

**Offline states (the existing security model, unchanged).**

- *Offline available* — the approved offline queue is enabled for this
  identity and the coach may mark; the strip says "offline — saved on device".
- *Offline pending* — the banner states how many marks are saved locally and
  not yet synced.
- *Offline unavailable* — the mark control is unavailable and the page says
  "Offline access ended. Connect and sign in to reload this page."
- *Sync failed* — the page says how many marks could not be synced and does
  not discard them.

The offline identity is scoped, expiring and purged on logout. This contract
changes none of that: an expired or revoked identity must stop working
offline, and a logout must clear the queue.

**Keyboard.** Each row is a real control with an accessible name (the
swimmer's name and current state) and a visible focus ring. Marking updates
the state in place with an accessible announcement; focus does not jump.

**Shared components.** `components/register-board.tsx`,
`components/ui/LaneStrip.tsx`, `components/ui/StatusBadge.tsx`,
`components/ui/BackLink.tsx`.

## Reception surface

Role: receptionist. Frame: bottom navigation, mobile only. Entry:
`/reception`.

| Route | Gate | Primary task | States |
| --- | --- | --- | --- |
| `/reception` | `attendance.mark` for the check-in panel, `staff.attendance` for the staff board, `payments.record` plus the `billing` entitlement to collect or close, `invoices.read` plus `billing` for dues, `payments.record` plus `cafe.pos` for the café | Start the day: check people in, collect money | populated · quiet day · a task hidden by entitlement · no payment QR · loading · error |
| `/reception/members` | `members.read` | Find a member | populated · filtered · no results · empty · error |
| `/reception/members/new` | `members.write` | Create a member at the desk | blank · validation error · saved · duplicate phone (not handled today — a defect for the page task) |
| `/reception/members/[memberId]` | `members.read` (writes need `members.write`, `invoices.write`, `enquiries.write`) | One member at the desk: status, enrolment, invoice | populated · not found · read-only |
| `/reception/enquiries` | `enquiries.read` | The enquiry desk | populated · stage filter · no results · empty |
| `/reception/enquiries/[enquiryId]` | `enquiries.read` | One enquiry | populated · not found · error |
| `/reception/collect-payment` | `payments.record` | Show the QR, record the payment | active QR · no active QR · recorded · error · offline refusal |
| `/reception/dues` | `invoices.read` (the desk entry also requires the `billing` entitlement) | Who owes money, overdue first | populated · empty · filtered |
| `/reception/close` | `payments.record` | Count the cash and close the counter | open · counted · confirmed · closed · over-threshold refused · mismatch |
| `/reception/cafe` | `payments.record` (the desk entry also requires the `cafe.pos` entitlement) | Take a counter order and settle it | empty menu · order open · billed · paid · voided |
| `/reception/bookings` | — | Deliberately hidden: the route returns `404` until the price-rule admin ships | not reachable |
| `/reception/me` | `staff.self` (the page also needs `members.read`) | Own shifts, own attendance, own leave, sign-out | populated · empty · error |

### `/reception` — Reception Today

**Primary task.** Start the day at the counter. One dominant action:
**Collect payment**, because collecting is the front desk's highest-frequency
paid task. Everything else is a quiet destination row.

**Composition (mobile, `390×844`).** Title and the session count, then the
task rows: Collect payment, Close day, Dues, Find a member, Café — each
hidden when its permission or entitlement is absent, so the list never
offers a tap that would be refused. Below them the check-in panel (sessions
the receptionist can mark) and the staff attendance board.

**States.** Populated; quiet day (no sessions — say so and name what is
available); entitlement-absent (the row is absent, not greyed); the check-in
panel degrades to read-only for a role without `attendance.mark`; the staff
board is absent for a role without `staff.attendance`; loading; error.

**Offline and recovery.** No offline money. The offline attendance queue may
apply to the check-in panel under the same identity, expiry and entitlement
rules as the coach register; everything else refuses offline writes with a
clear message.

**Shared components.** `components/reception-check-ins.tsx`,
`components/staff-attendance-board.tsx`, `components/ui/CountChip.tsx`,
`components/ui/Button.tsx`.

### `/reception/collect-payment` — Collect payment

**Primary task.** Show the payer a QR and record the payment against their
invoice.

**Composition.** The QR block and the record form are two steps of one task
on a phone: the QR is shown large and unambiguous, and the form sits below it
with the amount, the method and the invoice. If no payment QR is active, the
page says so and points at the owner's settings — it does not show a broken
or empty QR.

**States.** Active QR; no active QR; amount entered; validation error (the
entered amount survives); recorded (a confirmation states the invoice, the
method and the amount); offline (the save is refused with an explicit
"needs a connection" message — money is never optimistically recorded).

**Keyboard.** The amount field is 16px and numeric-friendly; the method is a
real radio group; the QR image is not focusable; the submit control is
disabled while a save is in flight and re-enabled on failure with the values
still in place.

**Shared components.** `components/collect-payment.tsx`,
`components/payment-record-form.tsx`, `components/ui/Button.tsx`,
`components/ui/FieldError.tsx`.

### `/reception/close` — Close day

**Primary task.** Count the day's cash and close the counter.

**Composition.** The counted total is the dominant figure, entered in paise
through a controlled keypad field, then a confirmation that states the count
and the variance. Reopening a closed count is management authority
(`settings.manage`) and is refused for the receptionist with a plain
sentence, not a dead button.

**States.** Open; counted with a variance; mismatch; confirmed; closed;
over-threshold (an amount above the configured limit is refused with the
limit named); error.

**Shared components.** `components/reception-close-day.tsx`,
`components/ui/StatCard.tsx`, `components/ui/Button.tsx`,
`components/ui/StatusBadge.tsx`.

## Worker surface

Role: worker. Frame: no bottom navigation — self-service cards and sign-out
only. Entry: `/worker`.

| Route | Gate | Primary task | States |
| --- | --- | --- | --- |
| `/worker` | `staff.self` | Own shifts, own attendance, own leave | populated · no shifts · not checked in · pending leave · error |

**Mobile (`390×844`).** Identity block first (name, phone), then the three
self-service cards, then sign-out. Every read returns only the caller's own
rows; there is no route to another person's shifts, and no bottom navigation
because there is no second destination.

**States.** Populated; no shifts this fortnight; not checked in today; a
leave request pending or approved; error.

**Keyboard and recovery.** Each card's primary action is a real button with
an accessible name. A failed check-in keeps the card and offers a retry; it
never clears the entered reason.

**Shared components.** `components/my-shifts-card.tsx`,
`components/my-attendance-card.tsx`, `components/my-leave-card.tsx`,
`components/tenant-sign-out.tsx`.

## Parent surface

The parent has no account, no session and no app. Their entire surface is one
signed link.

| Route | Gate | Primary task | States |
| --- | --- | --- | --- |
| `/p/[token]` | a signed, unexpired link token | Read one child's next session, month attendance, plan runway and read-only money | valid · expired or invalid · member deleted since the link was issued · no sessions · no attendance yet · no plan |
| `/p/[token]/receipt/[paymentId]` | the same token | One payment receipt | valid · invalid token · not found |
| `/parent` | no seeded role maps to the parent surface, so every caller gets the parent-specific not-found page | An explanation that the parent's surface is the signed link, not a dead end | explained (the explainer renders for every caller) |

**The parent page is a contract, not a style.** It is server-rendered markup
with **zero client JavaScript**, `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and
`X-Content-Type-Options: nosniff`. It must never enter a service-worker
cache, a manifest shortcut or an install prompt, and no token may appear in a
`start_url`. The theme JavaScript that the tenant surfaces use must not reach
this page: a shared device must not leak one account's appearance, and the
parent page must not render a theme at all.

**States.** An invalid token and a valid token for a member who no longer
exists produce the *same* generic page — a probing caller learns nothing
either way. The page states the expiry (seven days) and how to get a fresh
link.

**Composition.** One column, maximum 560px: academy mark and name, the child
block, the next session card, this month's attendance, the plan runway, the
fees (outstanding and payment history with receipt links), a contact line
that names the academy rather than inventing a phone number, and a footer
that states the link is unique to the child, expires in seven days and carries
no tracking.

**Money.** Read-only, exact paise, Asia/Kolkata dates. The parent never
sees another child, never sees a total that mixes children, and never sees a
payment method the academy does not record.

**Verification.** The production artifact, not a dev server:
`pnpm e2e:parent-link-zero-js` plus a manual check of the response headers
at `390×844` and `1280×900`.

## Auth surface

| Route | Gate | Primary task | States |
| --- | --- | --- | --- |
| `/login` | none | Sign in with the mobile number and the PIN | phone entered · PIN entered · wrong PIN · unsynced offline attendance drafts hold the sign-in until they are synced or explicitly discarded · rate limited · provider error |
| `/login/reset` | none | Reset a forgotten PIN by verifying the registered WhatsApp number | phone entered · code sent · code wrong · new PIN saved · rate limited · provider error |
| `/login/link/[token]` | the link token | Redeem a staff sign-in link | link previewed and confirmed · every failure kind (expired, already used, foreign tenant) renders the same generic page, so the preview can never be an oracle for which links are live |
| `/set-pin` | an authenticated session that has no credential yet — the safety net when the link-redeem flow minted a session without one | Set the missing PIN | credential already set → the role home (this page only ever sets a missing PIN; changing one is the owner reset link's job) · too short · mismatch · saved |
| `/check-in/[token]` | a tenant session with `staff.self` plus a token naming the caller's own tenant | Check in at the premises QR | signed out · invalid QR · no staff record · already checked in · checked out · checked in |

**Contract.** The journey, the PIN rules, the recovery flow and the session
semantics are unchanged by the redesign — only the presentation changes. The
restyle must keep the phone-first ordering, the 16px inputs, the inline
validation, the "Forgot PIN? Reset with WhatsApp" affordance, and it must not
introduce a second sign-in path, a social login or a password.

**States.** Every failure states what to do next. A wrong PIN does not
disclose whether a phone is registered. A rate limit states when to retry. An
expired session sends the caller back to `/login` and does not leave a
half-signed-in shell. Unsigned attendance drafts on the device hold the
sign-in and are offered two explicit ways forward — sync them, or discard
them knowingly. They are never discarded silently.

**Keyboard and accessibility.** The phone field is `inputmode="tel"`; the PIN
field is masked, numeric and at most 12 characters, and both fields are 16px
or larger so a phone does not zoom on focus. Enter submits when the form is
valid, and the error is announced with `role="alert"`. A reveal toggle and an
autofocus are **not** present today; a page task may add them as
presentation changes, but the authentication semantics stay as they are.

**Offline.** The auth journey requires a connection. If it is lost, the page
says so plainly and keeps what was typed.

## Ops surface

The operator console is a separate host (ops.localhost at the platform
host) and a separate auth scheme (TOTP plus a `platform_session` cookie). It
never touches the tenant schema and never appears on the tenant apex.

| Route | Gate | Primary task | States |
| --- | --- | --- | --- |
| `/ops` | platform session | See what needs attention | populated · queue empty · no metrics snapshot yet · error |
| `/ops/tenants` | platform session | List, filter and open tenants | populated · filtered · no results · paginated |
| `/ops/tenants/new` | platform session | Create a tenant | blank · validation error · created · error |
| `/ops/tenants/[tenantId]` | platform session | One tenant: overview | populated · not found · suspended · error |
| `/ops/tenants/[tenantId]/configuration` | platform session | Platform-owned configuration for the tenant | populated · pending change · rejected |
| `/ops/tenants/[tenantId]/entitlements` | platform session | Which features this tenant has | populated · none · changed |
| `/ops/tenants/[tenantId]/locations` | platform session | The tenant's locations | populated · empty · error |
| `/ops/tenants/[tenantId]/messaging` | platform session | Messaging configuration for the tenant | populated · empty · error |
| `/ops/tenants/[tenantId]/audit` | platform session | The tenant's audit trail | populated · filtered · no results |
| `/ops/tenants/[tenantId]/tax` | platform session | Tax and GST settings | populated · validation error · saved |
| `/ops/leads` | platform session | The sales pipeline | populated · filtered · empty |
| `/ops/leads/new` | platform session | Record a new lead | blank · validation error · created |
| `/ops/leads/[leadId]` | platform session | One lead and its conversion | populated · converted · not found |
| `/ops/features` | platform session | The feature catalogue | populated · empty · changed |
| `/ops/presets` | platform session | Presets | populated · empty · applied |
| `/ops/presets/[key]` | platform session | One preset: roles, permissions, modules, vocabulary | populated · not found · applied · error |
| `/ops/whatsapp` | platform session | The mock messaging console (mock provider only) | populated · empty · not enabled · error |
| `/ops/activity` | platform session | Platform activity log | populated · filtered · no results |
| `/ops/login` | none | Operator sign-in | blank · wrong credentials · locked · error |
| `/ops/verify` | half-authenticated | The second factor | blank · wrong code · expired · error |

**Desktop-first.** The console is designed at `1280×900`: a 240px dark
sidebar, data tables and forms. Mobile is best-effort and is not a supported
target — the redesign does not create a mobile console.

**Read-only viewers.** A `viewer` sees a read-only platform. The controls
are hidden, and the server refuses the writes anyway — the hidden control is
supplementary, never the enforcement.

**Audit.** Every operator mutation writes its audit row in the same
transaction as the change, through the shared ops action helper. A
notification banner on the console must not be mistaken for a transaction
record.

**Paid services.** The WhatsApp console is a mock in this phase. No paid
provider is activated to satisfy a screen.

**Keyboard.** Filters are labelled inputs, the tenant table's identity column
is the destination, and the tenant detail tabs are a tablist with arrow-key
movement. Focus is always visible on the dark sidebar.

## Non-screen endpoints

These are not screens and carry no visual contract, but they are part of the
surface map and are listed so that a later page task does not invent a
duplicate.

| Endpoint | Purpose |
| --- | --- |
| `/` | Host-aware entry point that redirects to the right door for the host |
| `/api/auth/[...all]` | The authentication API surface |
| `/api/login/pin` | PIN verification |
| `/api/login/pin-recovery` | PIN recovery |
| `/api/login-link/redeem` | Sign-in link redemption |
| `/api/account/set-pin` | Setting a PIN after phone verification |
| `/api/offline/session` | The scoped offline identity session |
| `/api/health` | The liveness endpoint |
| `/api/payment-qr/[qrId]/image` | The payment QR image |
| `/api/receipts/[paymentId]` | A payment receipt |
| `/owner/reports/attendance.csv` | The attendance CSV export |
| `/owner/members/import/template.csv` | The member import template |
| `/ops/api/whatsapp-auth` | Operator messaging credentials |

## Next implementation task

The foundation lane owns tokens, the shell and the primitives. These page
tasks are defined here so that they can be scheduled **after** the foundation
interfaces exist, and so that two lanes never edit the same page at the same
time. Each task names one surface and excludes the others.

| Task | Surface | Scope | Depends on |
| --- | --- | --- | --- |
| SC-1 | owner | `/owner` Home: identity header, summary tiles, attention queue, chart band | foundation tokens + `StatCard`, `AttentionRow`, `LaneStrip`, chart island |
| SC-2 | owner | `/owner/members`: long-page list, filters, empty and error states | foundation `DataTable`, `Row`, `EmptyState` |
| SC-3 | owner | `/owner/fees`: tabs, money rows, record-payment page | foundation `Tabs`, `StickyActionBar`, `FieldError` |
| SC-4 | owner | `/owner/settings` hub and its category screens | foundation `SectionHeader`, `BackLink` |
| SC-5 | coach | `/coach` and `/coach/register/[sessionId]`: today, register, offline states | foundation `LaneStrip`, `StatusBadge`, PWA offline banner |
| SC-6 | reception | `/reception`, `/reception/collect-payment`, `/reception/close` | foundation `Button`, `StatCard`, PWA offline banner |
| SC-7 | parent | the zero-JS token page restyle, still zero JavaScript | foundation tokens only; no client components |
| SC-8 | ops | the console shell at `1280×900` | foundation tokens; the dark sidebar is the ops exception |

Rules for every task above:

- One page family per task; no task edits two surfaces.
- No task may change a shared primitive's API unilaterally.
- A task that needs a new route, a new permission or a new backend contract
  raises a change request to the lane that owns it.
- No task may add a screen that does not exist in the route inventory above.
