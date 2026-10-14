# Aqua role/workflow permission audit

**Date:** 2026-10-13. **Audited:** branch `fix/comprehensive-review-findings`
@ `870cf1a` plus all uncommitted/untracked working-tree changes. **Audit only:**
no branch switch, no code changes. The 2026-10-09 role audit
(`docs/audits/2026-10-09-role-content-permission-audit.md`) and
`docs/remediation-ledger-2026-10-09-role-audit.md` are used only as the intent
baseline; every claim below was re-verified against the current working tree.

**Method:** navigation (`lib/nav.ts`, layouts, `middleware.ts`), seeded role
templates (`lib/services/roles.ts`), runtime gates
(`lib/auth/action-permissions.ts`, `lib/auth/permission.ts`,
`lib/auth/surface-access.ts`), Server Actions and their services, and data
scope (`withTenant`, `location-access`, `resource-access`).

Legend: **D** = confirmed defect, **P** = proposed product change,
**M** = missing capability, **—** = aligned.

## Role/workflow matrix

| Role | Task & screen | Perms & data scope | Intended responsibility | Nav | Mismatch | Source |
|---|---|---|---|---|---|---|
| **Attendance** |||||||
| Coach | Mark register — `/coach/register/[id]` (Today list) | `attendance.read/mark`; session must be `coachId`=self + location-visible | Coach marks assigned | Prominent (Today row → register) | — | `lib/actions/coach.ts:199-226`; `lib/services/attendance-mark.ts:18-26`; `lib/services/register.ts:88-97` |
| Receptionist | Backup check-in — Reception Today "Today's check-ins" | `attendance.mark/read`; any session at caller's locations (no roster page needed) | Backup marker | Prominent (Today tab panel) | — | `app/(reception)/reception/page.tsx:24,134`; `components/reception-check-ins.tsx:82-109`; `lib/services/attendance-mark.ts:22-26` |
| Owner / Admin | Completion view — dashboard, `/owner/schedule`, `/owner/sessions`, `/owner/reports` + CSV | Reads `attendance.read`/`reports.operational`; but owner template also grants `attendance.mark` | Read-only view | Sessions/schedule **not in nav** (only a link from Programs) | **D** grant wider than intent (mark callable, no UI); schedule discoverability | `lib/services/roles.ts:34`; `lib/auth/action-permissions.ts:47`; `app/(owner)/owner/sessions/page.tsx:30-33`; `lib/nav.ts:26-65` |
| **Admissions / enquiries** |||||||
| Receptionist | `/reception/enquiries[/id]` — capture, follow-up, trial, convert | `enquiries.read/write`; enquiries table has **no location column** → tenant-wide | Owns counter admissions | Prominent (bottom nav) | **D** location-scope gap (mitigated by single-site pilot) | `lib/services/roles.ts:84-85`; `lib/actions/enquiries.ts:42-129`; `db/schema/enquiries.ts:10-29` |
| Owner / Admin | `/owner/enquiries[/id]` oversight/backup | Same keys; nav gated `enquiries.read` | Oversight | Sidebar "Enquiries" | **D** accountant deep-link → uncaught `ForbiddenError` (no `error.tsx`) | `lib/nav.ts:38,95`; `lib/auth/permission.ts:76-79` |
| Owner/Admin + Reception | Waitlist add/cancel/promote (batch page, enrolment panel) | `enquiries.read/write` but actions narrow ctx to `{tenantId,userId}`; services check no batch/location/member | Admission overflow | Inline on batch/enrol page | **D** no resource/location authorization in waitlist service | `lib/actions/waitlist.ts:36-75`; `lib/services/waitlist.ts:36-298` |
| **Member management** |||||||
| Owner / Admin | `/owner/members/**` (360, import, edit, parent links) | `members.read/write`, location-scoped; parent link additionally owner/admin-only | Full management | Prominent (Members tab) | **D** accountant can open `/owner/members/new` (form renders, submit fails uncaught); **P** parent-link reissue absent at desk | `app/(owner)/owner/members/new/page.tsx:8`; `components/member-create-form.tsx:144-171`; `lib/actions/parent-link.ts:45-49` |
| Receptionist | `/reception/members/**` — admit, guardian/consent capture | `members.read/write`; create location-checked via DB membership fallback; full 360 projection | Admit + capture consent | Prominent ("Add member" tab) | **M** no status/lifecycle UI despite `members.write`; mutation panels unguarded in UI | `app/(reception)/reception/members/[memberId]/page.tsx:36-90`; `lib/actions/people.ts:114-122`; `components/member-status-panel.tsx` |
| Coach | `/coach/members/[id]` assigned detail | `members.read.assigned`; `visibleMember` = location + batch-assignment | Assigned learners only (safety context) | Members tab | — (DOB in payload, not rendered) | `lib/services/coach-member.ts:31-56,63-84`; `lib/services/resource-access.ts:80-95` |
| Accountant | Payer-only member finance view | `invoices.read` payer projection; full 360 refused without `attendance.read`/`members.write`; still holds `members.read` → person search/list exposes adult name+phone | Reconcile payers only | No nav; owner home redirects to fees | **D** residual read breadth; **D** deep links to owner pages throw uncaught | `app/(owner)/owner/members/[memberId]/page.tsx:68-85`; `lib/actions/people.ts:56-61,69-76`; `lib/services/people.ts:431-469` |
| All owner-surface | Global search — owner shell only | Coarse `members.read` + per-kind enquiry/invoice | Fast lookup | Owner header | **M** reception entitled but has no search UI | `components/owner-shell.tsx:4,57`; `lib/services/global-search.ts:51-67` |
| **Billing / refunds** |||||||
| Receptionist | Collect, issue invoice, café, `/reception/dues` | `invoices.read/write`, `payments.record`; location-scoped; **no** void (`settings.manage`) or reversal (`payments.refund`) | Counter collection; escalate cancellation | Today cards + bottom nav | — (R01 escalation fixed) | `lib/actions/invoices.ts:57-78`; `lib/actions/payment-reversals.ts:36-39`; `app/(reception)/reception/dues/page.tsx:15-17` |
| Owner / Admin | `/owner/fees`, member Payments tab — void/reverse/reopen | Void `settings.manage`; reverse `payments.refund`; location+balance guards | Final money authority | Sidebar "Fees & payments" (mobile via Home quick-links) | — | `app/(owner)/owner/fees/page.tsx:217-244`; `lib/actions/invoices.ts:69-78`; `lib/actions/payment-reversals.ts:24-39` |
| Accountant | Invoice issue + reversal + finance reports | `invoices.write`, `payments.record/read/refund`, `reports.financial/operational`; payer-only member data | Reasoned bookkeeping correction | Fees/Reports visible; Settings hidden | **P** reversal authority vs "narrow financial entry" — approved decision, needs monitoring | `lib/services/roles.ts:57-69`; `app/(owner)/owner/page.tsx:34-35` |
| Any | Actual refund payout | Reversal ledger only, no money movement | Deferred (Release 1) | — | **M** documented scope gap | `lib/actions/payment-reversals.ts:13-16` |
| **Reconciliation** |||||||
| Receptionist | `/reception/close` (Today → Close day) | `payments.record`; service narrows to caller locations + today; closed state read-only | Close own counter | Today card | — (M01 fixed) | `app/(reception)/reception/close/page.tsx:16-34`; `lib/actions/reconciliation.ts:93-101`; `app/(reception)/reception/page.tsx:35,70-84` |
| Owner / Admin | `/owner/reports/collections` — confirm, reopen, >₹2,000 rule | Read `reports.financial`; confirm `payments.record`; reopen `settings.manage` | Review discrepancy, override close | Reports → Collections | — | `app/(owner)/owner/reports/collections/page.tsx:38-44`; `lib/actions/reconciliation.ts:56-76,103-116` |
| **Assessments / curriculum** |||||||
| Coach | `/coach/members/[id]/assess` | `levels.read/assess`; `visibleMember` = location + batch assignment on read, write and deep link | Assess assigned learners | Via register/member page | — (A03 fixed) | `lib/services/skill-framework.ts:214-220`; `lib/services/skill-progress.ts:73`; `tests/review-assessment-scope.test.ts` |
| Owner / Admin | `/owner/settings/skills` ladder editor; progress tab read | Edit `settings.manage`; read `levels.read` | Curriculum ownership | Settings → Skills (feature-gated) | **P** coach ladder read is tenant-wide (no activity scoping) | `app/(owner)/owner/settings/skills/page.tsx:18-20`; `lib/actions/skill-ladder.ts:24-54` |
| Owner / Admin | `/owner/programs`, `/owner/batches/[id]` CRUD | `programs.read/write`, coach picker `staff.read`; location checks | Curriculum owner | Sidebar "Programs & sessions" | **P-low** batch page shows attendance under `programs.read` and waitlist controls ungated (latent for edited roles) | `app/(owner)/owner/batches/[batchId]/page.tsx:35,54,95` |
| Coach / Receptionist | Programs/batches read-only | `programs.read`; no authoring | No curriculum authoring | None | — | `lib/services/roles.ts:82,94,112` |
| **Scheduling** |||||||
| Owner / Admin | `/owner/sessions` cancel/reschedule/substitute; `/owner/schedule` read-only grid | `programs.write` + session location (A01 fixed); grid `attendance.read` + location filter | Management authority | **Not in nav** (link from Programs → Sessions) | **D-low** `listUpcomingSessions` read is not location-filtered; **P** no coach escalation path | `lib/actions/session-lifecycle.ts:34-46`; `lib/services/session-lifecycle.ts:69-78`; `lib/nav.ts:26-57`; `lib/services/coach-schedule.ts:94-127` |
| Coach | `/coach/schedule` read-only; no cancel/reschedule UI | `attendance.read`; own `coachId` + location | Request disruption, not cancel | Prominent (Schedule tab) | **M** no disruption/request workflow | `app/(coach)/coach/schedule/page.tsx:7`; `lib/nav.ts:68` |
| Receptionist | No scheduling UI | — | Optional scoped assistance if delegated | None | **D-low** management-shaped `listUpcomingSessionsAction`/`getScheduleGridAction` callable with `attendance.read` (tenant-wide, no location predicate) | `lib/actions/sessions-list.ts:31`; `lib/auth/action-permissions.ts:84` |
| Staff roster/leave | Owner/Admin `/owner/staff/roster`,`/leave` `staff.roster`; Coach/Worker own via `staff.self` | Roster scoped to locations | Owner/admin build; staff self-view | Owner Staff page | See worker defect below | `lib/actions/shifts.ts:39-114`; `app/(owner)/owner/staff/roster/page.tsx:39-40` |
| **Staff access** |||||||
| Owner / Admin | Directory, invites, owner reset, `/owner/staff/check-in-qr` | `staff.read/write/invite/roster`; admin→owner credential issuance now refused (ordinal trust gate); reset UI owner-only | Manage people | Sidebar "Staff" (gated `staff.read`; accountant hidden) | **M** no post-invite role/permission editor; invite/create forms omit `admin` though the role exists | `lib/services/invite-link-issue.ts:99-110,167,299-304`; `components/staff-invite-form.tsx:10-15`; `lib/actions/staff.ts:15-16`; `app/(owner)/owner/staff/page.tsx:56` |
| Owner / Admin | Revoked staff re-invite/reactivate | Invite matches any non-deleted membership → `already_member`; revoked links refused; no reactivation action | Staff returns to work | Staff page | **D/M** revoked staff cannot be re-invited or reactivated | `lib/services/staff-invitations.ts:185-202,514-548`; `lib/services/invite-link-issue.ts:161-162` |
| Receptionist | Staff attendance correction — Today board | `staff.attendance`; target-location intersection; today-only unless `settings.manage` (owner authority) | Same-day backup | Today page | **M** owner/admin historical-correction authority has no UI anywhere | `lib/services/staff-attendance-correction.ts:127-155`; `components/staff-attendance-board.tsx:68`; `app/(reception)/reception/page.tsx:136-142` |
| Coach / Worker | Own shifts, check-in, leave — `/coach/me`, `/worker` | `staff.self`; own rows only | Self-service | Me tab / worker home | **D** `/worker` is **blocked by middleware** (not in `APEX_ALLOWLIST`), so the seeded worker home 404s; surface map still points worker at `parent` | `middleware.ts:37-91,146-155`; `lib/services/roles.ts:119-128`; `app/(worker)/worker/page.tsx:26-30`; `lib/auth/surface-access.ts:60-64` |
| **Settings / ops / other roles** |||||||
| Owner / Admin | `/owner/settings/**` (tax, branding, locations, holidays, alerts, plans, QRs, menu) | Reads `settings.read`; writes `settings.manage` | Configure academy | Settings tab (gated `settings.manage`, so accountant never sees it) | **D** accountant can still deep-link `/owner/settings` and read-only sub-pages; `/holidays`/`/alerts` throw uncaught; Settings Staff tile unconditional | `lib/nav.ts:103`; `app/(owner)/owner/settings/page.tsx:23-26`; `app/(owner)/owner/settings/holidays/page.tsx:9-11` |
| Receptionist | Menu/QR/plan picker reads | `settings.read` only | See what they act on | Contextual | — | `lib/auth/action-permissions.ts:207-268` |
| Platform Ops | `/ops/**` tenant/config/feature/leads/whatsapp | Schema role `admin|viewer` (`platform-users.ts:33`) but **every page/action checks only `authenticated`** — viewer can mutate | Viewer read-only | Ops nav | **D** viewer/admin boundary is display-only (`layout.tsx:134`), no enforcement in `opsAction` | `db/schema/platform-users.ts:33`; `app/(platform)/layout.tsx:134`; `lib/actions/platform-tenants.ts:84-91`; `db/ops-action.ts:22-40` |
| Parent | `/p/[token]` + receipt | Bearer read-only, zero-JS; one member/token | Read-only child view | No nav | **M** no revocation; progress/schedule deliberately limited | `app/p/[token]/route.ts`; `lib/nav.ts:78-81` |
| Member/Student | none | — | Deferred | — | — | `lib/auth/surface-access.ts:8-9` |
| Background worker | jobs | No human login | System actor | — | — | `worker/index.ts` |

