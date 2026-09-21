# Aqua pilot release checklist

**Purpose:** the single execution register for the three-PR friend-pilot release.
It replaces the earlier many-PR plan and is carried, updated and committed across
all three sequential PRs without starting a new checklist.

**Source plan:** the final 3-PR execution plan (PR1 Pilot Stability & Deployment,
PR2 Core Workflow & CSV Import, PR3 UI Refresh & Pilot Release).

**Merge order is serial:** three PRs, each merged into `main` only after the
previous one merges. There is no `develop` branch. PR2 and PR3 branch from updated
`main`. PR3 is last because it restyles files PR1 and PR2 edit.

---

## How to use this checklist

1. **Never mark a task `[x]` because code was written.** A task is complete only
   when its listed tests pass **and** its acceptance criteria are verified.
2. **Record evidence beside every completed task:** the exact test command and
   result, manual verification note (viewport/route), and the commit SHA when one
   exists. Example:
   `Evidence: pnpm test tests/tier1/owner-analytics.test.ts — 4 passed; manually
   verified /owner/reports 200 with all 9 cards at 1280×900; commit abc1234.`
3. **Update proactively after each verified task** — same working session, before
   starting the next task.
4. **At the end of every working session**, update **Current status**,
   **Current task**, **Next task** and **Known blockers** in the status board
   below, and append a line to the session log.
5. **Commit checklist updates alongside the related implementation change**
   (same commit or the immediately following checklist-only commit on the same
   branch). Never let the checklist drift from the branch.
6. **Blockers are recorded inline** (`Blocker:`) and promoted to the status board.
   A blocked task stays `[ ]` with the blocker noted.
7. **Migrations** are forward-only and appear only in PR1 and PR2. Any PR touching
   `db/migrations/**` needs the `human-approved-merge` label before merge.
8. **Every PR gate** includes `pnpm typecheck && pnpm lint && pnpm test &&
   pnpm build` plus the applicable scanners. Do not merge on partial gates.
9. **Deployment split:** every green `main` CI run publishes one immutable image
   and auto-deploys that exact tag to the Dev VPS. Production is
   `workflow_dispatch` only, takes an immutable SHA/tag, requires GitHub
   `production` environment approval, and stays blocked until the complete PR3
   release gate below passes.

---

## Status board

| Field | Value |
|---|---|
| **Current status** | PR1 implementation in progress on `feat/pilot-pr1-stability-deploy`. PR1-C1–C7 verified and committed (C7 migration pending human-approved-merge at PR time). |
| **Current task** | PR1-C8 (Worker heartbeat, graceful shutdown, worker-aware health). |
| **Next task** | PR1-C9 (Migration advisory lock). |
| **Known blockers** | None. |

### Session log

| Date | Branch | Summary | Tasks completed |
|---|---|---|---|
| 2026-09-21 | none | Checklist authored from the final 3-PR plan | — |
| 2026-09-21 | none | Revision 2: no `develop`, main→Dev auto-deploy, dispatch-only gated prod, reception cash/UPI recording, parent read-only money preserved, Cloud adapter removed | — |
| 2026-09-21 | feat/pilot-pr1-stability-deploy | PR1 started; PR1-C1 fixed (timezone binding + settled report cards) | PR1-C1 |
| 2026-09-21 | feat/pilot-pr1-stability-deploy | PR1-C2 fixed (`/check-in` apex allowlist + boundary probes) | PR1-C2 |
| 2026-09-21 | feat/pilot-pr1-stability-deploy | PR1-C3 fixed (duplicate invoice friendly error + repeat-submit guard) | PR1-C3 |
| 2026-09-21 | feat/pilot-pr1-stability-deploy | PR1-C4 fixed (café cart GST parity with issued bill) | PR1-C4 |
| 2026-09-21 | feat/pilot-pr1-stability-deploy | PR1-C5 fixed (reception booking tile/route hidden) | PR1-C5 |
| 2026-09-21 | feat/pilot-pr1-stability-deploy | PR1-C6 fixed (preset applied on tenant creation + warnings surfaced) | PR1-C6 |
| 2026-09-21 | feat/pilot-pr1-stability-deploy | PR1-C7 fixed (messaging non-GA + post-pilot doc + migration) | PR1-C7 |

---

# PR 1 — Pilot Stability & Deployment

**Branch:** `feat/pilot-pr1-stability-deploy`
**Goal:** nothing on the critical path crashes; money maths agrees with itself;
unreachable or dangerous routes are closed; provisioning cannot mislead; the app
deploys to the Dev VPS automatically and to production only through an approved,
explicit release.

**Scope in:** reports/analytics fix, `/check-in` routing, duplicate-invoice
idempotency, café GST parity, booking hide, ops preset safety, ops catalogue
status, worker health/shutdown, migration lock, compose secrets, backup, CI
publish + main→Dev auto-deploy + gated production deploy.
**Scope out:** UI restyling and copy (PR3), reception permission and payment
recording (PR2), import/refunds/parent money/company settings (PR2), messaging
adapter work (post-pilot), production release itself (blocked until PR3 gate).

**Migrations in this PR (both forward-only, both human-approved-merge):**
`<ts>_worker_heartbeats.sql`, `<ts>_messaging_feature_status.sql`.

**Pilot exclusions enforced here:** booking UI stays hidden; no messaging send;
no fabricated metric on the health surface.

## Commits

### [x] PR1-C1 — Reports: timezone binding + settled card loading
- **Depends:** none.
- **Files:** `lib/services/owner-analytics.ts`, `lib/actions/owner-analytics.ts`,
  `app/(owner)/owner/reports/page.tsx`, new `tests/tier1/owner-analytics.test.ts`.
