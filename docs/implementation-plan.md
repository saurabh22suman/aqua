# Implementation plan — Aqua

**Task-level build plan for Phases 0 to 3.** Written to be executed sequentially by a developer or an AI coding agent.

| | |
|---|---|
| Covers | Setup, Phase 1 (foundation), Phase 2 (core), Phase 3 (vertical + staff pay + go-live), the ops platform spine (O-01–O-11) |
| Task count | 164 |
| Estimated duration | 23–27 weeks with one to two people |
| Companions | `project-scope.md`, `architecture.md`, `DESIGN.md` |

---

## How to use this document

Tasks are executed **in order**. Each carries an ID, its dependencies, what to build, and what "done" means. Do not skip ahead, do not batch unrelated tasks, and do not start a task whose dependencies are unfinished.

**One task equals one commit or one pull request.** A task that appears to need a second unrelated task's work is a signal that the plan is wrong — stop and flag it rather than expanding scope.

### Prompt template for an AI executor

```
Read architecture.md sections {SECTIONS} and DESIGN.md before writing code.

Execute task {ID}: {TITLE}

Constraints:
- All tenant data access goes through withTenant(). Never import the raw db client.
- Money is bigint paise. Never float, never numeric.
- Timestamps are timestamptz, stored UTC.
- Every mutation writes an audit_log row in the same transaction.
- TypeScript strict. No `any`. Zod validation at every boundary.
- Files stay under 300 lines. Split by domain concept.
- Only the styling tokens in DESIGN.md. No new hex values, no component library.
- Icons imported individually from lucide-react. Never the barrel import.

Stop and ask before:
- Adding any npm dependency
- Changing a schema defined in a completed task
- Adding a database table not named in this task
- Anything that would exceed the 150KB first-load JS budget

Done when: {ACCEPTANCE}
```

### Definition of done — applies to every task

1. `pnpm typecheck` passes with zero errors
2. `pnpm lint` passes with zero warnings
3. `pnpm test` passes, including `isolation.test.ts`
4. `pnpm build` succeeds and stays inside the bundle budget
5. New tenant-scoped tables have RLS enabled, forced, and policied
6. New mutations write to `audit_log`
7. New lists have a designed empty state
8. Task acceptance criteria are met and manually verified

### Escalation — stop and ask, do not improvise

- A task needs a table or column not in the plan
- A dependency is missing or the ordering seems wrong
- The bundle budget would be exceeded
- A third-party API behaves differently from what the architecture assumes
- Anything touching money, tenant isolation, or children's data is ambiguous

---

# Phase 0 — Discovery

**2 weeks. No code.** Output is documents, not software. Do not start Setup until these exist.

| ID | Task | Done when |
|---|---|---|
| D-01 | Shadow the reference business for five full days across morning and evening batches | Written observation log per day |
| D-02 | Map the enquiry-to-member journey including every exception | Process map with exception branches |
| D-03 | Document the real fee structure — every plan, discount, sibling rate, exception | Table covering every currently-active arrangement |
| D-04 | Record the cash-versus-online split by value and count over one month | Two numbers with the source data |
| D-05 | Inventory all existing data: registers, spreadsheets, WhatsApp groups, apps | File list with row counts and column descriptions |
| D-06 | Document coach pay: rates, structure, advance practice, dispute history | Pay rules per coach, written as formulas |
| D-07 | Photograph or export every paper form and register in use | Image set |
| D-08 | Write the migration plan for existing data into the target schema | Column-by-column mapping document |

**Gate:** you can describe a full month of the business, including exceptions, without asking a question.

---

# Milestone S — Setup

**Roughly 1 week.**

### S-01 · Repository and toolchain
**Depends:** —
**Build:** Next.js 15 App Router, TypeScript strict, Tailwind, ESLint, Prettier, Vitest. Node 22. `.nvmrc`, `.editorconfig`.
**Done when:** `pnpm dev` serves a page; `typecheck`, `lint`, `test`, `build` all run clean.

### S-02 · Design tokens and DESIGN.md
**Depends:** S-01
**Build:** `DESIGN.md` at repo root. Tailwind theme extension with the deck/marine/water/mango palette, semantic tokens (`good`, `late`, `warn`), type scale, two shadow levels, radii. Self-hosted subset Bricolage Grotesque and Instrument Sans with `font-display: swap`.
**Done when:** a test page renders every token; total font payload under 45 KB.
**Never:** raw hex values in components from this point on.

### S-03 · Local database
**Depends:** S-01
**Build:** Docker Compose with Postgres 16 and `btree_gist`. `.env.example`. Zod-validated env parsing that fails loudly at boot on a missing variable.
**Done when:** `docker compose up` gives a reachable database; a missing env var produces a clear startup error.

### S-04 · Drizzle and migrations
**Depends:** S-03
**Build:** Drizzle config, schema directory split by domain, plain-SQL forward-only migrations checked into the repo. `db:generate`, `db:migrate`, `db:reset` scripts.
**Done when:** a trivial table migrates up on a clean database.
**Never:** edit a migration that has been applied. Add a new one.

### S-05 · CI pipeline
**Depends:** S-01, S-04
**Build:** GitHub Actions running typecheck, lint, test, build, and `bundlesize` with a 150 KB gzipped first-load limit. Migrations run against a throwaway Postgres service.
**Done when:** a deliberate 200 KB import fails the build.

### S-05a · Test harness
**Depends:** S-05
**Build:** Testcontainers Postgres fixture, migrate-and-seed once per suite, transaction-rollback wrapper per test, seed factories for tenants, members, sessions, invoices.
**Done when:** an integration test runs against real Postgres and leaves no state behind. `beforeAll` timeout is 60s to survive the first image pull.
**Read first:** `testing-strategy.md` §3.1.
**Never:** mock the database. Never substitute SQLite.

### S-05b · Mutation testing
**Depends:** S-05a
**Build:** Stryker with the Vitest runner. Scope to Tier 1 and 2 paths only. `--incremental`. `mutate:changed` script mutating files changed against main. Break threshold 60.
**Done when:** deliberately weakening an assertion to `toBeDefined()` makes the mutation gate fail.

### S-06 · Observability
**Depends:** S-01
**Build:** Sentry with `tenant_id` and `user_id` tags. Structured JSON logging to stdout with a request ID.
**Done when:** a thrown error appears in Sentry carrying both tags.

### S-07 · Base UI kit
**Depends:** S-02
**Build:** Copy shadcn/ui source for button, input, select, dialog, sheet, table, badge, skeleton, toast. Restyle to the tokens. Empty-state and skeleton primitives.
**Done when:** a kitchen-sink page renders all of them on token styling only.
**Never:** install a component library.

---

# Backend-first pilot

Runs ahead of Phase 1 screens. Proves the data layer — schema, RLS, `withTenant`, auth context, domain tables, Server Actions and seed — before any UI exists. Same repo, no separate service. Each task cross-references the Phase 1/Core IDs it partially delivers; nothing here is throwaway. Every task carries a **stop level** (GREEN/AMBER/RED) defined in `.claude/skills/execute-task/SKILL.md`.

**Pilot outcome.** All eight tasks are complete. Fully delivered:
F-05, F-06, F-07 (via B4's lint rule), F-08, F-08a. Partially
delivered — real work remains inside these tasks:
F-02 (B3 shipped `tenants` and `locations` without the F-02 columns —
currency, gstin, branding, terminology, preset columns, and
`locations.address`; the F-02 reopen completed them),
F-03 (interim plain-text role — **closed** by F-03a's `role_id`
cutover),
F-09 (OTP has no delivery channel; **phone + PIN now provides the
credential door** — first login sets the PIN via a magic link, later
logins use phone + PIN; OTP still lights up unchanged when SMS lands),
F-10 (**closed for the PIN door**: per-account lockout lives in
`lib/services/pin-lockout.ts`; OTP still relies on Better Auth's
global limiter + plugin `allowedAttempts`),
F-11 (**closed** — `Ctx` carries `permissions` and `features`; the
role × surface × feature matrix is enforced),
C-01/C-03/C-16–C-19/C-22 (schema, constraints, generator and service
layer exist; core member/session/register screens now ship — what
remains is the C-47 job set beyond `sessions.generate` and the
per-task tails noted on each task).

### B1 · Foundation
**Delivers:** S-01, S-03, S-04 · **Stop level:** GREEN · **Status:** complete — `8bb6f99`
**Depends:** —
**Build:** Next.js 15 App Router, TypeScript strict, pnpm, Vitest. Docker Compose Postgres 16 with `btree_gist`. Drizzle config; forward-only plain-SQL migrations in `db/migrations` applied by `db/migrate.ts` with a `_migrations` ledger, per-file transaction and ascending-number guard. Zod env parsing that fails loudly at boot. Scripts: `db:generate`, `db:migrate`, `db:reset`, `test`, `typecheck`, `lint`.
**Done when:** a trivial migration applies on a clean database; idempotent re-run no-ops; `typecheck`, `lint`, `test`, `build` clean; dev serves a page.
**Never:** secrets in migration files. Edit an applied migration.
**Deferred:** Tailwind/tokens to S-02; CI to S-05.

### B2 · Roles and connection identity
**Delivers:** F-05 · **Stop level:** RED (identity/isolation) · **Status:** complete — `33e7726`, fixes `90be8a5`
**Depends:** B1
**Build:** `app_user` NOLOGIN holding CRUD grants on all tables plus default privileges for tables **and sequences**; `app_login` LOGIN **NOINHERIT**, member of `app_user`. Role creation lives in an idempotent `db/bootstrap-roles.ts` — not a migration — because the password comes from `APP_LOGIN_PASSWORD` env. Pool drops privileges per physical connection via the documented `onConnect` option. Migrations run only under `MIGRATION_DATABASE_URL`. Migration grants `USAGE` on schema public to `app_user` and revokes `CREATE` from `PUBLIC` (a manually recreated public schema lacks initdb ACLs). `db:reset` re-bootstraps roles automatically — default privileges are keyed by schema OID and die with the schema drop.
**Done when:** verified — `current_user=app_user`, `session_user=app_login` after connect; raw `app_login` denied everything; post-SET ROLE CRUD passes while create/alter/drop are denied; `rolinherit=false`, `rolbypassrls=false` on both roles; migrations still apply; a future table is reachable without any manual grant.
**Never:** password literals in checked-in files. `app_login` as owner or `BYPASSRLS`. Omit NOINHERIT — without it SET ROLE is a no-op.

### B3 · Core tenancy schema
**Delivers:** F-02, F-03 · **Stop level:** GREEN · **Status:** complete — `26a79fd`
**Depends:** B2
**Build:** `tenants` (slug unique, status check, timezone default Asia/Kolkata, `plan_id` bare uuid until F-01), `locations` (soft delete + partial index), `users` (global, allowlisted, phone unique, `better_auth_id`/`person_id` nullable), `tenant_memberships` (interim plain-text role check-constrained to owner|admin|coach|parent until F-04 — flagged in-migration), `membership_locations`. Join-table recipe: **denormalised `tenant_id`** + composite FKs `(membership_id, tenant_id)` / `(location_id, tenant_id)` so cross-tenant rows cannot exist; this is the precedent for every future join table. RLS enable+force+`tenant_isolation` in the same migration as each table; `tenants` policy is on `id`. UUID v7 PKs generated app-side. Allowlist constants live in `db/allowlist.ts`.
**Done when:** verified — pg_class shows rls+forced true on all four scoped tables; two tenants insert; A-context sees only A rows and explicitly naming B's id returns zero; no context fails closed; duplicate slug rejected; cross-tenant join insert rejected by composite FK.
**Never:** a join table without `tenant_id`. An index not leading with `tenant_id`. RLS in a later migration than its table.

### B4 · withTenant — the sanctioned accessor
**Delivers:** F-06, F-07 · **Stop level:** GREEN
**Depends:** B3
**Build:** `db/tenant.ts` exporting `withTenant(tenantId, fn)` — a transaction that runs `set_config('app.tenant_id', $1, true)` first; `true` scopes it to the transaction so it cannot leak across pooled connections. ESLint `no-restricted-imports` banning `@/db/client` outside `db/`. `db/CLAUDE.md` noting `users` is reached only by joining through `tenant_memberships` inside `withTenant()`.
**Done when:** an unscoped query inside `withTenant` returns only that tenant's rows; importing the raw client outside `db/` fails lint.
**Read first:** architecture §5.3, §5.4.
**Never:** read `app.tenant_id` from a cookie, header or request parameter — it comes from the validated route/session context.

### B5 · Isolation gate — BLOCKING
**Delivers:** F-08, F-08a (+ S-05a harness) · **Stop level:** RED · **Status:** complete — `8a73a52`
**Depends:** B4
**Build:** Testcontainers real Postgres 16. `tests/tier1/isolation.test.ts`: (1) unscoped query returns only current tenant's rows; (2) hostile query explicitly naming another tenant's id returns nothing; (3) `current_user` is `app_user` on a fresh connection; (4) catch-all querying pg_class for any public table where `relrowsecurity` or `relforcerowsecurity` is false, excluding the `RLS_EXEMPT_TABLES` allowlist from `db/allowlist.ts`; assert empty. Then prove the tests can fail: drop one policy → red → restore; remove force → catch-all red → restore; add a tenant_id table with no RLS → caught without a per-table test.
**Done when:** suite green AND mutations (b), (c), (d) each demonstrably turn it red. A green test proves nothing; only the mutations prove it would notice a real failure. Blocks B6 and everything after.
**Never:** mock the database. SQLite. Skip the mutation proof.

### B6 · Auth and request context
**Delivers:** F-09 (partial: no real OTP delivery channel, no email/password fallback), F-10, F-11 (partial: no permissions/features on Ctx yet) · **Stop level:** RED · **Status:** complete — `1b5bff6`
**Depends:** B5
**Build:** Better Auth self-hosted, phone + OTP (6 digits, 5-minute expiry, 5 attempts then lockout, rate limits per phone and per IP, OTPs never logged — fetch current Better Auth docs before writing; the access-control plugin docs are sparse). `Ctx` resolved once per request in middleware: userId, tenantId, membershipId, locationIds, role. Tenant slug from the route validated against the session.
**Done when:** valid session requesting another tenant's slug returns 404, not that tenant's data — tested; sixth wrong OTP locks out; no OTP in logs.
**Read first:** current Better Auth documentation.
**Never:** trust a client-supplied tenant id. Log an OTP.
**Known gap:** every better-auth call site (`app/api/auth/[...all]/route.ts`,
`lib/auth/context.ts`, `lib/actions/auth-ui.ts`) wraps its call in
`withPlatform()`, commented load-bearing. That's enforced as a hard
failure (P0001) only in dev/test — `db/client.ts`'s ALS scope guard is
disabled when `NODE_ENV=production` (RLS is the layer meant to hold in
production, not the guard). Better-auth's own tables (`ba_user`,
`ba_session`, etc.) are RLS-exempt platform tables, so there is no RLS
fallback either if a wrap were accidentally removed. This has not been
exercised under a production build — do so before relying on it. See
architecture §5.7.

