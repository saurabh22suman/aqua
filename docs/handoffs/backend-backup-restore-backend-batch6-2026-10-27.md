# Backend batch 6 — disposable backup/restore drill (B6)

**Date:** 27 October 2026
**Branch:** `feat/disposable-backup-restore-drill-b6`
**Base:** `d692fd322ca8aa369e23ee0b6056130e57aee298` (`d692fd3`, merge of
`integration/sportsip-batch4`)
**Worktree:** `/home/soloengine/thedutchrabbit/aqua-worktrees/backend-backup-restore`
**Working tree at handoff:** 4 untracked paths, no modified tracked file
(`git status --short` → `?? docs/backend/`, `?? scripts/lib/disposable-restore/`,
`?? scripts/verify-disposable-restore.ts`, `?? tests/backend-b6/`)

**No commit, push, PR, merge, label, deployment or external-service change was
made.** The deliverable is a reviewable local diff plus the evidence below.

---

## 1. Objective

Give this repository repeatable, executable proof that a
`pg_dump` custom-format backup taken from a PostgreSQL 16 database
**restores into a separate PostgreSQL 16 database and is usable
afterwards**.

Before this batch the only backup tests
(`tests/db/db-backup.test.ts`) asserted key naming, retention selection
and the five-byte `PGDMP` header. A header check cannot tell a good
archive from one truncated at 90% — both start with `PGDMP`. So a
successful upload did not prove a usable backup, and there was no
artefact in the repository that demonstrated recoverability at all.

## 2. What was built

A **local-only restore drill** plus the tests that make it credible.

```
source container                      destination container
(roles → 111 migrations)              (roles ONLY — never migrated)
+ synthetic two-tenant data
       │  pg_dump --format=custom --no-owner --no-privileges
       ▼
  archive bytes (binary, in memory)
       │  pg_restore --list        ← is the archive even readable?
       ▼
       │  bootstrap roles on the destination
       │  pg_restore --no-owner --no-privileges
       │  re-apply the destination's own grants
       ▼
  verification → 10 checks
```

The destination is **never migrated**: if the schema is present after
the restore, it arrived with the archive.

The dump uses the same flags as the production CLI
(`scripts/db-backup.ts`): `--format=custom --no-owner --no-privileges`.

Runbook: `docs/backend/disposable-restore-drill.md`.

## 3. Findings

| # | Finding | Consequence |
| --- | --- | --- |
| F1 | The existing `assertDumpLooksValid` only checks the `PGDMP` magic. A truncated archive passes it. | The drill asks `pg_restore --list` — the tool that will actually restore — and treats a nonzero exit or an entry-less listing as "not restorable". `pg_restore --list` on a truncated archive fails with `could not read from input file: end of file`. |
| F2 | `pg_dump` in PostgreSQL 16 compresses the custom archive by default (`Compression: gzip`). | The archive is captured as raw `Buffer` bytes end to end. Decoding it as text would corrupt it; `docker.ts` uses `encoding: "buffer"` for exactly this path. |
| F3 | The official `postgres:16` image trusts the **local socket** (`local all all trust`) and also `host … 127.0.0.1/32 trust`. | `pg_dump`/`pg_restore` connect over the container's local socket with `-U aqua`, so **no password is ever an argument to a dump tool**. No credential appears in a process list. |
| F4 | A dump taken with `--no-privileges` carries **no GRANTs**. Restoring it and stopping there would leave the application role with no access to the restored tables. | The drill re-applies the target's own grant policy after the restore (`bootstrapRoles` + `reconcileAppPrivileges`, the `db/deploy.ts` order) and then **proves** the grants, the append-only restrictions and the RLS state. |
| F5 | `pg_dump --format=custom --no-owner --no-privileges` **does** carry RLS enablement, `FORCE ROW LEVEL SECURITY` and the policies themselves. | The drill verifies all three on the restored database, using the runbook's own query from `docs/deployment.md`. |
| F6 | `pg_restore` is **not** idempotent: a second restore over a populated database fails with `already exists` (1140 ignored errors). | This is the mechanical guarantee that the drill never overwrites an existing database, and it is asserted as a test. |
| F7 | The drill's own first version leaked both containers when it failed, because cleanup was skipped on the error path. | Found by the first integration run (a seed bug, not the cleanup bug) and fixed: **a failed drill always removes its containers**, even under `--preserve`. |