- **Red test (must fail first):** new tier1 test calling `getMoneyAnalytics` with
  a seeded payment throws `42803`; a `ReportsPage` render test asserting the
  attendance card renders fails.
- **Tests:** the new service test; `tests/tier1/owner-reports.test.ts`;
  `tests/mobile/owner-analytics.test.tsx`; page-render style test.
- **Acceptance:** `/owner/reports` returns 200 with all nine cards; a single card
  failure no longer blanks the page; tenant isolation and IST month boundaries
  verified against real Postgres.
- **Migration/rollback:** none.
- **Evidence:** red first — `tests/tier1/owner-analytics.test.ts` failed with
  Postgres `42803` on the old GROUP BY. After the derived-table fix:
  `pnpm exec vitest run tests/tier1/owner-analytics.test.ts
  tests/mobile/owner-reports-page.test.tsx` — 4 passed;
  `pnpm exec vitest run tests/tier1/owner-reports.test.ts
  tests/mobile/owner-analytics.test.tsx` — 15 passed; `pnpm typecheck` clean;
  live `/owner/reports` 200 with all nine cards as demo owner (Playwright,
  localhost:3000); commit `94b1ef8`.

### [x] PR1-C2 — `/check-in/<token>` through production middleware
- **Depends:** none (independent of C1).
- **Files:** `middleware.ts`, `scripts/e2e-host-boundary.ts`.
- **Red test:** host-boundary probe for apex `/check-in/anything` currently
  returns 404.
- **Tests:** extended `scripts/e2e-host-boundary.ts` probes; keep
  `tests/tier1/premises-check-in.test.ts` green.
- **Acceptance:** apex serves the route (200 signed-in / redirect signed-out);
  ops host still 404s it; host boundary otherwise unchanged.
- **Migration/rollback:** none.
- **Evidence:** red first — extended `scripts/e2e-host-boundary.ts` failed
  `localhost/check-in/anything → 404 (expected 200)`. After adding
  `/check-in/` to the apex allowlist: `pnpm e2e:host-boundary` all probes
  green (apex 200, ops 404); `pnpm exec vitest run
  tests/tier1/premises-check-in.test.ts` — 4 passed; live dev server curl
  apex 200 / ops 404; commit `412940a`.

### [x] PR1-C3 — Duplicate invoice raise: friendly error and no repeat submit
- **Depends:** none.
- **Files:** `lib/services/invoice-issue.ts`, `lib/services/invoice-mutations.ts`,
  `lib/actions/invoices.ts`, `components/member-detail/member-invoices-panel.tsx`
  (guard only), `tests/billing-invoices.test.ts`.
- **Red test:** second raise for the same subscription throws raw 23505 on
  `invoices_subscription_due_live_uidx`.
- **Tests:** extend `tests/billing-invoices.test.ts` (second raise `{ok:false}`,
  concurrent raises → exactly one row); UI test for the disabled/hidden button.
- **Acceptance:** no raw PG error reaches the client; exactly one live invoice per
  subscription/due date; a repeat click cannot produce a second invoice.
- **Migration/rollback:** none.
- **Evidence:** red first — both new `tests/billing-invoices.test.ts` cases threw
  raw `23505 ... invoices_subscription_due_live_uidx`. After the pre-check +
  outside-transaction backstop: `pnpm exec vitest run tests/billing-invoices.test.ts`
  — 10 passed (duplicate friendly error, concurrent raises → exactly one live row);
  `pnpm exec vitest run tests/mobile/member-invoices-panel.test.tsx` — 2 passed;
  `pnpm typecheck` clean; live `/owner/members/<id>?tab=payments` shows
  "Raise invoice" disabled with "An invoice for today already exists" for a
  subscription holding today's live invoice (Playwright, localhost:3000);
  commit `9f90579`.

### [x] PR1-C4 — Café cart quote = issued bill
- **Depends:** none.
- **Files:** `lib/services/orders-core.ts`, `lib/services/orders-billing.ts`,
  `lib/services/cafe-billing.ts`, `components/cafe-cart.tsx`,
  `components/cafe-order-screen.tsx`, `tests/tier1/cafe-orders.test.ts`,
  `tests/tier1/cafe-billing-flow.test.ts`.
- **Red test:** for a no-GSTIN tenant, cart shows GST ₹1.00 / total ₹21 while the
  issued bill is ₹20 / no tax.
- **Tests:** café order + billing-flow tests for GST and non-GST tenants; mobile
  cart-total test asserting parity with the issued document.
- **Acceptance:** cart total equals issued total in both tenant states; zero-GST
  line labelled honestly.
- **Migration/rollback:** none. Do not edit `lib/money/**` without escalation.
- **Evidence:** red first — `tests/mobile/cafe-cart.test.tsx` showed GST ₹1.00 /
  ₹21.00 for a no-GSTIN tenant, and the new parity assertion in
  `tests/tier1/cafe-orders.test.ts` failed against the order total. After the
  fix: `pnpm exec vitest run tests/mobile/cafe-cart.test.tsx
  tests/tier1/cafe-orders.test.ts tests/tier1/cafe-billing-flow.test.ts` —
  17 passed; `pnpm exec vitest run tests/mobile/cafe-order-screen.test.tsx` —
  8 passed; `pnpm typecheck` clean; live `/reception/cafe` as demo receptionist
  shows cart total ₹20.00 (2000 paise) and "Bill of supply — no GSTIN on file"
  for the ₹20 item that previously previewed ₹21 (Playwright, localhost:3000);
  commit `f7b4faa`.

