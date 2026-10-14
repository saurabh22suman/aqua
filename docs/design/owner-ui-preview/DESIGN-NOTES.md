# Owner UI design preview — design notes

Companion to `README.md`. Input: `docs/audits/2026-10-13-owner-ui-review-and-image-prompts.md`
(§4 visual brief, §5 page prompts 01/02/05/07 and the Fees/member secondary
prompts, §7 non-visual findings, §8 order), `docs/audits/2026-10-13-role-workflow-audit.md`
and both remediation ledgers. This stage is a **design proposal**: it does
not change production routes, capabilities or tests.

## 1. What the proposal changes (and what it deliberately keeps)

Kept: the token system (`app/globals.css`), Bricolage Grotesque + Instrument
Sans, the 20/14px radius vocabulary, semantic money/attendance colour,
status words beside colour, grouped sidebar, four-item mobile nav, the
five Fees tabs, template-wording and money/invoice semantics.

Changed: composition and workflow arrangement only.

- **Desktop space works.** Home is a 60/40 money-and-decisions split; the
  registers card pairs completion evidence with capacity lanes; Fees uses
  aligned tables instead of stacked cards; the member page is a 2/3–1/3
  evidence-plus-context layout.
- **Creation follows management.** Add swimmer is revealed by navigation
  from the directory header, not a permanent form above records; the
  invoice's record-payment panel lives inside the selected invoice.
- **Comparison is possible.** Dues, invoices, transactions and members are
  aligned columns on desktop with identity first, amounts tabular and
  right-aligned, and states as words.
- **Mobile is restructured, not compressed.** Directory rows become
  identity-first blocks; Fees rows keep amount and balance immediately
  visible; the tab strip signals continuation with an edge fade.
- **Unnecessary nesting removed.** Cards replace card-in-card stacks;
  dividers and alignment carry the structure.

## 2. The three reusable workspace patterns

**Working list/table** — Members directory, Fees Dues, Invoices and
Transactions. Identity leads; comparable fields align; status and amounts
keep fixed positions; one row action (“Open” / the row itself) leads to the
detail. Long lists sit in one container with dividers, per DESIGN.md §3.

**Bounded editor** — Add swimmer (`/member-new`) and Edit member
(`/member-edit`): a 700–760px form with persistent labels, grouped sections
(identity / guardian / consent), field-level errors that keep the draft,
explicit Cancel, one primary action, and mobile single-column with footer
clearance. Guardian mode is explicit (existing person vs new guardian) and
processing consent is a separate required control from communications
consent.

**Evidence with contextual action** — the expanded invoice in Dues keeps
lines, totals, recorded payments, receipts, record-payment, reversal and
void together, each labelled with its consequence (“reversing corrects the
ledger; it never pays money out”); the member Overview pairs each evidence
block with its next permitted action. Home's attention rows state a reason
and a destination.

## 3. Role perspective (owner as reviewer, not operator)

- Attendance is **read-only** for the owner: “View register”, never “Take
  attendance”. Coaches mark assigned registers; reception backs up at the
  counter — stated in the registers card copy.
- Enquiries appear on Home as **oversight evidence** (overdue follow-ups
  with names and dates) with drill-down, not a capture form.
- Curriculum editing is absent from the owner workflow. The member Progress
  tab is read-only and says the designated curriculum lead maintains the
  framework. This does **not** resolve the Owner/Admin `levels.write`
  policy question.
- Money authority stays with the owner: record, receipt, reverse, void —
  with reverse and void visually distinct and confirmation on void.

## 4. Proposed controls → current capabilities