## 4. Threat and trust boundaries

The drill is the only thing in this repository that can overwrite a
database, so it is built to be unable to do that by accident.

| Boundary | Control | Where it is asserted |
| --- | --- | --- |
| **Who chooses the target** | There is no `--target-url`, `--destination`, `--source`, `--restore-to`, `--database-url` or positional argument. All are refused **by name**; unknown flags are refused rather than ignored. | `cli.test.ts` (7 cases) |
| **What a target may be called** | A closed namespace: `aqua-drill-<12 lowercase hex>`. The hex alphabet cannot spell "prod", "live", "stage" or "dev", so a minted identity can never collide with a real environment's name. An identity containing one of those words is refused with the word named. | `target.test.ts` (8 cases) |
| **Where the target lives** | Loopback only (`127.0.0.1`, `::1`, `localhost`). A remote or LAN host is refused. | `target.test.ts` (4 cases) |
| **Source vs. destination** | Same identity, same container or same connection string is refused: restoring a database over itself destroys the only copy of the data under verification. | `target.test.ts` (3 cases), `negative-cases.integration.test.ts` (1 case) |
| **Port selection** | Docker assigns the host port (`--publish 127.0.0.1::5432`). The drill never picks a port, so it cannot collide with the harness DB, the dev DB or another agent's container. | `containers.test.ts` (1 case) |
| **Cleanup scope** | Exactly one container, by name, after `assertOwnedContainerName()` confirms the name is inside the drill namespace. No prune, no remove-all, no "tidy up old drill containers". | `containers.test.ts` (4 cases) |
| **Credential disclosure** | Dump tools connect over the local socket — no password in any argv. Tool output passes through `redactToolOutput()` (strips connection-string passwords and `PASSWORD=` assignments) before printing. The report names containers, ports and counts only. | `archive.test.ts` (3 cases), `cli.test.ts` (2 cases), `containers.test.ts` (1 case) |
| **External services** | No R2, no WhatsApp, no paid provider, no network call of any kind. The drill needs no R2 credential to run. | by construction; documented |
| **Data in the output** | Synthetic only: generated names, generated phone numbers, generated member codes. No customer data, no real PII. | `seed.ts`; the report prints only synthetic ids and counts |
| **Scope of the fixture write** | The fixture is written through the **privileged** connection because `tenants` and every tenant table are under `FORCE ROW LEVEL SECURITY` — fixture setup, exactly like `tests/tier1/isolation.test.ts`. It is never a request path. | `seed.ts`; `verify.ts` uses the same privileged connection only for introspection |

### No privileged-scanner weakening

- `tests/tier1/**` — **not edited**. Read-only run: 185 tests green
  (`no-superuser-on-request-path`, `agent-protected-paths`,
  `isolation`, plus `ci-required-gate`).
- The new test files **never contain the literal `MIGRATION_DATABASE_URL`**
  (verified by grep). That is deliberate: `tests/tier1/no-superuser-on-request-path.test.ts`
  allowlists `tests/db/`, `tests/migrations/`, `tests/auth/` and named
  files, but **not** `tests/backend-b6/`. Referencing the privileged env
  var from the new directory would have tripped that scanner. The drill
  instead uses the **container superuser URI it just created**, so no
  allowlist entry is needed and no protected helper had to change.
- `pnpm check:scripts-exist` passes. The new CLI is **not** added to
  `package.json` — `check:scripts-exist` requires every `check:`/`e2e:`
  package script to be wired into `ci.yml`, and `package.json` /
  `.github/workflows/ci.yml` are read-only for this batch. The script is
  invoked directly with `pnpm exec tsx` (see the runbook). A
  `package.json` + `ci.yml` entry is a **request** in §8, not a
  unilateral edit.
- `pnpm check:migrations`, `pnpm check:tenant-conventions`,
  `pnpm check:location-scope` all pass. No migration, schema or policy
  change was made.

## 5. Exact files changed

All new. No tracked file was modified.