### [x] PR1-C5 — Booking: hide tile and route until priced
- **Depends:** none.
- **Files:** `app/(reception)/reception/page.tsx` (tile),
  `app/(reception)/reception/bookings/page.tsx` (guard/hide).
- **Red test:** a guard test currently fails because the route renders a disabled
  "Create booking" dead end; the tile is reachable today.
- **Tests:** route/tile guard test; keep `tests/tier1/bookings-*` green (services
  untouched).
- **Acceptance:** no reception path reaches a dead-end booking screen; the
  price-rule admin UI is explicitly deferred to post-pilot.
- **Migration/rollback:** none. PR3 must not re-add the tile.
- **Evidence:** red first — the new Today-page assertion found the bookings
  href, and the route test resolved instead of refusing. After: `pnpm exec
  vitest run tests/mobile/reception-today-page.test.tsx
  tests/tier1/reception-bookings-hidden.test.ts` — 4 passed; `pnpm typecheck`
  clean; live `/reception` as demo receptionist has no bookings tile/href and
  `/reception/bookings` renders "We couldn't find that page" with no booking
  screen (Playwright, localhost:3000); commit `5723a2d`.

### [x] PR1-C6 — Ops tenant creation applies the chosen preset
- **Depends:** none.
- **Files:** `db/platform-tenant-create.ts`, `lib/actions/platform-tenants.ts`,
  `app/(platform)/ops/tenants/new/new-tenant-form.tsx`,
  `app/(platform)/ops/tenants/[tenantId]/page.tsx`, `db/platform-lead-conversion.ts`,
  `tests/tier1/platform-tenants-create.test.ts`, `tests/platform-lead-conversion.test.ts`.
- **Red test:** created tenant has `preset_key = null` with no warning; form has
  no preset selection.
- **Tests:** create-action test (preset applied), failure-surfaced test, retry
  idempotency; lead-conversion failure surfaced.
- **Acceptance:** no tenant creatable without a preset or an explicit, retryable
  warning; retry uses applyPreset idempotency; no partial tenant is silently left.
- **Migration/rollback:** none (platform-side code only).
- **Evidence:** red first — the four new tests failed (no preset fields on the
  result; lead conversion silent). After: `pnpm exec vitest run
  tests/tier1/platform-tenants-create.test.ts
  tests/tier1/platform-tenants-create-action.test.ts
  tests/platform-lead-conversion.test.ts tests/tier1/tenant-creation-parity.test.ts`
  — 24 passed (apply + binding + audit, unknown preset → retryable warning +
  `tenant.preset_apply_failed` audit, omitted preset → warning, action path
  records `preset_key`); `pnpm typecheck` clean; `pnpm lint` clean on the
  touched files. Fixed a latent scope bug found by the new failure-path test:
  the raw platform-audit insert was returning the Drizzle thenable unawaited,
  so it ran outside `withPlatform` and was swallowed by the dev scope guard;
  both warning paths now `await` inside the scope. Live ops UI check skipped:
  the dev database currently has no enrolled platform operator, so
  `pnpm platform:code` cannot mint a TOTP; the action + service tests cover
  the surface. Commit `883168f`.

### [x] PR1-C7 — Ops catalogue: messaging is not GA (mock-only in pilot)
- **Depends:** none.
- **Files:** `db/seed-platform.ts`, new
  `db/migrations/<ts>_messaging_feature_status.sql`, new
  `docs/messaging-post-pilot.md`.
- **Red test:** row renders `GA` for `messaging` while the provider is mock/disabled.
- **Tests:** migration test for existing rows; entitlements/catalogue tests updated.
- **Acceptance:** catalogue shows a non-GA status for messaging for new and
  existing tenants; no other feature status changes; the only provider in the
  pilot is the existing mock (no Cloud adapter ships), and
  `docs/messaging-post-pilot.md` documents the real WhatsApp Cloud integration —
  credentials, webhook, template approval, rollout — as explicitly post-pilot.
- **Migration/rollback:** data-only update; rollback = corrective update. Needs
  `human-approved-merge`.
- **Evidence:** red first — `tests/tier1/messaging-feature-status.test.ts` read
  `'ga'` after migrations alone and from the seed catalogue. After:
  `pnpm exec vitest run tests/tier1/messaging-feature-status.test.ts
  tests/db/catalogue-parity.test.ts` — 11 passed; `pnpm check:migrations` —
  96 files, naming check passed; `pnpm db:migrate` applied
  `20260921110252_messaging_feature_status.sql` to the dev database and
  `features.messaging.status = 'internal'`; `docs/messaging-post-pilot.md`
  documents credentials, webhook, templates, consent and rollout as post-pilot;
  commit `c1ffca6`. **Migration needs `human-approved-merge` before this PR can
  merge.**

### [ ] PR1-C8 — Worker heartbeat, graceful shutdown, worker-aware health
- **Depends:** none.
- **Files:** `worker/index.ts`, `db/queue.ts`, `app/api/health/route.ts`, new
  `db/migrations/<ts>_worker_heartbeats.sql`, new
  `db/schema/worker-heartbeats.ts`, `db/schema/index.ts`.
- **Red test:** health ignores worker liveness; no SIGTERM handler exists.
- **Tests:** tier1 health test (stale heartbeat → 503; fresh → 200); fake-boss
  shutdown unit test; `tests/tier1/no-superuser-on-request-path.test.ts` stays green.
- **Acceptance:** a dead worker surfaces as unhealthy before a deploy is declared
  green; SIGTERM drains in-flight jobs; migration precedes web/worker.
- **Migration/rollback:** additive table; app rollback ignores it. Needs
  `human-approved-merge`.
- **Evidence:** _pending_

