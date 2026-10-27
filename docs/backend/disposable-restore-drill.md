# Disposable backup/restore drill (B6)

What this is: a **repeatable, local, credential-free** proof that a
`pg_dump` custom-format backup taken from a PostgreSQL 16 database
restores into a **separate** PostgreSQL 16 database and is usable
afterwards.

What this is **not**: the production restore drill. That one, in
`docs/deployment.md` §"Backups and restore", restores a real R2 object
into a throwaway PostgreSQL 16 and checks it by hand. This drill is the
reproducible local prerequisite for it — the part that can run on a
developer's machine, in CI, or on a laptop with no R2 credentials, every
time, and that proves the *backup and restore chain itself* works.

> An untested backup is not a backup (`docs/architecture.md` §9). A
> successful upload is not a usable backup either. This drill proves the
> second half.

---

## Running it

```sh
pnpm exec tsx scripts/verify-disposable-restore.ts            # text report
pnpm exec tsx scripts/verify-disposable-restore.ts --json     # machine-readable
pnpm exec tsx scripts/verify-disposable-restore.ts --preserve # keep the containers
```

Exit code `0` means the restored database passed every check. Exit code
`1` means the drill failed **and removed every container it created**.

Expected output (shape, not exact values):

```
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
```

### As a test

```sh
pnpm exec vitest run tests/backend-b6/backup-restore/
```

Six files, ~110 assertions, about seven seconds:

| File | What it covers |
| --- | --- |
| `target.test.ts` | The trust boundary: which targets are refused |
| `archive.test.ts` | Deciding whether a dump is restorable; credential redaction |
| `containers.test.ts` | How containers are created and removed; auto-assigned ports |
| `cli.test.ts` | The command line; the report carries no credential |
| `round-trip.integration.test.ts` | The real round trip, verified twice over |
| `negative-cases.integration.test.ts` | Corrupt archive, empty archive, no overwrite |

The integration tests need Docker and create their own containers on
ports Docker assigns. They never touch the harness database, the dev
database, or any other agent's container.

---

## What the drill actually does

```
 source container                     destination container
 (roles → 111 migrations)             (roles ONLY — never migrated)
 + synthetic two-tenant data
        │
        │  pg_dump --format=custom --no-owner --no-privileges
        ▼
   archive bytes (binary, in memory)
        │
        │  pg_restore --list        ← is the archive even readable?
        ▼
        │  bootstrap roles on the destination
        │  pg_restore --no-owner --no-privileges
        │  re-apply the destination's own grants
        ▼
   verification
```

The destination is **never migrated**. If the schema is there after the
restore, it arrived with the archive — which is the whole point.

The dump uses the same flags as the production backup CLI
(`scripts/db-backup.ts`): `--format=custom --no-owner --no-privileges`.
`--no-privileges` means the archive carries no GRANTs, so the
destination's own grant policy decides who can read the restored data.
The drill re-applies that policy and then **proves** it.

### The checks

| # | Check | How it fails |
| --- | --- | --- |
| 1 | The archive is readable | `pg_restore --list` must succeed and list entries in `Format: CUSTOM` |
| 2 | Every applied migration came back | The `_migrations` sets of source and destination must match |
| 3 | The exact records came back | Every synthetic row is compared field by field, source vs. destination |
| 4 | Money came back as exact paise | `118000` paise in, `118000` paise out — bigint, never a float |
| 5 | The application role can use it | `has_table_privilege('app_user', …)` on every tenant table |
| 6 | Append-only is still append-only | `app_user` must not hold UPDATE/DELETE on `audit_log`, `activity_events`, `announcements`, `account_entries` |
| 7 | RLS is enabled **and forced** | The runbook's own query, over every table with a `tenant_id` |
| 8 | The app role is not privileged | `rolsuper` and `rolbypassrls` must be false for `app_user` and `app_login` |
| 9 | Two tenants stay isolated | Over the application role, with `app.tenant_id` set, each tenant sees exactly its own member |
| 10 | No scope sees anything | A session with no tenant scope sees zero rows |

### The synthetic fixture

Two tenants, in one disposable database, with nothing that belongs to a
real club: generated names, generated phone numbers, generated member
codes, and money in exact bigint paise (`100000` subtotal + `18000`
tax = `118000` total, paid in full by a `upi` payment).

Two tenants rather than one, because the interesting property of a
restored database is not "the rows came back" — it is "the rows came
back **and** the other tenant's rows are still invisible".

---

## The trust boundary

The drill is the only thing in this repository that can overwrite a
database, so it is built to be unable to do that by accident.

**A restore target is only ever a database this run created.**
There is no `--target-url`, no `--destination`, no positional database
argument. `parseCliArgs` refuses `--target-url`, `--destination-url`,
`--source-url`, `--target`, `--destination`, `--source`, `--restore-to`,
`--database-url`, `--pg-url` and `--connection-string` by name, and
refuses any positional argument at all. It refuses unknown flags
rather than ignoring them, so "the flag did nothing" is never mistaken
for "the flag was honoured".

