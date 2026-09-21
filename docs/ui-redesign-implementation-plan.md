# Aqua UI redesign implementation plan

**Date:** 2026-09-21 · **Baseline:** `d483ec7`, merged PR #187.
**Status:** planning/handoff complete; UR-01–UR-15 implementation not started.
**User direction:** prioritise UI/UX, compare all seven target boards, and
attend to small details. This file replaces reliance on the preceding chat.
**Resume prompt:** “Read this plan and implement the first incomplete UR task;
honour its stop conditions and attach verification evidence before marking done.”

## 1. Start here, even in a fresh model session

1. Read `../AGENTS.md`, `../DESIGN.md`, and this entire file.
2. Read `project-scope.md` §§1, 3, 5 and the 2026-09-18 R1 amendments;
   `architecture.md` §§3, 5, 7, 8; and `implementation-plan.md` U-series,
   V-23–V-34, and R1-01. Read the specific task's implementation before editing.
3. Read `audits/2026-09-21-target-vs-current-ui-audit.md`, including its
   corrections. Inspect original PNGs; filenames alone are not specifications.
4. Inspect git status/branch/log. Preserve other work. Start with the first
   incomplete task below; use a feature branch per task/change.
5. Look up library APIs using Context7 as directed in `agent-setup.md` §4.
   No new dependencies without asking. Use existing components where suitable.
6. After finishing, update the task checkbox and append evidence to §6.
   A task is not complete merely because it builds or resembles one screenshot.

### Product and release context

Aqua is a multi-tenant operating system for Indian sports/recreation businesses,
starting with swimming, pool bookings and a small café. Owners need collections,
capacity and eventually batch profitability; coaches need fast offline attendance
and assessments; reception needs member lookup, check-ins and counter payments;
ops configures tenants. One generic dashboard does not serve these jobs.

Next.js 15 App Router, strict TypeScript, Tailwind, Drizzle/Postgres RLS,
Better Auth, pg-boss; local SVG avatars and server-rendered charts already exist.
Tenant access uses `withTenant()`, mutations audit in-transaction, money remains
bigint paise, timestamps store UTC and display IST. UI changes preserve these.

PR #187 shipped V-23–V-27: shifts, staff attendance, premises QR, leave and
approval. Payroll V-28–V-34 is pending. R1 payments are counter-recorded, with
no gateway. WhatsApp sending remains a mock pending the provider decision.
Parent expansion is deferred: preserve the zero-JS `/p/[token]` surface.
Revenue targets and operating-expense data cannot be invented for a chart.

### Reference inventory and required viewports

| Reference in `docs/images/` | Use | Verification |
|---|---|---|
| `coach-target-design.png` | Today, sessions, register, member detail, tools | 390×844 |
| `receptionist-target-desgin.png` | Ten front-desk screens; filename typo is real | 390×844 |
| `owner-target-design.png` | Nine **desktop** owner screens | 1280×900 + own mobile adaptation at 390×844 |
| `owner-webapp-target-design.png` | Alternate desktop owner board | Same two viewports |
| `ops-target-design.png` | Overview, tenants, detail, effective configuration | 1280×900 |
| `member-target-design-main.png` | Student/parent overview, attendance, progress, sessions, tools | Deferred expansion; existing link at 390×844 |
| `member-target-design.png` | Parent board adds fees/payments | Same R1 deferral |

Targets guide layout and workflows. `DESIGN.md` governs the visual system.
Resolve conflicting owner-board details by the implemented domain and this plan;
record any remaining product choice before building. The four-item mobile nav
and current no-More rule stay; desktop navigation need not mirror four items.
No new dummy links, fake metrics, fabricated trends, photo upload or gateway.

## 2. Known corrections and constraints

- The audit is preliminary evidence, not a complete accessibility certification.
  Some captures were empty states and some filenames misstate their viewport.
  Re-capture required states; inspect image dimensions, not just filenames.
- `/owner/reports` SQL grouping and `/check-in/` middleware blocking are real
  source-confirmed defects. Treat as high-priority broken flows (P1); P0 is
  reserved here for system-wide outage, data loss or a critical security event.
- Attendance controls already colour selected Present/Late/Absent states.
  Unselected outline controls are not proof of missing state treatment.
- Reception already renders checked-in times. Payment QR selection already has
  an optional amount input. Owner location switching exists for >1 location.