### [ ] PR1-C9 — Migration advisory lock
- **Depends:** none.
- **Files:** `db/migrate.ts`, new `tests/db/migrate-lock.test.ts`.
- **Red test:** two concurrent runners both attempt the same file; the second fails
  on the `_migrations` primary key.
- **Tests:** Testcontainers concurrency test (one applies, the other no-ops);
  migration ordering validation unchanged.
- **Acceptance:** serialized migrations, no partial application, single-run timing
  unchanged.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR1-C10 — Compose secrets fail-fast + db restart policy
- **Depends:** none.
- **Files:** `docker-compose.prod.yml`, new `scripts/check-compose-secrets.ts`,
  `package.json`, `.github/workflows/ci.yml` (scanner step).
- **Red test:** compose contains `${VAR:-fallback}` defaults today.
- **Tests:** scanner with a known-bad fixture; CI step.
- **Acceptance:** compose refuses to start without every required secret; CI fails
  any reintroduced fallback; db restarts with the host/compose.
- **Migration/rollback:** deploy-path change; revert the compose file to roll back.
- **Evidence:** _pending_

### [ ] PR1-C11 — Backup script + retention + restore runbook
- **Depends:** PR1-C10 (secret handling).
- **Files:** new `scripts/db-backup.ts`, `package.json`, `docs/deployment.md`.
- **Red test:** no backup script exists.
- **Tests:** unit tests for object-key naming, retention selection, empty-dump
  failure; integration skipped without R2 credentials.
- **Acceptance:** a run produces a restorable dump in the bucket; retention prunes
  only older keys; restore drill documented and executed once before money is
  collected.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR1-C12 — CI publish, main→Dev auto-deploy, gated production deploy
- **Depends:** PR1-C8 (health semantics), PR1-C10.
- **Files:** new `.github/workflows/publish.yml`, `deploy-dev.yml`, `deploy-prod.yml`,
  `.github/workflows/ci.yml`, `docs/deployment.md`. No `develop` branch.
- **Red test:** no image build or deploy workflow exists.
- **Tests:** post-deploy health gate in the workflows; a dry run on a scratch
  branch proving the prod workflow rejects a mutable ref.
- **Acceptance:** every green `main` CI run publishes exactly one immutable image
  (`sha-<short>`) and automatically deploys **that tag, no rebuild** to the Dev
  VPS; failed health fails the run. `deploy-prod.yml` is `workflow_dispatch` only,
  requires an immutable SHA/tag input (rejects branch/mutable refs), requires
  GitHub `production` environment approval, and the runbook and status board keep
  it blocked until the complete PR3 release gate passes; rollback is redeploying
  the prior immutable tag.
- **Migration/rollback:** none (workflows).
- **Evidence:** _pending_

## PR1 gate

### Pre-merge (blocks opening the PR for review)

- [ ] Full gate green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] Scanners green (migrations, location scope, ops actions, tenant conventions,
  bundle, fonts, focus contrast, scripts exist, compose secrets).
- [ ] Workflow validation: `publish.yml`, `deploy-dev.yml` and `deploy-prod.yml`
  lint/parse; prod workflow confirmed dispatch-only with immutable-SHA input and
  `production` environment approval.
- [ ] Migration review: both migrations carry `human-approved-merge` and a
  reviewer sign-off.
- [ ] PR opened into `main` (agent may push/open after this pre-merge gate; the
  agent never merges its own PR).

### Post-merge (completed by the human merge + agent verification before PR2)

- [ ] Green `main` CI publishes the immutable image; the run's tag is recorded.
- [ ] Automatic Dev VPS deployment of that exact tag; migrate → web → worker.
- [ ] Post-deploy health 200 and worker heartbeat visible.
- [ ] Deployed image tag equals the published tag (immutable-tag verification).
- [ ] Production workflow remains untouched and never triggered.
- [ ] One restore drill completed from a real backup (before any pilot money).

---

# PR 2 — Core Workflow & CSV Import

**Branch:** `feat/pilot-pr2-workflow-import` (from updated `main` after PR1).
**Goal:** the workflows a paying academy needs on day one: configurable company
identity, reception invoice issuance **and counter payment recording**, owner PIN
recovery, real register migration, refundable payments, parent-visible read-only
money, and an honest post-pilot boundary for real WhatsApp.

**Scope in:** academy profile settings; reception `invoices.write`; receptionist
cash/UPI payment recording on existing invoice/payment services; tenant-side owner
PIN reset; CSV member import; payment reversals; parent money view (read-only);
post-pilot messaging documentation pointer.
**Scope out:** UI restyle (PR3), XLSX, parent online payments, credit notes, fee
flags on the coach register, and any WhatsApp Cloud adapter (removed from pilot
scope; mock provider stays for testing).

**Migrations in this PR (forward-only, human-approved-merge):**
`<ts>_role_permissions_reception_invoices_write.sql`,
`<ts>_payment_reversals.sql` (+ `payments.refund` grant backfill). No payment-
recording permission migration is expected — reception already holds
`payments.record` and `invoices.read`; if PR2-C3's audit finds a genuinely missing
key, one additive grant migration rides this PR.

**Pilot exclusions enforced here:** no pay button on the parent page (read-only
invoice, payment history and receipts stay); no real WhatsApp credentials; no
coach fee visibility on the register.

## Commits

### [ ] PR2-C1 — Academy profile settings (name, currency, timezone, GSTIN)
- **Depends:** PR1 merged.
- **Files:** new `lib/services/tenant-profile.ts`, new
  `lib/actions/tenant-profile.ts`, new
  `app/(owner)/owner/settings/academy/page.tsx`,
  `app/(owner)/owner/settings/page.tsx`, `tests/tier1/tenant-profile.test.ts`.
