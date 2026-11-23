# Owner pastel workspace

The local Owner redesign uses the shared workspace on branch
`feat/all-role-workspace`, based on `77405fdf9c55`. It builds on the
existing local worktree changes and the approved Collections and Week
Planner designs. [Owner design rules](../../DESIGN.md#owner-workspace--approved-pastel-direction-22-november-2026)

## Workflow changes

| Area | Changes |
| --- | --- |
| Home and finance | Seven-day selection changes the dated payments and agenda. Current balances stay current. Fees has separate dues views and exact balance evidence. Invoice and collection actions preserve eligibility and scope. |
| Schedule and bookings | The seven-day planner fits the phone viewport. Session coverage can be filtered by date window. Batch detail links to roster, waitlist and history. Programs labels its search results. Bookings offers one recovery when prices are missing. |
| Enquiries and intake | Overdue follow-ups lead. Capture opens ahead of the directory. Member search restores focus on reset, registration reviews the name and facility, and member profiles link to family and status history. |
| Member maintenance and communication | Editors distinguish care notes, CSV checks focus their review, access links keep the selected member, publishing has a direct route to sent history, and the personal inbox can show unread items. |
| Reports and onboarding | Attendance can focus a group and clear that filter. Capacity exceptions lead. Member and staff reports link to their source records. Setup checks precede the optional guide. |
| Business settings | Settings searches the permitted destinations. Club and billing forms have separate entry points. Branding previews draft changes. Appearance previews the selected preset. Default facility shows the saved choice separately. |
| Facilities and pricing | The facility directory links to creation and financial identity. Sports resources can jump to a site. Price rules show active rule and resource counts. A closure opens its existing form from the start of the list. |
| Billing and development | Café catalogue filters by facility. QR setup focuses its heading. Plans can show active records only. Skills show rubric coverage. Vocabulary links directly to the edited term. |
| Staff and access | Staff filters by type, creation reviews the chosen identity, and profiles lead with login state. Invitation review shows recipient, role and scope, and the list can prioritize pending invitations. |
| Staff operations | Leave identifies pending and historical sections. Attendance filters unmarked records independently of unknown records. Roster opens the day sections from a week strip. The printable check-in poster names the academy and keeps the print action within reach. |

The application continues to use its existing tenant, facility, permission
and feature guards. Filtering and section navigation use records already
authorized by those guards. The redesign requires no schema change,
permission grant or new data service. Exact financial amounts remain in
transaction, invoice and report evidence.

## Local acceptance

The sibling verification workspace contains the actual Playwright probes.
The targeted assertions first failed against the earlier preview. For example,
the Schedule strip measured 336px inside 292px at a 320px viewport, missing
booking prices displayed two links to the same destination, and clearing an
attendance group left the old selection in the form. The final checks exercise
the corresponding fixes against the production-style local build.

- Route captures use synthetic club data, a fresh browser context and
  the real Owner session. Compare phone and desktop images in
  `outputs/khelsuite-owner-workspace/Owner-Workspace-Before-and-After.html`.
- `owner-workspace-flows.cjs` covers the later route batches. The first
  five routes are exercised by `verify-owner-pastel.cjs`.
- The build and test logs in the verification workspace record the budget,
  focus contrast and regression results. This handoff covers local review.

The final build is `rx5PhZkL6lhHuqhdsxJZi`. All 52 Owner pages rendered
at 320×844, 390×844 and 1280×900 with no document-level horizontal overflow.
The five finance journeys, 47 later page checks, four final visual checks
and the desktop scrolling and print checks passed. Typecheck, lint,
209 focused tests and the focus contrast check passed. The largest Owner
route used 149 kB of first-load JavaScript and the Latin fonts used 115.8 KiB.

## Mobile layout and interaction follow-up

The 51 pages outside Home now use layouts for planners, ledgers, directories,
records, editors, reports, settings and setup. The approved Home matched
pixel for pixel at 390px in the comparison.

Schedule keeps the range and facility in a single toolbar. The week strip
starts at 213px instead of 461px at 390px wide and at 254px at 320px wide.
Bookings, staff attendance and roster use the shared DD/MM/YYYY picker in
their own date sheets. More groups the secondary destinations and club search.
The Fees sheet applies the existing reporting period, and the invoice retains
its exact line items and tax in a disclosure. Enquiries, closures, café
categories and QR setup open as short tasks over the related list.

The local build `gri7s67tT641qy3xiPOtm` rendered all 52 routes at 320px,
390px and 1280px without document-level horizontal overflow. Browser checks
covered applying dates and facility filters, keyboard focus return,
swipe dismissal, reduced motion, enquiry draft retention, and desktop
scrolling and print. The focused regression run passed 336 tests. The build
passed the 150 kB route budget and the font budget.

The local comparison is in
`outputs/owner-mobile-redesign/Owner-Mobile-Before-and-After.html`. It contains
the 51 before-and-after pairs and links to the demo app at
`https://localhost:3479`.

## Daily collections date and facility

The report now shows a compact date and facility control with the last seven
days and the shared calendar in a sheet. Apply submits the two choices together.
Cancel keeps the applied scope and any unsaved cash count.

Before implementation, the browser and scope test both failed to find the
compact control. In local build `547gYXum1g2r3c27lJG96`, the browser passed
the scoped apply and focus checks at 320, 390, 1024 and 1280px. It also
recovered from an interrupted report read at 390px. The 23 focused tests,
typecheck, lint and the route and font budgets passed.

The Daily collections comparison now shows loaded payment evidence in the
before and after captures and includes an image of the open picker.

## Session list range control

The Owner session list shows the applied dates next to Needs cover. The
range sheet shows Today, Next 7 days and Full window with the dates for each
choice. The full range uses the same inclusive dates as the server read.

The unit and browser probes initially failed to find the compact selector.
Local build `KlinDkWGjPpCf9ZqL5kaE` passed browser checks for changing
ranges, keeping the coverage filter, keyboard focus, facility-scoped
calendar links, and opening Manage at 320, 390, 1024 and 1280px. The 44
focused tests, typecheck, lint and route and font budgets passed.

The gallery includes the updated session list comparison and range sheet.

## Follow-up on dates and filters

Home links to a single payment day using the following date as the exclusive
end. On 20 November, Home and Fees both show eight payments. The earlier
ledger measurement counted hidden markup for the same records.

Bookings shows the date above both Calendar and Board. The Roster date
control shows the week and facility together, and Publish week opens the
publication scope sheet. Invitations puts its status and sort controls in
one sheet. The mobile Attendance control shows the applied dates.

The focused assertions failed against the earlier capture build and passed
after implementation. All 73 tests in the focused run passed. Local build
`qbsiDxhDMPA3CnnnXugNf` passed the flow checks at 320, 390, 1024, and 1280px
and passed the route and font budgets. The first roster day starts at 483px
on the 390px Worli Main view, down from 668px. The Invoice and Bookings
comparisons wait for the report or payment controls to load.

## Invitation rows and details

Owner Invitations shows only the name and formatted phone number in each row.
A named details button opens a sheet with the role, status, club access and
the existing sign-in actions. Revocation and restoring access keep their
confirmation steps. Invite staff stays in the page heading to keep each
row's details button clear on mobile.

Use the same pattern when the list is primarily for finding a record and
its actions take place after selection. Family sign-in links are a good
fit if the row still shows the person, relationship and access status,
and both numbers stay available together before confirming a pairing.
For Payment QR setup, show the collection destination and status before
opening its QR and management actions. Programs and booking prices could
group secondary actions while keeping batch and price information in view.

Staff and Members already open profiles from their rows. Keep staff role
and login access, and member code, facility and standing, available when
scanning their lists. Enquiry stage and follow-up due dates, invoice
balances and due dates, and closure dates and conflict counts are also
needed before opening an individual record.

Local build `ndoy7ftoJj7K9E_P0kww7` passed browser checks at 320, 390,
1024 and 1280px. The checks opened the sheet by keyboard, verified the
person's data and phone search, dismissed a revoke confirmation with
Escape, checked focus return, and navigated to Invite staff. The
29 focused tests, typecheck, lint, route budget and font budget passed.
The gallery includes the updated list comparison and the open sheet.