## Confirmed defects (current tree)

1. **Worker home unreachable.** `/worker` 404s through middleware for the worker
   role itself: `middleware.ts:37-91` lacks `/worker`, while the seeded home is
   `/worker` (`lib/services/roles.ts:121`) and the page authorizes correctly
   (`app/(worker)/worker/page.tsx:26-30`). The role-bypass e2e does not cover
   worker (`scripts/e2e-role-bypass.ts:178`).
2. **Ops viewer can mutate.** `platform_users.role` is `admin|viewer`
   (`db/schema/platform-users.ts:33`), but every ops page/action gates only on
   `status.kind === "authenticated"` (`lib/actions/platform-tenants.ts:84-91`;
   `db/ops-action.ts:22-40`); the role is display-only
   (`app/(platform)/layout.tsx:134`).
3. **Accountant on the shared owner surface:** uncaught `ForbiddenError` /
   unhandled submit on `/owner/settings/*`, `/owner/enquiries`,
   `/owner/sessions`, `/owner/members/new` (no `error.tsx`; the member form has
   no catch — `components/member-create-form.tsx:144-171`).
4. **Location-scope gaps:** enquiries have no location dimension
   (`db/schema/enquiries.ts:10-29`); waitlist actions narrow ctx with no
   resource checks (`lib/actions/waitlist.ts:36-75`); `listUpcomingSessions` is
   not location-filtered (`lib/services/coach-schedule.ts:94-127`).