- **Red test:** service/action do not exist; GSTIN cannot be edited in UI.
- **Tests:** tier1 valid/invalid GSTIN, audit row, RLS-scoped read/write; mobile
  render test.
- **Acceptance:** typo'd GSTIN fixable in UI; existing invoices unchanged; invalid
  format rejected with a field error.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR2-C2 — Reception can issue invoices (role + tenant backfill)
- **Depends:** PR2-C1 (no); can follow immediately.
- **Files:** `lib/services/roles.ts`, new
  `db/migrations/<ts>_role_permissions_reception_invoices_write.sql`,
  `tests/tier1/role-gating-matrix.test.ts`,
  `tests/tier1/permission-matrix.test.ts`, new migration test.
- **Red test:** role-matrix assertion that receptionist holds `invoices.write`
  fails; migration test on pre-state fails.
- **Tests:** matrix tests; migration idempotency test.
- **Acceptance:** receptionist sees "Raise an invoice" per the intended counter
  workflow; re-running the migration is a no-op; no other permission changes.
- **Migration/rollback:** additive grant; rollback = corrective delete. Needs
  `human-approved-merge`.
- **Evidence:** _pending_

### [ ] PR2-C3 — Reception: cash/UPI payment recording on open invoices
- **Depends:** PR1 merged (rides existing `payments.record`; aligns with C8/C9
  ledger display).
- **Files:** `components/collect-payment.tsx` (recording UI, or split into
  `components/payment-record-form.tsx`),
  `app/(reception)/reception/collect-payment/page.tsx`,
  `lib/actions/payments.ts` (only if the permission audit finds a gap),
  `lib/services/payments.ts` (no change expected),
  `tests/tier1/reception-payments.test.ts`, new
  `tests/mobile/reception-payment-record.test.tsx`, role-matrix test if
  permissions change.
- **Red test:** reception collect-payment screen shows only a display QR and no
  control records a counter payment; a role-matrix test asserting reception can
  settle an open subscription invoice fails.
- **Tests:** tier1 cash and UPI recording (UPI reference required) against an open
  subscription invoice; partial payment leaves the correct balance; over-payment
  and duplicate reference refused; audit row written; mobile UI submit test
  asserting the balance updates; permission audit test.
- **Acceptance:** a receptionist at the counter can find a member, see outstanding
  invoices and **record** a cash/UPI payment that commits through the existing
  `recordPayment`/`recordPaymentAction` path (no parallel money path); the invoice
  status/balance updates immediately; audit row present. The task opens by
  auditing existing permissions — `payments.record` and `invoices.read` are
  already held, so **add only a genuinely missing permission** (none expected; if
  found, additive grant migration with `human-approved-merge`).
- **Migration/rollback:** none expected; if an audit-found grant is needed,
  additive and rollback = corrective delete.
- **Evidence:** _pending_

### [ ] PR2-C4 — Tenant-side owner PIN reset
- **Depends:** none beyond PR1.
- **Files:** new `lib/actions/tenant-owner-reset.ts`,
  `app/(owner)/owner/staff/page.tsx` (or `[staffId]`), `components/login-form.tsx`
  copy, `tests/auth/owner-reset-link.test.ts`.
- **Red test:** no tenant action exists to mint an owner reset link.
- **Tests:** owner allowed / receptionist-coach denied / audit row; existing reset
  link tests extended.
- **Acceptance:** a co-owner can recover a locked-out owner without platform ops;
  reset remains owner-only and revokes other sessions.
- **Migration/rollback:** none. Do not modify `lib/auth/**`.
- **Evidence:** _pending_

### [ ] PR2-C5 — CSV import: parser, validator, dry-run, row errors
- **Depends:** PR1 merged.
- **Files:** new `lib/services/member-import.ts`, new `lib/actions/member-import.ts`,
  new `components/member-import-*`, template route
  `app/(owner)/owner/members/import/template.csv/route.ts`, new
  `app/(owner)/owner/members/import/page.tsx`, `tests/member-import.test.ts`.
- **Red test:** service absent; importing today is impossible.
- **Tests:** parser/validator unit tests (quotes, commas, ambiguous dates, real
  calendar dates); dry-run writes nothing.
- **Acceptance:** mapping handles missing/extra columns; every rejected row reports
  row number, field and reason; error rows downloadable as CSV.
- **Migration/rollback:** none in v1.
- **Evidence:** _pending_

### [ ] PR2-C6 — CSV import: commit, consent, idempotent retry
- **Depends:** PR2-C5.
- **Files:** `lib/services/member-import.ts`, `lib/actions/member-import.ts`,
  `tests/tier1/member-import.test.ts`, CSV fixtures.
- **Red test:** a second import of the same file inserts duplicates; minor without
  guardian is accepted.
- **Tests:** tier1 double-import → zero new rows; minor-without-guardian rejected;
  unknown location row error; consent written with `evidence.channel = "import"`;
  cross-tenant isolation.
- **Acceptance:** matched rows skipped and never overwritten; duplicate matching by
  member code then phone+name+DOB; each row commits through `createMember`; retry
  is additive and safe.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR2-C7 — CSV import: discoverability and onboarding entry
- **Depends:** PR2-C6.
- **Files:** `app/(owner)/owner/members/page.tsx` (entry),
  `lib/services/onboarding-checklist.ts` (item), mobile render test.
