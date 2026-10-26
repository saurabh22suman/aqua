# Aqua — demo-readiness agent handoff

> Historical record, archived 26 October 2026. Not current execution instructions.
> Start with [the documentation index](../README.md), current runbooks and root AGENTS.md.

## Latest authentication and notifications update — October 7, 2026

Refer to `docs/whatsapp-demo-flows.md` for the current walkthrough.
**Ops now signs in with +91 90000 00099 and a code from the mock viewer.**
The older email/password/TOTP credentials and script below are historical;
they are no longer the web login flow. Tenant roles retain phone + PIN and now
have WhatsApp OTP-verified PIN recovery. The demo coach was restored to `123456`.

Owner/reception member profiles now offer multi-select notification destinations.
Announcements, session changes, absence alerts, waitlist promotions, invoices,
payments and staff invitation/link operations queue notifications for the worker.
Optional student updates require communications consent; selecting contacts
never grants it. The local capture viewer remains `http://localhost:3000`.

## WhatsApp capture viewer — added October 7, 2026

The running demo now forwards the non-production mock's outbound sends to the
existing service at `/home/soloengine/Github/whatsapp-mock`.

- **Viewer:** `http://localhost:3000` (existing Docker container
  `whatsapp-mock-whatsapp-mock-1`, persistent message volume).
- **Compose/send:** `http://ops.localhost:3100/ops/whatsapp`, using the existing
  ops login and TOTP flow documented below.
- **Local runtime configuration:** `.env.aqua-dev.local` contains
  `WHATSAPP_MOCK_URL=http://localhost:3000` and
  `WHATSAPP_MOCK_FROM=919000000000`. Both web and worker were restarted.
  The sender is a synthetic capture identity, not a tenant's onboarded number.
- Unset `WHATSAPP_MOCK_URL` to retain the original in-process mock. Unit tests
  should leave it unset. Only HTTP loopback origins are accepted in env config.
- No real WhatsApp credentials, dependency additions or schema changes.

### Two-minute walkthrough

1. Open the ops WhatsApp screen and the capture viewer in separate tabs.
2. In ops, select **Aqua Worli**, enter synthetic recipient `+919000000004`,
   and compose a message (optionally paste the demo parent URL from below).
3. Click **Send mock message**. The viewer automatically shows the outbound
   message from `919000000000` to `919000000004`.
4. Reload the ops screen to see the persisted, metered Aqua message-log row.
   The current ops screen does not automatically refresh its log after a send.
5. Use ops **Inject inbound** to demonstrate Aqua's existing inbound service.
   The external viewer's dummy-message form only writes its own capture log;
   it does not invoke Aqua's inbound webhook.

This connects existing `sendMessage` / mock-provider calls. It does not add
automatic receipt/reminder sends to workflows that were not already wired.
Capture means local storage, not real delivery, delivery/read callbacks or
template approval. HTTP failures, transport errors and invalid capture
responses fail the send instead of silently falling back to a fake success.

### Verified evidence

- Browser send from the authenticated ops UI reached the external viewer.
- Captured id: `wamid.mock.7c98fda044b04f1cadd9c5be7f0e8126`.
- Reloaded ops log showed **Aqua Worli · outbound · mock · sent · 12 paise**.
- Screenshot: `.playwright-mcp/aqua-whatsapp-capture.png`.
- `pnpm typecheck`, `pnpm lint`: PASS.
- Focused isolated unit tests: **2 files, 13 tests PASS** (capture behavior and
  existing provider/production guards); no demo DB mutations from tests.
- Production build: PASS with `NODE_ENV=production DEMO_MODE=false`, maximum
  reported First Load JS **131 kB**. The first build inherited the local dev
  `NODE_ENV` and failed; the corrected build passed after increasing timeout.
- Full DB suite was not rerun for this addition; the earlier results and
  known pilot blockers below remain the latest full-suite evidence.

## Goal

Deliver a working, browser-verified local demo today covering owner,
receptionist, coach and parent. Include the ops walkthrough if its existing
provisioning flow can be completed. Implement the demo-readiness fixes below,
start the application, and leave it running with clear access instructions.