```
docs/backend/disposable-restore-drill.md                     (new, runbook)
docs/handoffs/backend-batch6-2026-10-27.md                   (new, this file)

scripts/verify-disposable-restore.ts                         (new, CLI entry point)
scripts/lib/disposable-restore/target.ts                    (new, trust boundary — pure)
scripts/lib/disposable-restore/archive.ts                   (new, restorability — pure)
scripts/lib/disposable-restore/containers.ts                (new, container commands — pure)
scripts/lib/disposable-restore/docker.ts                    (new, binary-safe docker wrapper)
scripts/lib/disposable-restore/lifecycle.ts                 (new, create/wait/remove)
scripts/lib/disposable-restore/provision.ts                 (new, roles + migrations + grants)
scripts/lib/disposable-restore/seed.ts                      (new, synthetic fixture)
scripts/lib/disposable-restore/records.ts                   (new, record reading/comparison)
scripts/lib/disposable-restore/privileges.ts                (new, grants + RLS + role attributes)
scripts/lib/disposable-restore/isolation.ts                 (new, tenant isolation probe)
scripts/lib/disposable-restore/verify.ts                    (new, orchestration)
scripts/lib/disposable-restore/drill.ts                     (new, orchestration)
scripts/lib/disposable-restore/cli.ts                       (new, argument parsing + report)

tests/backend-b6/backup-restore/target.test.ts                        (new, 25 tests)
tests/backend-b6/backup-restore/archive.test.ts                       (new, 14 tests)
tests/backend-b6/backup-restore/containers.test.ts                    (new, 21 tests)
tests/backend-b6/backup-restore/cli.test.ts                           (new, 13 tests)
tests/backend-b6/backup-restore/round-trip.integration.test.ts        (new, 24 tests)
tests/backend-b6/backup-restore/negative-cases.integration.test.ts    (new, 7 tests)
```

## 6. RED → GREEN evidence

Method per `docs/engineering-standard.md`: the test was written and run
against a **first-cut implementation**; the failure recorded is the
*intended assertion*, not an import or setup error.

### Cycle 1 — the trust boundary (`target.ts`)

First run was an import error (`Cannot find package
'@/scripts/lib/disposable-restore/target'`) — **not counted as RED**.
A first-cut module that accepts everything was then written, and the
test was re-run.

```
$ pnpm exec vitest run tests/backend-b6/backup-restore/target.test.ts
 Test Files  1 failed (1)
      Tests  18 failed | 6 passed (24)
```

Intended assertions, e.g.:

```
FAIL  target.test.ts > assertDisposableIdentity > rejects a live/production identity
AssertionError: expected [Function] to throw an error
FAIL  target.test.ts > redactConnectionUri > removes the password from a connection string
AssertionError: expected 'postgresql://aqua:hunter2@127.0.0.1:4…' not to contain 'hunter2'
```

GREEN after implementation:

```
$ pnpm exec vitest run tests/backend-b6/backup-restore/target.test.ts
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

(One test was added during the cycle — the "same database, two names"
negative case — raising 24 → 25.)

### Cycle 2 — restorability decisions (`archive.ts`)

```
$ pnpm exec vitest run tests/backend-b6/backup-restore/archive.test.ts
 Test Files  1 failed (1)
      Tests  8 failed | 6 passed (14)
```

```
FAIL  archive.test.ts > interpretArchiveListing > rejects an archive pg_restore could not read
AssertionError: expected false to be true // Object.is equality
FAIL  archive.test.ts > redactToolOutput > removes a password= assignment
AssertionError: expected 'PGPASSWORD=hunter2 pg_dump failed' not to contain 'hunter2'
```

GREEN: `Tests 14 passed (14)`.

### Cycle 3 — container lifecycle (`containers.ts`)

**Process note, recorded honestly:** for this cycle the implementation
was written *before* the first test run. That is test-after, not TDD, and
it is not presented as such. The implementation was then replaced by the
naive first cut a developer would plausibly write — a fixed host port
`127.0.0.1:55433`, no labels, an unguarded `docker rm --force`, a
`docker ps -a` listing everything — and the test was re-run to obtain a
genuine intended-assertion RED before the real implementation was
re-applied.

```
$ pnpm exec vitest run tests/backend-b6/backup-restore/containers.test.ts
 Test Files  1 failed (1)
      Tests  9 failed | 12 passed (21)