- `member_notes` already exists. Coach notes require a visibility/permission
  decision and coach-roster scoping, not an assumed new table or broad
  `members.write` grant. Internal notes must not leak to parents.
- Analytics does not currently compute prior-period comparison deltas. Expense
  series and revenue targets are absent. Define semantics before adding trends.
- Approved accents include marine; mango is only the default. The target More
  tab is a fourth item, not a fifth, but still conflicts with current policy.
- Existing 38px owner hero typography appears with populated attendance data.
  Duplicate responsive DOM does not establish duplicate accessibility nodes:
  `display:none` branches are hidden. Test actual accessibility output.

## 3. Required design quality

**UX method:** before styling each task, map entry → decision → action → result
→ recovery for the role. Identify the main question the screen must answer.
Keep frequent actions prominent; progressively disclose occasional controls.
Preserve location/date/filter context, provide a clear way back, and distinguish
recorded success from pending sync. Compare baseline task time, steps and errors
with the redesign using identical fixtures. Report simulated walkthroughs as
such; do not claim real-user validation without participants. Visual fidelity
never justifies extra steps, lost context or misleading confirmation.

**Composition:** each screen has an identifiable purpose, one main action and
clear primary/secondary information. Owner desktop uses genuine columns/tables;
avoid stretching a phone's vertical stack across a laptop. Mobile remains
thumb-friendly with 44×44px targets and 16px input text.

**Hierarchy:** use the existing display scale for the key figure, restrained
secondary metrics, consistent headings and readable meta text. No rule requires
every metric to be 38px. Human identity, schedule metadata and real state should
provide context. Add icons/avatars when they improve scanning, not to fill space.

**Colour:** accessible neutral surfaces, approved tenant accent for actions,
semantic colour for actual status, and data colours for charts. Do not assign
good/late/warn to arbitrary course categories. A categorical chart palette is
a separate design decision. Preserve text/icons alongside colour.

**States:** inspect empty, populated, loading, failure/retry, disabled, selected,
success, long names, zero values and permission-limited states. Keep unmarked
distinct from absent. A no-requests queue can be informational; do not invent
an inappropriate action just to satisfy an empty-state template.

**Details:** baseline alignment, consistent row heights/radii, number alignment,
line wrapping, real date ranges, sticky-header offsets, safe-area padding,
keyboard focus, label association, contrast and last-row visibility above nav.
Charts need units, period, legend, accessible description and honest gaps.
Trends need a comparable denominator/period; never copy numbers from a PNG.

## 4. Ordered tasks

All tasks start **pending**. Preserve earlier functional acceptance criteria.
If blocked on a decision, record it and ask; do not silently skip ahead.

### [ ] UR-01 · Restore owner Reports
**Read:** `lib/services/owner-analytics.ts`, `lib/actions/owner-analytics.ts`,
`app/(owner)/owner/reports/page.tsx`, chart components, architecture money rules.
**Build:** fix SELECT/GROUP BY/ORDER BY timezone-expression binding. Use a safe
alias/subquery/ordinal approach; never interpolate unchecked SQL. Examine the
existing `Number(r.paise)` conversion and JS reduction against the bigint rule;
keep authoritative amounts exact, separating any bounded chart coordinates.
**Done:** Reports renders empty and populated periods; IST month-boundary cases
and tenant isolation are verified with real Postgres. A regression fails with
the original grouping. Document money-type issues beyond this task's boundary.

### [ ] UR-02 · Restore premises QR route
**Depends:** UR-01. **Read:** `middleware.ts`, `app/check-in/[token]/page.tsx`,
premises services/tests, `scripts/e2e-host-boundary.ts`, architecture isolation.
**Build:** allow `/check-in/` on the tenant host while preserving ops separation.
Extend the existing host-boundary test rather than claiming none exists.
**Done:** valid QR reaches sign-in/check-in, invalid/expired/wrong-tenant tokens
are handled, ops host refuses the tenant route, and no owner permission leaks.
Measure the signed-in phone flow; record login time separately. Check print CSS
does not hide the QR, and preserve a usable non-scan link fallback.

