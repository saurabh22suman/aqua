# Review checklist — what to check when a batch lands

Work top to bottom. Every check is mechanical; none requires
re-deriving the design. Queries assume `docker compose exec db psql -U aqua -d aqua`.

## 1. Commits and hygiene

- [ ] One commit per task, message prefixed with the task ID
      (`feat(B4):`, `docs(V-45):`).
- [ ] Commit range shown in the batch report matches the tasks claimed.
- [ ] No secrets: no passwords, tokens or OTPs in any tracked file;
      role creation lives only in `db/bootstrap-roles.ts`.
- [ ] No migration file was edited after being applied — fixes arrive
      as new migrations.

## 2. Migrations actually applied

- [ ] Ledger count equals file count:

```sql
select count(*) from _migrations;
```

- [ ] Names ascend by number with no gaps introduced silently:
      `ls db/migrations` vs the ledger rows.
- [ ] `pnpm db:reset` replays clean end to end (drop → migrate →
      re-bootstrap). If grants break after a reset, the reset script is
      not chaining bootstrap — fix that, not the symptom.

## 3. RLS is real (the pg_class sweep)

Every business table must show both flags true; only allowlisted
platform/infra tables (`db/allowlist.ts`) may show false.

```sql
select c.relname,
       c.relrowsecurity      as rls,
       c.relforcerowsecurity as forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
```

- [ ] Output matches the allowlist exactly: nothing unexpected false,
      nothing expected missing.
- [ ] Each scoped table's policy lives in the SAME migration file as
      the table (`grep -l "enable row level security" db/migrations/*`).

## 4. Connection identity

```sql
select rolname, rolinherit, rolbypassrls, rolcanlogin
from pg_roles
where rolname in ('app_user', 'app_login');
```

- [ ] `app_login`: rolinherit **false** (if true, SET ROLE is a no-op
      and the isolation model is broken), rolbypassrls false, can login.
- [ ] `app_user`: cannot login, rolbypassrls false.
- [ ] Fresh app connection reports `current_user = app_user`,
      `session_user = app_login`.
- [ ] Default privileges still installed for tables AND sequences
      (survives only if bootstrap ran after the last schema drop):

```sql
select defaclrole::regrole, defaclobjtype, defaclacl
from pg_default_acl;
```

## 5. The accessor is the only door

- [ ] `pnpm exec eslint .` is clean. The rule (`import/no-restricted-paths`
      in `eslint.config.mjs`) matches resolved module identity, not import
      text — it catches `../../db/client` the same as `@/db/client`. Do
      not "verify" this with a literal-string grep instead: an earlier
      version of this checklist did exactly that
      (`grep -rn "@/db/client" ...`), reported clean, and missed two real
      call sites reaching the same file by relative path. A verification
      that passes while the thing it verifies is already violated is
      worse than no verification — it spends the reviewer's trust for
      nothing. A lint bypass comment (`eslint-disable`) anywhere near this
      rule is a finding.
- [ ] `db/auth-db.ts` and `db/client.ts` are the only two files that may
      hold the raw client; everything else reaches data through
      `withTenant()` / `withUser()` / `withPlatform()`.
- [ ] Tenant context never originates from client input: no cookie /
      header / query param feeds `set_config`, `withTenant`, or `withUser`.
- [ ] `users` is only queried via joins through `tenant_memberships`,
      inside `withTenant()` for tenant-scoped reads or `withUser()` for
      pre-tenant resolution — never on a superuser/migration connection.
- [ ] `grep -rln "MIGRATION_DATABASE_URL" --include="*.ts" .` matches only
      `db/migrate.ts`, `db/bootstrap-roles.ts`, `db/reset.ts`,
      `db/seed-platform.ts`, `scripts/seed.ts`, `lib/env.ts`,
      `tests/**`. Zero matches under `app/`, `components/`, or `lib/`
      outside `lib/env.ts`'s schema declaration. `aqua`, the role behind
      that connection string, is a real Postgres superuser
      (`rolsuper=t`) — it bypasses RLS unconditionally regardless of
      `FORCE ROW LEVEL SECURITY`. It has no business on any path a live
      request can reach.

## 6. Break it and see red

A green suite proves nothing. For each safety property touched by the
batch, mutate the thing and confirm the test fails, then restore:

### Named failure class: unscoped reads return ZERO, not errors

RLS filters silently. A query that forgot its tenant context does not
fail — it succeeds with fewer rows than reality. Symptoms are never
permission errors; they are unique-key collisions, missing records,
wrong counts, "data I just wrote is gone".

Real examples from one batch:
- Seed's member-existence check ran unscoped → saw zero members →
  re-inserted → collided on `members_tenant_member_code_key`.
- Pre-hardening, a warm pooled connection without context turned
  `current_setting('app.tenant_id', true)` into `''` → cast error
  22P02 instead of rows or silence.

Detection is mechanical now (dev/test only): the application pool
rewrites any out-of-scope statement to `raise exception 'Unscoped
query…' (P0001)`. Tenant work goes through `withTenant()`; platform
surfaces declare themselves with `withPlatform()`. If you bypass both,
you have decided something — write it down.

- [ ] Mutation: run any service call outside `withTenant` in dev →
      must throw P0001 with guidance, not return empty.

### Bugs the tests caught

- The timezone converter's second-pass correction was computed against
  the target instead of the current guess, silently cancelling pass
  one — every wall time converted as if the server were UTC. Its own
  tests failed before the code ever touched data.
- Migration ordering (grants referencing a role created later) passed
  locally forever because bootstrap happened to run first; the
  clean-room Testcontainer caught it on day one.
- The "accessor is the only door" checklist item itself was checked by
  literal-string `grep -rn "@/db/client"`, which reported clean while
  `lib/auth/server.ts` and `scripts/seed.ts` reached the same file by
  relative import (`../../db/client`), evading both the grep and the
  `no-restricted-imports` ESLint rule it was meant to confirm. A
  verification that passes while the thing it verifies is already
  violated is worse than no verification: no verification leaves you
  uncertain; a false-green one leaves you confidently wrong. Fixed by
  matching resolved module identity (`import/no-restricted-paths`)
  instead of import text — see §5.

These three are the answer to "is the testing overhead worth it".

The rest of this section is built into the suite itself:
`ISOLATION_MUTATE=drop-policy|no-force|bare-table pnpm exec vitest run tests/tier1/isolation.test.ts`
must go RED in all three forms; a plain run goes back to green.

Also verify the no-context contract on a WARM connection: after any
`withTenant` call has run on the pool, an unscoped query must return
zero rows (`nullif` policies), never error 22P02 and never leak rows.
Covered by the fourth isolation test — and in dev it now throws via
the scope guard instead of returning zero.

Record what went red. A mutation that did NOT turn anything red is a
coverage hole — open a task for it before moving on.

## 7. Conventions sweep

- [ ] New tables: uuid v7 PK, `tenant_id uuid not null` where scoped,
      timestamptz UTC, all four audit columns, `deleted_at` + partial
      index where soft delete applies, every index leading with
      `tenant_id`.
- [ ] Money is bigint paise; no float/numeric money columns.
- [ ] Interim designs carry their in-migration flag comment (e.g. the
      B3 role column) and a plan cross-reference.

## 8. Report shape

The batch report arrived as ONE block containing: completed tasks +
hashes, condensed evidence per task, deferred/noticed items, why it
stopped, proposed next step. Missing sections get bounced back before
review continues.