Work autonomously through implementation and verification. A plan or a list of
recommendations is not the deliverable.

Workspace: `/home/soloengine/thedutchrabbit/aqua`.

## 1. Read and preserve the checkout

1. Read `AGENTS.md` / `CLAUDE.md` and `.opencode/instructions.md`.
2. Inspect git status and recent commits. Expected starting branch:
   `chore/opencode-development-setup`. Existing dirty files include tooling,
   documentation, Docker Compose changes and audit reports. Preserve them;
   do not reset, stash or overwrite them. This handoff is also a local file.
3. Create a feature branch for this work, preserving existing local changes.
   Do not commit or push unless the user explicitly asks.
4. Read:
   - `docs/audits/2026-10-05-backend-frontend-documentation-review.md`
   - `docs/demo-runbook.md`
   - `docs/opencode-development.md`
   - `DESIGN.md`
   - Relevant sections of `docs/architecture.md`
   - `db/CLAUDE.md` before any data-layer changes.
5. Inspect the implementation plan for dependencies. This is a scoped audit
   remediation assignment, not permission to implement unrelated roadmap tasks.
6. Use installed package versions and Context7 for library API guidance.
   Next.js is **15.5.24**; do not use Next 16 guidance.

## 2. Priority 1 — get the demo environment working

- Use Node 22 and pnpm 11.22.0.
- Inspect `package.json` and the current runbook for the actual setup commands.
- Use an explicitly disposable local database containing synthetic data only.
  Do not mutate or reset an existing database whose purpose is uncertain.
- Deploy the database with `pnpm db:deploy` before seeding.
- Use existing demo seeding/provisioning mechanisms.
- Preserve demo boot, seed and reset safeguards.
- `DEMO_MODE` must not introduce service/DB behavior branches or bypass
  authorization. Production serving rejects `DEMO_MODE`; use the supported local
  demo setup rather than weakening that restriction.
- Run web and worker separately when required by the walkthrough.
- Verify the real tenant host and ops host routing from repository config.
  Ops runs at `http://ops.localhost:3000/ops`; plain localhost `/ops` is
  intentionally not the ops surface.
- Do not spend time redesigning working screens before the demo boots.

## 3. Priority 2 — fix the demo-breaking audit findings

Reproduce each finding against the current source before changing it.
Implement and verify findings one at a time.

### A. FE-02 — reception invoice expansion

A receptionist must be able to expand an invoice with an existing payment
and continue the permitted payment workflow.

- Remove the unconditional dependency on a read action the role cannot invoke.
- Preserve existing permission boundaries and reversal-adjusted balances.
- Do not grant refund/reversal authority to reception.
- If the required reversal-history visibility is not established by existing
  permissions and architecture, ask a targeted question before changing it.
  Continue independent work while awaiting that decision.

### B. FE-03 — facility switcher / stale member list

- Client navigation between facilities must update the displayed member list.
- Handle search and status filters deliberately using existing UI conventions.
- Verify navigation without a full page reload.

### C. FE-04 — money controls stuck in “Saving…”

- Handle thrown/transport errors and release busy state in `finally`.
- Display an actionable failure.
- If a response might have been lost after commit, reconcile server state
  before enabling a retry that could duplicate a payment.
- Do not invent idempotency or financial rules.

### D. FE-05 — IndexedDB access during SSR

- Remove browser storage writes from render/`useMemo`.
- Persist through appropriately gated effects, handle failures, and honor
  the existing offline enablement policy.
- Verify the coach register produces no IndexedDB SSR rejection.

### E. FE-06 — parent recent attendance

- Select the newest eight records, with deliberate display ordering.
- Verify using more than eight synthetic attendance records.

### F. FE-07 — parent contrast

- Align the standalone parent HTML palette with approved current tokens.
- Preserve the zero-JavaScript parent route.
- Measure meaningful text/status contrast.

### G. FE-08 — accessible labels and touch targets

- Fix the specific remaining labels and undersized controls from the audit.
- Reuse existing primitives and tokens; do not introduce a component library
  or new hex colors.