5. **Revoked staff cannot be re-invited or reactivated**
   (`lib/services/staff-invitations.ts:185-202,514-548`;
   `lib/services/invite-link-issue.ts:161-162`).
6. **Contract drift:** `getMemberIdCardContextAction` has no permission check
   though mapped to `members.read` (`lib/actions/people.ts:170-173` vs
   `lib/auth/action-permissions.ts:32`); `getMemberDetailAction`'s runtime gate
   is narrower than its map.
7. **Latent UI/action parity:** mutation controls render without permission
   props (upcoming sessions, member status/subscription/enrolment, batch
   waitlist). Seeded roles are unaffected; tenant-edited roles would see
   controls that fail server-side.

## Proposed product changes / missing capabilities (not defects)

- **M** — Coach session-disruption request/escalation (no head-coach layer is
  assumed); historical staff-correction UI for owner/admin (authority exists,
  no UI); staff role/permission editor; reactivation of revoked staff; worker
  task list (`docs/project-scope.md:195`); consent-withdrawal workflow
  (legal-blocked); parent-link revocation.
- **P** — Reception-scoped announcements composer (holds `messaging.send`; the
  service already restricts non-managers to location-visible batches —
  `lib/services/announcements.ts:86-105` — but the UI is owner-only);
  parent-link reissue at the desk with guardian verification (currently
  owner/admin only — `lib/actions/parent-link.ts:45-49`); Sessions/Schedule nav
  entries; reception global-search box (entitlement exists); accountant
  reversal-authority review.

## Owner workflows that should primarily belong to staff

- **Counter close** — now reception-owned (`/reception/close`); owner remains
  review/reopen. Fixed, keep.
- **Parent-link issuance** — owner/admin holds the only UI; desk reissue is the
  realistic staff need (P, children's data).
- **Announcements** — owner-only composer despite reception's `messaging.send`
  grant (P).
- **Historical staff correction** — owner's `settings.manage` authority has no
  owner UI; either build it or route via request (M).
- **CSV member import** — owner-only page although reception holds the
  underlying `members.write` grant (`lib/actions/member-import.ts:48,71`);
  decide desk delegation (P).
- **Scheduling management** — correctly owner/admin (`programs.write`);
  reception assistance and coach escalation remain unbuilt (P/M), not defects.

Attendance otherwise matches the stated intent end-to-end (coach marks assigned
registers, reception backs up at location, owner reads); the only attendance
drift is the owner template's residual `attendance.mark` grant with no owner
UI.