**Target identity is a closed namespace.** Every target carries an
identity of the form `aqua-drill-<12 lowercase hex>`. The hex alphabet
cannot spell "prod", "live", "stage" or "dev", so a minted identity can
never collide with a name that reads like a real environment. An
identity containing one of those words is refused with the word named.

**Everything is on loopback.** The host must be `127.0.0.1`, `::1` or
`localhost`. The drill's containers publish on `127.0.0.1` and Docker
assigns the host port, so the drill never picks a port and can never
collide with the harness database, the dev database or another agent's
container.

**Source and destination must differ.** Same identity, same container
or same connection string is refused: restoring a database over itself
destroys the only copy of the data being verified.

**Cleanup is narrow.** The drill removes exactly the containers it
created, by name, after checking the name is inside the drill
namespace. There is no prune, no remove-all, no "tidy up stale drill
containers". A failed drill removes its containers even under
`--preserve`; a leaked Postgres instance on a published port is worse
than a lost debug session.

**No credentials anywhere.** The dump and restore tools connect over the
container's local socket, so no password is ever an argument to
`pg_dump` or `pg_restore`. Tool output is passed through
`redactToolOutput()` — which strips connection-string passwords and
`PASSWORD=` assignments — before anything is printed. The report names
containers, ports and counts; never a password.

**No external calls.** The drill never touches R2, WhatsApp, or any
paid provider. It uses no R2 credentials, so it can run on a machine
that has none. The `FakeObjectStore` in `tests/helpers/` remains the
right tool for testing the upload half; this drill covers the restore
half.

---

## Why the existing tests were not enough

`tests/db/db-backup.test.ts` covers the key naming, the retention
selection and the `PGDMP` header check. Those are real properties and
they stay. But a header check cannot tell a good archive from one
truncated at 90%: both start with `PGDMP`. So the drill asks the tool
that will actually do the restore — `pg_restore --list` — and a
truncated archive fails there with "end of file". That is the check
that closes the gap between "the upload succeeded" and "there is
something to restore".

---

## What this does NOT prove

- **That a real R2 object restores.** No R2 credential is used and no
  object is uploaded or downloaded. The archive moves in memory.
- **That a Staging or Production backup is good.** The source here is
  a freshly migrated database with a synthetic fixture, not a club's
  live data.
- **That `scripts/db-backup.ts` itself is correct end to end.** The
  drill reproduces its dump flags; the upload path is still the
  `FakeObjectStore` tests' subject.
- **Anything about restore time at scale.** A 695 KB archive of a
  two-tenant fixture says nothing about a multi-gigabyte club database.
- **That `pg-boss`'s schema is restorable.** `pg-boss` owns its own
  schema outside `db/migrations` (see `db/deploy.ts`), and the drill
  does not start it. The `pgboss` schema is created by `db:deploy` on
  the target, which is the documented deploy order.
- **Windows/other platforms.** The drill drives the `docker` CLI and
  assumes a POSIX shell.

The production gate in `docs/deployment.md` still has to be run by a
human, by hand, against a real uploaded dump. This drill does not
replace it, and the runbook says so.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `docker` not found | The drill shells out to the `docker` CLI. Install Docker and make sure the daemon is running. |
| `Could not read the published container port` | Docker did not publish the port. Check `docker ps -a --filter label=aqua.drill=b6`. |
| `The disposable … container did not become ready` | The image could not start. `docker logs <container name>` shows why. |
| `pg_restore failed … already exists` | The destination was not empty. The drill never migrates the destination; if you changed that, restore conflicts are the symptom. |
| `relation "…" does not exist` in the verification | The restore did not happen, or failed silently. Check that `restoreArchive` ran before verification. |

Containers carrying the drill label can be listed (and only those —
never with a prune) while a drill is running:

```sh
docker ps -a --filter label=aqua.drill=b6 --format '{{.Names}} {{.Status}}'
```

---

## Files

| Path | Purpose |
| --- | --- |
| `scripts/verify-disposable-restore.ts` | The CLI entry point |
| `scripts/lib/disposable-restore/target.ts` | Target identity and the trust boundary (pure) |
| `scripts/lib/disposable-restore/archive.ts` | Restorability decisions and credential redaction (pure) |
| `scripts/lib/disposable-restore/containers.ts` | Container command construction (pure) |
| `scripts/lib/disposable-restore/docker.ts` | The `docker` CLI wrapper (binary-safe) |
| `scripts/lib/disposable-restore/lifecycle.ts` | Container create / wait / remove |
| `scripts/lib/disposable-restore/provision.ts` | Roles, migrations and grant reconciliation |
| `scripts/lib/disposable-restore/seed.ts` | The synthetic two-tenant fixture |
| `scripts/lib/disposable-restore/verify.ts` | The checks |
| `scripts/lib/disposable-restore/drill.ts` | Orchestration |
| `scripts/lib/disposable-restore/cli.ts` | Argument parsing and reporting |
| `tests/backend-b6/backup-restore/` | The tests |