```

```
FAIL  containers.test.ts > buildRunArgs > lets Docker assign the host port instead of picking one
AssertionError: expected [ 'run', '--detach', '--name', …(10) ] to include '127.0.0.1::5432'
FAIL  containers.test.ts > assertOwnedContainerName > rejects a container outside the drill namespace
AssertionError: expected [Function] to throw an error
FAIL  containers.test.ts > buildRemoveArgs > refuses to build a removal for a container it does not own
AssertionError: expected [Function] to throw an error
```

GREEN: `Tests 21 passed (21)`.

### Cycle 4 — the round trip (`round-trip.integration.test.ts`)

**Process note, recorded honestly:** as with cycle 3, the implementation
existed before the first test run. The RED below was therefore obtained
by **mutating the implementation into the failure it must detect** —
the drill's `restoreArchive` call was commented out and the
verification result was no longer enforced — and re-running:

```
$ pnpm exec vitest run tests/backend-b6/backup-restore/round-trip.integration.test.ts
 Test Files  1 failed (1)
      Tests  10 failed | 14 passed (24)
```

```
FAIL  round-trip.integration.test.ts > … > restored every applied migration
AssertionError: expected 0 to be greater than 100
FAIL  round-trip.integration.test.ts > … > restored the exact synthetic records
AssertionError: expected [] to have a length of 2 but got +0
FAIL  round-trip.integration.test.ts > … > restored money as exact bigint paise
AssertionError: expected false to be true // Object.is equality
FAIL  round-trip.integration.test.ts > … > kept the two synthetic tenants isolated in the restored database
AssertionError: expected [] to have a length of 2 but got +0
FAIL  round-trip.integration.test.ts > the restored database, queried directly > holds both synthetic members
Error: relation "members" does not exist
```

This is the RED that matters: it shows the test detects a drill that
does not restore, using assertions on **real data** in the restored
database, not on the drill's own summary.

GREEN with the implementation restored:

```
$ pnpm exec vitest run tests/backend-b6/backup-restore/round-trip.integration.test.ts
 Test Files  1 passed (1)
      Tests  24 passed (24)
```

### Cycle 5 — the command line (`cli.ts`)

```
$ pnpm exec vitest run tests/backend-b6/backup-restore/cli.test.ts
 Test Files  1 failed (1)
      Tests  12 failed | 1 passed (13)
```

```
FAIL  cli.test.ts > parseCliArgs > refuses a target URL flag
AssertionError: --target-url: expected 'run' to be 'error' // Object.is equality
FAIL  cli.test.ts > parseCliArgs > refuses a positional connection string
AssertionError: expected 'run' to be 'error' // Object.is equality
FAIL  cli.test.ts > formatDrillReport > never prints a credential
AssertionError: expected 'postgresql://app_login:s3cr3t@127.0.0.1:4…' not to contain 's3cr3t'
```

GREEN: `Tests 13 passed (13)`.

### Cycle 6 — the negative cases

These were written after the drill existed, and they **found three real
bugs**, which were fixed:

1. A supplied (injected) archive skipped the byte-shape check, so an
   empty or non-archive archive was not refused before the restore.
   Fixed in `drill.ts` (`assertDumpBytesLookValid` on the supplied path).
2. The "second restore must fail" test provisioned the destination with
   migrations, so the *first* restore already failed. Fixed by
   provisioning the destination with **roles only**, as the real drill
   does.
3. A failed drill leaked both containers. Fixed: a failed drill always
   removes what it created.

```
$ pnpm exec vitest run tests/backend-b6/backup-restore/negative-cases.integration.test.ts
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

### Final GREEN — the whole batch

```
$ pnpm exec vitest run tests/backend-b6/backup-restore/
 Test Files  6 passed (6)
      Tests  104 passed (104)
```

Per file:

| File | Tests |
| --- | --- |
| `target.test.ts` | 25 passed |
| `archive.test.ts` | 14 passed |
| `containers.test.ts` | 21 passed |
| `cli.test.ts` | 13 passed |
| `round-trip.integration.test.ts` | 24 passed |
| `negative-cases.integration.test.ts` | 7 passed |

### The CLI, run for real

