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

**Known limitation, not yet closed:** this sweep proves RLS is *on*
(`relrowsecurity`/`relforcerowsecurity`), not that the policies attached
to a table are *correct*. It is blind to policy content (a second,
overly-permissive policy added to an already-RLS'd table changes
nothing this query sees) and blind to `SECURITY DEFINER` functions
entirely (they live in `pg_proc`, outside a `pg_class` sweep — a
function granted to `app_user` that quietly bypasses RLS would pass
this checklist item clean). Surfaced designing D3's cross-tenant job
scheduling (`docs/architecture.md` §9.1) while rejecting a proposed RLS
policy bypass — none of the options considered there changed this gap,
for better or worse. If it's ever closed, the two natural extensions
are a policy-content check (e.g. flag any policy referencing a
session variable outside `app.tenant_id`/`app.user_id`) and a
`pg_proc`-based allowlist for `SECURITY DEFINER` grants to `app_user`,
mirroring `RLS_EXEMPT_TABLES`'s shape.

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

### Named failure class: scoping the list, not the direct path

Tenant isolation (§5) answers "which tenant." It does not answer
"which row within that tenant" — a caller can be a legitimate member
of the tenant and still not be the right person to see a specific row
(a coach and another coach's session; eventually a parent and another
parent's child). **Scoping a list view without scoping the matching
direct-access action is not a fix** — it hides the row from a menu
while leaving the door to it unlocked. Real example: `getTodayAction`
was scoped to a coach's own sessions, and `getRosterAction` (open one
specific session by id) and `markAttendanceSessionAction` (mark one)
were left checking tenant membership only — anyone who wanted another
coach's roster just typed the session id into the URL, bypassing the
list entirely. This was the fifth recurrence of "fixed one instance,
missed the sibling" in this project.

- [ ] Whenever an action is scoped to something narrower than "is a
      tenant member" (a specific assignment, a specific relationship,
      a specific owner), grep every other exported action in the SAME
      FILE that takes an id and returns tenant data. For each one: does
      it check the caller may see THAT row, or only that they're in the
      tenant? Fix every real sibling found before closing the task —
      finding one and reporting the rest as future work is the
      recurrence, not the fix.
- [ ] A caller denied by row-level scoping gets the same response as
      "this row doesn't exist" (404-shaped), never a distinct
      forbidden/403-shaped response — the latter confirms the id was
      real to someone who shouldn't get that confirmation.
- [ ] Prove the scoping test actually exercises the real authorization
      path, not a fabricated context. A test that constructs `ctx`
      directly with a hand-picked id can pass while the real resolution
      path (session → user → tenant membership) is still broken — this
      happened in the same fix: the unit tests passed because they used
      a matching id by construction, and the real bug (`ctx.userId` was
      the wrong id space entirely) was only caught by running the
      actual E2E flow against a real login.

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
- `markAttendanceSessionAction` was missing its Zod-parse preamble
  (standing rule: every Server Action opens with (1) parse, (2)
  permission check). Fixed by hand. Then found by hand a second time in
  `getRosterAction`, and a third time in `devCodeAction` — three
  independent occurrences of the identical shape, each only found because
  someone happened to read that specific file closely. A fix applied by
  hand at one call site is not a fix, it is a coincidence: it says
  nothing about the next file. `tests/tier1/server-action-preamble.test.ts`
  now walks the TypeScript AST of every `"use server"` file and asserts
  every exported action taking input calls `.parse()`/`.safeParse()` as
  its first statement — mechanical, not review-dependent, and it runs on
  every `pnpm test`.
- Issue #4 (offline attendance durability) had three mechanisms, not
  two. `tx()` resolved on `request.onsuccess` instead of
  `transaction.oncomplete`, and `mark()`'s write ran inside a detached,
  unawaited IIFE — two real races, fixed together, took CI from 5/5
  failing to 2/5 failing. That looked like "fixed, residual flakiness"
  until it wasn't: a third mechanism (nothing observed in-flight writes
  before a reload could race them) was still fully open, just narrower.
  Only surfaced by re-running CI five more times after the first fix
  instead of taking one green run as proof. See the named failure class
  above, and `docs/architecture.md` §12.1 for the durability boundary
  this settled on.