### [ ] UR-03 · Accessible foundations and shared patterns
**Depends:** UR-02. **Read:** `DESIGN.md`, `app/globals.css`, shared Button,
StatusBadge, avatar, fields, `lib/branding/accents.ts`, existing a11y tests.
**Build:** fix contrast roles before spreading them to new UI. Measured source
pairs: ink-3/paper 3.35:1; ink-3/deck 2.91:1; white/mango 2.61:1. These fail
normal-text AA. Define accessible foregrounds for every approved accent.
Specify reusable summary, tabs, row, state and desktop-table treatments; build
only the primitives needed next. Fix duplicate “Unpaid · unpaid” wording in
both display and select. Standardise date-input guidance without assuming
`lang="en-IN"` changes browser-native rendering. Update shipped pattern docs.
**Done:** contrast calculations and rendered normal/hover/focus/disabled states
are checked; keyboard, labels, 44px targets and readable input values pass.

### [ ] UR-04 · Reproducible visual fixture and baseline
**Depends:** UR-03. **Read:** `demo-runbook.md`, seed scripts and reset guards.
**Stop:** ask before changing seed/reset scripts or resetting persistent data.
The earlier reset approval was for one operation, not blanket future approval.
**Build after approval:** use disposable deterministic fixtures for populated
payments/dues, café menu, shifts, requests, attendance, assessments and ops
metrics. Verify past-session IST timestamps and location assignments. Existing
empty states stay testable. No `DEMO_MODE` branches in services or DB code.
**Done:** each later surface can be exercised without relying on the weekday;
record fixture date/timezone and dataset. Do not claim unobserved flows pass.

### [ ] UR-05 · Coach Today and session navigation
**Depends:** UR-04. **Read:** coach home/schedule pages and coach read services;
target screens 1–2, architecture role/location scope.
**Build:** compact identity/date header, useful daily summaries, session time
ranges/location/count/state, dominant next action and existing actionable work.
Separate today's execution from weekly planning. Status filters use actual
session lifecycle/time rules; do not infer completion solely from elapsed time.
**Done:** a coach identifies the next session and opens its register immediately;
empty/cancelled/ongoing/long-name states work at 390×844. No invented tasks.

### [ ] UR-06 · Register and coach member detail
**Depends:** UR-05. **Read:** `register-board.tsx`, offline hook, member-detail
components, assessments, member-notes actions/services; target screens 3–4.
**Build:** compact count summary, roster find/filter if useful, clear selected
states and sync feedback; member header and coherent attendance/progress layout.
Keep Present/Late/Absent, bulk marking, undo/retry where present and autosave.
**Decision:** coach-note audience/permissions before exposing existing notes.
**Done:** rapid marking remains usable one-handed and offline, states announce
accessibly, notes stay authorised, progress has honest unassessed states.

### [ ] UR-07 · Reception Today and member lookup
**Depends:** UR-06. **Read:** reception home/check-ins, people/search services,
`lib/nav.ts`; target screens 1–3 and 6–8.
**Build:** prioritised work summary, prominent member lookup and payment/check-in
entry points, readable session/member states, existing marked-at timestamps.
Keep audited staff-reason controls. Decide navigation placement within four
items; do not blindly rename Me to More. Any bulk check-in preserves marked
rows, permission checks, audit behaviour and partial-failure feedback.
**Done:** reception finds an existing member by supported identifiers and reaches
the correct record/action; populated and empty days work at 390×844.

### [ ] UR-08 · Reception enquiry/payment journey
**Depends:** UR-07. **Read:** reception enquiry/detail/collect-payment pages,
invoice/payment actions and existing member panels; targets 3–5, 9–10.
**Build:** coherent member-context navigation, due/plan information and existing
counter-payment affordances; preserve quick enquiry capture, deeper detail and
validation. Reuse optional QR amount entry. Announcements require authorised
audience and reachable inbox; expose only currently deliverable channels.
**Done:** users understand QR display versus recorded payment; no automatic
“paid” inference, no gateway, duplicate payment or fabricated WhatsApp delivery.

### [ ] UR-09 · Owner navigation and dashboard
**Depends:** UR-08. **Read:** owner shell/nav/dashboard, dashboard and fees reads,
both owner boards; architecture permissions/configuration.
**Build:** task-oriented desktop nav to existing routes, useful top bar, current
location selector, accessible profile/sign-out. Retain four-item mobile nav.
Use real collections/dues and attendance/capacity hierarchy; remove stale
“money not built” assumptions. No revenue-target arc without a domain decision.
**Done:** dashboard directs owners to overdue money, uncovered work and capacity;
desktop composition is intentionally multi-column, mobile remains focused.