```
$ pnpm exec tsx scripts/verify-disposable-restore.ts
… Creating the disposable source container...
… Creating the disposable destination container...
… Provisioning the source database (roles, then migrations)...
111 migration(s) applied, 111/111 total.
… Seeding the synthetic two-tenant fixture...
… Taking the custom-format dump...
… Dump captured: 695278 bytes.
… Checking the archive is readable (pg_restore --list)...
… Bootstrapping the application roles on the restore target...
… Restoring the archive into the destination...
… Re-applying the target's own grants...
… Verifying the restored database...
… Removing the disposable containers...
Disposable backup/restore drill — PASSED

  Source container       aqua-drill-20a75d166830-source (127.0.0.1:32814/aqua_drill)
  Destination container  aqua-drill-1ddf96326105-destination (127.0.0.1:32815/aqua_drill)
  Dump size              695278 bytes (custom format, pg_restore --list readable)
  Migrations restored    111 of 111
  Records identical      yes (2 synthetic tenants)
  Money exact            yes (118000 paise)
  Application grants     complete
  RLS enabled + forced   yes
  Role attributes        app_user/app_login are neither superuser nor BYPASSRLS
  Tenant isolation       tenant … sees 1 of its own members, 0 of the other tenant's; …
  Append-only tables     still append-only

  Containers removed      2 created by this drill
$ echo $?
0
```

```
$ pnpm exec tsx scripts/verify-disposable-restore.ts --target-url "postgresql://aqua:s3cr3t@prod.internal:5432/aqua"
The disposable restore drill has no restore-to-an-arbitrary-target mode: it creates its own two throwaway databases and restores into one of them. Refusing "--target-url".
$ echo $?
1
```

`--json` mode was also run: exit 0, machine-readable, **no credential
in the output**.

### Refactor evidence

`verify.ts` had grown to 576 lines, past the 300-line guideline in
`CLAUDE.md`. It was split along its responsibilities — one module per
reason to change — with the tests green throughout:

| Before | After |
| --- | --- |
| `verify.ts` (576 lines) | `verify.ts` (214) — orchestration and the problem list |
| | `records.ts` (236) — reading and comparing the synthetic rows |
| | `privileges.ts` (127) — grants, append-only, RLS, role attributes |
| | `isolation.ts` (77) — the tenant isolation probe |

Re-run after the split:

```
$ pnpm exec vitest run tests/backend-b6/backup-restore/
 Test Files  6 passed (6)
      Tests  104 passed (104)
$ pnpm typecheck
$ pnpm lint
```

Every new module is now under 300 lines. `pnpm check:lines` (report-only,
not a CI gate) is unaffected — it scans `app/ lib/ db/ components/`, not
`scripts/`.

### Static checks

```
$ pnpm typecheck                                    # clean
$ pnpm lint                                         # clean, 0 warnings
$ pnpm check:scripts-exist                          # OK
$ pnpm check:migrations                             # Migration naming check passed (111 files).
$ pnpm check:tenant-conventions                     # 43 new migration(s) conform.
$ pnpm check:location-scope                         # enforcement or an allowlisted reason on every one of the 135 service files.
$ pnpm exec vitest run tests/tier1/no-superuser-on-request-path.test.ts \
    tests/tier1/agent-protected-paths.test.ts \
    tests/tier1/isolation.test.ts tests/ci-required-gate.test.ts
 Test Files  4 passed (4)
      Tests  185 passed (185)
```

**Not run by this batch:** the full release gate (`pnpm test:sharded`,
`pnpm build`, `pnpm check:bundle`, `pnpm check:fonts`). Per the
assignment, the coordinator runs the combined full gate; this batch
adds no dependency, no schema and no build output, and `pnpm build`
would contend for `.next` with other writers.

## 7. Negative and security cases exercised

