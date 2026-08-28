# CI — reading the first real run

`.github/workflows/ci.yml` has never executed on actual GitHub Actions
infrastructure. Every step below has been run manually, locally, against
the exact same commands the workflow uses — but "works on this machine"
and "works on a GitHub-hosted runner" are different claims, and the two
places they're most likely to differ (the Postgres service, and
Testcontainers needing Docker) are called out explicitly, not glossed
over.

## Do you need a secret?

**No.** Nothing in the suite requires a real credential. The three
`env:` values (`DATABASE_URL`, `MIGRATION_DATABASE_URL`,
`APP_LOGIN_PASSWORD`) are fixed, non-secret strings that exist purely to
match the `postgres` service container defined in the same file — change
one, you must change the other, but neither needs to be a GitHub Actions
secret.

One more env var is set for a different reason: `BETTER_AUTH_SECRET` is
not read by anything in this codebase and nothing fails without it —
better-auth just logs `[Error [BetterAuthError]: You are using the
default secret...]` once per auth-touching operation when it's unset.
That's noise, not a failure (verified: build/tests pass identically with
or without it — the only difference is whether that line appears). It's
set to a labeled dummy value purely so a real failure doesn't have to be
found underneath a dozen copies of a message that looks like an error
but isn't.

If a future task adds something that genuinely needs a secret (a real
SMS/WhatsApp provider key for OTP delivery, say), it goes in
`Settings → Secrets and variables → Actions` on the repo and gets
referenced as `${{ secrets.NAME }}` — nothing does today.

## Two Postgres instances, on purpose

This is the decision the task asked for explicitly: **both are needed,
they are not redundant.**

- The `postgres` **service** (fixed `localhost:5432`, defined in
  `services:`) is the long-lived database every test file *except*
  `isolation.test.ts` uses, via `MIGRATION_DATABASE_URL`/`DATABASE_URL`.
  It's the CI equivalent of running `pnpm db:reset` against your local
  `docker-compose` Postgres before `pnpm test`.
- `tests/tier1/isolation.test.ts` alone spins up its **own** disposable
  Postgres via `@testcontainers/postgresql` (`tests/helpers/isolated-db.ts`),
  on a dynamically allocated port, thrown away when the test file
  finishes. It does this because its mutation proofs (`ISOLATION_MUTATE`)
  deliberately `DROP POLICY`/`ALTER TABLE ... NO FORCE ROW LEVEL SECURITY`
  against a live database — running that against the shared service
  Postgres would corrupt the schema every other test file in the same
  job depends on. Testcontainers needs nothing from this workflow beyond
  the Docker daemon: no `services:` entry, no `container:` job wrapper.
  GitHub-hosted `ubuntu-latest` runners ship Docker pre-installed and
  running as the runner user — this is documented GitHub behavior, not
  something configured in this repo, and it's the one piece of this
  workflow that could not be verified without GitHub infrastructure to
  run on.

Which test files touch which database, precisely:

| File | Shared `postgres` service | Own Testcontainers Postgres | Neither |
|---|---|---|---|
| `attendance-upsert.test.ts` | ✓ | | |
| `auth-context.test.ts` | ✓ | | |
| `membership-role-scope.test.ts` | ✓ | | |
| `platform-entitlements.test.ts` | ✓ | | |
| `roles-permissions.test.ts` | ✓ | | |
| `tenants-locations.test.ts` | ✓ | | |
| `user-scope.test.ts` | ✓ | | |
| `isolation.test.ts` | | ✓ | |
| `no-superuser-on-request-path.test.ts` | | | ✓ (greps source files) |
| `server-action-preamble.test.ts` | | | ✓ (reads the TS AST) |
| `timezone.test.ts` | | | ✓ (pure functions) |
| `env.test.ts` | | | ✓ (mocks `process.env`) |
| `scripts/e2e-offline.ts` | ✓ (fixture setup/verify) | | |

If `isolation.test.ts` is ever changed to use the shared service instead
of Testcontainers "to simplify CI," that's the isolation gate quietly
losing its clean-room guarantee — don't do that.

## The offline suite (S3) — what's automated and what isn't

All six VERIFY scenarios from the S3 offline-sync work run in CI, headless,
via `pnpm exec tsx scripts/e2e-offline.ts`. This is real protection, not a
restatement of "it worked on my machine" — the script disables the network
for real (Playwright's `context.setOffline()`, not throttling), creates its
own isolated batch/roster/session inside the demo-academy tenant so row-count
assertions are exact, and cleans up after itself whether it passes or throws.

All six were judged safe to automate. Five are effectively deterministic —
timing is controlled by explicit waits and polling (`waitForQueueDrain`),
not fixed sleeps hoping a network call lands in time. **VERIFY 5 (offline
mid-sync) is the one with genuine timing sensitivity**: it goes online for
400ms, then offline again, aiming to catch the queue with some entries
synced and some not. On a loaded runner, that window could land with
everything synced or nothing synced instead of a genuine split. This does
NOT weaken the test — its actual assertions (no duplicate rows, no missing
rows) are invariants that hold regardless of how many entries happened to
land in the window — but if VERIFY 5 is ever flaky in a way the others
aren't, this is why, and the fix is widening the window, not disabling the
scenario.

Two extra CI-only steps this requires, that nothing else in the workflow
needed before:

- `pnpm exec playwright install --with-deps chromium` — `pnpm install`
  only installs the `playwright` npm package, not an actual browser
  binary. `--with-deps` also installs the OS-level libraries Chromium
  needs that a bare `ubuntu-latest` image doesn't ship by default.
- `pnpm seed` — the offline fixture (`scripts/lib/offline-fixture.ts`)
  reuses the demo-academy tenant and the coach login user `pnpm seed`
  creates, exactly like local dev. Nothing offline-specific is bootstrapped
  separately.

If this step is red: reproduce with the exact same command locally first
(`pnpm seed && pnpm exec tsx scripts/e2e-offline.ts` against a freshly
reset local Postgres). If it's green locally and red in CI, the two most
likely differences are (a) the Chromium/OS-deps install genuinely failing
on the runner image — check that step's own log before assuming the test
itself is broken — or (b) VERIFY 5's timing window, per above.

## Every step, and what failure looks like

1. **`actions/checkout@v4`** — clones the repo at the triggering commit.
   Failure here means a GitHub-side problem or a bad ref, not something
   in this repo.

2. **`pnpm/action-setup@v4`** — installs pnpm. Reads the version from
   `package.json`'s `packageManager` field (`pnpm@11.22.0`, added
   specifically so this step doesn't depend on auto-detection with
   nothing to detect). If this fails, `packageManager` was removed or
   pnpm's action changed its detection behavior — check the action's
   current README against what's pinned here.