Keep changes focused and consistent with surrounding code. Add meaningful
regression coverage for failures and role boundaries. Never edit
`tests/tier1/**`.

## 4. Priority 3 — verify an actual demo walkthrough

Use Playwright, clean browser caches and unregister stale service workers
before trusting browser results.

Walk through and capture screenshots:

- **Owner:** home, members, facility filtering, member detail, fees/payments,
  schedule, reports.
- **Reception:** member detail with a pre-existing payment, invoice expansion,
  permitted payment recording, receipt/result.
- **Coach:** today, populated register, attendance recording.
- **Parent:** valid synthetic parent link, recent attendance, money display.
- **Ops:** sign-in and overview if provisioned through the existing supported flow.

Required viewports:

- Owner: **390×844 and 1280×900**.
- Coach/reception: **390×844**.
- Ops: **1280×900**.
- Parent: mobile, including JavaScript-disabled viewing.

Use synthetic money and member records only. Verify persistence after refresh,
not just a success toast. Record browser/server errors and fix failures caused
by this scope. Do not broaden permissions or suppress errors to make a
screenshot pass.

## 5. Verification

- Run focused regression tests during implementation.
- Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  against the dedicated disposable test database.
- Keep the walkthrough database separate from test cleanup, or restore its
  synthetic demo fixtures before the final walkthrough.
- Run `pnpm e2e:parent-link-zero-js` against the production artifact using
  a supported configuration without weakening the production/demo safeguards.
- Run relevant bundle/font checks when applicable, serially: they share `.next`.
- Do not run builds alongside the demo dev server; restart and leave the demo
  running after verification.

The October 5 audit reported two full-suite failures:

1. Append-only announcement privileges on first deployment.
2. A date/state interaction in `tests/tier1/bookings-pricing.test.ts`.

Recheck rather than assuming they remain unchanged. Report any unresolved
failures honestly; do not edit protected tier1 tests or weaken assertions to
claim a green gate.

## 6. Boundaries

- Tenant access through `withTenant()`.
- Mutations and audits in the same transaction.
- Money is bigint paise.
- Zod boundaries, no `any`.
- Follow `DESIGN.md` and existing UI tokens.
- Ask before dependencies, unplanned schema changes, architecture changes,
  uncertain money rules or children's-data policy.
- FE-01 logout/offline-cache confidentiality is a known outstanding finding:
  do not make up an unsynced-attendance retention policy.
- This demo assignment does not certify the application for real pilot data.
  Keep outstanding backend/security findings visible in the handoff.

## 7. Final deliverable

1. Working demo URL(s), with web/worker left running.
2. Synthetic role login details, privately in the handoff rather than committed.
   For ops, explain the supported TOTP login process.
3. A short, ordered **10-minute demo script** with exact routes and actions.
4. Screenshots and their paths.
5. Changed files and findings resolved.
6. Verification commands with actual pass/fail results.
7. Remaining demo blockers and outstanding real-pilot blockers.

Start with booting the demo environment, then implement the fixes one at a
time. Finish by walking the app in the browser and leaving it ready to show.

---

# Execution report — 2026-10-07

Status: **demo running and browser-verified**. Branch `demo-readiness`
(created from `chore/opencode-development-setup`; all pre-existing local
changes preserved, nothing committed). No tier1 tests or applied
migrations were edited.

## Access (local only — do not commit this file)

| Surface | URL | Credentials |
|---|---|---|
| Tenant app | http://localhost:3100/login | see logins below |
| Ops control plane | http://ops.localhost:3100/ops/login | `ops@aqua.local` / `nOrK-IfF1694YQvS` / TOTP secret `L32MOJJ4VUPWV7CRHGAFNINBKV2NMQFF` |

Current TOTP code: `DEMO_MODE=true pnpm platform:code` (one line, prints
seconds remaining). PIN for every seeded staff/owner account: `123456`.

- Owner: `+91 90000 00001` (Aqua Worli + Kicks memberships)
- Coach (primary): `+91 90000 00002` · Coach (secondary): `+91 90000 00005`
- Receptionist: `+91 90000 00004` · Accountant: `+91 90000 00006`
- Kicks coach: `+91 90000 00007`