### B7 · Domain schema — people, programs, sessions
**Delivers:** C-01/C-03/C-16–C-19 schema only (no screens, no job scheduling — generation runs inline via `generateSessions`), C-22 schema + upsert semantics · **Stop level:** GREEN · **Status:** complete — `69a9eed`, lint fix `0632d21`
**Depends:** B4
**Build:** `persons` — NO generated is_minor column; derived at read time using the tenant's timezone via one shared helper. `members` (person, location, member_code unique per tenant, status). `programs`, `batches` (capacity, days_of_week int[], start/end time), `enrolments` unique (tenant_id, member_id, batch_id, enrolled_on), `sessions` unique (tenant_id, batch_id, session_date), `attendance` unique (tenant_id, session_id, member_id) with `client_id text not null` and upsert semantics. Sessions materialised, not computed: generation job runs 4 weeks ahead in the tenant's timezone — a 07:00 batch lands at 07:00 IST regardless of server timezone; tested explicitly.
**Done when:** migrations apply; uniqueness constraints reject duplicates; timezone test passes across a UTC-offset server clock.
**Never:** store a derived `is_minor`. Compute sessions on read.

### B8 · Server Actions and seed
**Delivers:** first vertical slice through C-03, C-18, C-19, C-22 (service layer + actions; UI still absent) · **Stop level:** GREEN · **Status:** complete — `9985c23`, scoping fix `faad9f8`
**Depends:** B7
**Build:** Actions for create member, enrol, generate sessions, mark attendance. Every action opens with (1) Zod parse, (2) permission check. Attendance upserts on (session_id, member_id) by client_id — replaying the same client_id twice produces one row; tested. Seed script: one tenant, one location, two batches, twelve members, four weeks of sessions. Synthetic names only — real academy data arrives later, with consent.
**Done when:** `pnpm seed`, then a scripted run marks a full register, replays it, and the row count is unchanged.
**Never:** skip the parse/permission preamble in an action. Seed with real personal data.

---

# Phase 1 — Foundation

**5–6 weeks.** Nothing a customer notices. Everything depends on it.

## Platform and tenancy

### F-01 · Platform schema
**Depends:** S-04
**Build:** `plans`, `features`, `plan_features`, `presets`, `permissions`. Platform-level, no RLS.
**Done when:** migration applies; seed inserts the feature catalogue and exactly one plan — `standard`, `is_default = true`, `price_paise = NULL` — holding every Phase-1 feature with empty limits; a test tenant resolves its effective feature set through plan baseline alone; and applying the eventual pricing decision (scope §2.5) requires only seed/data changes — verified by inserting a second plan and flipping `tenants.plan_id` with zero schema edits.
**Never:** encode pricing-model assumptions (tiers, slabs, per-feature prices) in schema or code while scope §2.5 is undecided.

### F-02 · Tenants and locations
**Depends:** F-01
**Build:** `tenants` (slug, status, timezone, gstin, branding jsonb, terminology jsonb, preset columns) and `locations`.
**Done when:** two tenants and three locations insert cleanly; slug uniqueness enforced.

### F-03 · Users and memberships
**Depends:** F-02
**Build:** `users` (global identity), `tenant_memberships` (user↔tenant, role, location scope). A user may belong to several tenants.
**Done when:** one user holds memberships in two tenants with different roles.

### F-04 · Roles and permissions
**Depends:** F-03
**Build:** `roles` per tenant, `permissions` as a platform-level closed list, `role_permissions`. Seed role templates: owner, admin, receptionist, coach, accountant, worker. `roles.home_path` and `roles.home_ordinal` (migration `0012_roles_home_routing.sql`) carry the landing route and default-membership tie-break priority as data — added after independent review found `db/platform.ts` branching on `roles.key` string literals (`ROLE_HOME`, `order by case r.key when 'owner'...`) to pick a home path, in direct violation of the Never below; nothing in the schema stops a future `UPDATE roles set key = ...`, so that was one rename away from silently misrouting to `/parent`. `resolveHomePath`/`resolveDefaultMembership` now order by `roles.home_ordinal` and return `roles.home_path`.
**Done when:** role templates seed per tenant and are editable; a role renamed or re-keyed after seeding still resolves the correct home path (`tests/tier1/user-scope.test.ts`).
**Never:** hard-code behaviour to a role name anywhere in the codebase.

### F-03a · Membership role_id cutover
**Depends:** F-04
**Build:** replace `tenant_memberships.role` (plain text) with
`role_id uuid not null` referencing the per-tenant `roles` table, cutting over every
consumer.
**Done when:** no column, query or type carries a plain-text membership role; a membership
cannot reference another tenant's role; `requireDefaultCtx` honours the membership's real
location scope.
**Never:** leave a code path that resolves authorization from a role name string.

## Isolation — the blocking gate

### F-05 · Database roles
**Depends:** F-02
**Build:** `app_user` role — NOLOGIN, not the table owner, without `BYPASSRLS` — holding only CRUD grants, reached through `app_login` (LOGIN, **NOINHERIT**, member of `app_user`) with `SET ROLE app_user` on every fresh physical connection. A separate privileged role for migrations.
**Done when:** `app_user` cannot alter tables; `current_user` reads `app_user` after connect; migrations still run under the privileged role.

### F-06 · RLS policies and withTenant
**Depends:** F-05
**Build:** `enable` and **`force`** row level security plus a tenant isolation policy on every tenant-scoped table. `db/tenant.ts` exporting `withTenant()` using transaction-scoped `set_config`.
**Done when:** a query inside `withTenant` with no `WHERE tenant_id` returns only that tenant's rows.
**Read first:** architecture §5.3, §5.4.

### F-06a · Pre-tenant resolution — user-scoped RLS
**Depends:** F-06 · **Status:** complete — fixes a design error surfaced by
independent review, not an implementation slip. F-07 (below) originally
pre-authorized "the platform module" as a lint exception without examining
what that module would connect as; it connected as `aqua`, a real Postgres
superuser (`rolsuper=t`, `rolbypassrls=t`), on the authenticated request
path (`db/platform.ts`, before this fix) — bypassing RLS unconditionally,
regardless of `FORCE ROW LEVEL SECURITY`. There is no exception for
"platform module" anymore. `MIGRATION_DATABASE_URL` is migrations-only,
full stop, exactly as this document already claimed at F-05's build note
before the exception undermined it.
**Build:** `withUser(userId, fn)` in `db/tenant.ts`, symmetric to
`withTenant()` — opens a transaction, sets `app.user_id` (transaction-
scoped), and is the only sanctioned way to resolve which tenant a request
belongs to before that tenant is known. A second, `for select`-only,
permissive RLS policy (migration `0011_user_scoped_resolution.sql`) on
`tenant_memberships`, `tenants`, and `roles`, keyed on
`nullif(current_setting('app.user_id', true), '')::uuid`. Permissive
policies OR together, so this only ever widens visibility for a session
that called `withUser()`; ordinary `withTenant()` sessions never set
`app.user_id` and are unaffected. `enterScope()` in `db/scope.ts` makes
`withTenant()` and `withUser()` mutually exclusive — entering one while
inside the other throws, so the two session variables can never coexist
on one transaction. `withPlatform()` nests freely with either, since it
sets no session variable at all.
**Done when:** every `db/platform.ts` resolution function runs through
`withUser()`/`withTenant()`/`withPlatform()` on the guarded pool — zero
raw `pg.Pool` construction, zero `MIGRATION_DATABASE_URL` reference,
anywhere in `db/platform.ts` or `lib/actions/auth-ui.ts`; a query with no
`WHERE` clause at all, run inside `withUser()`, still returns only that
user's own rows (`tests/tier1/user-scope.test.ts`); a write attempt inside
`withUser()` is rejected with Postgres `42501`, not silently permitted; a
read inside `withTenant()` never sees a row only the user-scoped policy
would expose; dropping the `user_resolution` policy turns both
`user-scope.test.ts` and `auth-context.test.ts`'s slug-resolution test
red; `tests/tier1/no-superuser-on-request-path.test.ts` asserts
`MIGRATION_DATABASE_URL` appears only in migration/bootstrap/reset/seed
tooling and test fixtures, never in `app/`, `components/`, or `db/platform.ts`/`db/client.ts`.
**Never:** widen the `user_resolution` policy from `for select` to `for
all` — its `WITH CHECK` could only constrain `user_id`, not `tenant_id`,
which would let a user self-insert a `tenant_memberships` row into any
tenant. See the migration's comment before touching this.
**Read first:** architecture §5.7 (pre-tenant resolution).

### F-07 · Lint rule
**Depends:** F-06
**Build:** ESLint `import/no-restricted-paths` (resolved module identity,
not import text — `no-restricted-imports`'s literal-string matching missed
`../../db/client`, a relative import resolving to the same file as
`@/db/client`) banning `db/client.ts` from `app/`, `components/`, and
`lib/`. No "platform module" exception: the one remaining legitimate need
outside `db/` — wiring better-auth's drizzle adapter at construction time
— goes through the single named re-export `db/auth-db.ts`, not a direct
import of `db/client.ts` from arbitrary application code.
**Done when:** importing the raw client in a route file fails lint by
either import form; `docs/review-checklist.md` §5 verifies by running
`pnpm exec eslint .`, not by grepping import text.

### F-08 · Isolation test — CI gate
**Depends:** F-06, F-07
**Build:** `tests/isolation.test.ts` per architecture §5.6, including the hostile query that explicitly targets another tenant's id, and an assertion that `current_user = 'app_user'` on a fresh connection.
**Done when:** the test passes and is wired into CI. **Temporarily disabling RLS makes it fail.**

### F-08a · RLS catch-all assertion
**Depends:** F-08
**Build:** A test querying `pg_class` for any public table where `relrowsecurity` or `relforcerowsecurity` is false, excluding the platform-table allowlist: `plans`, `features`, `plan_features`, `presets`, `permissions`, `users`, `webhook_events`. (`audit_log` is deliberately **not** allowlisted — it carries its own strict policy; see architecture §8.10.)
**Done when:** adding a tenant-scoped table without RLS fails CI **without anyone writing a test for that table.**

> **Do not begin F-09 until F-08 and F-08a pass.** Every subsequent task depends on isolation being real rather than intended.

## Identity

### F-09 · Auth with phone OTP
**Depends:** F-08
**Build:** Better Auth self-hosted. Phone plus 6-digit OTP, 5-minute expiry. Email/password fallback for desktop staff. 30-day sliding session cookie.
**Done when:** a staff member logs in by phone and the session persists across restarts.
**Never:** a per-MAU auth vendor.

### F-10 · OTP hardening
**Depends:** F-09
**Build:** Per-phone and per-IP rate limiting, five attempts then lockout, constant-time comparison, OTPs never logged.
**Done when:** a sixth wrong attempt locks out; no OTP appears in any log.

### F-11 · Request context
**Depends:** F-09, F-04
**Build:** Middleware resolving `Ctx` once per request — userId, tenantId, membershipId, locationIds, permissions, features. Tenant slug from the route, validated against the session.
**Done when:** requesting another tenant's slug with a valid session returns 404, not that tenant's data.

### F-12 · Permission enforcement
**Depends:** F-11
**Build:** `requirePermission(ctx, 'x.y')` checking permission, then location scope, then feature entitlement. A `<Can>` component for conditional UI.
**Done when:** a coach calling an admin endpoint gets 403; the control is also absent from their UI.

## Configuration

### F-13 · Feature entitlements
**Depends:** F-01, F-11
**Build:** Resolution of `plan_features` overridden by `tenant_features`, cached into `Ctx`. Expiry support for trials and betas.
**Done when:** toggling a tenant override changes both API behaviour and rendered navigation.

### F-14 · Audit log
**Depends:** F-06
**Build:** Partitioned-by-month `audit_log`. `writeAudit()` helper that participates in the caller's transaction. Insert-only grants.
**Done when:** a mutation and its audit row commit or roll back together; `app_user` cannot update or delete audit rows.

**Known gap:** `db/membership-activation.ts`'s `activateInvitedMemberships` (D1, fix/demo-blockers) flips a tenant membership from `invited` to `active` — a security-relevant transition, since it's what grants tenant access — and writes no audit row today. `platform_audit_log.actorId` is a FK to `platform_users.id` (platform operators); the person accepting their own invite is a tenant member, not a platform user, so writing there would violate the FK. Unaudited until this table exists; see the `TODO(F-14)` in that file.

### F-15 · Audit coverage
**Depends:** F-14
**Build:** Wrap mutation helpers so audit writing is the default rather than a per-callsite decision. Capture before and after.
**Done when:** every existing mutation produces an audit row; a test asserts coverage.

### F-16 · Soft delete
**Depends:** F-06
**Build:** `deleted_at` convention, query helpers excluding deleted rows by default, partial indexes, a restore path.
**Done when:** deleted rows disappear from lists and can be restored with audit history.

### F-17 · Branding
**Depends:** F-02, S-02
**Build:** R2 client. Wordmark and square mark upload with validation (SVG/PNG, 500 KB, 512 px minimum). Server-generated inline-SVG initials fallback.
**Done when:** a tenant with no upload still renders a correct mark everywhere.
**Read first:** architecture §7.5.

### F-18 · Terminology
**Depends:** F-11
**Build:** Closed `TERM_KEYS`, per-locale defaults, `term(ctx, key, count)` helper, `titleCase` formatter.
**Done when:** overriding `member` to swimmer/swimmers renders correctly in headings, sentences and counts, and `member_code` is untouched.
**Never:** string replacement over rendered output.

### F-19 · Accent token
**Depends:** S-02
**Build:** Frozen six-entry `ACCENTS` map, `--accent` custom properties set on the document root from resolved branding, fallback to mango on an unknown key. Lint rule preventing `--accent` inside status styles.
**Done when:** switching the accent value changes buttons but leaves paid/overdue colours identical.

### F-20 · Preset engine
**Depends:** F-13, F-17, F-18
**Build:** `applyPreset()` per architecture §7.4 — single transaction, idempotent, records key and version, refuses once a non-sample member exists.
**Done when:** applying a preset twice does not duplicate anything.
**Never:** branch application logic on `preset_key`.

### F-21 · Preset definitions
**Depends:** F-20
**Build:** Full definitions for **swimming** and **multi-sport** only. Others as documented stubs.
**Done when:** a swimming tenant provisions with levels, skills, plan shapes (prices null), pool facility and lanes.

## Shell

### F-22 · App shell and role layouts
**Depends:** F-12, F-17, F-19
**Build:** Route groups per role. Separate layouts, not conditional rendering. Bottom nav on mobile with four items and **no "More" tab**. Skeleton loading.
**Done when:** each role sees its own navigation; a worker's bundle contains no owner components.

### F-23 · Settings
**Depends:** F-22
**Build:** Tenant profile, GSTIN, locations, business hours, holiday calendar, terminology editor, branding upload.
**Done when:** an owner changes vocabulary in settings and the app updates.

### F-24 · Staff invitations
**Depends:** F-22
**Build:** Invite by phone, assign role and locations, accept flow, revoke, resend.
**Done when:** an invited coach logs in and sees only the coach surface.

### F-25 · Provisioning CLI
**Depends:** F-21
**Build:** A script creating a tenant, applying a preset, inviting an owner. This is how tenants are created until Phase 4.
**Done when:** one command produces a working tenant.

### F-26 · Phase 1 gate
**Depends:** F-01 … F-25
**Verify:** two tenants coexist; isolation test green; feature toggle changes the UI; audit covers all mutations; bundle under budget; a fresh clone provisions a tenant in under ten minutes.

---

# Phase 2 — Operating core

**8–10 weeks.** The part the customer pays for.

## People

### C-01 · Persons
**Depends:** F-26
**Build:** `persons` with phone and name indexes excluding deleted rows. Minor status derived at read from `date_of_birth` using the tenant's timezone (architecture §8.3) — never stored.
**Done when:** a person whose eighteenth birthday passes today reads as an adult immediately, without any batch process.