3. **`actions/setup-node@v4`** (node 22, `cache: pnpm`) — installs
   Node, restores the pnpm store cache keyed on `pnpm-lock.yaml`. First
   run has no cache to restore (slower, not a failure). Failure here is
   almost always a Node version genuinely unavailable on the runner
   image — unlikely for "22".

4. **`pnpm install --frozen-lockfile`** — fails loudly and correctly if
   `package.json` and `pnpm-lock.yaml` have drifted (someone edited one
   without running `pnpm install` locally first, or committed a
   dependency change without regenerating the lockfile). Verified clean
   locally right before this doc was written. Fix: run `pnpm install`
   locally, commit the regenerated lockfile.

5. **`pnpm typecheck`** (`tsc --noEmit`) / **`pnpm lint`** (`eslint .`)
   — both clean locally as of this commit. A failure here is a real
   type or lint error; there's no environment-specific reason either
   would behave differently in CI.

6. **`pnpm db:reset`** — drops and recreates the `public` schema,
   bootstraps `app_user`/`app_login`, runs all migrations, against the
   `postgres` service. **Most likely first-run failure point for the
   service Postgres**: if the service's health check hasn't actually
   gated this step (it should — GitHub Actions waits for
   `--health-cmd`/`--health-interval`/`--health-retries` to pass before
   running job steps against a service), this fails with a connection
   refused. Fix: increase `--health-retries`/`--health-interval` if the
   service is genuinely slow to start; this hasn't been observed
   locally (`postgres:16` is healthy within a few seconds every time
   `docker compose up` has been run this project).

7. **`pnpm test`** (`pretest` seeds the platform catalogue, then
   `vitest run`) — the big one. Two independent failure modes:
   - **Shared-service tests fail**: something about the `postgres`
     service differs from local `docker-compose.yml` (same image tag,
     same `POSTGRES_USER`/`PASSWORD`/`DB` — they should be identical,
     but double-check the service block hasn't drifted from
     `docker-compose.yml` if this fails).
   - **`isolation.test.ts` fails or hangs**: Testcontainers couldn't
     reach Docker. Look for an error mentioning the Docker socket or
     `Could not find a valid Docker environment`. If this happens, the
     runner's Docker daemon isn't where Testcontainers expects it —
     start by checking `docker info` as an ad-hoc step before this one
     to confirm the daemon is actually up on that runner, before
     assuming it's a code problem.

8. **`pnpm exec tsx scripts/check-bundle-budget.ts`** — runs `next
   build` itself and parses the summary table; fails if any route
   exceeds 150 KB gzipped first load. All 13 routes currently pass with
   headroom (worst case 107 KB). A failure here is a real regression,
   not a CI quirk — reproduce with the same command locally.

9. **`pnpm exec tsx scripts/check-font-budget.ts`** — also runs its own
   `next build` (small duplicate build cost, traded for a script that's
   correct standalone regardless of step order) and sums shipped
   `.woff2` bytes. Currently 55.2 KB against a 60 KB budget. Same as
   above: a failure is real, reproduce locally with the same command.

10. **`pnpm exec playwright install --with-deps chromium`** — downloads
    a Chromium binary plus OS libraries. Failure here is almost always
    network/registry access on the runner, not this repo; retrying the
    job is a reasonable first move if this specific step is what's red.

11. **`pnpm seed`** — same script, same output as local dev (see the
    seed log in any of the other docs for what success looks like).
    Failure here means something upstream (schema, roles, platform
    catalogue) is broken — steps 6/7 should have already caught that,
    so a failure only at this step and not before is worth a second look.

12. **`pnpm exec tsx scripts/e2e-offline.ts`** — see "The offline suite"
    above for what's automated, what's timing-sensitive, and how to
    reproduce it. On failure the script prints which of the six VERIFY
    scenarios failed and the actual detail (row counts, sync state),
    not just pass/fail.

## If something is red and it isn't obvious why

Reproduce the exact failing step locally against a *fresh* container,
not the one sitting around from a dev session — state left over from
manual testing is the single most common way "works locally, fails in
CI" happens:

```
docker compose down -v && docker compose up -d db
pnpm db:reset
pnpm test                                      # step 7
pnpm exec tsx scripts/check-bundle-budget.ts   # step 8
pnpm exec tsx scripts/check-font-budget.ts     # step 9
pnpm seed                                      # step 11
pnpm exec tsx scripts/e2e-offline.ts           # step 12
```

If that's green and CI is still red, the difference is genuinely
runner-specific (Docker availability for Testcontainers is the prime
suspect — see above) rather than something wrong with the code.