| Case | Expected | Where |
| --- | --- | --- |
| Identity naming a production/staging/live/development database | refused, word named | `target.test.ts` |
| Identity that is a connection string | refused, value never echoed | `target.test.ts` |
| Identity that only resembles a drill identity (wrong case, wrong length, prefixed) | refused | `target.test.ts` |
| Empty identity | refused | `target.test.ts` |
| Remote host / LAN address / empty host | refused | `target.test.ts` |
| Source and destination are the same database (by identity, container or URI) | refused | `target.test.ts`, `negative-cases.integration.test.ts` |
| Container name outside the drill namespace | refused by the removal helper | `containers.test.ts` |
| Cleanup command could ever be a prune or a remove-all | asserted impossible | `containers.test.ts` |
| Host port hard-coded rather than Docker-assigned | asserted impossible | `containers.test.ts` |
| Password present in a dump tool's argv | asserted impossible | `containers.test.ts` |
| Empty dump | refused | `archive.test.ts`, `negative-cases.integration.test.ts` |
| Bytes that are not a custom-format archive | refused | `archive.test.ts`, `negative-cases.integration.test.ts` |
| Archive `pg_restore` cannot read (truncated) | refused, tool reason carried | `archive.test.ts`, `negative-cases.integration.test.ts` |
| Archive listing with no entries | refused | `archive.test.ts` |
| Archive not in custom format | refused | `archive.test.ts` |
| Tool output containing a connection string / `PASSWORD=` | credential stripped | `archive.test.ts` |
| Drill report or JSON containing a password | asserted absent | `cli.test.ts` |
| CLI given a target-URL flag | refused by name, exit 1 | `cli.test.ts`, CLI run above |
| CLI given a positional connection string or host | refused, value never echoed | `cli.test.ts` |
| CLI given an unknown flag | refused, not ignored | `cli.test.ts` |
| Corrupt archive through the real drill | drill fails, **and removes both containers** | `negative-cases.integration.test.ts` |
| Empty archive through the real drill | drill fails, containers removed | `negative-cases.integration.test.ts` |
| Non-archive bytes through the real drill | drill fails, containers removed | `negative-cases.integration.test.ts` |
| Second restore over a populated database | `pg_restore` fails, existing data intact | `negative-cases.integration.test.ts` |
| Drill run leaves no container behind | container list unchanged | `negative-cases.integration.test.ts` |
| Restored `app_user` is superuser or BYPASSRLS | asserted false | `round-trip.integration.test.ts` |
| Restored tenant tables without RLS / without FORCE | asserted none | `round-trip.integration.test.ts` |
| Restored append-only tables writable by `app_user` | asserted none | `round-trip.integration.test.ts` |
| A tenant seeing the other tenant's member after the restore | asserted zero | `round-trip.integration.test.ts` |
| A session with no tenant scope seeing rows | asserted zero | `round-trip.integration.test.ts` |

## 8. Remaining failures and requests

**No failures outstanding in this batch's scope.** Every check in §6 and
§7 is green.

Requests for the coordinator (each needs an owner other than this
batch; none was actioned unilaterally):

1. **`package.json` + `.github/workflows/ci.yml`** — add a script entry
   for the drill. `scripts/check-scripts-exist.ts` requires every
   `check:`/`e2e:` package script to be wired into `ci.yml`, so the
   entry must land in both files together, and both are read-only for
   this batch. Suggested shape: `"db:verify-restore": "tsx scripts/verify-disposable-restore.ts"`
   (the `db:` prefix is deliberately excluded from the must-be-wired
   list, so it needs no `ci.yml` change) **or** a `check:` entry wired
   into `ci.yml`. The integration tests need Docker and two containers,
   so a CI lane is a capacity decision, not a correctness one.
2. **`docs/deployment.md` §"Backups and restore"** — one pointer to
   `docs/backend/disposable-restore-drill.md`, so an operator running
   the production drill finds the local prerequisite. The runbook
   currently says a local drill "does not complete this gate"; that
   statement remains true and must not be weakened.
3. **CI capacity** — the round-trip test creates two PostgreSQL 16
   containers and runs 111 migrations; it takes ~21 s and needs Docker
   with the `postgres:16` image available.

**No protected-helper change was needed.** The privileged-scanner
allowlist in `tests/tier1/no-superuser-on-request-path.test.ts` was
**not** touched: the new test directory avoids the literal
`MIGRATION_DATABASE_URL` and uses the container superuser URI it
creates itself. If a future change makes the new tests need the
ambient privileged env var, that directory would have to be added to
the allowlist — a protected change requiring the human.

## 9. Owned resources and reproduction

### Owned resources (this session)

| Resource | Identity | Status |
| --- | --- | --- |
| Disposable test Postgres | container `aqua-harness-test-fc0ee15a2c`, `127.0.0.1:55463→5432`, label `aqua.harness=disposable` | **Running**, owned by this worktree. Profile `.env.aqua-harness-test.local` (mode 0600, git-ignored). Created by `harness.py prepare-test --port 55463`. |
| Drill containers | names `aqua-drill-<12 hex>-{source,destination}`, label `aqua.drill=b6` | **None left running.** Every drill run removes exactly what it created; the failed run's leak was removed and the cleanup path fixed. |
| Web port 3133 | — | **Not used.** This batch runs no server. |
| Next build / dev server | — | **None.** No build was run. |
| Background processes | — | **None.** Every drill run is a foreground process that exits; no dev server, no worker, no watcher was left running. |