- **Red test:** no import entry point exists anywhere.
- **Tests:** members-page render test for the entry; checklist item test.
- **Acceptance:** import reachable from the members list and the onboarding
  checklist; empty state offers import alongside "add first member".
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR2-C8 — Payment reversals: table, service, audit
- **Depends:** PR2-C2 (role model), PR1-C3 (invoice logic).
- **Files:** new `db/migrations/<ts>_payment_reversals.sql`, new
  `db/schema/payment-reversals.ts`, `db/schema/index.ts`, new
  `lib/services/payment-reversals.ts`, `db/seed-platform.ts`
  (`payments.refund`), `lib/services/roles.ts`, backfill migration,
  `tests/tier1/payment-reversals.test.ts`.
- **Red test:** no writer exists for reversals; `'refunded'` is allowed but never
  written.
- **Tests:** immutability (original payment row unchanged), partial then full
  reversal, over-reversal refused, concurrency serialization, audit rows, denial
  for receptionist.
- **Acceptance:** reversals are new rows only; invoice paid/outstanding recomputed;
  nothing edits an existing payment.
- **Migration/rollback:** additive table and grant; rollback = revoke grant and
  leave rows inert. Needs `human-approved-merge`.
- **Evidence:** _pending_

### [ ] PR2-C9 — Payment reversals: UI + fees ledger display
- **Depends:** PR2-C8.
- **Files:** `components/member-detail/invoice-expanded.tsx`,
  `app/(owner)/owner/fees/page.tsx`, mobile render test.
- **Red test:** no reverse action in the invoice panel.
- **Tests:** UI test for reverse-with-reason and disabled state when nothing
  refundable; fees ledger shows reversal entries.
- **Acceptance:** owner/admin/accountant can reverse; reason required; the ledger
  reconciles to the underlying rows.
- **Migration/rollback:** none (UI only).
- **Evidence:** _pending_

### [ ] PR2-C10 — Parent money view (member-scoped read-only)
- **Depends:** PR2-C8 for refund display (optional).
- **Files:** `lib/services/parent-view.ts`, `app/p/[token]/route.ts`,
  `tests/tier1/parent-money.test.ts`.
- **Red test:** parent page has no fees/invoice/payment data.
- **Tests:** cross-child and cross-tenant denial; amounts match DB; render test.
- **Acceptance:** parent sees only their child's outstanding invoices and payment
  history, in a read-only surface; zero-JS preserved
  (`scripts/e2e-parent-link-zero-js.ts` still 0 scripts).
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR2-C11 — Token-scoped receipt download
- **Depends:** PR2-C10.
- **Files:** new `app/p/[token]/receipt/[paymentId]/route.ts`,
  `lib/services/receipts.ts` (member-scoped extract),
  `tests/tier1/parent-money.test.ts`.
- **Red test:** receipt download requires a staff session; parent has no path.
- **Tests:** valid token + own payment → PDF; other child / other tenant / forged id
  → generic denied page; existing session-gated route untouched.
- **Acceptance:** member-scoped authorization only; no cross-child or cross-tenant
  leak; zero-JS link page unaffected.
- **Migration/rollback:** none.
- **Evidence:** _pending_

## PR2 gate

- [ ] Full gate green (typecheck, lint, test, build) + scanners.
- [ ] Both migrations carry `human-approved-merge` and reviewer sign-off (plus the
  conditional payment-recording grant only if the audit found a missing key).
- [ ] Reception cash/UPI recording demonstrated at 390×844: payment commits
  through the existing service, invoice balance and status update, audit row
  present, permission audit recorded.
- [ ] Import dry-run and idempotent retry demonstrated on seeded data; error CSV
  exported and re-imported successfully.
- [ ] Reversal demonstrated end to end; payments table rowcount/values unchanged
  for the reversed payment.
- [ ] Parent read-only invoice, payment-history and receipt surfaces verified
  member-scoped live at 390×844; zero-JS count = 0.
- [ ] PR opened into `main`, CI green, merged by a human.
- [ ] Checklist committed with the implementation on the PR2 branch.

---

# PR 3 — UI Refresh & Pilot Release

**Branch:** `feat/pilot-pr3-ui-refresh` (from updated `main` after PR2).
**Goal:** close the target-board gap without decoration, restore accessibility,
make working features discoverable, and lock the pilot surface.

**Scope in:** token/contrast remediation; state tone maps; shared primitives; owner
nav/dashboard/members/detail/fees/schedule; coach Today/register/detail; reception
Today/search/check-ins/payment-recording screen restyle; parent polish + runway +
attendance summary (preserving PR2 read-only money UI); ops overview/tenants/detail
ordering; a11y and copy sweep; pilot-release verification.
**Scope out:** new data or metrics that do not exist (expenses, targets, weather,
pool chemistry), photo avatars, category colours, More tabs, gamification, booking
UI, and parent **Pay Now / online payment** only. PR2's read-only parent invoice,
payment-history and receipt UI is preserved, not redesigned away.

**Migrations in this PR:** none. Purely component/CSS so it can roll back by image.

**Pilot exclusions enforced here:** nothing that PR1/PR2 hid may be re-surfaced
(booking, parent Pay Now, WhatsApp sending, expenses, XLSX); read-only parent
money and reception cash/UPI recording remain fully working.

## Commits

### [ ] PR3-C1 — Tokens: accent-strong, ink-3 contrast, KPI type, tone maps
- **Depends:** PR2 merged.
- **Files:** `app/globals.css`, `components/ui/StatusBadge.tsx`,
  `components/ui/Button.tsx`, `tests/tier1/semantic-token-reservation.test.ts`.
- **Red test:** live computed contrast: white on mango 2.61:1; ink-3 on deck
  2.91:1; no session/payment/plan tone maps.
- **Tests:** focus-contrast check; computed-style assertions for the primary button
  and muted text; tone-map unit tests.
- **Acceptance:** normal text ≥4.5:1, controls/focus ≥3:1; no new hues; `--accent`
  still absent from status styles.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR3-C2 — Shared primitives and chart extraction