Processes left running: `systemctl --user` units `aqua-dev-demo` (Next dev,
port 3100, `DEMO_MODE=true`) and `aqua-worker-demo` (pg-boss worker);
Postgres in the `aqua-db` container on 127.0.0.1:55432. Dev logs:
`/tmp/opencode/dev.log`, worker: `/tmp/opencode/worker.log`.

## Demo fixtures created through the supported UI (synthetic only)

`pnpm demo:reset` wipes these; recreate in this order if you reset:

1. `/owner/settings/locations` → Add location `Bandra Turf` (turns on the
   facility switcher).
2. `/owner/settings/plans` → custom plan `Monthly Swim`, Worli Main,
   duration 30 days, ₹2,800 GST-exclusive.
3. Member `Aarav Sharma` (AWS-001) → Overview → Start subscription
   (Monthly Swim).
4. Same member → Payments tab → Raise invoice (INV/2026-27/0001, ₹2,800).
   Record ₹1,000 cash (owner).
5. `/reception/members/<Aarav id>` → expand the invoice → record ₹500 UPI
   with a reference (reception).

Resulting state: invoice `partial`, paid ₹1,500 (₹1,000 cash + ₹500 UPI),
outstanding ₹1,300; two receipt PDFs; today's Morning Squad 2/12 marked
(Aarav present, Aaradhya Iyer absent). Parent link (Aarav, valid 7 days):
`http://localhost:3100/p/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZW5hbnRJZCI6IjAxYTExNjIyLTVlYTEtNzEyYy1iZThkLWU3YjVkYTA3ZjM4NyIsInBlcnNvbklkIjoiMDFhMTE2MjItNjFhMi03MGQyLTk0YjUtOWQzNTc3NDZlZjg3Iiwic2NvcGUiOiJwYXJlbnRfdmlldyIsImlhdCI6MTc5MTM4MjU1MCwiZXhwIjoxNzkxOTg3MzUwLCJqdGkiOiIxNzkxMzgyNTUwLWkzdGR6ZDV2In0.ANTbboiF_Q9cnueP9cWTQKX0Io8w5J6-Ieb0IZBIQDU`

One fixture-repair note: a verification click accidentally paid the
invoice in full; the accidental ₹1,300 payment row was deleted from the
disposable demo DB and the invoice restored to `partial` (its append-only
`audit_log` row remains, by design).

## 10-minute demo script

1. **Ops — 2 min.** `http://ops.localhost:3100/ops/login` → email,
   password, then the code from `DEMO_MODE=true pnpm platform:code`.
   Show `/ops` cards → `/ops/tenants` (Kicks leads, Aqua Worli second,
   Orphan Demo churned) → open Aqua Worli → Configuration tab, "Why this
   value?" on `absence_alert_threshold_pct` → `/ops/presets`.