No process owned by another agent was stopped, inspected destructively
or reset. No database other than this worktree's own disposable profile
was written to. The host also carries other worktrees' harness
databases (`aqua-harness-test-*`); none of them was created, stopped,
removed or written to by this batch.

### Reproduction

```sh
cd /home/soloengine/thedutchrabbit/aqua-worktrees/backend-backup-restore

# 1. the disposable test profile (already prepared; idempotent)
python3 .opencode/scripts/harness.py prepare-test --port 55463

# 2. the drill, as a test
set -a && . ./.env.aqua-harness-test.local && set +a
pnpm exec vitest run tests/backend-b6/backup-restore/

# 3. the drill, as a CLI
pnpm exec tsx scripts/verify-disposable-restore.ts
pnpm exec tsx scripts/verify-disposable-restore.ts --json
pnpm exec tsx scripts/verify-disposable-restore.ts --preserve   # keeps the containers

# 4. static checks
pnpm typecheck && pnpm lint
pnpm check:scripts-exist && pnpm check:migrations
pnpm exec vitest run tests/tier1/no-superuser-on-request-path.test.ts \
  tests/tier1/agent-protected-paths.test.ts tests/tier1/isolation.test.ts

# 5. confirm nothing was left behind
docker ps -a --filter label=aqua.drill=b6 --format '{{.Names}}'   # expect empty
```

Requirements: Docker with the `postgres:16` image, Node 22, pnpm
11.22.0. The drill drives the `docker` CLI and assumes a POSIX shell.

## 10. What was NOT tested

Stated explicitly, because the runbook in `docs/deployment.md` is the
real gate and this batch does not replace it.

- **No real R2 object was uploaded, downloaded or restored.** No R2
  credential was used; the archive moved in memory. The upload half
  remains the `FakeObjectStore` tests' subject.
- **No Staging or Production backup was restored.** The source was a
  freshly migrated database with a synthetic fixture, not a club's live
  data. The RLS, grants and isolation findings are properties of the
  **schema and the restore**, not of any customer's rows.
- **`scripts/db-backup.ts` was not executed end to end.** It is
  read-only for this batch. The drill reproduces its dump flags
  (`--format=custom --no-owner --no-privileges`) but does not run the
  CLI, so the upload/retention path is still covered only by
  `tests/db/db-backup.test.ts`.
- **The `pg-boss` schema was not restored.** `pg-boss` owns its schema
  outside `db/migrations` (`db/deploy.ts`); the drill does not start
  it, and the target creates it through `db:deploy` — the documented
  deploy order.
- **Restore time at scale.** A ~695 KB archive of a two-tenant fixture
  says nothing about a multi-gigabyte club database.
- **The application was not started against a restored database.** No
  Next dev server, no worker, no HTTP request. The isolation probe
  reproduces `withTenant()`'s exact mechanism (`set role app_user` plus
  a transaction-scoped `app.tenant_id`) in SQL; it does not exercise
  `db/tenant.ts` itself, because the drill may point at either side of
  the round trip and the ambient `DATABASE_URL` is process-wide.
- **No browser, UI or visual check.** Out of scope by assignment.
- **The full release gate was not run** (`pnpm test:sharded`,
  `pnpm build`, `pnpm check:bundle`, `pnpm check:fonts`) — the
  coordinator runs the combined gate. This batch adds no dependency, no
  schema, no migration and no build output.
- **Non-POSIX platforms.** The drill shells out to the `docker` CLI.

## 11. Status

**No certification, shipping or deployment claim is made.** This batch
provides a reproducible local prerequisite for the production restore
drill. The production gate in `docs/deployment.md` still requires a
human to run it by hand against a real uploaded dump; the statement in
that runbook that "a local `--dry-run`, fake object store or successful
dump into a local throwaway DB does not complete this gate" remains
true and is not weakened by this work.

Scope complete. Stopping here.
