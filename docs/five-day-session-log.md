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

Pick up at **1.5 — create tenant**. The route `/platform/tenants/new`
is already linked from the list page. The natural shape:

1. Form page: name + slug + timezone + plan (default selected) + first
   location name (suggested: "Main") + currency + GSTIN (optional).
2. Server action: create tenant row + first location row + apply a
   chosen preset (or no preset, "start from scratch" is one of the
   seven documented presets in `docs/project-scope.md` §5.16).
3. After creation, redirect to the new tenant's detail page
   (/platform/tenants/[id]).

The "Replaces the CLI path in F-25" in 1.5's task body is the
explicit goal — `db/seed-platform.ts`'s demo-academy is what 1.5 will
supersede for new tenants.

Things 1.5 will need that don't exist yet:
- A create-tenant server action schema (Zod). Tenant input is
  tenant-scoped data, so the action calls `db.query.insert(tenants)…`
  directly under withPlatformAdmin() (the cross-tenant write path;
  see the architectural note above about writes).
- A preset-application pathway. Day 2 (2.1–2.4) covers
  `applyPreset()`, which doesn't exist yet. 1.5's create should still
  work without presets — creating a tenant with no preset applied is
  a valid starting state, and the wizard's preset step (2.2 / 2.6) can
  apply one later. **DO NOT block 1.5 on the preset pathway.**

Before opening 1.5, read `db/seed-platform.ts` to see how the existing
CLI creates a tenant — the new code replaces that path with a UI.

After 1.5: 1.6 (status lifecycle). The detail page (1.4) needs a
"Status" action button — but 1.6 is not the action button, it's the
audit-aware transition machinery. Suspension writes `platform_audit_log`,
notifies the tenant users, blocks tenant login. Stack on top of 1.5's
platform-write path.
