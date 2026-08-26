# Implementation plan — Aqua

**Task-level build plan for Phases 0 to 3.** Written to be executed sequentially by a developer or an AI coding agent.

| | |
|---|---|
| Covers | Setup, Phase 1 (foundation), Phase 2 (core), Phase 3 (vertical + staff pay + go-live) |
| Task count | 148 |
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
F-03 (interim plain-text role until F-04's roles/permissions model),
F-09 (OTP has no delivery channel and no staff email/password
fallback), F-10 (rate limiting is Better Auth's global limiter; the
per-phone lockout is plugin `allowedAttempts`), F-11 (`Ctx` lacks the
permissions/features arrays F-12 will consume),
C-01/C-03/C-16–C-19/C-22 (schema, constraints, generator and service
layer exist; screens, job scheduling and the full task bodies do not).

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
**Build:** `roles` per tenant, `permissions` as a platform-level closed list, `role_permissions`. Seed role templates: owner, admin, receptionist, coach, accountant, worker.
**Done when:** role templates seed per tenant and are editable.
**Never:** hard-code behaviour to a role name anywhere in the codebase.

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

### F-07 · Lint rule
**Depends:** F-06
**Build:** ESLint `no-restricted-imports` banning `@/db/client` outside `db/` and the platform module.
**Done when:** importing the raw client in a route file fails lint.

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
**Depends:** C-01
**Build:** `staff` typed as coach, receptionist, worker, accountant, linked to a person and optionally to a login via `staff.user_id`.
**Done when:** one person can be both a coach and a member.

### C-05 · Consent — DPDP
**Depends:** C-02
**Build:** Append-only `consents` with purpose, policy version, granting party, timestamp and evidence. Registration blocks on missing guardian consent for a minor.
**Done when:** a minor cannot be activated without recorded guardian consent; withdrawal is recorded, not deleted.
**Read first:** scope §7.1.

### C-05a · Per-tenant DPA
**Depends:** F-25, C-05
**Build:** Standard data processing agreement template; signature/version captured at provisioning and stored on the tenant; surfaced during onboarding.
**Done when:** every live tenant has a signed DPA version recorded.
**Read first:** scope §7.1.

### C-06 · People screens
**Depends:** C-03, C-04, C-05
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

### C-18 · Enrolments
**Depends:** C-17, C-03
**Build:** `enrolments` linking members to batches with dates, capacity check.
**Done when:** enrolling beyond capacity is refused with a clear message.

### C-19 · Session generation
**Depends:** C-17
**Build:** pg-boss job materialising sessions eight weeks ahead from batch recurrence, respecting holidays and closures and **the tenant's timezone**.
**Done when:** a 7:00 AM batch generates sessions at 07:00 IST regardless of server timezone.

### C-20 · Session changes and substitution
**Depends:** C-19
**Build:** Cancel with reason, reschedule, and **substitute coach — recording who actually took the session**.
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
**Depends:** C-22
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
**Build:** `membership_plans` — duration, session pack, one-time. Amount required and non-null on activation.
**Done when:** a preset-seeded plan cannot activate until a price is entered.

### C-30 · Subscriptions
**Depends:** C-29, C-03
**Build:** `subscriptions` with start, end, pause, resume, cancel. Pause extends the end date.
**Done when:** a seven-day pause moves the end date by exactly seven days.

### C-31 · Invoice numbering
**Depends:** C-28
**Build:** Gapless per financial year per location using a counter row with `select … for update` inside the invoice transaction.
**Done when:** a concurrency test of fifty parallel invoices produces fifty sequential numbers with no gaps or duplicates.
**Never:** a Postgres sequence — rollbacks leave gaps and GST requires none.

### C-32 · Invoices
**Depends:** C-31, C-30
**Build:** `invoices` with line items, GSTIN, HSN/SAC, subtotal, tax, total, due date, status.
**Done when:** a generated invoice is arithmetically correct and GST-valid.

### C-33 · Cash and manual payments
**Depends:** C-32
**Build:** `payments` recorded at the counter — cash, UPI reference, bank transfer — with `received_by`. Partial payments update invoice balance.
**Done when:** two partial cash payments settle an invoice and mark it paid.

### C-34 · Daily reconciliation
**Depends:** C-33
**Build:** Daily collection report by method and by staff member, with a cash count confirmation step.
**Done when:** the report matches a manual count for a full day at the reference business.

### C-35 · Razorpay adapter
**Depends:** C-32
**Build:** Order creation with the invoice id as receipt, config validated at boot.
**Done when:** an order is created in test mode against a real invoice.

### C-36 · Payment links
**Depends:** C-35, C-42
**Build:** Generate and send a payment link for an outstanding invoice.
**Done when:** a link opens Razorpay pre-filled with the correct amount.

### C-37 · Webhook endpoint
**Depends:** C-35
**Build:** Signature verification before parsing, insert-on-conflict-do-nothing into `webhook_events`, enqueue, return 200. Under 50 ms.
**Done when:** the same event delivered five times stores one row and enqueues one job.

### C-38 · Webhook worker
**Depends:** C-37, C-33
**Build:** Apply payment, update invoice, emit receipt. Idempotent, retryable, dead-letters with an alert.
**Done when:** a replayed event produces no duplicate payment and no second receipt.

### C-39 · Receipts
**Depends:** C-38, F-17
**Build:** Branded receipt PDF, sent on payment, stored against the payment record.
**Done when:** the receipt carries the tenant's mark, not ours.

## Messaging

### C-40 · Provider interface
**Depends:** F-26
**Build:** `MessageProvider` interface plus one BSP adapter. Nothing above the interface knows the provider.
**Done when:** swapping in a stub provider requires no changes outside the adapter.

### C-41 · Template registry
**Depends:** C-40
**Build:** Template definitions with category, variables and approval status. **Every automated template is `utility`.**
**Done when:** registering a `marketing` template for an automated flow fails validation.

### C-42 · Message log and metering
**Depends:** C-41
**Build:** `message_log` with cost in paise, per-tenant monthly counters, hourly metering job.
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
**Depends:** C-44, F-17
**Build:** Server-rendered, **zero client JavaScript**, tenant-branded. Fees, schedule, attendance, progress.
**Done when:** the page works with JavaScript disabled and ships no analytics.
**Never:** tracking of any kind on this surface.

## Dashboard and jobs

### C-46 · Owner dashboard
**Depends:** C-33, C-27, C-13
**Build:** Per the UI direction — overdue amount with a WhatsApp action, three supporting figures, a needs-attention list where every item carries its reason, today's batches as capacity lanes.
**Done when:** it loads in under 2.5 s on a mid-tier Android over 4G.

### C-47 · Scheduled jobs
**Depends:** C-30, C-32
**Build:** `subscriptions.expire`, `invoices.generate`, `reports.rollup`. Idempotent, tenant-scoped, chunked.
**Done when:** re-running a night's jobs changes nothing.

### C-48 · Phase 2 gate
**Depends:** C-01 … C-47
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

### V-03 · Slots and pricing
**Depends:** V-02
**Build:** Slot templates, peak and off-peak pricing, advance-booking window.
**Done when:** peak pricing applies correctly by time of day.

### V-04 · Staff booking
**Depends:** V-03
**Build:** Front-desk booking for a member or a named walk-in, with payment.
**Done when:** a walk-in is booked and paid in under a minute.

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

## Swimming

### V-09 · Skill ladder
**Depends:** C-48
**Build:** `skill_levels`, `skills`, rubric JSON.
**Done when:** the preset's swimming ladder is present and editable.

### V-10 · Assessments
**Depends:** V-09
**Build:** `assessments` with band 1–4, assessor and timestamp. Coach entry from the session view.
**Done when:** a coach assesses three swimmers from the register in under a minute.

### V-11 · Progress view
**Depends:** V-10
**Build:** Progress pips per DESIGN.md, history over time, visible on the parent page.
**Done when:** a parent sees the progress trend without an account.

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

### V-24 · Staff attendance
**Depends:** V-23
**Build:** `staff_attendance` with self check-in and check-out, late minutes against shift, audited manual correction.
**Done when:** a manual correction records who made it and why.

### V-25 · QR staff check-in
**Depends:** V-24
**Build:** Premises QR check-in, optional geofence.
**Done when:** a coach checks in by scan in under five seconds.

### V-26 · Leave
**Depends:** V-23
**Build:** `leave_types` with quotas, `leave_requests` with balances.
**Done when:** balances decrement correctly and unpaid leave is distinguished.

### V-27 · Leave approval
**Depends:** V-26, C-20
**Build:** Approval flow, roster update, **flagging batches left uncovered**.
**Done when:** approving leave surfaces uncovered sessions before the day arrives.

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

# Phases 4 to 6 — not yet decomposed

Deliberately left at epic level. Decompose only after Phase 3 ships, because real usage will change the priorities.

| Phase | Epics |
|---|---|
| **4 — Multi-tenant readiness** (5–6 wks) | Control plane UI · self-service onboarding wizard on the preset engine · remaining preset definitions · usage quota enforcement · our own subscription billing · support impersonation · custom fields · Hindi and Bengali · six-accent picker · referrals · waitlists · notification centre · scheduled reports · certificates |
| **5 — Commerce and depth** (6–8 wks) | Café menu · offline-first POS · table management · inventory · member account billing · expenses · shift swaps · overtime · checklists · campaigns · discount codes · accounting export |
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

---

# Standing rules

These apply to every task and override any local convenience.

| Rule | Why |
|---|---|
| All tenant data through `withTenant()` | Isolation is the one unrecoverable failure |
| Money is `bigint` paise | Float rounding on money is unrecoverable trust damage |
| Timestamps `timestamptz`, stored UTC | Tenant timezone drives display and scheduling |
| Every mutation writes audit in the same transaction | Partial audit is worse than none |
| Every job is idempotent and tenant-scoped | Retries are guaranteed |
| Files under 300 lines | Generated code degrades badly beyond this |
| No new dependency without approval | Every dependency is a bundle and a liability |
| Tokens only, no raw hex | The palette is the design thesis |
| Automated messages are utility category | Marketing costs 7–8× as much |
| Terms never touch data, enums, permissions or exports | Vocabulary is presentation only |
| No tracking on parent or student surfaces | DPDP obligation, not a preference |


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
**Stop level:** RED — propose before building
**Depends:** S1
**Build (proposed, not approved):** signed single-purpose scoped tokens with expiry and revocation; `/p/[token]` zero-JS server-rendered; child's next session and attendance this month; no analytics or tracking ever.
**Never:** serve children's data behind an unguessable-but-unmanaged URL.
