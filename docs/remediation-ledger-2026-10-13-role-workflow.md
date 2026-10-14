# Remediation ledger — role/workflow audit (2026-10-13)

**CI follow-up:** the historically outstanding test-pin failures below have
been corrected under explicit owner authorisation. The final local full suite
passes; see [`ci-resolution-2026-10-14.md`](ci-resolution-2026-10-14.md).
Original verification records are preserved. The `levels.write` policy question
remains open.

Input: `docs/audits/2026-10-13-role-workflow-audit.md`. Branch
`fix/comprehensive-review-findings` @ `870cf1a` plus working-tree changes.
No branch switch, no reset, no unrelated commits, no tier1 test edits.

Status legend: **fixed (verified)** / **human-owned gate** / **deferred (proposal)**.

| ID | Finding / responsibility change | Correction implemented | Status | Verification evidence | Remaining limitation |
|---|---|---|---|---|---|
| R-01 | Owner/Admin kept `attendance.mark` although attendance is execution work | Templates exclude `attendance.mark` (`lib/services/roles.ts`); migration `20261013181215_owner_admin_attendance_read_only.sql` deletes persisted system-role grants; `markAttendanceSessionAction` returns a truthful refusal and `markAttendance` refuses owner/admin contexts even with a stale grant (`lib/actions/coach.ts`, `lib/services/attendance-mark.ts`); owner read views unchanged | **fixed (verified)** | `tests/review-role-workflow-corrections.test.ts` R01 (3 tests, incl. migration upgrade path + no row written); `tests/review-resource-integrity.test.ts` re-seeded with a reception marker ctx | Human-owned tier1 pins still encode the old grant: `tests/tier1/roles-permissions.test.ts` (owner matrix) and `tests/tier1/role-gating-matrix.test.ts` ("attendance still works for the same owner"). Tenant-edited custom roles keep their grants |
| R-02 | Curriculum editing rode `settings.manage`; no delegated lead | New `levels.write` permission + seeded system `curriculum_lead` role (coach surface/ordinal, coach grants + `levels.write`) in `db/seed-platform.ts`, `lib/services/roles.ts`; migration `20261013181216_curriculum_lead_levels_write.sql` inserts the permission, backfills owner/admin and creates the role per tenant; ladder actions gate `levels.write`; owner/admin-only designation/removal service + staff-detail UI (`lib/services/curriculum-lead.ts`, `lib/actions/curriculum-lead.ts`, `components/curriculum-lead-control.tsx`); the lead's editing surface is `/coach/curriculum` (coach surface, `levels.read` view / `levels.write` edit) linked from `/coach/me`; coach-like resource scoping via `isCoachLikeRoleKey` | **fixed (verified)** | `tests/review-role-workflow-corrections.test.ts` R02 (designation swaps role, keeps one membership, audits ×2); `tests/review-role-workflow-actions.test.ts` R02 (settings.manage alone rejected; templates); browser: owner designated the coach on the staff page, coach then saw the Curriculum framework link and the lead copy on `/coach/curriculum`; scanner: `pnpm check:ops-actions`, `pnpm check:tenant-conventions` | Frameworks are academy-wide (stated in service/UI copy); no activity-level isolation. Human-owned tier1 pin expects six roles (`tests/tier1/roles-permissions.test.ts`) and must add `curriculum_lead` |
| R-03 | Ops `viewer` could execute platform writes | `requireOpsAdminAction()` gates every mutating platform action (in `lib/actions/platform-*.ts`); `opsAction` re-reads `platform_users.role/status` under `withPlatform` and throws `OpsForbiddenError` before any callback/side effect (`db/ops-action.ts`); `scripts/check-ops-actions.ts` + `scanPlatformAdminGuards` now fail any exported non-exempt action without the guard; viewer note in the ops layout | **fixed (verified)** | `tests/review-ops-administrator-guard.test.ts` (viewer refused before callback, suspended/unknown refused, admin positive); `tests/scanner-fixtures/ops-action-fixtures.test.ts` 9/9; `pnpm check:ops-actions` PASS | Viewer control-hiding beyond the banner is incremental UI polish; server enforcement is authoritative |
| R-04 | Enquiries had no location ownership | `enquiries.location_id` + composite FK/index (`db/schema/enquiries.ts`, migration `20261013181219_enquiries_location_scope.sql`); backfill only from trial batch → member, never arbitrary; creation requires a visible site in the app action (`createEnquiryAction` Zod) and validates it in the service; list/detail/transition/follow-ups/trials/conversion/overdue/funnel all use a scope predicate — non-management see located rows within access, unresolved rows are management-review-only | **fixed (verified)** | `tests/review-role-workflow-corrections.test.ts` R04 (5 tests incl. upgrade-path column check) | The service TS input stays optional for internal/system callers because `tests/tier1/**` is agent-read-only; an internal caller can still store NULL (management-only visible). A dedicated "assign site" UI for unresolved rows does not exist; trial/conversion backfills them |
| R-05 | Waitlist actions narrowed ctx; no resource checks | Services take the full ctx and validate batch (tenant, live, location, assignment), batch location and member on add/cancel/list/head/promote; actions pass ctx (`lib/actions/waitlist.ts`, `lib/services/waitlist.ts`) | **fixed (verified)** | `tests/review-role-workflow-corrections.test.ts` R05 (forged/out-of-scope refused, positive control) | Capacity re-check on promote remains the documented known gap (product decision) |
| R-06 | Upcoming-sessions read not location-scoped; management action callable with `attendance.read` | `listUpcomingSessions` applies the caller-location predicate; `listUpcomingSessionsAction` gates `programs.write`; schedule grid already location-filtered; action map updated | **fixed (verified)** | `tests/review-role-workflow-corrections.test.ts` R06; `tests/review-role-workflow-actions.test.ts` map check | Coach reads remain assignment-scoped (unchanged); reception gets no scheduling write |
| R-07 | Accountant deep links threw uncaught; broad read endpoints | Page-level `requirePagePermission` before any fetch on owner pages (settings/*, enquiries, sessions, schedule, members/new+edit, programs, batches, staff/*, reports, fees, announcements, onboarding); `searchPersonsAction` now `members.write`; `getMemberIdCardContextAction` enforces its documented `members.read`; create-member form catches refusals with a truthful inline error; payer projection and `getMemberDetailAction` narrowing preserved; reversal authority kept; roles without the Settings destination get a shell-level sign-out in `components/owner-shell.tsx` (settings was the only sign-out) | **fixed (verified)** | `tests/review-role-workflow-actions.test.ts` R07; `tests/mobile/owner-fees-hub.test.tsx`, `tests/mobile/phone-display-sweep.test.tsx`, `tests/review-accountant-projection.test.ts`, `tests/mobile/owner-shell.test.tsx` green; browser: accountant lands on `/owner/fees`, `/owner/settings/holidays`, `/owner/enquiries`, `/owner/members/new` all render the controlled 404, sidebar sign-out present | `members.read` still drives finance lookup/list (name/phone/code/status only); removing it would break timezone/plan helpers — documented |
| R-08 | `/worker` blocked by middleware; worker mapped to the parent surface | `/worker` allowlisted (`middleware.ts`); `SURFACE_WORKER` + `worker → SURFACE_WORKER` (`lib/auth/surface-access.ts`); nav entry `worker: []`; page still self-authorizes role + `staff.self` | **fixed (verified)** | `tests/review-role-workflow-actions.test.ts` R08 (surface map + middleware 200/404 probes) | Human-owned tier1 pins still expect worker→parent: `tests/tier1/role-gating-sub-pr1.test.ts`, `tests/tier1/role-gating-matrix.test.ts` |
| R-09 | Revoked staff could not be reactivated; old links could revive | `tenant_memberships.links_valid_from` epoch (schema + migration `20261013181217`), enforced at invite-link preview AND redeem; `reactivateInvitation` reuses the membership (no duplicate), applies the issuer-target trust gate, sets the epoch, deletes old better-auth sessions, audits `membership.reactivate`, then issues a fresh single-use link; invitations board confirm step states role + location scope; old sessions/links stay dead | **fixed (verified)** | `tests/review-role-workflow-corrections.test.ts` R09 (old token dead, fresh token live, second run `not_revoked`, admin→owner `forbidden_target`) | Link epoch is second-precision (documented in code); issuance audit remains the existing A06 two-transaction shape |
| R-10 | Contract drift, ungated controls, Sessions/Schedule not discoverable | Panels gate on their independent write grants (sessions Manage, waitlist Promote/Remove, member status/subscription/enrolment/facilities, makeup redeem with truthful copy); `ACTION_PERMISSION_MAP` updated (skill ladder, `searchPersonsAction`, reactivation, curriculum delegation); Sessions/Schedule added to the owner sidebar and Programs page with gates (`programs.write`/`attendance.read`); member id-card map enforced | **fixed (verified)** | `tests/mobile/*` (upcoming-sessions-list, waitlist-board, member-*, enrolment-*, makeup) green; `tests/review-role-workflow-actions.test.ts` | Mobile bottom nav intentionally unchanged (4-item contract) |
| R-11 | Verification gate | typecheck/lint/scanners/tests/build + browser journeys | see below | | |

## Verification run (this branch)

Environment: the shared dev `aqua-db` has drifted `app_login` credentials
(pre-existing; do **not** reset it — it holds usable data). DB-backed
suites were run against a disposable `postgres:16` container on port
55440 provisioned with `pnpm db:deploy` (all 110 migrations, including
the four new ones) plus the zero-UUID system user the tier1 fixtures
expect.

- `pnpm typecheck` PASS · `pnpm lint` PASS.
- Scanners: `check:migrations` (110 files), `check:location-scope`,
  `check:tenant-conventions` (42 new migrations), `check:ops-actions`
  (both passes) PASS.
- New regressions: `tests/review-role-workflow-corrections.test.ts`
  15/15; `tests/review-role-workflow-actions.test.ts` 7/7;
  `tests/review-ops-administrator-guard.test.ts` 3/3;
  `tests/scanner-fixtures/ops-action-fixtures.test.ts` 9/9.
- Prior review suite + adjacent tier1: 18/19 files pass (the six
  `tests/tier1/session-lifecycle.test.ts` failures were a missing
  system-user fixture in the disposable DB, confirmed green after
  inserting it — not an app failure).
- Mobile/UI: 17 files, 79/83 green; the four were test-mock/fixture
  gaps from the new page gates and panel props, all fixed (three files
  re-run green).
- Full suite against the disposable DB: **2739 tests, 2698 passed, 8
  skipped, 33 failed** at the first full run. Every failure was then
  triaged: the actionable ones (semantic-token violations in two new
  components; seven mock gaps for the new page guard/admin guard in
  non-tier1 tests) are fixed and re-run green. The remainder are
  protected pins for superseded behaviour or pre-existing environment
  issues (see human-owned follow-ups).
- Browser journeys (dev server against the seeded disposable DB):
  owner sidebar carries Sessions/Schedule, Sessions shows Manage
  controls, member status/subscription/enrolment controls render;
  owner designated the seeded coach as Curriculum Lead on the staff
  page (confirm copy states scope) and the coach then saw the
  Curriculum framework entry and lead copy; worker `/worker` renders
  own shifts/check-in/leave and check-in succeeded, `/parent` and
  `/owner` 404; coach `/worker` 404; accountant `/owner` redirected to
  `/owner/fees`, deep links to settings/enquiries/member-create
  rendered the controlled 404, shell sign-out present; reception
  captured an enquiry with its site and Today shows collect/close/dues
  and check-ins; reception `/owner` 404.
- Tier1 failures that remain are **only** the protected pins for
  superseded behaviour or pre-existing fixtures (below).

## Human-owned follow-ups (do not edit as an agent)

1. `tests/tier1/roles-permissions.test.ts` — matrix now has seven
   roles; owner/admin lose `attendance.mark`; curriculum_lead gains
   `levels.write`; worker is `staff.self` only (pre-existing pin).
2. `tests/tier1/role-gating-sub-pr1.test.ts` — worker maps to
   `SURFACE_WORKER`, not `SURFACE_PARENT`.
3. `tests/tier1/role-gating-matrix.test.ts` — worker/parent surface
   rows; owner `attendance.mark` expectations.
4. `tests/tier1/platform-tenants-create.test.ts` — "seeds all six role
   templates" now expects seven.
5. `tests/tier1/platform-entitlements.test.ts` — the closed permission
   catalogue is 35 keys with `levels.write` (was 34).
6. `tests/tier1/enquiries.test.ts` / `tests/tier1/owner-dashboard.test.ts`
   compile only because the service keeps an optional site for internal
   callers; when the pins are updated they should pass `locationId`.
7. `tests/tier1/platform-auth-actions.test.ts` (7 tests) — pre-existing
   legacy password/TOTP Ops expectations (documented in the prior
   ledger; unrelated to this change).
8. `tests/tier1/attendance-history.test.ts` — pre-existing fixture
   time bomb: it enrols with the current date and then marks June
   sessions, so `enrolled_on > session_date` makes eligibility fail
   regardless of this change. Needs a fixed `enrolledOn` in the fixture.

## Product proposals intentionally NOT implemented here

Reception CSV import, reception announcements composer, parent-link
delegation/revocation, coach disruption requests, consent-withdrawal
workflow, general permission editor, worker task list. Reversals remain
ledger operations, not payouts.