### [ ] UR-10 · Owner members and member workspace
**Depends:** UR-09. **Read:** members board, member-detail route/panels, notes,
subscription/invoice services; both owner boards' member screens.
**Build:** desktop working table with useful supported columns/filters, compact
mobile rows, person avatars, clear identity header and contextual sections/tabs.
Move the printable identity card behind its action instead of duplicating the
profile. Preserve guardians/consent/enrolment/payment/progress workflows.
**Done:** desktop scans/comparisons and mobile lookup both work; a seeded long
name never hides the key action; every tab shows real data or an honest state.

### [ ] UR-11 · Owner schedule and staff workspace
**Depends:** UR-10. **Read:** owner schedule grid/service, staff, roster, leave
and QR pages; target calendar/staff panels; architecture scheduling/pay.
**Build:** desktop time×day calendar with readable collisions/capacity and list
alternative, mobile day agenda; staff table/list and discoverable roster/leave
controls. Preserve timezone, recurrence, substitution and approval semantics.
**Done:** both viewports show matching sessions/counts; filters and week changes
work; publication, leave review/uncovered sessions and QR access remain usable.

### [ ] UR-12 · Owner money, reports and settings
**Depends:** UR-11. **Read:** fees/report/settings routes and service contracts;
target fees/report/settings panels; R1 scope and pending V-35–V-37 dependencies.
**Build:** organised filters/tables, clear amounts/periods/actions, purposeful
chart placement and settings groups. Define prior-period comparisons before
adding deltas. Label collections accurately, not as profit; expenses/targets
without data remain absent with clear scope. Keep location/business-hours editing.
**Done:** selected period reconciles to underlying rows, empty/loading/error
states are usable, comparisons are honest, 390×844 and 1280×900 both pass.

### [ ] UR-13 · Ops desktop refinement
**Depends:** UR-12. **Read:** ops overview/tenants/configuration, metrics and
health services, `ops-platform-design.md` adopted decisions; ops target.
**Build:** compact desktop header/nav, clear metrics freshness/unavailable states,
working filters/table, readable provenance and existing role previews. Verify
hidden responsive branches through the accessibility tree before changing them.
Correct misleading feature readiness labels through normal catalogue workflow.
**Done:** target's four workflows are visually reviewed at 1280×900, including
permission preview below the fold; no tenant data or host-boundary regression.

### [ ] UR-14 · Parent compatibility and cross-role detail pass
**Depends:** UR-13. **Read:** parent token handler/template and both member boards.
**Build:** polish existing link hierarchy/contrast/mobile spacing only; explicitly
inventory deferred parent screens. Sweep labels, empty-state next steps, forms,
date/money formatting, keyboard paths, print, headers/nav overlap and long data
across all changed roles. Preserve token privacy, expiry and zero client JS.
**Done:** every discrepancy has a fix or recorded scope decision; no unsupported
parent nav/payment/progress UI; existing zero-JS verification passes.

### [ ] UR-15 · Finish gate and handoff
**Depends:** UR-14. **Build:** screenshot/evidence index by role, route, state,
actual viewport, fixture date and task; side-by-side comparison to original PNGs.
**Done:** no broken critical flow, known contrast failure, horizontal page
overflow or unreachable primary action remains. Each deviation has a reason.
Update the audit and main plan honestly, including unresolved dependencies.

## 5. Verification and delivery for every implementation task

- Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and applicable
  bundle/font/focus checks. Guard tests must exercise real behaviour and prove
  the reported defect fails. Follow protected-test ownership in repository docs.
- Run role-specific browser checks at the viewports above. Clear service workers
  and caches; recheck dev-server/HMR failures before calling them product bugs.
  Record any untested state explicitly. Passing CI is not visual acceptance.
- No public or persistent DB reset without current approval. Never fix a
  migration by editing an applied file. Seed changes remain separate from UI.
- Commit/push/open a PR only when requested. If requested, PR targets main,
  PR CI must pass and the human merges under the self-merge suspension.

## 6. Continuation record

Documentation handoff only; no UR implementation completed. The prior audit
captures are local, gitignored evidence, not portable acceptance proof. No code
or database change is authorised merely by a task appearing in this plan.

After each task record: task ID, commit/PR if any, files changed, tests and
results, screenshot locations + actual viewports, deviations, remaining blockers
and next task. A fresh model should be able to continue from that entry alone.