| Preview control | Current capability (source) | Status |
|---|---|---|
| Home money panel: “Payments recorded today”, Outstanding, Overdue | `lib/services/dashboard.ts` daily collections + fees overview; same labels as `components/owner-dashboard.tsx` | existing, unchanged semantics |
| “Needs you today” queue (overdue fees, overdue follow-ups, unstarted register) | `needsAttention` items; per-item `href` | existing |
| “View register” on an unstarted register | **No owner read-only register view exists**; owner currently reads completion via dashboard/reports/sessions | **proposed — needs a build decision** (see §5.1) |
| Attendance / Collections trends, “last 30 days” | `lib/services/owner-analytics.ts` + `components/dashboard-trends.tsx` (ECharts desktop / SVG mobile) | existing; preview draws plain SVG for review only |
| Sidebar groups, search top bar, four-item mobile nav | `lib/nav.ts`, `components/owner-shell.tsx`, `bottom-nav.tsx` | existing |
| Breadcrumbs | not currently rendered by pages | proposed (presentation only) |
| Members search + status filter, facility via switcher | `members-board.tsx` + `listMembersAction`; `?facility=` switcher | existing |
| Import / Add swimmer | `/owner/members/import`, `/owner/members/new`; `members.write` | existing, permission-gated |
| Member header (avatar, code, location, minor, joined, participation) | member page header + `people.ts` projection | arrangement proposal |
| Participation vs Plan & billing split | participation status and subscription services are separate today | existing data, clearer labels |
| Last-7-sessions tiles, Attendance % | member attendance grid data | presentation proposal |
| Progress bands, “assessments are recorded by coaches” | read-only skill progress; coach `levels.assess` | existing |
| Notes composer + list (staff-internal) | member notes panel/service | existing |
| Documents unavailable state | documents panel already truthful | existing |
| Guardian existing/new mode, selected identity, consent split | member create form + guardian/consent requirements; **existing-person search replaces raw id entry — needs an authorised person projection** | partly proposed (see §5.2) |
| Fees five tabs | `/owner/fees` tabs | existing |
| Period vs current-balance summary wording | fees overview + collections services (`net of reversals` vs current balances) | existing data, clearer scope labels |
| Dues / Invoices / Transactions tables | `fees-invoice-list.tsx`, `invoice-expanded.tsx`, payments service | existing, aligned presentation |
| Record payment, Receipt, Reverse, Void | `recordPaymentAction`, `/api/receipts/[id]`, `reversePaymentAction` (`payments.refund`, ledger-only), `voidInvoiceAction` (`settings.manage`) | existing |
| Void confirmation panel | current void has an inline reason + confirm; this makes the consequence explicit | presentation improvement |
| Plans read-only hub + “Manage plans” | plans catalogue; editing lives in Settings → Plans | existing |
| Parent-link “Copy link” | parent-link actions are owner/admin-only | existing authority |

No control in the preview is shown as shipped when it does not exist; the
two proposed items above are marked.

## 5. Decisions needed

1. **Owner read-only register** — either build a strictly read-only register
   view (view marks, no marking controls) or point “View register” at the
   existing Sessions/reports evidence. Prompt 1 made owner attendance
   read-only at the action level; this surface does not exist yet.
2. **Existing-person search for guardians** — the review's member-create
   prompt calls for a picker; today the flow needs a person projection with
   `members.read`-appropriate fields, matching the staff-form gap already
   recorded in the role audit. Preview shows the intended control only.
3. **Filter-context preservation** — returning from a member to the
   directory should restore search/status. Preview demonstrates the visual
   context (chips); restoration logic is an implementation decision.
4. **Guardian name projection for invitations** (recorded in the review) is
   untouched here; still needed before the identity-first invitations table
   can ship.
5. **Owner/Admin `levels.write` backfill** — unresolved Prompt 1 policy
   question. This preview assumes curriculum maintenance stays with the
   designated lead and does not settle the grant either way.

## 6. Rollout order for the remaining owner pages

1. **Shell + patterns**: breadcrumbs, aligned tables, bounded editor
   primitives; no visual-token changes.
2. **Owner Home** as composed here (money/queue/registers/trends).
3. **Members**: directory columns, member Overview arrangement, both
   bounded editors (labels, cancel, validation, consent split).
4. **Fees**: summary scope labels, Dues/Invoices/Transactions tables,
   expanded invoice with record/reverse/void and confirmation.
5. **Programs, Sessions, Schedule, Roster, Enquiries, Announcements**:
   apply the three patterns (batch tables, exception list, time×day grid,
   week board with explicit publish scope, list-first enquiries with
   oversight framing, composer/history split).
6. **Settings reorganisation** and complex editors (Configuration, Plans,
   Skills, Terminology, Activities).
7. **Small pages** (Academy, Alerts, read-only Staff, Onboarding): polish
   only; do not overdesign.
8. **State verification pass** on the real implementation: empty, loading,
   failed, permission-limited, long names, exact money, keyboard/touch,
   restored filter/date/location context, honest delivery states.

## 7. Open Prompt 1/2 items (not closed by this stage)

The Prompt 2 ledger records a green combined suite except seven
human-owned tier1 pin files (Prompt 1 contract changes and two
pre-existing fixtures), and the Owner/Admin `levels.write` policy question
stays open. Nothing in this preview changes tests, grants or schemas; the
preview must not be cited as release readiness.

## 8. Preview limitations

- Synthetic fixtures derived from current data structures; no server reads.
- Avatars are the app's `boring-avatars` renderer seeded by member id;
  icons are the app's lucide set; fonts are the repo's `@fontsource`
  files. Everything else is preview CSS.
- The preview bar/state switcher are review chrome, not product UI.
- Search fields, date inputs and “not in this stage” destinations do not
  navigate; they state so when used. Real payment/void/reversal actions are
  never simulated as successful.
- Native date inputs render in the browser's locale; production still needs
  the en-IN/en-US check required by DESIGN.md.
- Bundle/font budgets are untouched: the preview is served as static files
  and adds nothing to the app bundles.