2. **Owner — 3 min.** `http://localhost:3100/login` as `+91 90000 00001`,
   PIN `123456`. `/owner` (32 active, today's lanes, needs-you) →
   `/owner/members` (40) → switch Facility to `Bandra Turf` (empty) and
   back to `Worli Main` (40, no reload) → `/owner/fees` (₹1,500 collected,
   ₹1,300 outstanding) → `/owner/reports` → `/owner/sessions` (R.1
   substitution row).
3. **Reception — 2 min.** Sign out, in as `+91 90000 00004`. Open member
   `Aarav Sharma` from `/reception` today list (or search) → Invoices →
   **View**: the invoice expands with the two payments and receipt links
   (this was FE-02) → record a small cash/UPI payment → the balance
   updates and a second receipt is available; refresh to show persistence.
4. **Coach — 2 min.** Sign out, in as `+91 90000 00002`. `/coach` today →
   open Morning Squad register → the two marks are already there → mark
   one more Present → reload to show it persisted. `/coach/schedule`.
5. **Parent — 1 min.** Open the parent link above in a phone viewport
   (zero JavaScript): attendance this month, the newest marks, ₹1,300 due
   and both payments. Ask them to try disabling JS — the page is static.

## Screenshots

All under `.playwright-mcp/demo-walkthrough/` (git-ignored):
`owner-home-390.png`, `owner-members-390.png`,
`owner-members-facility-bandra-390.png`, `owner-member-detail-390.png`,
`owner-home-1280.png`, `owner-members-1280.png`, `owner-fees-1280.png`,
`owner-reports-1280.png`, `owner-sessions-1280.png`,
`reception-invoice-expanded-390.png`, `coach-register-390.png`,
`parent-link-390.png`, `parent-link-no-js-390.png`, `ops-home-1280.png`,
`ops-tenants-1280.png`.

## Findings resolved

| Finding | Fix | Evidence |
|---|---|---|
| FE-02 invoice expansion for reception | reversal reads gated by new `canReadPayments` prop (pages/fees list threaded); no refund authority added; invoice totals stay service-adjusted | live reception expansion; `tests/mobile/invoice-reverse.test.tsx` (reception case) |
| FE-03 stale member list on facility change | `MembersBoard` adopts new server rows and resets search/status on facility change | live 40 → empty → 40; `tests/mobile/members-board-facility.test.tsx` |
| FE-04 money controls stuck on transport error | try/catch/finally everywhere, reconciliation reload, actionable message, failed-state Retry button | live aborted POST: button released, message shown, no phantom payment; component tests |
| FE-05 IndexedDB during SSR | roster persistence moved from `useMemo` to gated `useEffect` with `.catch` | `tests/offline/use-offline-register-ssr.test.tsx` (fails on old code); no SSR rejection in dev log |
| FE-06 parent recent attendance | select newest 8 (`desc`) then reverse for display | `tests/mobile/parent-recent-attendance.test.ts` (fails on old code); parent link shows newest marks |
| FE-07 parent contrast | `lib/design-tokens.ts` shared palette; route uses it; alert/runway aligned | `tests/parent-contrast.test.ts` (token sync + 4.5:1 pairs); JS-disabled screenshot |
| FE-08 labels/targets | search/enrolment/void labels, 44px staff links and Confirm reversal | `tests/mobile/a11y-fe08.test.tsx`; visible in walkthrough |

Decision to confirm (FE-02): reception cannot read `payments.read`, so it
now sees gross payment rows with reversal-adjusted invoice totals and no
reversal sub-history. If reception must see reversal history, that needs an
explicit permission decision, not a grant added here.

## Verification results (2026-10-07, disposable DB `aqua-test-db`, port 55433, one fresh `db:deploy`)

- `pnpm typecheck` PASS · `pnpm lint` PASS.
- `pnpm test`: **320/321 files, 2513 passed, 1 failed, 1 skipped** — the
  failure is the known BE-07 first-deploy announcement privilege assertion
  (`tests/tier1/announcements.test.ts:249`, protected; needs a reviewed DB
  grant change, not a demo fix). QA-01's date-dependent booking-pricing
  failure did not trigger today (it needs Monday before 14:00 IST).
- `pnpm build` PASS (max First Load JS 131 kB on `/reception/enquiries/[id]`
  vs 150 kB budget).
- `pnpm check:bundle` PASS (93 routes) · `pnpm check:fonts` PASS (55.2/60 kB).
- `pnpm e2e:parent-link-zero-js` PASS against a production build: 0 script
  tags on valid and invalid tokens.
- Browser walkthrough at required viewports with clean caches; only console
  errors were the intentional role-probe 404 (`/coach/me` as reception) and
  the favicon 404. No server exceptions in `dev.log`.

## Remaining blockers

- **Current continuation:** the former BE/FE blocker list is review-time
  history. October code remediation and current verification are tracked in
  `docs/review-fixes-status.md`. Dependency advisories remain by the owner's
  disposition-only decision; real provider/deployment/restore and release gates
  are not completed by local fixes.
- **Demo-scope:** fixtures live only in the running DB (`demo:reset` wipes
  them — recreation steps above); the parent link expires ~2026-10-14
  (mint a fresh one from the member's Parent link panel); `.next` is a dev
  build, so keep the demo on `aqua-dev-demo` rather than running
  `build`/`check:*` again while it is showing.
