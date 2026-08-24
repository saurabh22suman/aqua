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

- [ ] `grep -rn "@/db/client" --include="*.ts" --include="*.tsx" .`
      hits nothing outside `db/` (and the platform module). The ESLint
      rule enforces this — a lint bypass comment is a finding.
- [ ] Tenant context never originates from client input: no cookie /
      header / query param feeds `set_config` or `withTenant`.
- [ ] `users` is only queried via joins through `tenant_memberships`
      inside `withTenant()`.

## 6. Break it and see red

A green suite proves nothing. For each safety property touched by the
batch, mutate the thing and confirm the test fails, then restore:

- [ ] Drop one table's RLS policy → isolation suite goes RED → restore.
- [ ] Remove `force row level security` from one table → catch-all
      goes RED → restore.
- [ ] Create a tenant_id table with no RLS → catch-all catches it with
      no per-table test written → drop it.
- [ ] Revoke a sequence grant → bigserial insert fails → restore.
- [ ] Weaken one assertion to `toBeDefined()` → mutation gate fails
      (once S-05b lands).

The first three are built into the suite itself:
`ISOLATION_MUTATE=drop-policy|no-force|bare-table pnpm exec vitest run tests/tier1/isolation.test.ts`
must go RED in all three forms; a plain run goes back to green.

Also verify the no-context contract on a WARM connection: after any
`withTenant` call has run on the pool, an unscoped query must return
zero rows (`nullif` policies), never error 22P02 and never leak rows.
Covered by the fourth isolation test.

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