- **Depends:** PR3-C1.
- **Files:** new `components/ui/StatCard.tsx`, `DataTable.tsx`,
  `SegmentedTabs.tsx`, `SectionHeader.tsx`, `LaneStrip.tsx`, `RunwayStrip.tsx`,
  `CountChip.tsx`, `ProgressBar.tsx`, `AttentionRow.tsx`, `StickyActionBar.tsx`,
  extracted `components/charts/*`; `components/ui/EmptyState.tsx` extension.
- **Red test:** components absent; lane strip is duplicated inline in three files.
- **Tests:** render tests per primitive; lane-strip parity test across consumers.
- **Acceptance:** primitives used by at least one real screen each; no dead
  components (the `Row`/`FieldError` precedent).
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR3-C3 — Owner: nav, dashboard band and attention rows
- **Depends:** PR3-C2.
- **Files:** `components/owner-shell.tsx`, `components/owner-side-nav.tsx`,
  `lib/nav.ts`, `components/owner-dashboard.tsx`, `lib/services/dashboard.ts`,
  mobile tests.
- **Red test:** no Fees entry; attention rows not all actionable; no KPI band or
  trend chart on home.
- **Tests:** nav tests; dashboard render tests (KPI band, actionable rows);
  `tests/tier1/owner-dashboard.test.ts` extended.
- **Acceptance:** Fees reachable from owner nav/home; every attention row links;
  KPI values trace to DB and deltas are real or absent (no fabrication).
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR3-C4 — Owner: members table + member workspace
- **Depends:** PR3-C3, PR2-C7 (import entry).
- **Files:** `components/members-board.tsx`,
  `app/(owner)/owner/members/[memberId]/page.tsx`, `components/member-detail/*`.
- **Red test:** desktop renders a stretched card list; no tabs/columns/pagination;
  member detail lacks plan runway/ring/upcoming sessions.
- **Tests:** mobile table/columns/navigation tests; long-name and empty-state
  coverage.
- **Acceptance:** desktop scans and compares; mobile remains focused; every tab has
  real data or an honest state.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR3-C5 — Owner: fees, reports and schedule composition
- **Depends:** PR3-C4.
- **Files:** `app/(owner)/owner/fees/page.tsx`, `components/fees/*`,
  `app/(owner)/owner/reports/page.tsx`, `components/reports/*`,
  `components/owner-schedule-grid.tsx`.
- **Red test:** fees overview has no KPI band/table; schedule is a day list at
  desktop; charts exist but are not placed on home.
- **Tests:** fees/reports render tests; schedule list/grid parity at both viewports.
- **Acceptance:** period totals reconcile to rows; no expenses/targets invented;
  both viewports pass.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR3-C6 — Coach: Today, register and member detail
- **Depends:** PR3-C2.
- **Files:** `app/(coach)/coach/page.tsx`, `components/register-board.tsx`,
  `app/(coach)/coach/members/[memberId]/page.tsx`, mobile tests.
- **Red test:** Today has no greeting/KPI/tasks; register has no count chips/search/
  avatars; save copy says "Saved on this phone".
- **Tests:** coach Today/register/member render tests; 44px targets preserved.
- **Acceptance:** register stays one-handed and autosaving; count chips match the
  header; copy is truthful; no cosmetic Save button added.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR3-C7 — Reception: Today, member search, check-ins, payment screen
- **Depends:** PR3-C2, PR1-C5 (booking hidden), PR2-C3 (payment recording).
- **Files:** `app/(reception)/reception/page.tsx`, new member-search route,
  `components/reception-check-ins.tsx`, `components/collect-payment.tsx`,
  `app/(reception)/reception/collect-payment/page.tsx`, mobile tests.
- **Red test:** no KPIs/tasks on Today; no reception member search; the payment
  screen is visually below the target board.
- **Tests:** Today/search/check-in render tests; payment-screen render test
  asserting the recording form (cash/UPI) is present and submits through the
  unchanged PR2 action; nav tests.
- **Acceptance:** search by name/phone/code returns the right record; the payment
  screen **still records** cash/UPI through the PR2 services (restyle only — no
  display-only QR, no behavior change); booking tile stays absent; 44px targets.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR3-C8 — Parent: polish, runway, attendance summary
- **Depends:** PR2-C10/C11 (money data and receipts), PR3-C1.
- **Files:** `app/p/[token]/route.ts` (markup only).
- **Red test:** no runway strip or month summary; page otherwise unchanged.
- **Tests:** route render tests asserting invoices, payment history and receipt
  links remain intact; `scripts/e2e-parent-link-zero-js.ts` still 0 scripts.
- **Acceptance:** zero-JS preserved; runway from real subscription dates; summary
  counts match marked attendance; **PR2 read-only invoice, payment-history and
  receipt UI content and authorization behaviour preserved**; no Pay Now /
  online payment control added; no payment/progress fabrication.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR3-C9 — Ops: overview, tenants, detail ordering
- **Depends:** PR3-C2, PR1-C6/C7.
- **Files:** `app/(platform)/layout.tsx`, `app/(platform)/ops/page.tsx`,
  `app/(platform)/ops/tenants/page.tsx`,
  `app/(platform)/ops/tenants/[tenantId]/page.tsx`, `db/platform-overview.ts`,
  `db/tenant-health.ts`.
- **Red test:** overview has no KPI/health bands; tenants lack identity marks and
  pagination; owner-invite buried below stats.
- **Tests:** ops render tests at 1280×900; no host-boundary regression.
- **Acceptance:** metrics freshness stated honestly; preset-less tenants flagged;
  invite owner visible for new tenants.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR3-C10 — Accessibility and copy sweep
