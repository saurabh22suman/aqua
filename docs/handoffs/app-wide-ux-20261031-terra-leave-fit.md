# Leave date fit handoff — 31 October 2026

Branch `fix/app-wide-ux-20261031`, HEAD `54e6d80c25164da8c85c8e33c41511ae467f3d54` plus inherited uncommitted overlay. Runtime metadata: approved `openai/gpt-6.1-terra`. No commit.

## Change and actual evidence
- `components/leave-request-form.tsx`: the From/To group now uses an auto-fitting grid with a 13rem minimum track bounded by the container width; it stacks in narrow containers and uses two columns when both fit. No change to DateField, typography, date values, validation, permissions, leave request/approval or button targets.
- Pre-edit browser RED is `.playwright-mcp/app-wide-ux-20261031/chrome-full-review-2/review.json` and `screenshots/{coach,reception,worker}-leave-form.png`; supplied measurements report 61px usable versus 96px required for each display at 390. The coach screenshot was inspected. Chrome build identity in review: `372aba3bc5a5ebe213e1f56a971b69376bce1ac3c060c2570479400116bff178`. No new browser run; viewport/text fit after change is not yet proven.
- `NODE_OPTIONS=--max-old-space-size=2048 python3 .opencode/scripts/lane_job.py harness test --profile .env.aqua-harness-regression.local -- tests/mobile/deferred-leave-form.test.tsx tests/mobile/leave-coverage-recovery.test.tsx tests/app-wide-ux-20261031/staff-leave-copy.test.tsx tests/app-wide-ux-20261031/date-field-calendar.test.tsx tests/app-wide-ux-20261031/date-field-calendar-review.test.tsx tests/owner-openpen-20261029/shared/date-field-validity.test.tsx --reporter=verbose`: exit 0, 59 passed / 6 files. Log `.playwright-mcp/app-wide-ux-20261031/terra-leave-fit-evidence/focused.log`; harness verified disposable `aqua_test_c1a05ac212` / `app_login`.
- `NODE_OPTIONS=--max-old-space-size=2048 python3 .opencode/scripts/lane_job.py harness quick`: exit 0, typecheck and lint; `terra-leave-fit-evidence/quick.log`. These tests do not establish rendered layout.

## Unverified DateField grid candidates for coordinator
Source inspection only; none is a confirmed defect or edited here. Use a full ten-character chosen date and measure text area, calendar target and page overflow in actual Chrome.
- `components/roster/add-shift-form.tsx`: `add-shift-date` shares unconditional two-column grid with Template. Owner `/owner/staff/roster`, expand **Add shift** with staff and location available; probe 390 and narrow containers.
- `components/member-subscription-panel.tsx`: `member-subscription-starts` and `member-subscription-ends` share a three-column grid from `sm`, potentially inside owner member overview's two-column `lg` layout. Owner/reception member detail, eligible membership plan and `members.write` so **Start a subscription** controls render; test at/above `sm` and split-column desktop, not just phone.
- `components/member-create-form.tsx` and `components/member-edit-form.tsx`: DOB and joined-on fields are in `sm` two-column grids. Probe Add member and member edit at breakpoint and constrained desktop form widths.
- `components/enquiry-detail-view.tsx`: follow-up due date shares a two-column grid from `sm` with time. Open follow-up editor at breakpoint/constrained width; actual selected-date geometry, not source classes, decides.
- `components/activity-filter-bar.tsx` and `components/ops/ops-activity-filter.tsx`: Since/Until fields use two columns at `md`/`xl` respectively; check if their enclosing region is narrower than the viewport at those breakpoints.

## Verdict and next action
**Functional:** focused tests pass; actual leave interaction after build pending. **Semantic:** form content unchanged; role-journey review pending. **Visual:** BLOCKED pending coordinator's fresh production Chrome date-text-fit checks for coach, reception and worker, including expanded form, calendar use, narrow/large container and no page overflow. Coordinator owns build, full suite and browser sweep.

No lib/db/auth/money/consent/global CSS/dependency/protected-test edits, build, preview, background job, browser run, commit/push/PR/merge/deploy or other-worktree operation by worker.
