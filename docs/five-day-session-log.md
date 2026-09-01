# Five-phase batch — session log

**Continuation marker.** This file is updated at the end of every
session so the next agent can resume without re-reading the entire
repo state. When the next agent picks up, they should:

1. Read this file top to bottom.
2. Update the **Next pickup** section with their own notes (what they
   plan to do next, what's blocking).
3. Append their own session entry below the previous one.
4. **Remove the marker line at the top of the next session**, leaving
   the file as a normal running log.

---

## Mark here when work resumes below

<!-- marker -->

---

## Branches and PRs as of last session

- `feat/day1-platform-control-plane` — PR #30 against `main`. Phase 1.1 + 1.2
  (platform auth; platform layout/shell). CI green. **Awaiting review.**
- `feat/1.3-tenant-list` — PR #31 against `feat/day1-platform-control-plane`.
  Phase 1.3 (tenant list with denormalised counts). CI state unknown.
- `feat/1.4-tenant-detail` — PR #32 against `feat/1.3-tenant-list`. Phase
  1.4 (read-only tenant detail). CI state unknown — just pushed at end of session.
- All three stack: `main` ← `#30 (1.1+1.2)` ← `#31 (1.3)` ← `#32 (1.4)`.

## Completed work — Phase 1

- [x] **1.1** Platform auth — `db/platform-auth.ts` + `lib/actions/platform-auth.ts`
  + login UI at `/platform/login`. TOTP second factor, scrypt-hashed
  passwords, opaque session token hashed in the row. 23 tests.
- [x] **1.2** Platform layout and shell — `(platform)` route group, dark-marine
  sidebar (operators are desktop users), `/platform/login` and
  `/platform/verify` consumed by 1.1's service. 10 action tests.
- [x] **1.3** Tenant list — `db/platform-tenants.ts:listTenants`, server-rendered
  table with status pill, search + status filter URL-bound. 7 tests.
  Introduced `withPlatformAdmin()` scope + `platform_admin_select` RLS
  policies (migration `20260901162028_platform_admin_tenant_read.sql`)
  to grant cross-tenant visibility to the platform surface.
- [x] **1.4** Tenant detail — `db/platform-tenants.ts:getTenantDetail`,
  read-only `/platform/tenants/[tenantId]`. 8 tests. Added
  `platform_admin_select` on sessions (migration
  `20260901171804_platform_admin_sessions_read.sql`) for the
  sessionsThisMonth subquery.

## Architectural decisions made in this batch

The next agent should know about these — they were deliberate, not
defaults. **DO NOT re-derive them when picking up 1.5+;**
they would unground the work already merged.

### `withPlatformAdmin()` is the platform's third scope
`db/scope.ts` defines three scopes:
- `withTenant(tenantId, fn)` — sets `app.tenant_id`. Tenant work.
- `withUser(userId, fn)` — sets `app.user_id`. Pre-tenant resolution
  (`db/platform.ts` uses this for tenant lookup after better-auth).
- `withPlatform(fn)` — no session var. RLS-exempt tables only.
- **`withPlatformAdmin(fn)` — opens a transaction, sets `app.platform_admin = 'true'`.**
  New in 1.3. Cross-tenant reads for the operator surface.

`withPlatformAdmin` nests freely with itself and with `withPlatform`.
It does NOT nest with `withTenant()` or `withUser()` — the scope guard
rejects this combination because both session variables OR'd together
on the same row would widen visibility beyond what either intends.

### `platform_admin_select` RLS policies
Migration `20260901162028_platform_admin_tenant_read.sql` adds
SELECT-only policies on `tenants`, `tenant_memberships`, `locations`,
`members` — keyed on `app.platform_admin = 'true'`. Migration
`20260901171804_platform_admin_sessions_read.sql` adds the same for
`sessions`. **The pattern is one new policy per table the platform
reads cross-tenant; all are SELECT-only.** Future cross-tenant reads
should follow the same pattern rather than introducing a new mechanism.

Multiple SELECT policies OR together — a tenant scope with
`app.tenant_id` set sees its own row; `withPlatformAdmin` sees every
row. Writes remain gated by `tenant_isolation`. The platform scope
**reads every tenant but cannot mutate tenant data through this path.**
Writes (status changes, suspensions) come in 1.6 and need a separate
audit-aware path — do not invent a new write mechanism.

### `lib/auth/platform-cookie.ts` is the platform-session cookie
`HttpOnly`, `SameSite=Lax`, `Secure` only in production. Name:
`platform_session`. TTL: 8h sliding. None of this is tenant-side. The
tenant auth flow uses better-auth and lives at `/login`; the platform
auth flow lives at `/platform/login`. **These two paths must remain
separate — that's the whole point of 1.1 ("Platform staff must not be
reachable through the tenant login").**

### Routes so far
- `/platform/login` — login form
- `/platform/verify` — TOTP entry (auto-submits on 6 digits)
- `/platform` — empty home (intentionally empty; not a placeholder dashboard)
- `/platform/tenants` — list with search + status filter
- `/platform/tenants/[tenantId]` — read-only detail
- `/platform/tenants/new` — 404s until 1.5 lands (the list page links to it)

The tenant list links to "New tenant" via `/platform/tenants/new`. 1.5 will
materialise that route. If 1.5 takes a different shape, **update the link**
in `app/(platform)/platform/tenants/page.tsx`.

## Standing rules applied in this batch

- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before each commit.
  All green at session end (257/257 tests).
- Every Server Action opens with Zod safeParse at the boundary. (Confirmed by
  `tests/tier1/server-action-preamble.test.ts` AST walk.)
- Money work is out of scope. None of 1.1–1.4 touches billing.
- Soft-delete hides resources from cross-tenant reads (location count tests
  this: 2 live + 1 soft-deleted → count is 2).
- Per-tenant RLS is preserved. The platform's cross-tenant read is a separate
  path, not a weakening of tenant isolation.
- Mutation proof per review-checklist §6 — each task's tests include a
  "breaks the implementation, the suite catches it" check at least once.

## Things deferred to specific later phases

- 1.5 create tenant — the next slice. The "New tenant" link is live.
- 1.6 status lifecycle — needs an audit-aware write path for status
  transitions (suspension, churn). Stacks on 1.4's detail page.
- 1.7 feature catalogue — platform-owned entity, doesn't need cross-tenant read.
- 1.8 feature toggles — needs a per-tenant override table (not yet created).
  Currently feature state is plan-derived; overrides land here.

## Test inventory snapshot

Test files added or modified in this batch:
- `tests/tier1/platform-auth.test.ts` (23)
- `tests/tier1/platform-auth-actions.test.ts` (10)
- `tests/tier1/platform-tenants-list.test.ts` (7)
- `tests/tier1/platform-tenants-detail.test.ts` (8)
- `tests/tier1/user-scope.test.ts` — updated to assert the new
  `platform_admin_select` policy exists alongside `user_resolution` and
  `tenant_isolation`.
- `tests/tier1/no-superuser-on-request-path.test.ts` — allowlist extends
  each time a new test file references `MIGRATION_DATABASE_URL`.

`vitest.config.ts`: `fileParallelism: false` added — the two
platform-auth test files share a `beforeAll` that wipes the same
table; parallel files race. Tests within a file still run in parallel.

## Files added in this batch (worth knowing for `git log` archaeology)

```
db/
  schema/platform-users.ts                  # schema
  schema/index.ts                          # exports the new schema
  allowlist.ts                             # adds platform_users, platform_sessions, platform_audit_log
  platform-auth.ts                         # service: login, verifyTotp, lookupPlatformSession, logout, provisioning, totp helpers
  platform-tenants.ts                      # service: listTenants, getTenantDetail
  scope.ts                                 # adds withPlatformAdmin() scope
  migrations/20260901110035_platform_users.sql
  migrations/20260901162028_platform_admin_tenant_read.sql
  migrations/20260901171804_platform_admin_sessions_read.sql

lib/
  auth/platform-cookie.ts                  # platform_session cookie wrapper
  actions/platform-auth.ts                 # server actions: login, verify, logout, status

app/(platform)/
  layout.tsx                               # dark-marine sidebar shell
  platform/{login,verify,page,tenants,tenants/[tenantId]}/*.tsx

scripts/
  seed-platform-user.ts                    # dev seed: prints email + password + current TOTP code

docs/
  five-day-work-guide.md                   # reframed days as phases; checklist marked through 1.4
  five-day-handover.md                     # new doc, <100 lines, the prompt pasted to start a fresh session

tests/tier1/
  platform-auth.test.ts
  platform-auth-actions.test.ts
  platform-tenants-list.test.ts
  platform-tenants-detail.test.ts

vitest.config.ts                           # added fileParallelism: false
```

## CI state as of session end

- PR #30 (1.1 + 1.2): green at last check
- PR #31 (1.3): not yet observed green this session
- PR #32 (1.4): pushed at end of session, CI not yet observed

If the next agent finds a red CI on #31 or #32, the most likely
cause is a missing migration in CI — `pnpm db:reset` runs against
the CI Postgres service and should pick up all migrations including
the two new ones (20260901162028 and 20260901171804). If a migration
is missing from CI, the symptom is "relation X does not exist".

---

## Sessions

### Session N — Phase 1.1–1.4 (this session, ended before compaction)

What landed:
- 1.1 platform auth: `db/platform-auth.ts`, `lib/actions/platform-auth.ts`,
  `app/(platform)/platform/login/page.tsx` + login form, scrypt password
  hashing + RFC 6238 TOTP, 23 tests with mutation proof.
- 1.2 platform layout: `(platform)` route group, dark-marine sidebar layout,
  `/platform/login` and `/platform/verify` consumed by 1.1's service,
  `/platform` empty home (intentional). 10 server-action tests.
- 1.3 tenant list: `db/platform-tenants.ts:listTenants` (single SELECT with
  denormalised counts), `withPlatformAdmin()` scope, new
  `platform_admin_select` RLS policies, `/platform/tenants` page with
  search + status filter, 7 tests. Migration
  `20260901162028_platform_admin_tenant_read.sql`.
- 1.4 tenant detail: `db/platform-tenants.ts:getTenantDetail` (composes
  withPlatformAdmin + withTenant), `/platform/tenants/[tenantId]` page,
  8 tests. Migration `20260901171804_platform_admin_sessions_read.sql`.

Bug found:
- sessions table needed its own `platform_admin_select` policy; the
  count subquery returned 0 with the platform_admin scope, even with the
  session row actually present. Fixed with the dedicated migration.

Scope drift:
- Added `withPlatformAdmin()` scope — it's the third scope kind the
  codebase needs (alongside `withTenant` and `withUser`).
  Documented above for the next agent.

Velocity calibration (per the human's note mid-session):
"Phases are work units, not calendar days; sessions are calendar units.
A phase may take several sessions; a session may complete zero, one, or
several tasks. Progress is read off the checklist."
"Don't accelerate to hit a number. 1-3 substantive tasks per session
with full TDD is better than 8 rushed ones."

That calibration held: 4 substantive tasks shipped (1.1–1.4), each
with TDD and mutation proof, plus the platform-admin architecture on
top.

### Next pickup

Pick up at **1.7 — feature catalogue**. The platform sidebar
already links to `/platform/features` (`app/(platform)/layout.tsx`)
and 1.4's tenant detail references it in
`recentActivity` ("feature toggle changes…"). The catalogue page
sits on `db/schema/platform.ts::features` (already in the DB and
seeded by `db/seed-platform.ts`). The page lists every feature
with its category and status (`'ga' | 'beta' | 'internal'`),
allows editing name / category / status, and write-protection on
`feature_key` (the immutable analytics key per architecture §7).
The status field is what 1.8 will eventually override per-tenant.

Stack state: PR #35 (1.5) and PR #36 (1.6) are open. #36 is off
`feat/1.5-create-tenant` (it includes 1.5's commits ahead of
`main`); once #35 merges to main, rebase #36 onto the new main
head so the diff is small and reviewable.

---

## Sessions

### Session N — Phase 1.1–1.4 (this session, ended before compaction)

What landed:
- 1.1 platform auth: `db/platform-auth.ts`, `lib/actions/platform-auth.ts`,
  `app/(platform)/platform/login/page.tsx` + login form, scrypt password
  hashing + RFC 6238 TOTP, 23 tests with mutation proof.
- 1.2 platform layout: `(platform)` route group, dark-marine sidebar layout,
  `/platform/login` and `/platform/verify` consumed by 1.1's service,
  `/platform` empty home (intentional). 10 server-action tests.
- 1.3 tenant list: `db/platform-tenants.ts:listTenants` (single SELECT with
  denormalised counts), `withPlatformAdmin()` scope, new
  `platform_admin_select` RLS policies, `/platform/tenants` page with
  search + status filter, 7 tests. Migration
  `20260901162028_platform_admin_tenant_read.sql`.
- 1.4 tenant detail: `db/platform-tenants.ts:getTenantDetail` (composes
  withPlatformAdmin + withTenant), `/platform/tenants/[tenantId]` page,
  8 tests. Migration `20260901171804_platform_admin_sessions_read.sql`.

Bug found:
- sessions table needed its own `platform_admin_select` policy; the
  count subquery returned 0 with the platform_admin scope, even with the
  session row actually present. Fixed with the dedicated migration.

Scope drift:
- Added `withPlatformAdmin()` scope — it's the third scope kind the
  codebase needs (alongside `withTenant` and `withUser`).
  Documented above for the next agent.

Velocity calibration (per the human's note mid-session):
"Phases are work units, not calendar days; sessions are calendar units.
A phase may take several sessions; a session may complete zero, one, or
several tasks. Progress is read off the checklist."
"Don't accelerate to hit a number. 1-3 substantive tasks per session
with full TDD is better than 8 rushed ones."

That calibration held: 4 substantive tasks shipped (1.1–1.4), each
with TDD and mutation proof, plus the platform-admin architecture on
top.

### Session N+1 — Phase 1.5 (this session)

What landed:
- 1.5 create tenant: stack #30/#31/#32 first merged into main
  (`main` ← #30 ← #31 ← #32, all CI green). Then
  `feat/1.5-create-tenant` off `main`, single commit
  `19f1b96`. PR #35 OPEN.
- `db/migrations/20260902200000_platform_admin_tenant_write.sql` —
  additive INSERT policies on `tenants` + `locations` keyed on
  `app.platform_admin = 'true'`. First cross-tenant write path the
  request surface can reach; the existing CLI used
  `MIGRATION_DATABASE_URL`, which architecture §5.6 bans from
  request-path code.
- `db/platform-tenant-create.ts` — `createTenant()`: one
  `withPlatformAdmin()` transaction (tenant + first location +
  `platform_audit_log` action=`tenant.create`); Zod at the boundary;
  slug uniqueness → `code:'slug_taken'`; plan lookup →
  `code:'plan_not_found'`. Exports `listActivePlans()` for the form's
  plan `<select>`.
- `lib/actions/platform-tenants.ts` — `createTenantAction`: parse
  preamble → platform-session permission check → service. Same
  `CreateTenantResult` shape throughout.
- `app/(platform)/platform/tenants/new/{page.tsx,new-tenant-form.tsx}`:
  server-rendered page (auth-gated, fetches plans) + client form per
  DESIGN.md (16px inputs to avoid iOS zoom, `--accent` primary action,
  error pill, sentence case, no emoji). Form 2.11kB First Load JS,
  within bundle budget.

Architectural decision (1.5):
- ADDED `platform_admin_insert` RLS policies on `tenants` +
  `locations`. Mirrors the `platform_admin_select` pattern from 1.3.
  Postgres OR-combines permissive policies; with `withPlatformAdmin()`
  setting `app.platform_admin='true'`, the new policy's WITH CHECK
  passes while the existing `tenant_isolation.with check` (which
  requires `id = app.tenant_id`) still safely denies (no tenant context
  on a write). App_user without `app.platform_admin='true'` still
  cannot INSERT — the policy is additive, not a weakening. Phase 1.6
  will add a sibling `platform_admin_update` policy for status
  transitions; no UPDATE/DELETE was opened here.

Tests:
- `tests/tier1/platform-admin-tenant-write-rls.test.ts` — 6 tests:
  (1) `withPlatformAdmin()` INSERT succeeds, (2) `app.platform_admin =
  'false'` fails (RLS denies), (3) unset fails, (4) both-deny
  fails, (5) cross-connection leak guard (a fresh connection reads
  `app.platform_admin` as empty, not the value the previous
  connection set), (6) idempotent under repeated `withPlatformAdmin()`
  calls. Mutation-proofed: dropping the policy turns tests 1 + 6 red.
- `tests/tier1/platform-tenants-create.test.ts` — 7 tests: happy
  path (tenant + first location + audit row captured), trim
  normalisation, gstin upper-casing, duplicate slug → `slug_taken`,
  unknown plan → `plan_not_found`, zod-rejected input, atomicity
  proof. Mutation-proofed: commenting out the audit insert breaks
  2 tests.
- `tests/tier1/platform-tenants-create-action.test.ts` — 5 tests:
  happy via Server Action with full 2FA, no cookie / unauthenticated,
  half-authenticated (login but no TOTP verify), zod rejection, slug
  collision.
- `tests/tier1/no-superuser-on-request-path.test.ts` — added 3 new
  files to the allowlist (the existing test already enforces the
  invariant; the new files only reference `MIGRATION_DATABASE_URL` for
  fixture cleanup, never in request-path code).

Verification:
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — all
  green. Full suite 276/276 (was 257). Bundle audit: all 26 routes
  within budget; new `/platform/tenants/new` ships at 2.11kB First
  Load JS.

Velocity: 1 substantive task shipped with full TDD + mutation proof
+ migration. Matches the standing calibration ("1-3 substantive
tasks per session").

### Session N+2 — Phase 1.6 (this session)

What landed:
- 1.6 tenant status lifecycle: `feat/1.6-status-lifecycle` off
  `feat/1.5-create-tenant` (PR #35 still open; will need rebase
  after #35 merges). Single commit `703b276`. PR #36 OPEN.
- **migration `20260902210000_platform_admin_tenant_update.sql`** —
  additive UPDATE policy on `tenants` keyed on
  `app.platform_admin = 'true'`. Sibling of `platform_admin_insert`
  (1.5). The platform surface can now write `tenants.status`
  through `withPlatformAdmin()`; `tenant_isolation` keeps the
  default closed for any tenant user who somehow opens the path.
- **`db/platform-tenant-status.ts`** — `transitionTenantStatus()`:
  one `withPlatformAdmin()` transaction. `SELECT FOR UPDATE` on
  the tenant row, state-machine guard (trial/active/suspended can
  move to any of the three; churned is terminal), UPDATE
  `tenants.status`, INSERT `platform_audit_log` with action
  `tenant.activate` / `tenant.suspend` / `tenant.churn` and detail
  `{from, to, reason?}`. Reasons required on suspend/churn;
  activate/reactivate reason-less. Distinct error codes for
  `no_change` (same status) and `terminal_state` (out of churned).
- **`db/platform.ts`** — added `resolveSessionForLogin()` returning
  a discriminated union `{kind: 'ok' | 'suspended' | 'none'}`.
  One call resolves both the home route AND whether to gate the
  login on tenant suspension. `resolveHomePath()` kept for any
  future reader that wants only the path.
- **`lib/actions/auth-ui.ts`** — `homeForSessionAction` now
  returns the `SessionResolution` union instead of `string | null`.
- **`components/login-form.tsx`** — clear tenant-suspended message
  carrying the actual slugs ("Your club (xyz, acme) is paused.
  Reach out to your operator to reactivate it."), instead of the
  previous `No membership found` which conflated paused-tenant
  with no-account.
- **`lib/actions/platform-tenants.ts`** — added
  `transitionTenantStatusAction`: same parse → permission →
  service preamble as `createTenantAction`. TenantId comes from
  the route param, never from the form (a hidden field is just a
  cookie replier away).
- **`app/(platform)/platform/tenants/[tenantId]/status-transitions.tsx`** —
  client controls wired into the existing detail page. Suspend /
  churn open a reason-typed modal; activate runs inline.
  `router.refresh()` after each commit so the status pill, the
  activity timeline, and the audit log all reflect.

Tests (20 new; 297 / 297 total):
- `tests/tier1/platform-admin-tenant-update-rls.test.ts` — 4:
  UPDATE policy proof + 'app.platform_admin = false' deny + unset
  deny + idempotent repeat. **Mutation-proofed**: drop the policy,
  1 test red.
- `tests/tier1/platform-tenants-status.test.ts` — 11: every state
  machine edge, reason-required on suspend/churn, no_change vs
  terminal_state, tenant_not_found, invalid input, atomicity.
  **Mutation-proofed**: skipping the audit insert breaks 5 tests.
- `tests/tier1/platform-tenants-status-action.test.ts` — 5: full
  Server Action with real auth (provision + login + TOTP verify
  like the other action tests), parse rejection, terminal-state,
  malformed input.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build &&
   pnpm check:migrations && pnpm exec tsx
   scripts/check-bundle-budget.ts` — all green. Detail page
  `/platform/tenants/[tenantId]` went from `171 B` to `1.86 kB`
  First Load JS (the new client island for the transition
  controls); still well within the 150 KB bundle budget.

Velocity: 1 substantive task shipped with full TDD + migration +
mutation proof + UI integration. Matches the standing calibration
("1-3 substantive tasks per session").

Stack note for the next agent: this branch is off
`feat/1.5-create-tenant`, not off `main`. PRs #35 (1.5) and
#36 (1.6) are stacked 1.5 → 1.6. When #35 lands, rebase #36 onto
`main` to drop the 1.5 commits and keep the diff small.

After 1.5: 1.6 (status lifecycle). The detail page (1.4) needs a
"Status" action button — but 1.6 is not the action button, it's the
audit-aware transition machinery. Suspension writes `platform_audit_log`,
notifies the tenant users, blocks tenant login. Stack on top of 1.5's
platform-write path.