### C-02 · Guardianships
**Depends:** C-01
**Build:** `guardianships` linking minors to guardians, one guardian to many children, primary flag.
**Done when:** a guardian with three children resolves all three.

### C-03 · Members
**Depends:** C-01
**Build:** `members`, per-tenant `member_code` generation, status lifecycle (trial, active, paused, lapsed, left).
**Done when:** codes are unique per tenant and never reused.

### C-04 · Staff records
**Depends:** C-01, C-03
**Build:** `staff` typed as coach, receptionist, worker, accountant, linked to a person and optionally to a login via `staff.user_id`.
**Done when:** one person can be both a coach and a member.

### C-05 · Consent — DPDP
**Depends:** C-02, C-03
**Build:** Append-only `consents` with purpose, policy version, granting party, timestamp and evidence. Registration blocks on missing guardian consent for a minor.
**Done when:** a minor cannot be activated without recorded guardian consent; withdrawal is recorded, not deleted.
**Read first:** scope §7.1.

### C-05a · Per-tenant DPA
**Depends:** F-25, C-05
**Build:** Standard data processing agreement template; signature/version captured at provisioning and stored on the tenant; surfaced during onboarding.
**Done when:** every live tenant has a signed DPA version recorded.
**Read first:** scope §7.1.

### C-06 · People screens
**Depends:** C-02, C-03, C-04, C-05
**Build:** List with search and filters, detail view, create and edit. Mobile-first.
**Done when:** a receptionist adds a member with a guardian in under ninety seconds.

### C-07 · Documents
**Depends:** C-06
**Build:** R2 upload for ID, photo, medical certificate. Private bucket, short-lived signed URLs, role-gated.
**Done when:** no unauthenticated URL resolves to a child's photograph.

### C-08 · Member lifecycle
**Depends:** C-03
**Build:** Status transitions with reasons, audit trail, pause and resume.
**Done when:** each transition is audited and reversible.

## Import

### C-09 · Importer upload and mapping
**Depends:** C-06
**Build:** CSV/XLSX upload, header detection, column mapping UI with saved presets. Mapping includes a per-entity external reference column — required, or explicitly absent.
**Done when:** a messy real spreadsheet from D-05 maps successfully.

### C-10 · Importer validation and dry run
**Depends:** C-09
**Build:** Row validation, a preview showing exactly what will be created, a downloadable per-row error file.
**Done when:** a file with ten bad rows previews 90 creates and 10 errors, creating nothing.

### C-11 · Importer commit and undo
**Depends:** C-10
**Build:** Single-transaction commit, import batch record, 24-hour undo.
**Done when:** importing 500 members then undoing leaves zero residue. Re-importing the same file with identical external references updates rather than duplicates — zero new rows, zero orphans.

## Enquiries

### C-12 · Enquiries
**Depends:** C-06
**Build:** `enquiries` with source, stage, assigned owner, contact details.
**Done when:** a walk-in is captured in under thirty seconds.

### C-13 · Pipeline and follow-ups
**Depends:** C-12
**Build:** Stage transitions, follow-up tasks with due dates, an overdue view.
**Done when:** overdue follow-ups surface on the owner dashboard.

### C-14 · Trials
**Depends:** C-13, C-18
**Build:** Trial session booking against a real batch, outcome recording.
**Done when:** a trial appears on the coach's register flagged as a trial.

### C-15 · Conversion
**Depends:** C-14, C-03
**Build:** Convert an enquiry to a member, preserving source attribution.
**Done when:** conversion rate by source is reportable.

## Programs and scheduling

### C-16 · Programs
**Depends:** F-26
**Build:** `programs` with activity type, per location.
**Done when:** CRUD works and the swimming preset's seeded program appears.

### C-17 · Batches
**Depends:** C-16
**Build:** `batches` with capacity, days, times, coach, facility, start and end dates.
**Done when:** capacity is enforced at enrolment.

> **Open plan gap, not resolved here:** "coach" needs C-04 (Staff, not in Depends) and "facility" needs a facilities module that doesn't exist anywhere in Phase 2 — facilities are scoped to Phase 3 (project-scope.md §5.7). `batches.coach_id` exists as a bare user id as of the coach-assignment-scoping fix (see C-20's note), independent of whether C-04 lands first. `facility` has no such interim answer yet — decide whether Phase 2 batches reference a stub facility, a free-text venue field, or nothing until Phase 3, before building the rest of this task.

### C-18 · Enrolments
**Depends:** C-17, C-03
**Build:** `enrolments` linking members to batches with dates, capacity check.
**Done when:** enrolling beyond capacity is refused with a clear message.

### C-19 · Session generation
**Depends:** C-17
**Build:** pg-boss job materialising sessions four weeks ahead from batch recurrence, respecting holidays and closures and **the tenant's timezone**. (The shipped horizon is `DAYS_AHEAD = 28` in `lib/jobs/session-generator.ts`; this task previously said eight weeks, in conflict with B8 and the code. If eight weeks is wanted, it is a code change plus this line, not a doc edit.)
**Done when:** a 7:00 AM batch generates sessions at 07:00 IST regardless of server timezone.

### C-20 · Session changes and substitution
**Depends:** C-19, C-04
**Build:** Cancel with reason, reschedule, and **substitute coach — recording who actually took the session**. `batches.coach_id` and `sessions.coach_id` exist as of the coach-assignment-scoping fix (item 1/2, docs/architecture.md §9.2) — currently a bare user id, not yet a `staff` foreign key, since C-04 didn't exist when they were added. Migrate the reference once C-04 lands; don't leave two competing notions of "the coach."
**Done when:** a substituted session reports the substitute as its coach.

> **This task feeds V-31.** Payout computation reads `sessions.coach_id`. If substitution does not record the actual coach, the wrong person gets paid. Build it deliberately.

### C-21 · Coach conflicts
**Depends:** C-20
**Build:** Detect a coach double-booked across overlapping sessions; warn on assignment.
**Done when:** assigning an overlapping session warns before saving.

## Attendance

### C-22 · Attendance schema
**Depends:** C-19, C-18
**Build:** `attendance` unique on (tenant_id, session_id, member_id), `client_id` for idempotency, upsert semantics.
**Done when:** replaying the same `client_id` twice produces one row.

### C-23 · Coach register
**Depends:** C-22, F-22
**Build:** Mobile-first register per DESIGN.md — separate 44 px present and absent targets, not a swipe. Header shows marked count. Optimistic update under 100 ms.
**Done when:** sixteen students are markable one-handed in under sixty seconds.

### C-24 · Offline queue
**Depends:** C-23
**Build:** IndexedDB queue, `client_id` generated on device before the network call, ordered replay.
**Done when:** marking with the network disabled then re-enabling syncs everything exactly once.

### C-25 · Service worker
**Depends:** C-24
**Build:** Cache app shell, today's sessions, today's rosters. Background sync registration.
**Done when:** a hard refresh with no network still loads today's register.

### C-26 · Sync state UI
**Depends:** C-24
**Build:** Persistent, honest sync indicator — pending count, last synced, failure state.
**Done when:** the coach can always tell whether their marks are saved.

### C-27 · Attendance history
**Depends:** C-22, C-06
**Build:** Per-member history, per-batch summary, percentage over a period.
**Done when:** a member page shows accurate monthly attendance.

## Money

### C-28 · Money primitives
**Depends:** F-26
**Build:** Paise helpers, tax calculation in basis points, `en-IN` formatting, tabular numerals, parsing.
**Done when:** property tests confirm no precision loss across a thousand random operations.
**Never:** float or `numeric` for money.

### C-28a · Money property tests
**Depends:** C-28
**Build:** fast-check property suite for money — tax/total precision, `splitTotal` round-trip, partial payments summing to the invoice total (testing-strategy §4.2). Tier 1: human-owned, agent read-only.
**Done when:** 1,000-run properties hold with zero counterexamples and the mutation gate is green on `lib/money`.
**Read first:** testing-strategy.md §4.2.
**Never:** a float or `numeric` anywhere in the generators.

