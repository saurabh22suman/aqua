# KhelSuite workspace redesign

Human-approved visual direction, 20 November 2026. Start with Owner Today
when implementation is assigned. The prototype illustrates selected tasks
with synthetic data for five roles. Every production workflow still follows
its existing routes, grants, facility boundaries and server actions.

## Start here

1. Check the current branch, HEAD and dirty files. This handoff was prepared
   in `feat/owner-courtside` at base `77405fdf9c55ae5c1d58009235417302ea99ebc0`
   with existing Courtside work in the tree. Preserve that work. Confirm
   inherited audit fixes in the actual checkout before treating them as present.
2. Read only the current design section, the relevant UI acceptance rows and
   the files for the assigned slice. Capture the current app with a disposable
   fixture before changing it. [Current design](../../DESIGN.md#approved-workspace-direction--20-november-2026) · [UI acceptance](../ui-quality-contract.md#workspace-redesign-behaviors--20-november-2026)
3. Open the local HTML in a browser. The top-right role picker changes
   workspaces. **Summit** demonstrates the same shell with aquatics terminology
   and a different module set. Compare the mock and the running app at the same
   width. The mock illustrates hierarchy, spacing, and feedback. Use approved
   app tokens, the approved typography and actual role capabilities when
   implementing it. Check glyph coverage and inspect the rendered fonts in
   the browser. CSS family names alone do not establish type fidelity.
   [Interactive mock](../design/workspace-2026-11-20/KhelSuite-Workspace.html)
   · [Owner desktop](../design/workspace-2026-11-20/Owner-overview.png)
   · [Four mobile workflows](../design/workspace-2026-11-20/Mobile-workflows.png)

The standalone reference has SHA-256
`703dfe7117299c4575740c7c6f5c61857d21c87d5cfba17ca48b71428aaf778c`.
Its role picker, forced failures, connection toggles, demo receipts and sample
data are preview controls. Keep them in the reference artifact. Changes to role
navigation, product branding, authentication, modules or authority require a
specific product assignment.

## First slice · Owner Today

The later Floodlit reference controls layout, art and type for Owner Today.
Use the earlier details below for scope, compatibility and route context.
[Approved reference and build check](../design/floodlit-owner-2026-11-20/README.md)

**Earlier mobile revision.** The older build used Instrument Sans throughout
after an incomplete Barlow subset produced mixed title glyphs. Its neutral
financial card and settings explain the current runtime baseline. Use the
Floodlit asset and type requirements for the next visual pass. Check rendered
glyphs, title and amount wrapping, and both comparison viewports.

- **Build the new hierarchy as a complete page composition.** Put facility
  and date above the financial snapshot. Put the fixed Needs attention slot
  beside it on desktop and directly below it on phones. Put the compact
  next-session image inside the agenda, then keep collections accessible
  further down. A populated first phone screen should show both the financial
  figures and the priority action. Preserve existing Owner rail and tab access.
  [Owner route](<../../app/(owner)/owner/page.tsx>)
  · [Home composition](../../components/owner-dashboard.tsx)
  · [Home components](../../components/owner-home/)
  · [Owner mobile navigation](../../components/owner-ui/owner-mobile-nav.tsx)
- **Reuse scoped financial reads.** The day figure is gross captured payments
  for the tenant-local day. Outstanding is the open invoice balance now.
  Overdue belongs inside outstanding. Use the existing money summary, facility
  rules and payment permissions. Distinguish zero, failed read, and excluded
  by permission. The repo's Fees Dues view currently returns open balances
  generally. If the work includes an overdue-only link, carry the semantic
  filter through the server query and verify its amount, count, and permission
  against the Home figure. Keep existing period controls on period-bound views.
  [Dashboard read](../../lib/services/dashboard.ts)
  · [Facility scoping](../../lib/services/facility-scope.ts)
  · [Fees route](<../../app/(owner)/owner/fees/page.tsx>)
  · [Fees service](../../lib/services/fees-hub.ts)
- **Lead with a real actionable issue.** Use authorized existing facts for
  the reason, site and next step. A confirmed coverage issue can precede cash
  review when it requires immediate attention. Keep lower-priority items
  reachable. The branch's current Home filters overdue rows out of the main
  queue, so check overdue discoverability explicitly when composing the new
  lead. Use existing schedule or collections destinations when they support
  the action. Assigning cover directly from the card needs its own production
  contract if the supported flow ends at Schedule.
  [Current attention render](../../components/owner-dashboard.tsx)
  · [Collections report](<../../app/(owner)/owner/reports/collections/page.tsx>)
- **Maintain context.** Carry the selected facility and applicable reporting
  period through links and Back. Sign-in uses All unless the person chose an
  authorized default facility for this business on this device. Keep the
  business-account choice separate from the facility filter. Include a single-site case, an all-sites
  Owner case and an assigned-sites Manager case. Preserve the real handling of
  unassigned records. The current dashboard facility breakdown is membership
  and attendance. A new per-facility financial breakdown needs scoped reads and
  reconciliation evidence before release. Reuse shared token mappings for
  Court Blue, Clay Season and Floodlights. [Courtside appearance mapping](../../lib/theme/courtside.ts)

## Follow-on slices · existing roles and routes

Use the same shell and components. Preserve every authorized route outside
the mock examples. Apply each row when that slice is assigned.

| Slice | Behavior to carry forward | Start in |
| --- | --- | --- |
| **Manager and Accountant** | Keep today's sessions and staffing prominent for Managers. Facility and finance access are determined by the actual grant. Give Accountants the relevant Fees and Collections destinations. | [Role surfaces](../../lib/auth/surface-access.ts) · [Manager grants](../../lib/services/manager-role-grants.ts) |
| **Enquiry conversion** | Replace old results as the query changes. Clear an outdated guardian choice. Keep the selected guardian and prospective member visible at confirmation, then show the actual outcome. | [Owner enquiry detail](<../../app/(owner)/owner/enquiries/[enquiryId]/page.tsx>) · [Reception enquiry detail](<../../app/(reception)/reception/enquiries/[enquiryId]/page.tsx>) |
| **Reception payments and bookings** | Put the selected member and retry next to the lookup result. Separate failed lookup, no matching invoice, confirmed payment and unknown outcome. Use an existing authoritative transaction lookup or an explicitly scoped recovery change before exposing a status-check action. Server state decides booking cancellation and payment eligibility. | [Reception Dues](<../../app/(reception)/reception/dues/page.tsx>) · [Reception Bookings](<../../app/(reception)/reception/bookings/page.tsx>) |
| **Coach attendance** | Keep session and roster context visible. Reuse existing feature-gated offline registration and scoped replay. Say when a mark is saved locally, synced or rejected. Explain disabled offline controls and restore availability on reconnect. | [Register route](<../../app/(coach)/coach/register/[sessionId]/page.tsx>) · [Register board](../../components/register-board.tsx) · [Offline register hook](../../lib/hooks/use-offline-register.ts) |
| **Family announcements and receipts** | Retain the authorized child in billing and through receipt access. Match announcement visibility to the actual audience. Use the existing issued receipt and legacy Parent route, maintain private/no-store behavior and preserve zero-JS for the legacy Parent surface. | [Family billing](<../../app/(self)/family/billing/[memberId]/page.tsx>) · [Family announcements](<../../app/(self)/family/announcements/page.tsx>) · [Owner announcements](<../../app/(owner)/owner/announcements/page.tsx>) · [Legacy Parent receipt](<../../app/p/[token]/receipt/[paymentId]/route.ts>) |

## Verification for an implementation assignment

1. Use `aqua-ui-quality`, `aqua-tdd-secure` and an isolated test database
   where required. Start with the relevant Home composition and scope tests.
   Update expectations for the approved hierarchy while retaining permission,
   exact-amount, scope, and destination checks. Keep focused tests behavioral.
   [Courtside Home tests](../../tests/owner-courtside/home/today.test.tsx)
   · [Dashboard scope tests](../../tests/review-dashboard-scope.test.ts)
   · [Fees scope tests](../../tests/mobile/owner-fees-scope.test.tsx)
2. Compare running Owner Home against the reference at 390×844 and 1280×900.
   Verify the type families, glyphs, sizes and spacing as well as the visual
   ordering. Check 320px and the intermediate desktop size from the UI contract. Cover
   no-finance, quiet day, missing data, site switch and drill-down return.
   For shared shell changes, also check the breakpoint, scroll ownership and
   protected navigation described in the UI contract.
3. In the role being changed, test visible recovery, focus and screen-reader
   status, reduced motion and the button path for each gesture. Test against
   the real app and its authorized fixtures. For changes affecting legacy
   Parent, run `pnpm e2e:parent-link-zero-js` and keep the existing route tests.
   [Legacy receipt test](../../tests/tier1/parent-receipt-route.test.ts)
4. Report branch and diff, commands and results, viewports and captures, and
   differences from the reference with reasons. Separate mock fidelity,
   functional verification and approval of implementation. Use
   `/aqua-ui-contract Owner Home` for the scoped build assignment or
   `/aqua-ui-check` for independent browser review once there is a running app.
   [OpenCode project commands](../opencode-development.md)

## Account settings and role switching

Owner Settings and staff account pages now offer Switch role for additional
assigned roles. Member and Family place it with their account controls.
The panel names the active role. Two business accounts with the same staff
role use the existing business account switch. The database supports one
staff role per business and separate Member and Family links.

The choices are derived on the server from the signed-in account. Member and
Family choices require a live verified linkage in the current business. A
matching live session can open that view directly. Otherwise the existing
PIN form confirms access. The destination still checks the requested role
and business. Switching staff business accounts continues to use the
existing attendance sync and offline clearance flow.

The Settings test first failed because Switch role was missing. The final
focused run passed 70 tests, including revoked links, absent destination
sessions and same-role business accounts. Typecheck and lint passed.
Build `-Rw648Q7prqM9lRPRvbD9` passed the 150 kB route and font budgets.
The isolated preview verified Coach to Family and back, fresh PIN
confirmation, keyboard activation, and Coach to Worker business switching
at 320px and 390px. Owner Settings was also verified at 1280px. Run Family
sign-ins serially for a shared sample account because a new sign-in rotates
the previous session.

## Usability review follow-up

The local review visited the public, tenant and Ops routes and ran additional
checks for Manager, Administrator, Accountant and Curriculum Lead. It covered
142 route and role combinations at the usual review widths and 106 routes
and role combinations at 320px.

The browser checks initially found sign-in tabs ahead of the form, staff
account links with zero spacing, larger Manager date controls, 18px and
19.5px settings disclosures, and stacked Family actions. The Reception test
also found that the search identifiers were only in the placeholder. These
were addressed in build `ng3U6HwulEsqWX7ZGJJ8L`.

Browser checks passed at 320px and 390px, plus the Ops disclosure at 1280px.
They verified the sign-in options and carried business, account link spacing,
Manager date sheets and focus return, invoice search and recovery, and Family
actions with the child's name in the accessible label. Paired Family actions
retain 44px targets. The staff-backed view offers one sign-in action per card.

The focused run passed 118 tests. The PIN recovery frame test also fails
on the previous snapshot because it expects the older About Aqua sidebar.
Typecheck, lint and the route and font budgets passed. The comparison images
and findings are in the local `khelsuite-ux-polish-2026-11-23` review.

## Compact controls and Worker navigation

Reception groups the counter actions and member shortcuts. The payer
search places Search beside its input and keeps the accepted identifiers
visible. Owner Fees groups Overdue and All due, Enquiries puts the queue
beside the expansion control, and program actions use short labels.
Coach, Member, Family and Ops also use shorter actions with contextual
accessible names where needed. Existing destinations, permissions,
receipt requests and record mutations keep their current paths.

Worker uses Today, Schedule and Me. Today loads shifts and attendance.
Schedule lists published shifts and opens Leave as a secondary screen,
with Schedule still selected. Me holds identity, preferences, role
switching, help and sign-out. Announcements opens from Today. The new
pages check the Worker role and staff.self before loading account data.

The first browser run reproduced stacked actions, longer labels and the
missing Worker navigation. The intermediate Worker revision exposed four
tabs and clipped leave dates when paired at 390px. The final layout has
three tabs and shares the full-width date fields used on other staff pages
at narrow widths. The browser checks exercise the route and subsections,
keyboard navigation, receipt downloads, and leaf controls that retain the
correct scope. The focused suite includes updated sign-in frame and
Reception router checks and passed 120 tests.

Local build `On3q-oTpyjKuOqUiIfF-F` passed the 320px and 390px
journeys, with the Ops controls also checked at 1280px. The Worker
tests verified Leave under Schedule, full date text, keyboard navigation,
and denial of the new pages for a Reception account. Twelve sampled
page states had no automated accessibility findings. The local
`khelsuite-compact-actions-2026-11-23` review has the before-and-after
screenshots.