- `getTodayAction` (coach's session list) was scoped to the caller's
  own assignments while `getRosterAction` and
  `markAttendanceSessionAction`, in the SAME file, kept checking tenant
  membership only — a coach could still open and mark another coach's
  register directly by session id, bypassing the scoped list entirely.
  The fifth recurrence of fixing one instance and missing its sibling
  in this project. Fixing it surfaced a second, unrelated bug that made
  the fix a no-op for every real user: `ctx.userId` was returning
  better-auth's own id in one of two `Ctx`-construction paths, not the
  platform `users.id` the new scoping columns actually stored — the
  unit tests passed anyway because they fabricated a matching id
  directly, and only running the real E2E flow against a real login
  caught it. See the named failure class above, and
  `docs/architecture.md` §9.2.

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

### Named failure class: a narrowed window looks like a closed one

**A fix that reduces a failure rate is not a fix.** Measure repeatedly,
on the environment that reliably fails, both before and after — not
once. A race that fails 5/5 and, after a fix, fails 2/5 has not been
fixed; the failure has been made rarer, and rarer is indistinguishable
from fixed on a single green run. Real example (issue #4): two real
mechanisms were diagnosed and fixed together, CI went from 5/5 failing
to 2/5 failing, and that read as "fixed, remaining failures are CI
flakiness" — it wasn't. It was a third, undiagnosed mechanism, now just
less likely to lose the race than before. Only found because CI was run
5 times again after the fix instead of once.

- [ ] If the batch fixes a race, a timing-dependent bug, or a flaky
      test: it was measured repeatedly (5+ runs), on the environment
      that reliably reproduces the failure, both before the fix (to
      confirm it's real and not noise) and after (to confirm it's gone,
      not just rarer). One green run after a fix for a probabilistic
      failure is not evidence — report the actual run count, not "it
      passed."

## 7. Offline sync — the last-write-wins rule is not a test detail

`attendance` upserts on `(tenant_id, session_id, member_id)` — whichever
write reaches the database last wins, full stop. It does **not** compare
`marked_at` to find the most recent human decision, even though it's
tempting to describe it that way (architecture.md §12 used to, and was
wrong).

This is coach-visible behaviour: a device that went offline after
marking, then reconnects after a second device already marked the same
member while online, overwrites that second mark on reconnect — even
though the offline device's mark was the *earlier* decision in
wall-clock time. Verified directly (S3, `scripts/e2e-offline.ts` VERIFY
6): two devices, one offline, mark the same member differently; the
offline device's mark reached the server last and won, regardless of
which coach decided more recently.

- [ ] If touching the register service or the offline queue: re-run
      VERIFY 6 (or the CI equivalent) and confirm this is still the
      behaviour, not just that *a* row exists.
- [ ] Do not "fix" this into timestamp-based conflict resolution without
      raising it as a design change first — it is the correct rule for
      this product (an offline coach's marks must land, not silently
      lose to whoever had signal first), not an accident to clean up.

## 8. Conventions sweep

- [ ] New tables: uuid v7 PK, `tenant_id uuid not null` where scoped,
      timestamptz UTC, all four audit columns, `deleted_at` + partial
      index where soft delete applies, every index leading with
      `tenant_id`.
- [ ] Money is bigint paise; no float/numeric money columns.
- [ ] Interim designs carry their in-migration flag comment (e.g. the
      B3 role column) and a plan cross-reference.

## 9. Report shape

The batch report arrived as ONE block containing: completed tasks +
hashes, condensed evidence per task, deferred/noticed items, why it
stopped, proposed next step. Missing sections get bounced back before
review continues.

## 10. Delegated work — a fork's report is not evidence, its output is

Applies whenever work is farmed out to a subagent/fork rather than
done directly: **check the branch and the diff yourself before
treating any part of the report as true.** A report is a claim about
what happened, written by the same process that did the work — it can
be wrong in either direction, confidently.

Two real failures from one session, back to back:

- **Silent no-op.** A fork asked to build a feature returned a status
  line with zero tool calls and no branch changes — it never actually
  started, but the response read like a plausible summary. Caught only
  by checking `git worktree list`/the branch diff before believing
  "done."
- **600-second stall.** A different fork, mid-way through its own
  manual verification step, stopped responding entirely and was killed
  by the stream watchdog. It had already produced real, substantial,
  correct work on its branch — discarding it and redoing from scratch
  would have wasted it. Checking the actual branch state first (not
  just the failure notification) was what made it possible to recover
  the work instead of re-running the whole task.

- [ ] Read the actual diff of every file a fork touched before citing
      any of its claims (test count, "confirmed red," "verified
      end-to-end") in your own report upward.
- [ ] Re-run the fork's own verification commands yourself
      (`pnpm typecheck && pnpm lint && pnpm test`, plus anything
      E2E) rather than trusting a pasted "clean" in its report.
- [ ] A fork that returns with zero tool calls or an implausibly short
      duration for the task size is a signal to check the branch/
      worktree directly, not to accept the report at face value.
- [ ] A fork that stalls or fails is not necessarily a fork that did
      nothing — check for a branch and uncommitted work before
      deciding whether to resume, extract, or redo.