### C-29 · Membership plans
**Depends:** C-28, C-16
**Status:** complete, then reworked — the first cut was tenant-level; C-29c moves plans onto facility + activity and drops the per-plan tax rate (2026-09-14 decisions: facility = location, activity = the schema's facilities row, GST is config per activity).
**Build:** `membership_plans` — duration, session pack, one-time. Amount required and non-null on activation.
**Done when:** a preset-seeded plan cannot activate until a price is entered.

### C-29a · Activity catalog
**Depends:** O-01
**Lane:** schema + services + UI
**Status:** complete (PR #162) — kind set gains `table`; facilities and facility_sub_units gain soft delete and live-name uniqueness; owners/admins CRUD at /owner/settings/activities; ops reuses the same service.
**Build:** Activities are the schema's `facilities` (pool, court, table, café counter) under a location. Catalog only — bookings are V-01.

### C-29b · GST rate configuration (activity scope)
**Depends:** C-28, O-04
**Lane:** schema + services + UI
**Status:** complete — key `billing.gst_rate_bp` (ops_only, default 1800); resolver order extended with activity: platform → tenant → facility → activity; ops sets it per level at /ops/tenants/[id]/tax.
**Build:** Invoices apply and snapshot the resolved rate; plan prices stay GST-exclusive.
**Done when:** a café activity can carry 5% while the pool beside it carries 18%.

### C-29c · Plans per facility and activity
**Depends:** C-29, C-29a, C-29b
**Lane:** schema + services + UI
**Status:** complete — `location_id NOT NULL` + optional `activity_id` (null = all-access); `tax_rate_bp` dropped; uniqueness per (tenant, facility, activity, template); subscriptions copy facility/activity from the plan at creation and O-08 scoping follows them.
**Build:** `membership_plans` gains `location_id NOT NULL` and optional `activity_id` (null = all-access/combo); `tax_rate_bp` is dropped (one GST source of truth); the per-template live uniqueness moves to (tenant, location, activity, template); owner UI groups by facility with an activity picker.
**Done when:** the same preset template is priced independently at each facility and for all-access vs a single activity.

### C-30 · Subscriptions
**Depends:** C-29, C-03
**Status:** complete — first cut; facilities/activities arrive through the plan once C-29c lands.
**Status:** complete — start/end (inclusive end date), pause/resume extends by the elapsed paused days, cancel; subscription state is independent of the member lifecycle.
**Build:** `subscriptions` with start, end, pause, resume, cancel. Pause extends the end date.
**Done when:** a seven-day pause moves the end date by exactly seven days.

### C-31 · Invoice numbering
**Depends:** C-28
**Status:** complete — gapless per tenant per financial year. Decision 2026-09-14: one tenant = one GSTIN for now, so per tenant *is* per GSTIN. The counter key `(tenant_id, financial_year)` is the extension point if a second GSTIN is ever needed (never renumber issued invoices).
**Build:** Gapless per financial year per tenant using a counter row with `select … for update` inside the invoice transaction.
**Done when:** a concurrency test of fifty parallel invoices produces fifty sequential numbers with no gaps or duplicates.
**Never:** a Postgres sequence — rollbacks leave gaps and GST requires none.

### C-32 · Invoices
**Depends:** C-31, C-30
**Status:** complete — `invoices` + `invoice_line_items`: GSTIN snapshot (null ⇒ Bill of Supply, no tax — an unregistered supplier cannot collect GST), SAC code from `billing.sac_code` (default 999723) and the resolved GST rate snapshotted per line, subtotal + tax = total in integer paise, gapless number from C-31. CGST/SGST split derived at render time (intra-state; IGST not modelled — needs a place-of-supply decision). Owner/reception raise from an active subscription; `invoice.void` before any payment arrives.
**Build:** `invoices` with line items, GSTIN, HSN/SAC, subtotal, tax, total, due date, status.
**Done when:** a generated invoice is arithmetically correct and GST-valid.

### C-33 · Cash and manual payments
**Depends:** C-32
**Status:** complete — `payments` recorded at the counter: cash, UPI reference, bank transfer, `received_by`, location inherited from the invoice. The invoice row is locked `for update` so concurrent desks cannot win the same outstanding balance; an overpayment is refused. Two partials settle to `paid`.
**Build:** `payments` recorded at the counter — cash, UPI reference, bank transfer — with `received_by`. Partial payments update invoice balance.
**Done when:** two partial cash payments settle an invoice and mark it paid.

### C-34 · Daily reconciliation
**Depends:** C-33
**Build:** Daily collection report by method and by staff member, with a cash count confirmation step.
**Status:** complete — `/owner/reports/collections`: tenant-local day (Asia/Kolkata by tenant), totals by method and by the staff member who received them (users reachable only through `tenant_memberships`), and `cash_counts` snapshots the system cash figure beside the counted amount. A variance is surfaced, never adjusted; a recount replaces the row with an audit trail. Confirming needs `payments.record`, reading `reports.financial`.
**Done when:** the report matches a manual count for a full day at the reference business.

### C-35 · Payment QRs
**Depends:** C-28
**Lane:** schema + services + UI
**Build:** `payment_qrs` — owner-managed, several per tenant, each with a
nickname. Two kinds: a UPI QR generated from the owner's UPI ID + payee
name, and an uploaded image QR (PNG/JPEG/WebP, strict size cap; stored in
Postgres because no object store exists yet). Active flag and display
order. Tenant RLS, audit on every mutation, owner/admin write only.
**Done when:** an owner adds one UPI QR and one uploaded-image QR, both
listed with nicknames and usable; a wrong MIME type or an oversize file is
refused; a receptionist can read them and cannot write them.

### C-36 · Collect-payment screen
**Depends:** C-35
**Lane:** UI
**Build:** Read-only `/reception/collect-payment`, linked from reception
Today: choose a QR by nickname, optionally enter an amount, render the QR
large for the payer to scan. Generated UPI QRs carry the amount in the
`upi://pay` payload; uploaded images do not. The screen cannot create,
edit or delete.
**Done when:** a receptionist shows a ₹2,500 QR in two taps and has no
path to changing the QR itself.

### C-37 · QR reuse
**Depends:** C-35, C-40a
**Build:** One service produces the `upi://pay` URI (and QR SVG) for a
tenant QR with an optional amount, so the collect screen, the message
composer and future receipts share one implementation. Amount formatting
is bigint paise throughout.
**Done when:** the same QR payload appears on screen and in a mock
WhatsApp message byte-for-byte, for the same amount.

### Payment gateway decision — 2026-09-14

The Razorpay adapter, payment links, webhook endpoint and webhook worker
(C-35…C-38 as originally planned) are **removed from scope**. Owners
collect over their own UPI QR codes and payments are recorded at the
counter (C-33); no card data touches our systems and there is no PSP
integration. The zero-commission positioning (project-scope §7.3) is
unaffected — that section's Razorpay wording is flagged for rewrite
pending owner approval. A hosted flow, if ever wanted, returns as a new
task rather than by reopening these.

### C-39 · Receipts
**Depends:** C-33, F-17
**Status:** complete — dependency-free PDF 1.4 writer (`lib/receipts/pdf.ts`), one A4 page carrying the tenant's initials-on-accent mark, the amount in figures and Indian-format words, and the invoice's GST references (number, document kind, GSTIN, place of supply, SAC). Generated lazily on first read and stored in `receipts` (unique per payment — a second read returns the stored bytes, never a second document). Download at `/api/receipts/[paymentId]` (invoices.read). **Sent on payment is not wired:** the only provider is the non-prod mock, which carries no attachments; it lands with the real WhatsApp adapter (O-11).
**Build:** Branded receipt PDF, sent on payment, stored against the payment record.
**Done when:** the receipt carries the tenant's mark, not ours.

## Messaging

### C-40 · Provider interface
**Depends:** F-26
**Build:** `MessageProvider` interface; one real adapter (WhatsApp Cloud
API) once a tenant-owned WABA exists. Nothing above the interface knows
the provider. The non-prod mock and the metered log ship in C-40a, which
is what makes this interface testable before Meta onboarding.
**Done when:** swapping provider requires no changes outside the adapter.

### C-40a · Provider abstraction, metered log and non-prod mock
**Depends:** F-26, O-04
**Lane:** schema + services + UI
**Build:** `message_log` written by every send and receive (direction,
provider, template key, body, status, cost in paise per message). Provider
selected from `WHATSAPP_PROVIDER` — `mock` in dev/test, and **production
fails closed** unless a real provider is configured; no silent mocking in
production. Mock send plus simulated inbound through the same handler the
real webhook will call, so inbound flows are testable now. Non-production
`/ops/whatsapp` screen: list conversations, compose an outbound mock
message, inject an inbound payload.
**Done when:** a mock send and a mock receive both appear in the log with
a cost recorded (mock cost may be zero, but the column and code path are
real), the screen shows them, and a production boot with the mock selected
is refused.
**Never:** in production, a mock that pretends to deliver.

### C-41 · Template registry
**Depends:** C-40
**Build:** Template definitions with category, variables and approval status. **Every automated template is `utility`.**
**Done when:** registering a `marketing` template for an automated flow fails validation.

### C-42 · Message log and metering
**Depends:** C-41, C-40a
**Build:** Per-tenant monthly counters and the hourly metering job on top
of the `message_log` written by C-40a.
**Done when:** sending 100 messages produces an accurate per-tenant cost figure.

### C-43 · Notification queue
**Depends:** C-42
**Build:** pg-boss consumer with retry, backoff and delivery status callbacks.
**Done when:** a provider outage retries rather than losing messages.

### C-43a · Email fallback channel
**Depends:** C-42
**Build:** Second `MessageProvider` adapter over AWS SES (Mumbai region); fallback routing when WhatsApp is undeliverable or no phone exists; same metering and message log.
**Done when:** a message that fails WhatsApp delivery arrives by email and appears once in the log with correct cost.

### C-44 · Magic links
**Depends:** F-26
**Build:** Signed, single-purpose, scoped, 7-day tokens with a rotating secret and revocation.
**Done when:** a fee link cannot read progress data; an expired token fails cleanly.

### C-45 · Parent pages
**Depends:** C-44, F-17, C-32
**Build:** Server-rendered, **zero client JavaScript**, tenant-branded. Fees, schedule, attendance, progress.
**Done when:** the page works with JavaScript disabled and ships no analytics.
**Never:** tracking of any kind on this surface.

> **Open plan gap, partially resolved:** the "fees" element needs C-32 (Invoices) to exist — added above, was missing entirely. This is also S5 (RED — propose before building, S-series). The proposal should state whether "fees" ships in the first version or is added once C-32 lands, rather than assuming both are ready at once.

## Dashboard and jobs

### C-46 · Owner dashboard
**Depends:** C-33, C-27, C-13, C-17, C-19
**Build:** Per the UI direction — overdue amount with a WhatsApp action, three supporting figures, a needs-attention list where every item carries its reason, today's batches as capacity lanes.
**Done when:** it loads in under 2.5 s on a mid-tier Android over 4G.

### C-47 · Scheduled jobs
**Depends:** C-30, C-32
**Status:** complete — the three billing queues ship with per-tenant schedules (02:15 / 02:30 / 03:00 tenant time) registered at tenant creation and reconciled by `db/deploy.ts`. `subscriptions.expire` marks lapsed actives; `invoices.generate` raises one renewal invoice for an `auto_renew` subscription inside the 7-day window, due the day the period ends, made idempotent by `invoices_subscription_due_live_uidx`; `reports.rollup` upserts `daily_rollups` for the day that just ended. Job mutations carry no tenant audit row — `audit_log.actor_id` is NOT NULL and jobs have no user actor (the standing F-15 gap; same as `sessions.generate`).
**Build:** `subscriptions.expire`, `invoices.generate`, `reports.rollup`. Idempotent, tenant-scoped, chunked.
**Done when:** re-running a night's jobs changes nothing.

### C-48 · Phase 2 gate
**Depends:** C-01 … C-47
**Amended (2026-09-18):** folded into the Release 1 gate (R1-01). The reference month now also covers the café module and the H/E hardening; the original verification below still applies in full.
**Verify:** the reference business completes one full month — enquiries through collected fees — without the register. Offline attendance survives a real poolside session. No duplicate receipts.

---

# Phase 3 — Vertical, staff pay, go-live

**7–8 weeks.**

## Facilities and bookings

### V-01 · Facilities
**Depends:** C-48
**Build:** `facilities` with kind, capacity, and sub-units as lanes or courts.
**Done when:** the swimming preset's pool with four lanes exists.

### V-02 · Overlap prevention
**Depends:** V-01
**Build:** `btree_gist` exclusion constraint on facility, sub-unit and time range for held and confirmed bookings.
**Done when:** fifty concurrent identical booking attempts produce exactly one success.
**Never:** check-then-insert in application code.
**Status:** complete — `20260918140000_v02_bookings.sql` creates `bookings`
with `EXCLUDE USING gist (tenant_id =, facility_id =, coalesce(sub_unit_id, 0-uuid) =,
tstzrange(starts_at, ends_at, '[)') &&) WHERE status in ('held','confirmed')`.
The fifty-concurrent test fails when the constraint is dropped (50 successes)
and passes with it (exactly one) — the database is the guarantee. Adjacent
slots (`end == next start`) both succeed; cancel frees the slot.

### V-03 · Slots and pricing
**Depends:** V-02
**Build:** Slot templates, peak and off-peak pricing, advance-booking window.
**Done when:** peak pricing applies correctly by time of day.
**Status:** complete — `20260918141000_v03_booking_pricing.sql` adds
`booking_price_rules` (days-of-week, time window, priority) plus the
`bookings.advance_window_days` config key (default 30). The resolver picks the
most specific active rule (priority, then narrowest window) and the booking
snapshots its `price_paise`. No price-rule CRUD UI in this pass — rules are
seeded/edited via SQL or a future settings screen.

### V-04 · Staff booking
**Depends:** V-03
**Build:** Front-desk booking for a member or a named walk-in, with payment.
**Done when:** a walk-in is booked and paid in under a minute.
**Status:** complete, scoped — `/reception/bookings` (entry from reception
Today) books a facility/sub-unit slot with the V-03 price. A **member**
booking bills through the existing invoice spine (`source='other'`,
`invoice-issue` gained an optional trusted per-line `taxPaise` snapshot so an
inclusive booking price bills to the paisa) and settles at the counter. A
**walk-in** booking records the name but is not payable in R1 — the same
member-attachment rule as café (flagged decision, not a code gap). Cancel is
audited.

### V-05 · Public booking page
**Depends:** V-04, C-35
**Build:** Slug-routed public page, minimal JavaScript, availability, payment, confirmation over WhatsApp.
**Done when:** an unauthenticated visitor books and pays end to end.

### V-06 · Cancellation policy
**Depends:** V-05
**Build:** Configurable cancellation window, refund or credit rules, no-show marking.
**Done when:** cancelling inside the window follows the configured rule.

### V-07 · Closures
**Depends:** V-01, C-19
**Build:** Maintenance windows and closures blocking bookings and cancelling affected sessions with notification.
**Done when:** a closure cancels sessions and notifies affected parents once.

### V-08 · Utilisation
**Depends:** V-05
**Build:** Facility utilisation by hour, day and week.
**Done when:** the report identifies the emptiest recurring slot.
**Status:** complete — `lib/services/utilisation.ts` computes utilisation by
hour/day/week per facility over `confirmed`+`completed` bookings and names the
emptiest recurring (day-of-week, hour) bucket from the last four weeks; a card
renders it on `/owner/reports`. Business hours unset ⇒ an honest `null`, not a
fabricated percentage.

## Swimming

### V-09 · Skill ladder
**Depends:** C-48
**Build:** `skill_levels`, `skills`, rubric JSON.
**Done when:** the preset's swimming ladder is present and editable.
**Status:** complete — `20260918142000_v10_framework_bridge.sql` idempotently
seeds `skill_frameworks`/`skill_nodes` from every existing
`skill_levels`/`skills` ladder (stable name-independent ids; `applyPreset`
runs the same bridge in-transaction so future tenants get ladders too), and
`/owner/settings/skills` edits level/node names and rubric with audit. The
preset tables stay intact and read-only to the bridge.

### V-10 · Assessments
**Depends:** V-09
**Build:** `assessments` with band 1–4, assessor and timestamp. Coach entry from the session view.
**Done when:** a coach assesses three swimmers from the register in under a minute.
**Status:** complete — the register row links to a per-member assessment board
(one tap per node band 1–4); bands enforced at the service, every assessment
audits, `levels.assess` required. Manual pass: three swimmers assessed in
three taps.

### V-11 · Progress view
**Depends:** V-10
**Build:** Progress pips per DESIGN.md, history over time, visible on the parent page.
**Done when:** a parent sees the progress trend without an account.
**Status:** complete except the parent half — progress pips (band → pip state,
`water`/`deck` tokens) with history render on the coach member page and the
owner member 360 **Progress tab** (the U-03 tab landed here). The **parent
surface is deliberately untouched** (owner decision 2026-09-18: parent stays
the zero-JS token link); `git diff` confirms zero files under `app/p/**`.

### V-12 · Lane allocation
**Depends:** V-01, C-18
**Build:** Assign members to lanes within a batch; the register groups by lane.
**Done when:** a coach's register is ordered by lane.

### V-13 · Facility logs
**Depends:** V-01
**Build:** `facility_logs` for chemistry, maintenance and incidents. Overdue chemistry surfaces on the owner dashboard.
**Done when:** a missed chlorine check appears in needs-attention within 24 hours.

## Collections

### V-14 · Dunning ladder
**Depends:** C-43, C-32
**Build:** Automated reminders at 3, 7, 14 and 30 days overdue. Configurable intervals. Stops on payment.
**Done when:** paying mid-ladder cancels remaining reminders immediately.
**Guard:** consults the recipient's communications-consent state before sending and records which category each message falls into (scope §7.1). Fee reminders are essential and survive a communications withdrawal — the check and citation happen anyway.

### V-15 · Mandate registration
**Depends:** C-35, C-30
**Build:** UPI e-mandate registration at subscription creation, mandate id stored.
**Done when:** a mandate registers in test mode and persists.

### V-15a · Pre-debit notification
**Depends:** V-15, C-43
**Build:** `mandate_notices` table, `mandates.prenotify` daily job, branded notice carrying the amount plus the child's monthly attendance and next session, opt-out link cancelling that cycle only.
**Done when:** every scheduled debit has a recorded `notified_at` before execution, and opting out cancels one debit without cancelling the membership.
**Read first:** architecture §10.4. **Verify the notification window against Razorpay's current docs — sources disagree between 24 and 72 hours.**
**Never:** execute a debit without a recorded notice. Enforce it as a guard in the job, not a convention.
**Guard:** pre-debit notices are RBI-mandated and essential — they send despite a communications withdrawal — but the send must check suppression state and cite its category in `message_log` like any other message.

### V-16 · Auto-debit
**Depends:** V-15a, C-38
**Build:** Scheduled debit ahead of renewal, skipping opted-out and un-notified rows. Failure falls back into the dunning ladder.
**Done when:** a failed debit does not lapse the membership silently, and an un-notified debit refuses to run.

### V-17 · Refunds and credit notes
**Depends:** C-38
**Build:** Refund against a payment, credit note linked to the original invoice, correct GST treatment.
**Done when:** a refunded invoice reports correctly in the month's figures.

## Operations

### V-18 · Makeup sessions
**Depends:** C-22
**Build:** Compensatory session entitlement from excused absences, redemption against another batch.
**Done when:** an excused absence grants exactly one makeup credit.

### V-19 · Batch transfer
**Depends:** C-18
**Build:** Move a member between batches preserving history and subscription.
**Done when:** attendance history survives the transfer intact.

### V-20 · Absence alerts
**Depends:** C-27, C-43
**Build:** Daily job detecting absence streaks and low monthly attendance; notifies coach and guardian.
**Done when:** three consecutive absences trigger exactly one alert, not three.

### V-21 · QR check-in
**Depends:** C-22
**Build:** Per-member QR, scanner view, marks attendance for the current session.
**Done when:** a scan marks the correct session and rejects an out-of-window scan.

### V-22 · Self-registration
**Depends:** C-05, V-05
**Build:** Public registration page with consent capture, creating an enquiry rather than a member.
**Done when:** a minor registration cannot complete without guardian details and consent.

### V-50 · Worker tasks and maintenance log
**Depends:** C-04, F-22, V-13
**Build:** `tasks` (tenant_id, location_id, title, detail, assigned staff, due_at, status open|done|cancelled, source manual|rule|inventory) and `maintenance_schedules` (facility, interval_days, last_done_at). Cadence is "N days since last_done_at" — not fixed calendar recurrence — because that is how pool maintenance actually works and it degrades gracefully when a check is missed. Worker daily view shows only their day; overdue chemistry checks (V-13) auto-create tasks.
**Done when:** a worker sees and completes today's tasks phone-only, and a missed chlorine check becomes someone's task within 24 hours.

## Staff attendance and pay

### V-23 · Shifts
**Depends:** C-04
**Build:** `shift_templates` and `shifts`, weekly roster builder, publication to staff.
**Done when:** a published roster is visible to each staff member.
**Status:** complete, scoped — `shift_templates` + `shifts` (migration
`20260919222556_v23_shifts`), owner builder at `/owner/staff/roster`
(add/delete a shift, templates, publish week), and published shifts on
the Me tab of `/coach/me` and `/reception/me` through the new
`staff.self` permission. `published_at` is the gate: drafts are
invisible to the staff member until the week is published. Workers
have no self-service surface yet (V-50 owns the worker view); owner's
staff-page delete only removes the row (audited).

### V-24 · Staff attendance
**Depends:** V-23
**Build:** `staff_attendance` with self check-in and check-out, late minutes against shift, audited manual correction.
**Done when:** a manual correction records who made it and why.
**Status:** complete — `staff_attendance` (migration
`20260919223554_v24_staff_attendance`, one row per staff per day); self
check-in/out resolves the caller's own staff row, late minutes are
measured against the day's first shift and stored; a manual correction
requires a reason and records `marked_by` plus before/after in
`audit_log`. Reception `Today` gains the staff-attendance board U-08
deferred (reason panel, quick reasons); Me tab gains today's state and
check-in/out. Self-service is `staff.self`; correcting someone else is
`staff.attendance` (reception). A caller without a staff row is
refused — the fix is the owner adding the staff record (C-04), and the
demo seed now attaches one to the receptionist login.

### V-25 · QR staff check-in
**Depends:** V-24
**Build:** Premises QR check-in, optional geofence.
**Done when:** a coach checks in by scan in under five seconds.
**Status:** complete except geofence (deferred — the task calls it
optional). `/owner/staff/check-in-qr` renders a printable QR for a
signed 180-day token; the staff member's phone camera opens
`/check-in/<token>` and one tap records a `self_qr` check-in through
the V-24 service. No new dependency. The resolver refuses a poster
minted for another tenant. Known limitation: a public static QR can be
photographed and used off-premises until the geofence or a rotating
in-app code lands.

### V-26 · Leave
**Depends:** V-23
**Build:** `leave_types` with quotas, `leave_requests` with balances.
**Done when:** balances decrement correctly and unpaid leave is distinguished.
**Status:** complete — `leave_types` + `leave_requests` (migration
`20260919224658_v26_leave`); casual/sick/unpaid seed for existing
tenants in the migration and inside tenant provisioning. Balances are
per calendar year (stated assumption): `available = quota − approved −
pending`, so pending requests cannot overdraw. Unpaid leave is
`is_paid = false` for V-30's deduction later. Request/cancel is
`staff.self`; types and the request queue are `staff.roster` at
`/owner/staff/leave`; the Me tab shows balances, request form and own
requests.

### V-27 · Leave approval
**Depends:** V-26, C-20
**Build:** Approval flow, roster update, **flagging batches left uncovered**.
**Done when:** approving leave surfaces uncovered sessions before the day arrives.
**Status:** complete — Review loads the sessions the staff member
coaches inside the leave range (substitution rewrites
`sessions.coach_id`, so a covered session drops off), then Approve/
Reject records the decision and its note. Approval moves rostered
shifts in the range to `leave` in the same transaction; rejection
leaves the roster untouched. Owners/admins without a staff row can
decide — `decided_by` stays null and `audit_log.actor_id` carries who.

### V-28 · Pay rules
**Depends:** C-04, C-28
**Build:** `pay_rules` — monthly, per session, per hour, per head — with effective dating and multiple concurrent rules per person.
**Done when:** a coach on a retainer plus per-session rate resolves both.

### V-29 · Advances
**Depends:** V-28
**Build:** `advances` with instalments and outstanding balance.
**Done when:** an advance recovers across three months and closes exactly.

### V-30 · Payout computation
**Depends:** V-28, V-29, V-24, C-20
**Build:** Monthly job producing a **draft** run and lines. Session counts read from `sessions` where the staff member is the recorded coach — substitutions included. `source_ref` stores the contributing session ids.
**Done when:** a substituted session pays the substitute, and opening the line lists the exact sessions.
**Never:** pay automatically. Draft only.

### V-31 · Payout review
**Depends:** V-30
**Build:** Review screen, manual adjustment lines, approve, lock. Locked runs are immutable; corrections go to the next period.
**Done when:** an approved run cannot be edited and an adjustment appears next month.

### V-32 · Payslips
**Depends:** V-31, F-17
**Build:** Branded payslip PDF, shareable over WhatsApp, staff see only their own.
**Done when:** a coach opening the staff area sees their payslip and no one else's.

### V-33 · Pay permissions
**Depends:** V-32, F-12
**Build:** `staff.pay.read` and `staff.pay.write` separate from `staff.attendance`. **Reads of pay data are audited.**
**Done when:** a receptionist can mark staff attendance and cannot see any rate; their attempt is logged.

### V-33a · Pay permission and audit-on-read tests
**Depends:** V-33
**Build:** Tier 1 tests — a principal without `staff.pay.read` is denied payout lines and rates; the denial writes a `staff.pay.read.denied` audit row; every successful read of pay data is audited.
**Done when:** the receptionist scenario from V-33 fails closed with an audit trail, verified against Testcontainers Postgres.
**Read first:** testing-strategy.md §4.5.

### V-34 · Payroll export
**Depends:** V-31
**Build:** Monthly gross earnings export formatted for Zoho Payroll and RazorpayX import.
**Done when:** the file imports without manual editing.
**Never:** compute PF, ESI or TDS.

## Reporting

### V-35 · Revenue reports
**Depends:** C-33
**Build:** Revenue by program, batch, month and location.
**Done when:** figures reconcile to the payments table exactly.

### V-36 · Batch profitability
**Depends:** V-35, V-30
**Build:** Batch revenue against coach cost per month.
**Done when:** a loss-making batch is identifiable at a glance.

### V-37 · Monthly P&L
**Depends:** V-36
**Build:** Collections minus staff cost — contribution margin. Expense integration lands with the Phase 5 expenses module (scope §5.6); the report schema accepts expense lines without migration.
**Done when:** the owner dashboard shows contribution, not only revenue; a later expense line requires no schema change.
**Flagged dependency:** scope §5.6 delivers expenses in Phase 5. Until then this report deliberately excludes non-staff operating costs — rent, utilities, consumables. It is a contribution report, not a full P&L, until Phase 5.

### V-38 · Attendance and retention
**Depends:** C-27
**Build:** Attendance trends, retention cohorts, lapse rate, coach utilisation and cost per session.
**Done when:** members at risk of lapsing are listed.

### V-38a · Enquiry funnel report
**Depends:** C-15, V-35
**Build:** Counts and conversion by source and stage over time; stage-duration distribution.
**Done when:** funnel figures reconcile to the enquiries table exactly for any date range.

### V-39 · Export
**Depends:** V-35
**Build:** CSV export on every report, using canonical field names rather than tenant vocabulary.
**Done when:** exports open cleanly in Excel with correct encoding.

## Go-live

### V-40 · Backup restore drill
**Depends:** V-39
**Build:** Restore production into a scratch environment and verify integrity. Document elapsed time.
**Done when:** a full restore is proven and timed. **An untested backup is not a backup.**

### V-41 · Load test
**Depends:** V-39
**Build:** Simulate the 6–9 AM burst — 200 concurrent users, attendance writes, dashboard loads.
**Done when:** p95 stays under 300 ms and no query plan degrades.

### V-42 · Security review
**Depends:** V-39
**Build:** Isolation re-verification, signed URL expiry audit, permission matrix review, dependency audit, secret rotation, rate-limit verification.
**Done when:** every checklist item is signed off in writing.

### V-43 · Migration and cutover
**Depends:** V-40, C-11
**Build:** Execute the D-08 migration plan. Parallel run for two weeks with the register as backup.
**Done when:** two weeks of parallel running show no discrepancies.

## DPDP — go-live blockers

### V-45 · Consent withdrawal — per-purpose
**Depends:** C-05, C-43
**Build:** Guardian-initiated withdrawal via magic link and staff UI, scoped to a consent purpose (`communications` | `photography` | `processing`) — never a single global action. Sets `withdrawn_at` on the matching consent record (append-only — never deleted); audited. Consequences per purpose:
- `communications` → suppressible messages stop per scope §7.1 (fee reminders, receipts and RBI-mandated pre-debit notices are essential and still send). Membership continues.
- `photography` → that person's R2 media is deleted and future uploads blocked. Membership continues.
- `processing` → not implemented here; hands off to V-45a.
**Done when:** withdrawing `communications` stops the next queued attendance alert while the same child's fee reminder still sends; withdrawing `photography` removes existing media and rejects new uploads; every withdrawal is provable with timestamp, purpose and evidence.
**Read first:** scope §7.1 — the reasoning behind the essential/suppressible split is recorded there, not just the split.

### V-45a · Consent withdrawal offboarding
**Depends:** V-45
**Build:** What happens when `processing` consent is withdrawn for an enrolled member: active subscription, live UPI mandate, existing attendance and assessment history, member status lifecycle. Without core processing consent the academy cannot lawfully record attendance or assessments — membership cannot continue as normal.
**FLAGGED DECISION NEEDED:** retention versus erasure of historical records, mandate cancellation flow, refund or credit treatment, target member status (new terminal status versus reuse of `left`). Requires Indian legal counsel — same conversation as scope §13 open question 7. Do not implement locally.
**Done when:** decided with counsel and specified; the offboarding path then runs end to end.

### V-46 · Data export
**Depends:** C-06
**Build:** Export bundle per person — profile, guardianship, attendance history, invoices/payments, assessments, consents — assembled server-side, delivered as signed time-limited download; request and fulfilment audited.
**Done when:** a parent's export contains exactly their child's rows and nothing belonging to another person.

### V-47 · Erasure with retention exceptions
**Depends:** V-46
**Build:** Anonymise-on-request workflow: scrub identity fields, delete R2 media, retain financial rows under tax-law retention with the person reduced to an opaque id; documented exceptions list.
**Done when:** an erased person leaves no recoverable identity in people surfaces while invoice arithmetic still reconciles.
**FLAGGED DECISION NEEDED:** retention period unstated anywhere — GST practice is commonly cited at 72 months, but DPDP erasure rights collide. Requires Indian legal counsel (scope §13, open question 7). Do not pick a number locally.

### V-48 · Breach notification runbook
**Depends:** —
**Build:** Written runbook — detection, containment, Data Protection Board notification, affected-tenant and guardian notice templates, timeline targets; one tabletop drill before go-live.
**Done when:** drill executed end-to-end with elapsed times recorded.

### V-44 · Phase 3 gate
**Depends:** V-01 … V-43, plus V-45 – V-48, V-45a and C-05a
**Verify:** registers retired; 90%+ of sessions marked same-day; outstanding dues measurably reduced against the baseline; owner opens the app five or more days a week; one payroll month run end to end.

---

# Ops platform spine

**Implementation status (2026-09-14).** O-01 … O-06 and O-09 … O-10
merged to `main` via PR #154. O-07 and O-08 are open PRs (#155, #156),
each branched from `main`:

| Task | PR | Notes |
|---|---|---|
| O-01 … O-06, O-09, O-10 | #154 | merged; see the individual commit messages for the per-task detail |
| O-07 | #155 | migration PR — needs the `human-approved-merge` label; owner settings rendered from the registry + the change-request path |
| O-08 | #156 | new key `access.location_scoped_staff` (owner_read, default off); `check:location-scope` scan with a known-bad fixture; invite path now covers worker/accountant and mirrors locations onto `staff_locations` |

Two carried-forward decisions: `attendance.offline_sync_enabled` is
registered but its storage stays in `tenants.offline_sync_enabled` until
the human-owned tier-1 test that pins the column is updated; O-05's
credential-link actions remain exempted with a stated reason.

**Blocked:** O-11 (messaging) on C-40–C-45, as its task text says.

**Source:** `docs/ops-platform-design.md`. Extracted here as tasks at the
author's request. Build order follows that document's §10. The design
doc's own recommendations are adopted as decisions unless a task says
otherwise:

- Preset changes are **copy-on-apply**, never live inheritance (§3). No
  edit to a preset definition or preset row may change an already-applied
  tenant's configuration as a side effect.
- Impersonation stays blocked (RED). The effective-configuration viewer
  (O-06) is the support path until that decision is revisited (§6).
- One WhatsApp number per tenant, owned by the tenant; Embedded Signup
  v4 is deferred to roughly five tenants. Template sync and the metered
  message log are needed from the first tenant (§9).
- Legal entity / GSTIN-scoped invoice numbering is **not modelled yet**.
  It must be settled before invoices exist (C-31 currently specifies
  per-tenant numbering); O-01 leaves the door open at zero cost without
  deciding it.

**Lane notes.** O-01, O-02, O-04, O-05 and O-09 are schema-lane.
O-06, O-07 and O-10 are UI-lane. O-03 and O-08 touch both — the schema
change lands first as its own PR. Tasks in this section never edit
`tests/tier1/**`, which agents must not write to.

**Tables this section adds** (pre-clearing the plan's stop-and-ask
rule): `staff_locations`, `config_keys`, `config_values`,
`config_change_requests`, `platform_leads`. No other table or column is
implied by these tasks.

### O-01 · Hierarchy schema — locations.kind, facilities.location_id, staff_locations
**Depends:** F-02, F-20
**Lane:** schema
**Read first:** ops-platform-design.md §8.
**Build:** One migration: `locations.kind` (`'club' | 'cafe' | 'mixed'`,
default `'club'`); `facilities.location_id` NOT NULL with composite FK
`(location_id, tenant_id) → locations(id, tenant_id)` and an index
`(tenant_id, location_id)`; backfill so every live tenant has exactly one
primary location (auto-create one where none exists; resolve any
multi-primary rows deterministically) and every facility points at its
tenant's primary location; new `staff_locations` (`id`, `tenant_id`,
`staff_id`, `location_id`, `is_primary`, audit columns, unique
`(tenant_id, staff_id, location_id)`, composite FKs to `staff` and
`locations`), RLS enabled, forced and policied like every tenant-scoped
table. Drizzle schema files updated to match.
**Done when:** a fresh migrated database and a database seeded with
existing tenants both satisfy the invariant; `staff_locations` is covered
by the isolation gate; `pnpm test`, `pnpm typecheck`, `pnpm lint` are
green.
**Never:** decide the legal-entity/GSTIN model here. No `legal_entity_id`
column until that question is answered.

### O-02 · Event rows carry location
**Depends:** O-01
**Lane:** schema + services
**Read first:** ops-platform-design.md §8 ("Members belong to the tenant.
Everything that happens carries a location.").
**Build:** Migration adding `sessions.location_id` and
`attendance.location_id` (NOT NULL, composite FK to `locations`, index
`(tenant_id, location_id)`), backfilled from each session's batch. Write
paths set it from the batch when a session is generated or created
manually, and attendance marks copy it from their session in the same
transaction. History is not rewritten when a batch later moves location.
**Done when:** a session and every attendance mark against it carry the
same location; moving a batch leaves existing rows untouched; the
consolidated view (no filter) and the per-site view (filtered) are the
same query shape.

### O-03 · Preset applications become location-scoped
**Depends:** O-01
**Lane:** schema + UI
**Read first:** ops-platform-design.md §3 and §8 ("Presets must apply per
location, not per tenant").
**Build:** Preset binding moves from the tenant to the location:
`locations.preset_key`, `preset_version`, `preset_applied_at`; apply,
idempotency and the "different preset" lock all evaluate per location.
Facilities, sub-units and example batches are written against the target
location; `location.kind` constrains which presets the UI offers. The ops
preset detail page previews per location and applies per location.
**Flagged decision (interim rule implemented here, revisit before a pilot
tenant runs two presets):** tenant-wide preset content (terminology,
roles, skills, plan shapes, message templates, dashboard cards, feature
union) belongs to the **first** preset applied to the tenant. A later
preset on another location writes location-bound content only; the
preview lists the tenant-wide sections it will skip. Re-applying the
owning preset is the only path that rewrites tenant-wide content. This is
deliberately conservative and matches copy-on-apply.
**Done when:** a tenant with a pool location and a café-kind location can
hold a swimming preset on one and a different preset on the other; the
second apply leaves the first location's rows and the tenant-wide content
unchanged; `pnpm test` green including the existing preset suites.

### O-04 · Config registry and resolver with provenance
**Depends:** O-01
**Lane:** schema
**Read first:** ops-platform-design.md §2–§3.
**Build:** `config_keys` (catalogue seeded and versioned in code:
`key`, `value_schema` jsonb, `default_value` jsonb, `visibility`
(`owner_edit | owner_read | ops_only`), `risk`
(`safe | sensitive | dangerous`), `description`) and `config_values`
(append-only: `id`, `key`, `scope_type`
(`platform | plan | preset | tenant | location`), `scope_id`, `value`,
`set_by`, `set_at`, `reason`, `superseded_at`). One resolver implementing
the fixed order `platform → plan → preset → tenant → location`, returning
the value **and** its provenance (`source`, `setBy`, `setAt`). Every write
validates against `value_schema` and supersedes the prior row in the same
transaction. Migrate the two existing scalar tenant settings into it —
`tenants.absence_alert_threshold_pct` and `tenants.offline_sync_enabled` —
with their current column defaults as the registry defaults, their reads
routed through the resolver, and a test that default-only tenants resolve
to a working system with no unconfigured state.
**Done when:** resolution order is proven for all five scopes; provenance
names the exact scope and actor for each; a bad value is rejected at the
boundary; the two migrated keys behave exactly as before when unset.
**Never:** put entitlements (`features`/`plan_features`/`tenant_features`)
or content (branding, terminology) in the registry.

### O-05 · Audited platform mutation wrapper and scan
**Depends:** —
**Lane:** schema + tests
**Read first:** ops-platform-design.md §5; `docs/status-report-2026-09-13.md`
§4 on `TODO(tenant-audit-log)`.
**Build:** One `opsAction` wrapper all platform mutations go through:
closed union of scopes, platform permission assertion, `platform_audit_log`
row written in the same transaction as the mutation, recording actor,
scope, tenant, target, before, after and reason (reason mandatory for
`dangerous` risk). Convert every existing platform mutating action to it.
A CI scan (`pnpm check:ops-actions`) fails on any exported platform action
that mutates without going through the wrapper, and the scan must flag a
known-bad fixture under `tests/scanner-fixtures/`.
**Done when:** the scan is red on the fixture and green on the tree;
existing platform actions are converted; audit rows carry before/after.
**Never:** claim this closes the tenant-side `TODO(tenant-audit-log)`
sites — that is F-15 and remains open.

### O-06 · Effective-configuration viewer in /ops
**Depends:** O-04, O-05
**Lane:** UI
**Read first:** ops-platform-design.md §6.
**Build:** `/ops/tenants/[tenantId]/configuration`: for a chosen tenant
and role, every resolved config value with provenance, the entitlement set
with its source (plan / override / denied, reusing
`resolveTenantFeatureSources`), the permission matrix, and the nav that
role would render. **No member PII on the screen.**
**Done when:** the "why can't my coach see Reports?" question is answered
from this page alone; the page renders for a role with no permissions and
for a role with all of them; a test asserts no person/member data is
queried by the page.

### O-07 · Owner settings from the registry, with Request change
**Depends:** O-04, O-06
**Lane:** schema + UI
**Build:** Owner settings sections render from the same registry,
filtered by `visibility`. `owner_edit` keys are editable; `owner_read`
keys show the current value greyed with a **Request change** button that
creates a `config_change_requests` row (tenant-scoped, RLS) with tenant,
key, requested value and note, visible to ops from the viewer with a
resolved/declined state. Owners never see mechanisms, only outcomes.
**Done when:** editing an `owner_edit` key writes through the registry
with provenance; a request for an `owner_read` key is visible to ops and
carries the tenant and key; an owner cannot write an `ops_only` key and
the attempt fails closed.
**Empty state:** with no `owner_read` key seeded yet, the request path is
exercised by tests with a fixture key and the UI shows nothing extra.

### O-08 · Location-scoped staff access
**Depends:** O-01, O-04
**Lane:** schema + services + UI
**Read first:** ops-platform-design.md §8 ("Location-scoped staff
access"); `docs/review-checklist.md` on scoping the list versus the
direct path.
**Build:** Config key `access.location_scoped_staff` at tenant scope,
default **off** (today's behaviour unchanged). When on: service-layer
enforcement on every location-scoped read and write — list **and**
by-id paths — and a CI scan with a known-bad fixture that fails on any
location-scoped read skipping the filter. Staff are attached to locations
via `staff_locations` (O-01), and the invite path gains admin, worker and
accountant attachment (currently only coach and receptionist can hold a
location).
**Done when:** with the key off, every existing test is unchanged; with
it on, a receptionist scoped to one location can list their members and
cannot reach another location's member by id, proven against
Testcontainers Postgres; the scan is red on its fixture.
**Never:** describe this as an isolation boundary. It is an access-control
boundary inside one tenant — one business, one controller.

### O-09 · platform_leads
**Depends:** —
**Lane:** schema
**Read first:** ops-platform-design.md §7.
**Build:** Platform-scoped `platform_leads` (no `tenant_id` until
conversion): contact fields, qualification answers captured as structured
fields (sport, member-count band, fee model, collection mode, GST
registered, coach count, locations), source channel, lifecycle status
(`lead | qualified | demo_booked | trial | converted | lapsed | lost`),
trial start/expiry, ops owner, lost reason, timestamps. Add the explicit
allowlist entry and a source scan restricting which files may import it,
the same treatment as `users`.
**Done when:** RLS exemption is explicit and scanned; the table holds no
child data by construction; lifecycle transitions are audited through
O-05's wrapper.

### O-10 · Lead → tenant conversion carrying configuration
**Depends:** O-03, O-04, O-09, O-05
**Lane:** UI
**Read first:** ops-platform-design.md §7 ("a lead converts into a
tenant, carrying its qualification answers forward").
**Build:** `/ops/leads` list, detail and lifecycle actions; conversion
selects the preset from the qualification answers and seeds the tenant's
initial config values, so nothing captured in the sales conversation is
re-entered. Trial expiry and the conversion decision with a reason are
recorded; lost-reason data is queryable.
**Done when:** a lead with answers converts into a working tenant whose
preset and config match those answers, with one audited action and no
re-entry.

### O-11 · Messaging — provider abstraction, metered log, manual WABA onboarding
**Depends:** C-40a, C-40, C-41, C-43, O-04, O-05
**Status:** **partially unblocked (2026-09-14).** The provider
abstraction, metered log and non-prod mock ship as C-40a; the Cloud API
adapter and WABA onboarding below remain demand-driven (first real
number). The mock must never reach production — production fails closed.
**Lane:** schema + services + UI
**Read first:** ops-platform-design.md §9.
**Build:** `MessageProvider` abstraction with a WhatsApp Cloud API
adapter; per-tenant WABA credentials stored as ops-only, `dangerous`-risk
config keys, encrypted at rest, with a restricted import path and a
documented rotation procedure; per-tenant template copies with approval
status tracked and graceful degradation when a tenant's templates are not
yet approved; a metered message log that assumes every message costs
something (the free 24-hour service window closes 1 October 2026);
on-screen manual fallback for credential delivery that is never removed.
Embedded Signup v4 is deferred until roughly five tenants.
**Done when:** a tenant without WhatsApp onboarding can still have its
credentials delivered by hand from a screen; every send writes a metered
log row; a failed send surfaces rather than fails silently.
**Never:** a shared platform-owned number; marketing templates without the
corresponding entitlement.

### O-12 · Ops plan management
**Depends:** C-29c, O-05
**Lane:** UI
**Status:** pending — step D of the 2026-09-14 reshuffle.
**Build:** A Plans section on the tenant detail page: activate preset templates
per facility/activity, create/edit/archive plans (names and prices as the
tenant wants), through platform actions wrapped in `opsAction`. Same service
the owner console uses; every mutation audited.

### O-13 · Ops subscription lookup (audited)
**Depends:** C-30, O-05
**Lane:** UI
**Status:** pending — step D of the 2026-09-14 reshuffle.
**Build:** Support lookup by phone or member code from the ops console:
read-only view of that member's subscriptions (plan, activity, facility,
period, status, pause history). No browsable member directory in `/ops`;
every lookup writes a platform audit row.
**Never:** expose children's data beyond what the support case needs.

---

# Phases 4 to 6 — not yet decomposed

Deliberately left at epic level. Decompose only after Phase 3 ships, because real usage will change the priorities.

| Phase | Epics |
|---|---|
| **4 — Multi-tenant readiness** (5–6 wks) | Control plane UI · self-service onboarding wizard on the preset engine · remaining preset definitions · usage quota enforcement · our own subscription billing · support impersonation · custom fields · Hindi and Bengali · six-accent picker · referrals · waitlists · notification centre · scheduled reports · certificates |
| **5 — Commerce and depth** (6–8 wks) | Offline-first POS · table management · inventory · member account billing (fast-follow after Release 1) · expenses · shift swaps · overtime · checklists · campaigns · discount codes · accounting export. **Café menu, online counter order entry and counter payments moved to Release 1 (K-series, 2026-09-18).** |
| **6 — Intelligence** (ongoing) | Churn scoring · renewal likelihood · natural-language querying over tenant data · recommended actions in context |

---

# Dependency map

```
D-01…08  Discovery
    ↓
S-01…07  Setup
    ↓
F-01…04  Schema ──► F-05…08  ISOLATION GATE ◄── blocking
                        ↓
                  F-09…12  Identity
                        ↓
                  F-13…21  Config, branding, presets
                        ↓
                  F-22…26  Shell ──► PHASE 1 GATE
                                          ↓
        ┌───────────────┬─────────────────┼──────────────┬─────────────┐
     C-01…11         C-12…15          C-16…21        C-28…39      C-40…45
     People          Enquiries        Scheduling     Money        Messaging
        └───────────────┴─────────────────┼──────────────┴─────────────┘
                                     C-22…27 Attendance
                                          ↓
                                     C-46…48 ──► PHASE 2 GATE
                                          ↓
        ┌──────────────┬──────────────────┼──────────────┬─────────────┐
     V-01…08        V-09…13           V-14…22        V-23…34      V-35…39
     Bookings       Swimming          Collections    Staff pay    Reports
        └──────────────┴──────────────────┴──────────────┴─────────────┘
                                          ↓
                               V-40…48, V-45a ──► PHASE 3 GATE · LIVE
```

**Critical path:** F-05 → F-08 → C-19 → C-20 → C-22 → V-30. Everything downstream of C-20 depends on substitution recording the coach who actually took the session.

**Ops spine (O-01…O-11):** O-01 → {O-02, O-03, O-04, O-08}; O-04 → {O-06, O-07, O-08}; O-09 → O-10; O-05 feeds O-06, O-09, O-10 and O-11. O-11 is blocked on C-40–C-45.

**Release 1 extensions (H/E/M/K/U, 2026-09-18):** H → E-01/E-02/E-04; E-05 → E-06; M-01 → {M-03, M-04}; M-04 → M-05; K-01 → K-02 → K-03 → {K-04, K-06, K-07}; U-08 depends on V-21/V-24. K runs parallel to the V-series; U closes target-design gaps; R1-01 gates all of it. The café module may not start before H-01/H-02 and E-01 land on `main` — it inherits their schema conventions.

---

# Standing rules

These apply to every task and override any local convenience.

| Rule | Why |
|---|---|
| All tenant data through `withTenant()` | Isolation is the one unrecoverable failure |
| Money is `bigint` paise | Float rounding on money is unrecoverable trust damage |
| **One exception to the row above, not a precedent:** `lib/money/format.ts`'s `formatINR` converts paise to `Number` once, to call `Intl.NumberFormat` (which requires a `Number`, not a `bigint`), purely to produce a display string — the result is never fed back into arithmetic. Isolated to that one function, which does nothing else; guarded by `tests/money.test.ts`'s "no paise-to-Number conversion outside formatINR" check. Cite the reasoning (display-only terminal step, API constraint, mechanically guarded), not the outcome, before treating this as license for another float anywhere near money |
| Timestamps `timestamptz`, stored UTC | Tenant timezone drives display and scheduling |
| Every mutation writes audit in the same transaction | Partial audit is worse than none |
| Every job is idempotent and tenant-scoped | Retries are guaranteed |
| Files under 300 lines — test files too, no exemption | Generated code degrades badly beyond this; a test file over budget is fixed by splitting along the concern it tests (see `tests/tier1/roles-permissions.test.ts`'s F-06-review split into roles-permissions / platform-entitlements / membership-role-scope), not by carving out an exception |
| No new dependency without approval | Every dependency is a bundle and a liability |
| jsdom + @testing-library/react (dev-only) are the one granted exception — not a precedent | Granted specifically for issue #4's regression test: a hook's internal await behaviour needed to be proven at runtime, not by reading the code, and structural/AST checks would have proven the code's shape, not its behaviour. Dev-only, zero production bundle impact (confirmed against the bundle budget check). Cite the reasoning, not the outcome, before adding another runtime or dev dependency — "we added one before" is not a justification on its own |
| Tokens only, no raw hex | The palette is the design thesis |
| Automated messages are utility category | Marketing costs 7–8× as much |
| Terms never touch data, enums, permissions or exports | Vocabulary is presentation only |
| No tracking on parent or student surfaces | DPDP obligation, not a preference |
| Feature branch → PR into `main` → merge only when `ci` is green, no admin bypass | `main` auto-deploys once D5 lands; a red `main` was previously discovered after the fact, from a direct push. `docs/branch-protection.md` is the enforcement, `CLAUDE.md` is the reminder |


---

# Screens-first sprint

Coach first (highest frequency, hardest technical problem), then owner,
then parent. DESIGN.md is the authority on tokens, spacing, type and
the Never list — no invented values. Backend contract is B6–B8.

### S1 · App shell and login
**Delivers:** first surfaces for F-09/F-11 · **Stop level:** GREEN · **Status:** complete — see git log
**Depends:** B6
**Build:** Route groups `(coach)/(owner)/(parent)` with separate layouts — a coach bundle must not contain owner code. Phone + OTP login against B6; post-login each role routes to its own home. Bottom nav exactly four items per role, no More tab. Tokens from DESIGN.md only.
**Done when:** three roles log in and land on three different surfaces; coach bundle contains no owner code.

### S2 · Coach register
**Delivers:** C-22 surface · **Stop level:** GREEN
**Depends:** S1
**Build:** Coach today-list → register screen. Separate 44px present/absent targets, never a swipe. Header shows marked-of-total. Optimistic update under 100ms. Rows ordered by lane where lanes exist (member_code until facilities land). Every row shows attendance percentage this month.
**Done when:** 16 students markable one-handed in under 60 seconds on a real phone — timed and reported.

### S3 · Offline sync
**Delivers:** C-22 offline replay promise · **Stop level:** AMBER
**Depends:** S2
**Build:** client_id generated on device before any network call. IndexedDB queue with ordered replay on reconnect. Service worker caching shell plus today's sessions and rosters (roster payloads also snapshot to IDB — server actions are POST and not HTTP-cacheable). Persistent honest sync state: pending count, last synced, failures.
**Done when:** with the network genuinely disabled a full register marks and persists; on reconnect it syncs exactly once; replaying the queue twice changes no row counts.

### S4 · Owner home
**Delivers:** owner dashboard surface · **Stop level:** GREEN
**Depends:** S1
**Build:** Per DESIGN.md reference: today's batches as capacity lanes (signature element), member count, attendance this week, needs-attention list where every item states why it is there. NO money tiles, no placeholders for absent data — honest empty states.
**Done when:** an owner opening the home sees their day truthfully, including its emptiness.

### S5 · Parent page
**Stop level:** RED — proposal signed off and shipped
**Depends:** S1
**Status:** complete — signed single-purpose 7-day tokens (`lib/services/parent-link.ts`), `/p/[token]` zero-JS server-rendered (route handler, no client JS), child's next session + attendance this month (`lib/services/parent-view.ts`), `no-store`/`noindex`/`no-referrer`, and a zero-JS contract test (`pnpm e2e:parent-link-zero-js`). Fees and progress remain out (C-32 / V-10–V-11).
**Never:** serve children's data behind an unguessable-but-unmanaged URL. (The signed token is the managed URL; revocation/denylist is still open on C-44.)

---

# Release 1 extensions — multi-sport, café, events, UI closure

**UI follow-up (2026-09-21):** the U-series records functional delivery, not
visual parity with the target boards. The user selected UI redesign as the
next workstream after PR #187. Follow
[`ui-redesign-implementation-plan.md`](ui-redesign-implementation-plan.md),
starting at UR-01 and continuing in order. It is the execution companion for
target fidelity and runtime/UI defects; this document remains the product
scope/dependency register. Payroll V-28 onward is still pending.

**Scope decision — 2026-09-18.** Café moves out of Phase 5 into Release 1 as a
module on the existing billing spine. Expanded parent surfaces stay **out**: the
parent experience remains the `/p/[token]` zero-JS link (S5). **No payment
gateway** is integrated — every payment in this release is counter-recorded
(cash, UPI reference, card-terminal reference, other). The member wallet ledger
(`account_entries`, K-05) is a **fast-follow**, not part of the R1 gate.
`boring-avatars` (MIT, local npm package, no external service) is an approved
new dependency for U-09. Owner ships web + mobile (U-10); ops is web-only with
mobile best-effort; coach/reception mobile-only.

**Series:** H hardening · E events/audit · M module kernel · K café · U UI
closure. H, E and the M schema seams land first; K runs beside the Phase 3
V-series; U closes the target-design gaps. Every `db/migrations/**` change
carries the `human-approved-merge` label per the standing rules and the
self-merge suspension (F1).

## H — Hardening

### H-01 · Index hardening
**Lane:** schema
**Build:** Add the missing tenant-leading indexes identified in the 2026-09-18
schema audit: `attendance(tenant_id, member_id, marked_at desc)`;
`tenant_memberships(user_id)` partial live+active; `ba_session(user_id)`,
`ba_account(user_id)`, `ba_verification(identifier)`; `programs(tenant_id)`;
`batches(program_id)`, `batches(coach_id)`; `sessions(coach_id)`;
`enrolments(batch_id)`; `members(person_id)`; `staff(user_id)`;
`guardianships(guardian_id)`; `payments(tenant_id, location_id, received_at)`;
`message_log(provider_message_id)` and `message_log(tenant_id, status,
created_at)`; `platform_audit_log(action)`. One migration; `concurrently` where
the table is live.
**Done when:** EXPLAIN on the member, tenant-resolution, reconciliation and
webhook-dedupe hot paths shows index scans, not sequential scans.
**Status:** complete — `20260918050000_h01_hardening_indexes.sql`, 17 indexes.
FK-supporting lookups with tenant context were added tenant-leading
(`(tenant_id, col)`), not bare. Two deliberate exemptions are pinned with
reasons in `scripts/lib/tenant-conventions-scan.ts`: `tenant_memberships(user_id)`
and `message_log(provider_message_id)` run before a tenant is selected.
`tests/tier1/hardening-indexes.test.ts` asserts every index definition.

### H-02 · Convention convergence
**Lane:** schema + CI
**Build:** One RLS policy shape across all tenant tables (the
`nullif(current_setting(...), '')::uuid` form standardised in
`0004_policy_nullif_hardening.sql`); resolve the Drizzle↔SQL divergences
(`audit_log.tenant_id` FK exists in `db/schema/audit.ts` but not in the applied
migration); `db/schema/index.ts` re-exports every schema file. Add a CI scan
that fails any new tenant table whose indexes do not lead with `tenant_id`
(documented exemptions: GiST exclusion constraints, platform tables) and any
new id column defaulting to v4.
**Done when:** the scan fails on a known-bad fixture and passes on `main`; no
tenant table carries a raw `tenant_id::text = current_setting(...)` policy.
**Status:** complete — `20260918051000_h02_rls_policy_convergence.sql` converged
15 tenant-isolation policies (the 8 text-shaped from the audit plus 7 older
`current_setting(...)::uuid` ones the shape test surfaced), never
platform-admin/user_resolution. `scripts/check-tenant-conventions.ts` +
`tests/scanner-fixtures/tenant-conventions-fixtures.test.ts` gate new
migrations (tenant-leading indexes, no v4 UUID defaults) from 20260918050000 on.
`db/schema/index.ts` exports are complete; the `audit_log` Drizzle/SQL FK
divergence was resolved to the SQL side (no FK) in E-01.

### H-03 · Partition infrastructure
**Lane:** schema + jobs
**Build:** Rebuild `audit_log` as `PARTITION BY RANGE (created_at)`, monthly,
via expand/contract (new partitioned table with `PRIMARY KEY (id, created_at)`,
dual-write in the same transaction, backfill, rename swap) — the applied
migration deliberately deferred this and it cannot be retrofitted cheaply once
coverage lands. A global `maintenance.partitions` pg-boss job keeps three
months ahead for `audit_log` and `activity_events`, and alerts on failure.
**Done when:** a test inserting a row in month+3 succeeds; a month with no
partition fails loudly, never silently; the dual-write phase produces zero row
count drift.
**Status:** complete — `20260918090000_h03_audit_log_partitioning.sql` rebuilds
`audit_log` as monthly range partitions via one-transaction
expand/backfill/drop/swap, `PRIMARY KEY (id, created_at)`, partitions from the
oldest existing row (fallback 2026-01) through **2028-12**, **no default
partition** (a 2029 insert fails loudly), RLS forced on the parent *and every
partition*, and grants restored INSERT+SELECT only. The mechanism is the
static-horizon-per-migration model E-05 proved, not a pg-boss DDL job —
`app_user` has no CREATE and `MIGRATION_DATABASE_URL` is migrations-only. New
partitions are added by future migrations; a privileged runtime DDL path
remains a deliberate non-goal.

### H-04 · Request correlation
**Lane:** services
**Build:** `middleware.ts` generates a `request_id` (UUIDv7) per request; it
flows through `Ctx` into every `audit_log` row and every `activity_events` row;
structured log lines carry `tenant_id` + `request_id`.
**Done when:** one action's audit row and its activity event share the same
`request_id`, and the value survives jobs (enqueued with the job data).
**Status:** complete for the request path — `middleware.ts` generates/forwards
`x-request-id`, `Ctx.requestId` carries it, `lib/audit/write.ts` persists it,
and `session.attendance_marked` events carry it. The thirteen pre-existing
inline audit writers were not refactored in this batch; E-02's sites pass
`requestId` explicitly, and the rest default to NULL until they migrate to
`writeAudit`. Extending the id into job payloads is tracked with H-03.

## E — Events and audit

### E-01 · Audit actor model
**Lane:** schema + services
**Build:** `audit_log` gains `actor_type`
(`user | staff | system | job | platform | support`), `actor_id` becomes
nullable, plus `impersonator_id`, `source` (`web | job | ops | api`), and
`changed_fields text[]` (computed for updates; the cheap alternative to GIN on
`before`/`after`). Backfill existing rows to `actor_type = 'user'`. System jobs
write `actor_type = 'system'`. This resolves the F-14 blocker (membership
activation could not write because `platform_audit_log.actor_id` FKs to
`platform_users`) and the jobs gap that made `subscriptions.expire` and
`invoices.generate` unauditable.
**Done when:** `subscriptions.expire` writes one audit row with no user actor;
a job run with no actor passes the schema; the F-14 `TODO` in
`db/membership-activation.ts` is gone.
**Status:** complete — `20260918060000_e01_audit_actor_model.sql` adds
`actor_type` (default `'user'`), nullable `actor_id`, `impersonator_id`,
`source`, `changed_fields`, `request_id` and `(tenant_id, action, created_at)`.
`lib/audit/write.ts` is the one writer. `subscriptions.expire` and
system-issued invoice renewals now write `actor_type='system'`,
`source='job'`. The Drizzle declaration was aligned to the applied schema
(no tenant FK) — the divergence H-02 named.

### E-02 · Audit coverage closure
**Lane:** services
**Build:** Replace the six `TODO(tenant-audit-log)` sites (branding,
terminology, coach substitution, staff invitations ×3) and the membership
activation gap. Add a coverage test that asserts each of these service
mutations writes exactly one `audit_log` row in the same transaction.
**Done when:** removing any one audit write flips the coverage test red; the
list of `TODO(tenant-audit-log)` occurrences is empty.
**Status:** complete — the six TODO sites plus both membership-activation paths
(OTP and magic-link redemption) now audit via `writeAudit`, with
`tests/tier1/tenant-audit-coverage.test.ts` pinning the action names and
`grep` proving zero TODOs remain. Two audits were added beyond the literal list
(`terminology.clear`, `membership.activate` on the link path) because leaving
half of a paired mutation unaudited was the actual coverage hole. Review catch:
the same change fixed `inviteStaff`'s missing-user guard, which previously sat
after the membership insert — an unauthenticated call could commit a
membership.

### E-03 · Tamper evidence — daily signed checkpoint
**Lane:** schema + jobs
**Build:** A `BEFORE UPDATE OR DELETE` trigger on `audit_log` raising an
exception; a nightly job computes a per-tenant digest of the day's rows
(ordered, canonical), signs it, and stores it in R2 and `platform_audit_log`;
a verifier script recomputes a day from the DB and compares against the
checkpoint. This is deliberately **not** a per-row hash chain — the checkpoint
catches the realistic tamper and truncation cases without serialising writes.
**Done when:** a hand-edited row is detected by the verifier; dropping the
latest partition is detected via the checkpoint; the nightly job is idempotent
across retries.
**Never:** claim this is a per-row hash chain; if an enterprise tenant ever
requires one, that is a new task, not an extension of this one.
**Status:** complete — `20260918095000_e03_audit_guard.sql` adds the blocking
`BEFORE UPDATE OR DELETE` trigger (created on the parent; partitions inherit
the clone). `lib/audit/checkpoint.ts` computes a canonical per-tenant-day
digest (recursive key ordering, every column included) and HMAC-SHA256 signs
it with `AUDIT_CHECKPOINT_SECRET`; `audit.checkpoint` (04:00 tenant-local)
stores the manifest via the R2 object store at
`audit-checkpoints/<tenant>/<date>.json` and anchors `{date,rowCount,digest}`
in `platform_audit_log` — the always-available anchor used when R2 is not
configured. `scripts/verify-audit-checkpoint.ts` recomputes and exits non-zero
on the first divergent row. Test-only escape hatch for suite cleanups:
`tests/helpers/audit-log-cleanup.ts`. **Not verified live against real R2**
(no credentials); the signing/HTTP path is typechecked, not network-tested.

### E-04 · Sensitive-read auditing
**Lane:** services
**Build:** Pay-data reads write `action = 'staff.pay.read'` (V-33) with actor,
entity, `request_id`; denials write `staff.pay.read.denied`.
**Done when:** an owner viewing pay produces one audit row; a denied coach
produces one denial row and no data.
**Status:** deferred to Phase 3 — there is no pay read path to audit yet
(V-30–V-33 are unbuilt); wiring this before the surface exists would produce a
test that audits a fixture, not a product. Pairs with V-33a.

### E-05 · activity_events
**Lane:** schema + services
**Build:** A monthly-partitioned `activity_events` table with the agreed
envelope: `event_id` UUIDv7, `tenant_id`, `occurred_at` (client/business clock)
vs `received_at` (server clock), `actor_id`/`actor_kind`, `session_id`,
`request_id`, `event_name` (registry-enforced snake_case), `entity_type`/
`entity_id`, `properties jsonb` (schema-validated, no PII), `context jsonb`
(route, platform, app version), `source`. Unique
`(tenant_id, client_event_id)` for idempotent delivery. Ingest through a
pg-boss batch consumer, never inside a business transaction. No writes from
`/p/[token]` or any parent/student surface — enforced by a source-scan test.
**Done when:** register marking emits `session.attendance_marked` events; a
duplicate delivery inserts exactly one row; the parent surface emits zero.
**Status:** complete — `20260918070000_e05_activity_events.sql` creates the
table with 28 monthly partitions (2026-09…2028-12), no default partition (a
beyond-horizon insert fails loudly; auto-extension needs a privileged DDL
path, see H-03), RLS forced, SELECT+INSERT only. Idempotency is
`unique (tenant_id, client_event_id, occurred_at)` — PostgreSQL requires the
partition key in partitioned-table unique indexes, so a retry must resend the
original `occurred_at`; this is an at-least-once analytics stream, not a ledger.
`lib/events/registry.ts` validates names; `lib/jobs/activity-ingest-job.ts`
consumes the pg-boss `activity.ingest` queue; the attendance register is the
first caller. `db/bootstrap-roles.ts` now re-revokes UPDATE/DELETE after its
blanket deploy-time grant, or the app role's append-only guarantee would
silently regress on every `db:deploy`.

### E-06 · Event rollups and export
**Lane:** jobs
**Build:** Nightly job folds `activity_events` into `daily_rollups`
extensions (`events_count` per name for the owner/ops dashboards) and exports
closed partitions to R2 as Parquet (one file per tenant-day), then drops raw
partitions older than the configured window (default 180 days).
**Done when:** a dropped partition's numbers remain queryable from rollups;
the export re-imports in DuckDB; the job is idempotent across retries.
**Status:** complete, one recorded deviation — rollup
(`20260918080000_e06_daily_rollups_events.sql`, `events.rollup` 03:15
tenant-local, upsert touches only event columns) and export
(`activity.export` 03:30, gzipped **NDJSON** at
`activity-events/<tenant>/<date>.ndjson.gz` via the R2 object store —
deliberately NDJSON, not Parquet: a Parquet writer is a dependency this
workstream would not add, and DuckDB reads NDJSON with `read_json_auto`, which
preserves the re-import intent). Retention is the operator-only
`scripts/retention-activity-events.ts` (`--i-understand`, default 180 days,
refuses without a privileged URL and, unless overridden, without an export
object per tenant-day) — never scheduled. Live R2 export unverified without
credentials.

## M — Module kernel (multi-sport)

### M-01 · Activity type catalog
**Lane:** schema + platform
**Build:** Platform `activity_types` (key, name, `capabilities jsonb`:
`bookable | attendance | progress | resource_based | pos`) seeded with
swimming, tennis, fitness, team-sport and café; tenant activities link to a
type. Capabilities gate UI, never data integrity.
**Done when:** one tenant runs two activities of different types and the UI
groups, labels and bills them correctly without code branches on the key.

### M-02 · facilities → activities + resources
**Lane:** schema + services
**Build:** Expand/contract rename of `facilities` → `activities` (compatibility
view first, drop one release later); normalise `facility_sub_units` into a real
`resources` table (lanes, courts, tables) with the same tenant isolation, ahead
of V-01/V-02. Keep a jsonb capacity hint for display only.
**Done when:** existing presets apply unchanged; `/owner/settings/activities`
reads the new tables; V-02's exclusion constraint can reference a resource id.

### M-03 · Generic skill framework
**Lane:** schema + services
**Build:** `skill_frameworks` / `skill_nodes` / `assessments` keyed by
`activity_type` (`rubric jsonb` per node), replacing the swim-shaped
`skill_levels`/`skills`; the swimming preset seeds the existing ladder into the
generic shape; the `progress` capability gates the UI. A module whose progress
is not a node ladder (gym PRs) uses a class-table extension, not nullable
columns on the core.
**Done when:** swimming progress renders from the generic tables; a second
activity type defines its own framework with no kernel change.

### M-04 · Module registry and contract
**Lane:** platform + CI
**Build:** Platform `modules` + tenant `tenant_modules` (key, version,
enabled_at); each module declares its presets, config keys, feature keys,
capability flags and surfaces. A contract test applies every registered module
to a scratch tenant and asserts its declarations resolve.
**Done when:** the contract test fails when a module's preset references an
unregistered config or feature key.

### M-05 · Module versioning
**Lane:** platform + services
**Build:** Copy-on-apply, versioned modules with idempotent re-apply, exactly
like presets; apply is refused once non-sample data exists unless the version
is declared additive; upgrade writes a `platform_audit_log` row.
**Done when:** re-applying a module twice changes no rows; upgrading a version
is an explicit, audited action.

### M-06 · Pricing model extension
**Lane:** schema + services
**Build:** `plan_shapes` and `membership_plans` support `per_session | term |
drop_in` alongside `duration | sessions | one_time`; existing plans untouched.
**Done when:** a drop-in and a term plan coexist per activity and bill
correctly through C-30/C-32.

## K — Café module

### K-01 · Menu catalog
**Lane:** schema + UI
**Build:** `menu_categories` / `menu_items` (`price_paise`, `tax_rate_bp`,
`sac_code`, veg flag, active, location-scoped); owner and reception read,
owner/admin write, coach never; every mutation audited (E-01/E-02 shapes).
**Done when:** a category with three items renders on reception and a coach
cannot read or write it.
**Status:** complete — `20260918100000_k01_menu.sql`; tenant-leading indexes,
case-insensitive unique per location, RLS forced; every mutation audited via
`writeAudit`. K-07 ships the owner management screen.

### K-02 · Order capture
**Lane:** schema + UI
**Build:** `orders` / `order_lines` with counter entry, optional member,
`served_by`, idempotency key; unit price and tax snapshotted per line (the
invoice-line pattern); void requires a reason and is audited. No offline mode
in Release 1 — `counter_client_id` is reserved for the Phase 5 POS.
**Done when:** a walk-in order and a member order both record in one screen;
a voided order keeps its lines for audit.
**Status:** complete — `20260918101000_k02_orders.sql`; price/tax/SAC
snapshotted per line at order time. **Known limitation (decision needed):**
`invoices.member_id` is NOT NULL, so a walk-in order cannot be billed until a
member is attached; the plan's "walk-in" scope is therefore "record a walk-in,
bill only against a member" in R1. Anonymous billing needs either nullable
invoice/payment member columns or a per-tenant walk-in member — a money-path
decision, not a code gap.

### K-03 · Café ↔ invoice bridge
**Lane:** services
**Build:** `invoices.source` (`membership | cafe | other`); finalising an order
creates one invoice with line items and links 1:1. The invoice remains the
legal document; the order remains the operational record. Gapless FY numbering
(C-31) is reused unchanged.
**Done when:** a café bill carries a GST invoice number from the same FY series
and appears in receipts; voiding the invoice is blocked while the order is
unpaid.
**Status:** complete — `20260918102000_k03_invoice_source.sql` adds
`invoices.source (membership|cafe|other)`; finalize creates exactly one invoice
through the existing spine and links it 1:1. **GST:** the bill-of-supply rule
is applied where the café snapshot is created — an unregistered tenant
snapshots rate 0, so order and invoice agree to the paisa (see the fix in
`lib/services/orders.ts`).

### K-04 · Café payments
**Lane:** schema + services
**Build:** Counter payments settle café invoices through the existing payments
path; extend `payments.method` CHECK with `card` and `other` (card = terminal
reference, no gateway; no card data ever touches our systems). Partial
payments are refused for café in Release 1; refunds are void + new order, never
row edits.
**Done when:** a counter payment settles an order invoice; overpayment and
partial payment are both refused; `method='card'` requires a reference.
**Status:** complete — `20260918103000_k04_payment_methods.sql` widens
`payments.method` to cash|upi|bank_transfer|card|other (card = terminal
reference, never an integration) and the action-level enum matches. Café bills
settle in full by design (refund = void + new order).

### K-06 · Café reconciliation
**Lane:** reports
**Build:** Café collections merge into `/owner/reports/collections` and the
daily cash count by method; `daily_rollups` gains `cafe_paise` and
`cafe_orders`.
**Done when:** a day with ten café orders reconciles to the paisa and shows in
the owner report alongside membership collections.
**Status:** complete — `20260918104000_k06_cafe_rollups.sql` adds
`cafe_paise`/`cafe_orders` to `daily_rollups`; the daily collections view and
the rollup job share one definition (captured payments against
`invoices.source='cafe'`; orders = distinct settled café invoices).

### K-07 · Café surface
**Lane:** UI
**Build:** Reception Café tab at 390×844: menu grid, cart, member lookup, pay
(cash / UPI QR / card reference). Owner sees a café revenue card. No new role —
permissions ride on the receptionist's existing grants.
**Done when:** an order-to-receipt flow completes without leaving the tab; the
coach role sees nothing café.
**Status:** complete — `/reception/cafe` (CTA from reception Today) and
`/owner/settings/menu`; walk-in bill is disabled with the server's reason shown
verbatim, partial-payment refusals render inline, receipt is in-page. No cafe
nav item added — the reception bottom nav stays four items. No order-list/void
UI yet (`voidOrderAction` exists; a placed walk-in has no screen to void it).

### K-05 · Member wallet ledger — **fast-follow, not in R1**
**Lane:** schema + services
**Status:** complete (2026-09-18, moving out of fast-follow) —
`20260918130000_k05_account_entries.sql`: append-only `account_entries`
(direction, amount_paise, `balance_after_paise`, source_type/source_id,
idempotency_key, unique per tenant), RLS forced, INSERT+SELECT only and the
revoke made bootstrap-proof. `lib/services/wallet.ts` + `wallet-core.ts`:
`topUp` (counter payment row with NULL invoice + credit entry, same
transaction), `charge` (refuses overdraft), `refund`; balance re-derives from
entries and the stored `balance_after` is asserted equal at every write.
Audited (`wallet.topup|charge|refund`). **Not wired yet:** settling a café
invoice from the wallet (next K task), wallet UI, credit limits (open
decision in project-scope §5.12).

### K-08 · Reception café billing flow
**Lane:** services + UI
**Depends:** K-03, K-04, K-07
**Build:** Café billing at reception only, mirroring membership/activity
billing: the receptionist selects an open café order, the system requests the
bill (finalizing into its invoice when needed) and shows the itemized bill
with the payment amount due, then collects payment through the existing
panel. Walk-ins without a member stay unbillable — the reason is surfaced,
no anonymous path is invented. No owner-surface café billing.
**Done when:** an open order can be selected, bill requested, amount shown,
and paid from reception; the paid order leaves the open list; the bill maths
equal the invoice to the paisa; a walk-in refusal is shown verbatim.
**Status:** complete — `lib/services/cafe-billing.ts` + `cafe-bill-view.ts`,
actions `listOpenCafeOrdersAction`/`requestCafeBillAction` (`payments.record`),
panels on `/reception/cafe` refactored to Request bill → amount due → Collect
payment. Invoice↔bill equality and audit of `order.bill` pinned by tests.
Deferred: wallet settlement (K-05 follow-on) and order void UI.

## U — UI closure (target-design gaps)

### U-01 · Owner analytics and charts
**Lane:** UI
**Build:** Attendance trend, collections vs expenses, plan-wise revenue and
member mix per the target design, rendered as inline SVG against DESIGN.md
tokens — **no charting dependency** (bundle budget is 150 KB/route). The
"collections vs target" arc is **decision needed**: no target exists in the
schema; either add a tiny `revenue_targets` table or drop the arc.
**Done when:** the page renders with real data and an honest empty state, and
the route stays within budget.

### U-02 · Fees & Payments hub
**Lane:** UI
**Build:** Owner Overview / Transactions / Dues / Invoices tabs over the
existing C-29…C-39 services; "Plans & Discounts" shows plans only — discounts
are Phase 5 and must not appear as a stub.
**Done when:** a pending invoice is collectible from the hub and appears in
transactions after payment.

### U-03 · Member detail tabs
**Lane:** UI
**Build:** Payments / Progress / Notes / Documents tabs on member 360. Notes
uses a `member_notes` table (new, audited); Documents depends on C-07;
Progress depends on M-03/V-10. Status tab mapping **decision needed**:
Inactive = `paused + lapsed`, Archived = `left`; no new statuses without a
schema decision.
**Done when:** the four tabs render real data or an honest empty state, and
status labelling matches the mapped set exactly.

### U-04 · Schedule calendar grid
**Lane:** UI
**Build:** Week/month grid over C-17/C-19 with capacity lanes per batch,
per-location filter, add-session entry point.
**Done when:** a full week renders at 390×844 without horizontal scroll and
matches the sessions list to the row.

### U-05 · Global search
**Lane:** UI + read services
**Build:** One search box finding members, enquiries and payments (read-only,
permission-scoped, tenant-scoped); no cross-entity index in R1 — LIKE over the
existing indexes.
**Done when:** a member search from the owner header lands on the member page;
a coach search never returns another coach's roster.

### U-06 · Announcements and in-app notifications
**Lane:** schema + UI
**Build:** Announcement composer (audience: all members / batch / parents only;
channel: in-app now, WhatsApp remains the C-40a mock) plus a per-user in-app
notification list. **Decision needed:** a `notifications` table vs deriving
from `message_log`; do not build the table until decided. Scheduled send rides
C-47.
**Done when:** an announcement appears for the selected audience in-app; no
WhatsApp send is attempted outside the mock.

### U-07 · Settings — locations and business hours
**Lane:** UI + services
**Build:** Locations editor and business-hours editor on the existing O-01
hierarchy and config registry; single-location tenants never see a switcher
(ops-platform-design §"skeleton").
**Done when:** a second location is creatable, appears in the header switcher,
and the first location still renders without a switcher.

### U-08 · Reception check-ins and staff attendance UI
**Lane:** UI (depends V-21, V-24)
**Build:** Today's check-in list with checked-in times against sessions
(V-21's schema), session check-in view with "mark all", and staff attendance
marking (V-24) for the reception surface.
**Done when:** a full day's check-ins and staff attendance are markable from
reception at 390×844.

### U-09 · boring-avatars and visual pass
**Lane:** UI + dependency
**Build:** Approved new dependency: `boring-avatars` (MIT, ~20 KB, local SVG
generation — the hosted service is not used). One wrapper
`components/avatar.tsx`; deterministic seed is the stable `person_id` (never
the display name, which changes); palette uses tenant accent + semantic tokens
from DESIGN.md, not the library default; `marble` default variant, `beam`
later. Used in staff boards, member lists/detail, ops users. **No photo
uploads** — C-07 remains out and children's photos are DPDP-sensitive.
`TenantMark` stays branded initials. Verify RSC compatibility; if the wrapper
must be a client component, it is excluded from the parent surface.
**Done when:** avatars render identically on server and client, the bundle
budget check passes, and no photo-upload affordance exists anywhere.

### U-10 · Owner desktop shell
**Lane:** UI
**Build:** Responsive shell over the existing `(owner)` layout: sidebar + top bar at `lg` (≥1024px) matching the owner target design (search, location switcher, notifications affordance deferred), the existing four-item bottom nav preserved below `lg`. Coach and reception bundles must remain free of owner components (route groups already enforce this). Ops stays desktop-only (mobile best-effort, not a gate — decision 2026-09-18).
**Done when:** every owner route renders at both 1280×900 and 390×844 from the same layout, the bundle-budget check passes, and coach/reception route bundles contain no owner code.

**Batch status (2026-09-18, third Release 1 batch):**

- **M-01** complete — `activity_types` + nullable `facilities.activity_type_key`
  with a seated backfill (pool→swimming, court→tennis, turf→team_sport,
  studio→fitness; unknown kinds stay NULL).
- **M-02** deferred — the `facilities→activities` rename + `resources` table
  still needs its own migration pass (M-01 added the type link only).
- **M-03** complete — generic `skill_frameworks`/`skill_nodes`/`assessments`,
  additive; the swim preset's `skill_levels`/`skills` are untouched, and the
  preset→generic data migration is a follow-up.
- **M-04** complete — platform `modules` + tenant `tenant_modules`, contract
  test resolves every declared preset/config/feature key (and fails on a
  known-bad key).
- **M-05** complete — `applyModule` idempotent, `upgradeModule` explicit and
  audited, non-additive upgrades refused once non-sample data exists.
- **M-06** complete — `per_session | term | drop_in` added to
  `plan_shapes`/`membership_plans`; existing kinds untouched.
- **U-01** complete — inline-SVG analytics on `/owner/reports` (no chart
  dependency); the target arc is omitted (no target in the schema).
- **U-02** complete — `/owner/fees` hub; discounts deliberately absent.
- **U-03** Payments/Notes/Documents tabs shipped with `member_notes` + audit.
  **Update 2026-09-21:** Progress was wired in Phase 3A; Documents remains an
  honest empty state until C-07.
- **U-04** complete — week/month schedule grid on `/owner/schedule`.
- **U-05** complete — permission-scoped member/enquiry/invoice search in the
  owner shell; no cross-entity index in R1.
- **U-06** complete — announcements + in-app `notifications` with audience
  fan-out (all/batch/parents) and audit; WhatsApp remains the C-40a mock.
  R1 families on the zero-JS link resolve to no user row and receive nothing
  in-app (documented).
- **U-07** complete — locations CRUD + business hours in the config registry;
  single-location tenants see no switcher.
- **U-08** complete (scoped) — reception "Today's check-ins" over existing
  sessions/attendance, interactive because the receptionist template already
  grants `attendance.mark`. **Update 2026-09-21:** V-24 in PR #187 delivered
  the staff-attendance board, including required reasons and quick reasons.
- **U-09** complete on staff board, coach members list and reception
  check-ins (stable id seeds, `boring-avatars`). Owner member surfaces are not
  swapped yet — another workstream owns those files; ops has no users list.
- **U-10** complete — `OwnerShell`: sidebar ≥1024px, bottom nav below; all
  routes within the 150 KB budget.
- **K-05 / K-08** complete — see their status notes above. Deferred:
  wallet-settles-café, order void UI, M-02. U-03 Progress was wired in Phase
  3A; U-08 staff attendance shipped in PR #187. Visual parity remains open.

## Release 1.1 — fast-follow (not in the gate)

| Item | Why deferred |
|---|---|
| K-05 wallet ledger | Needs balance re-derivation and reconciliation tests; R1 café works with counter payments |
| Parent expansion (progress, fees, announcements) | Parent stays the S5 token link this release |
| Per-row hash chain (E-03 upgrade) | Daily signed checkpoint covers R1; enterprise demand only |
| CDC/logical-replication pipeline (on top of E-06) | R2 Parquet export is sufficient at current volume |
| Discount codes, offline POS, inventory, tables | Phase 5 per `project-scope.md` |

### R1-01 · Release 1 gate
**Depends:** H-01 … U-10 (K-05 excluded)
**Verify:** the reference business runs sports **and** café for one full month
without the register. Café cash count matches the system figure daily. F-15
audit coverage is closed and the coverage test is green. `activity_events`
carries attendance and money actions, and the parent surface carries none. The
parent token link still serves zero client JavaScript. No payment gateway code
exists in the tree. `main` is green and every migration carried the
`human-approved-merge` label.

**As-built (2026-09-18).** Shipped: H-01–H-04 · E-01, E-02, E-03, E-05, E-06
(E-04 parked until pay exists) · K-01–K-08 (wallet K-05 shipped service-side;
wallet-settles-café deferred) · M-01, M-03–M-06 (M-02 rename deferred;
resources already exist as `facility_sub_units`) · U-01–U-10 (U-03 Progress
wired in Phase 3A; U-08 staff attendance delivered by V-24; owner avatar
swap pending) · V-01–V-04, V-08–V-11 (Phase 3A). **Update 2026-09-21:**
V-23–V-27 shipped in PR #187; runtime/UI gaps follow the UR redesign plan.
**Remaining before this gate can run:** V-28–V-34 staff pay, V-35–V-37
revenue/profitability, the messaging send path C-40–C-43 (blocked on the
BSP/WhatsApp decision), V-05–V-07 to complete bookings, and the reference
month itself. **Open decisions:** anonymous/walk-in billing, wallet credit
limit, parent expansion, price-rule CRUD UI, slot grid driven by business
hours.