- **Depends:** PR3-C3..C9.
- **Files:** `components/member-detail/inline-edit-field.tsx`,
  `components/member-enrolment-panel.tsx`,
  `components/member-subscription-panel.tsx`,
  `components/member-detail/member-invoices-panel.tsx`,
  `components/member-detail/invoice-expanded.tsx`,
  `components/member-detail/member-attendance-grid.tsx`,
  `components/owner-schedule-grid.tsx`, `components/leave-request-form.tsx`,
  `components/my-leave-card.tsx`, remaining `type="date"` sites.
- **Red test:** sub-44px controls; "Edit fullName" accessible names; unassociated
  select; sub-11px text; "Unpaid · unpaid"; native date inputs.
- **Tests:** mobile a11y/tap-target tests; copy assertions.
- **Acceptance:** controls ≥44px on tenant surfaces; readable labels; no sub-11px
  text; no native date fields in user-facing forms; copy matches behaviour.
- **Migration/rollback:** none.
- **Evidence:** _pending_

### [ ] PR3-C11 — Pilot release verification and hidden-surface lock
- **Depends:** every prior PR3 commit.
- **Files:** deviations/evidence notes only (no product code expected).
- **Red test:** n/a — verification task.
- **Tests:** full gate; manual pass per role at 390×844 (owner also 1280×900).
- **Acceptance:** no broken primary action; empty/loading/success/error verified for
  every changed screen; hidden surfaces remain hidden (booking, parent Pay Now,
  WhatsApp sending, expenses, XLSX); reception cash/UPI recording and parent
  read-only invoices/payment history/receipts remain fully working; bundle/font
  budgets green; **this gate's completion is the precondition for unblocking the
  production deploy workflow**.
- **Migration/rollback:** none.
- **Evidence:** _pending_

## PR3 gate

- [ ] Full gate green + scanners (no migration label needed — no migrations).
- [ ] Owner verified at 1280×900 and 390×844; coach/reception/parent at 390×844;
  ops at 1280×900.
- [ ] Zero horizontal overflow; all changed primary actions reachable.
- [ ] Reception payment screen records cash/UPI through unchanged PR2 services.
- [ ] Parent read-only invoice, payment-history and receipt UI preserved end to
  end; only Pay Now/online payment absent.
- [ ] Zero-JS parent contract still passes; no new fabricated metric found.
- [ ] PR opened into `main`, CI green, merged by a human.
- [ ] Checklist committed with the implementation on the PR3 branch.
- [ ] **Release gate complete → production `workflow_dispatch` unblocked.**

---

## Cross-PR dependency map

```
PR1 (stability/deploy) ──► PR2 (workflow/import) ──► PR3 (UI refresh/release)
All three merge into main serially. No develop branch.

PR1-C1..C12    no cross-PR dependencies
PR2-C1..C7     require PR1 merged (deploy + invoice/café invariants in place)
PR2-C3         rides existing payments.record/invoices.read; audit first
PR2-C8..C9     depend on PR1-C3 (invoice logic) and PR2-C2 (roles)
PR2-C10..C11   depend on PR2-C8 only for refund display
PR3-C1..C11    require PR2 merged; C4 depends on PR2-C7, C7 on PR1-C5 and
               PR2-C3, C8 on PR2-C10/C11
PR3-C11 pass   is the precondition for unblocking deploy-prod (PR1-C12)
```

## File-ownership guards (prevent duplicated work)

| File / concern | Owner PR | Other PRs may |
|---|---|---|
| `lib/services/owner-analytics.ts` | PR1-C1 | consume only |
| `lib/services/invoice-issue.ts`, `invoice-mutations.ts` | PR1-C3 | PR2 touches roles/tests only; PR3 restyles UI |
| Café quote logic | PR1-C4 | PR3 restyles components only |
| Booking route/tile | PR1-C5 | PR3 must keep hidden |
| Ops preset/create flow | PR1-C6 | PR3 restyles ops pages only |
| Worker/health/migrate/compose/CI + dev/prod workflows | PR1-C8..C12 | untouched by PR2/PR3 |
| Roles/permissions | PR2-C2 | PR3 displays only |
| Reception payment recording (`payments.ts`, `payments` action, collect-payment) | PR2-C3 | PR3 restyles UI only; must not change recording behavior |
| Import logic | PR2-C5..C7 | PR3 restyles entry page only |
| Reversal arithmetic | PR2-C8..C9 | PR3 restyles UI only |
| Parent read-only money + receipt route | PR2-C10..C11 | PR3 edits markup only and must preserve invoice/payment-history/receipt content |
| Post-pilot WhatsApp Cloud path (docs only) | PR1-C7 | no Cloud adapter in any PR |
| Tokens/primitives/nav/a11y | PR3 | PR1/PR2 must not restyle |

## Pilot-exclusion register (holds for all three PRs)

- Payroll, Hindi/multilingual UI, public self-registration, native apps and
  offline attendance are out of the release entirely.
- Booking UI, XLSX import, **parent Pay Now / online payment**, real WhatsApp
  sending, expenses/P&L/targets, wallet-settled café, credit notes and coach fee
  flags stay hidden or unbuilt.
- Real WhatsApp Cloud integration is removed from pilot scope: the existing mock
  provider stays for testing and `docs/messaging-post-pilot.md` documents the
  Cloud rollout as post-pilot.
- Reception cash/UPI payment recording and the parent read-only invoice, payment
  history and receipt surfaces are explicitly **in scope** and must survive PR3.
- Nothing may surface a fabricated metric, trend or placeholder to fill a target
  board gap.
