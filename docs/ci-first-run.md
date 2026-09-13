# CI — what each step does, and what failure looks like

`.github/workflows/ci.yml` runs for real on GitHub Actions, and `ci` is a
**required status check** on `main` (repository ruleset `main protection`,
enforcement active — see `docs/branch-protection.md`). PR #118 exercised
the gate end-to-end: the check ran on the PR itself and the merge was
blocked until it was green.

So this document is no longer a "what to expect on the first-ever run"
guide. Its remaining value is as a reference for the parts of the
workflow whose *rationale* isn't obvious from reading the YAML:

- why there are **two Postgres instances** in one job, and why that isn't
  redundant,
- which test files need **Docker/Testcontainers** and which don't,
- which e2e scenario is **timing-sensitive** and what to do when it flakes,
- what each step is actually checking, so a red step points somewhere.

## Do you need a secret?

**No.** Nothing in the suite requires a real credential. Every `env:`
value in `ci.yml` is a fixed, non-secret string:

| Var | Why it's there |
|---|---|
| `DATABASE_URL` | Unprivileged app role against the `postgres` service container. |
| `MIGRATION_DATABASE_URL` | Privileged role — migrations, `db:reset`, `db:deploy`. |
| `APP_LOGIN_PASSWORD` | Must match the password embedded in `DATABASE_URL`; change one, change the other. |
| `NODE_ENV` | `test`. |
| `BETTER_AUTH_SECRET` | Log-noise suppression only — see below. |
| `BETTER_AUTH_URL` | `http://127.0.0.1:3220`, the port `scripts/e2e-role-bypass.ts` listens on. |
| `PARENT_LINK_SECRET` | Required by `lib/env.ts`'s production boot guard, which fires for the seed subprocess `e2e-role-bypass` spawns under `NODE_ENV=production`. The parent page is never hit by that test, so the value is arbitrary. |

The first three exist purely to match the `postgres` service container
defined in the same file. The last two exist because
`scripts/e2e-role-bypass.ts` runs `next build` + `next start` + a seed
with `NODE_ENV=production`, which makes `lib/env.ts`'s boot guard demand
them (`next build` itself is exempt via
`NEXT_PHASE=phase-production-build`; `next start` loads env lazily on
first request — it's the eager-importing seed that was crashing).

`BETTER_AUTH_SECRET` is the odd one out: nothing in this codebase reads
it and nothing fails without it — better-auth just logs `[Error
[BetterAuthError]: You are using the default secret...]` once per
auth-touching operation when it's unset. That's noise, not a failure
(verified: build/tests pass identically with or without it — the only
difference is whether that line appears). It's set to a labeled dummy
value purely so a real failure doesn't have to be found underneath a
dozen copies of a message that looks like an error but isn't.

If a future task adds something that genuinely needs a secret (a real
SMS/WhatsApp provider key for OTP delivery, say), it goes in
`Settings → Secrets and variables → Actions` on the repo and gets
referenced as `${{ secrets.NAME }}` — nothing does today.

## Two Postgres instances, on purpose

**Both are needed, they are not redundant.**

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
  running as the runner user.

Which database a test file uses, as a rule rather than a list (the
enumeration that used to live here went stale almost immediately —
`tests/tier1/` alone now holds ~99 files):

- **Its own Testcontainers Postgres** — `tests/tier1/isolation.test.ts`,
  plus `tests/mobile/wave2-schema.test.ts` and
  `tests/mobile/absence-alerts.test.ts`, which import
  `@testcontainers/postgresql` directly. These are the files that need a
  throwaway database. Grep for `testcontainers` to get the current set;
  `isolation.test.ts` is the one with a hard *correctness* requirement
  for it, per the mutation-proof reason above.
- **No database at all** — the source-scan and AST tests
  (`no-superuser-on-request-path.test.ts`,
  `server-action-preamble.test.ts`, `demo-mode-reads.test.ts`), the pure
  function tests (`timezone.test.ts`, `tests/money.test.ts`), and the
  env tests (`tests/env.test.ts`, `tests/tier1/demo-mode-env.test.ts`),
  which mock `process.env`.
- **The shared `postgres` service** — everything else, which is the
  large majority.

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

Two CI-only steps this requires, that nothing else in the workflow
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

In `ci.yml` order.

1. **`actions/checkout@v4`, `fetch-depth: 0`** — clones the repo at the
   triggering commit. The full-history clone is deliberate: the
   lane-overlap check (step 10) diffs against `origin/<base>`, which a
   default shallow clone doesn't carry. Failure here means a GitHub-side
   problem or a bad ref, not something in this repo.

2. **`pnpm/action-setup@v4`** — installs pnpm. Reads the version from
   `package.json`'s `packageManager` field, added specifically so this
   step doesn't depend on auto-detection with nothing to detect. If this
   fails, `packageManager` was removed or pnpm's action changed its
   detection behavior — check the action's current README against what's
   pinned here.

3. **`actions/setup-node@v4`** (node 22, `cache: pnpm`) — installs
   Node, restores the pnpm store cache keyed on `pnpm-lock.yaml`. A cold
   cache is slower, not a failure. Failure here is almost always a Node
   version genuinely unavailable on the runner image — unlikely for "22".

4. **`pnpm install --frozen-lockfile`** — fails loudly and correctly if
   `package.json` and `pnpm-lock.yaml` have drifted (someone edited one
   without running `pnpm install` locally first, or committed a
   dependency change without regenerating the lockfile). Fix: run
   `pnpm install` locally, commit the regenerated lockfile.

5. **`pnpm typecheck`** (`tsc --noEmit`) — a failure here is a real type
   error; there's no environment-specific reason it would behave
   differently in CI.

6. **`pnpm lint`** (`eslint .`) — same. Note this is where the
   tenant-isolation import rule bites (`import/no-restricted-paths` on
   `@/db/client`, see `eslint.config.mjs`), so a red lint step can be a
   genuine architecture violation and not a style nit.

7. **`pnpm check:migrations`** (`scripts/check-migration-naming.ts`) —
   fails fast (~1s) on a migration numbering collision or a
   non-conforming filename, rather than letting `db:reset` discover the
   same problem minutes later at runtime. Fix: renumber the new
   migration; never edit an applied one.

8. **`pnpm check:runbook-sync`** (`scripts/check-runbook-sync.ts`) —
   `scripts/seed-demo.ts` and `docs/demo-runbook.md` must change
   together; drift means the operator walkthrough lands on stale
   numbers. Pure git-diff check, no DB, sub-second. Fix: update the
   runbook alongside the seed script.

9. **`pnpm check:scripts-exist`** (`scripts/check-scripts-exist.ts`) —
   every script referenced in `package.json` must point to a file that
   exists. This exists because a "passing" parent-link zero-JS test was
   once a phantom: `package.json` referenced a script file that existed
   in no commit, and CI never ran it. A passing test is not evidence
   unless you have seen it run.

10. **`pnpm exec tsx scripts/check-lane-overlap.ts`** — **non-blocking
    by design.** The script always exits 0 and emits a GitHub
    `::warning::` when a PR touches both `db/migrations/` and
    `app/`/`components/`. See `docs/agent-lanes.md` for why this warns
    rather than blocks. It cannot turn the job red; if you want to know
    whether it fired, read the annotation, not the exit status.

11. **`pnpm db:reset -- --i-understand`** — drops and recreates the
    `public` schema, bootstraps `app_user`/`app_login`, runs all
    migrations against the `postgres` service. The `--i-understand` flag
    is mandatory, not decorative: `db/reset-guard.ts` refuses to run
    unless `DEMO_MODE=true` or that flag is passed explicitly, because
    `db/reset.ts` is directly runnable on its own and can't infer that
    CI's Postgres is scratch. (The guard refuses outright under
    `NODE_ENV=production`, flag or not.) A connection-refused failure
    here means the service health check didn't gate the step — raise
    `--health-retries`/`--health-interval` in the `services:` block.

12. **`pnpm db:deploy`** — bootstraps pg-boss's own schema (`pgboss.*`,
    via `boss.start()` under the privileged `MIGRATION_DATABASE_URL`)
    and grants `app_user` read/write on it afterward. This is **not**
    covered by `db:reset`, which only runs our own migrations. Without
    this step a fresh CI Postgres has no `pgboss.schedule`, and every
    test that touches scheduling (`platform-tenants-create.test.ts`'s D2
    case, `tenant-creation-parity.test.ts`) fails with `relation
    pgboss.schedule does not exist`. A real deploy always runs this
    before serving a request, so `createTenant()` is allowed to assume
    it; this step matches that guarantee.

13. **`pnpm test`** (`pretest` seeds the platform catalogue, then
    `vitest run`) — the big one. Two independent failure modes:
    - **Shared-service tests fail**: something about the `postgres`
      service differs from local `docker-compose.yml` (same image tag,
      same `POSTGRES_USER`/`PASSWORD`/`DB` — they should be identical,
      but double-check the service block hasn't drifted from
      `docker-compose.yml` if this fails).
    - **A Testcontainers test fails or hangs**: Testcontainers couldn't
      reach Docker. Look for an error mentioning the Docker socket or
      `Could not find a valid Docker environment`. Add an ad-hoc
      `docker info` step before this one to confirm the daemon is up on
      that runner before assuming it's a code problem.

    Note `vitest.config.ts` sets `fileParallelism: false` — files run
    sequentially because the shared fixtures race on each other's
    `beforeAll` cleanups. A "fix" that re-enables file parallelism will
    produce spurious FK violations.

14. **`pnpm exec tsx scripts/check-bundle-budget.ts`** — runs `next
    build` itself and parses the summary table, failing if any route
    exceeds the first-load JS budget in `DESIGN.md` §5 (150 KB gzipped,
    per route). It is also the only thing that indirectly catches a
    lucide-react barrel import, which has no lint rule of its own. A
    failure here is a
    real regression, not a CI quirk — reproduce with the same command
    locally. Read the script for the current budget rather than trusting
    a number quoted in prose.

15. **`pnpm exec tsx scripts/check-font-budget.ts`** — also runs its own
    `next build` (small duplicate build cost, traded for a script that's
    correct standalone regardless of step order) and sums shipped
    `.woff2` bytes against the `DESIGN.md` §1.3 budget. Same as above:
    a failure is real, reproduce locally with the same command.

16. **`pnpm exec playwright install --with-deps chromium`** — downloads
    a Chromium binary plus OS libraries. Failure here is almost always
    network/registry access on the runner, not this repo; retrying the
    job is a reasonable first move if this specific step is what's red.

17. **`pnpm seed`** — same script, same output as local dev. Failure
    here means something upstream (schema, roles, platform catalogue) is
    broken — steps 11/12/13 should have already caught that, so a
    failure only at this step and not before is worth a second look.

18. **`pnpm exec tsx scripts/e2e-offline.ts`** — see "The offline suite"
    above for what's automated, what's timing-sensitive, and how to
    reproduce it. On failure the script prints which of the six VERIFY
    scenarios failed and the actual detail (row counts, sync state),
    not just pass/fail.

19. **`pnpm exec tsx scripts/e2e-offline-disabled.ts`** — the
    counterpart: every tenant ships with offline sync OFF by default
    (`OFFLINE_SYNC_ENABLED` unset, `lib/feature-flags.ts` — the issue #4
    postmortem's kill switch, architecture §12.2). Proves the online
    happy path is unaffected, the offline banner is proactive, and a tap
    made while offline is refused outright rather than silently queued.
    Runs its own dev server on a different port so it can't collide with
    step 18.

20. **`pnpm e2e:parent-link-zero-js`** — the parent page's shipped
    artifact must contain zero `<script>` tags. Builds and runs `next
    start` rather than asserting against the dev server, because dev
    mode bundles differently from `next build` output — what this checks
    is what a real visitor receives.

21. **`pnpm e2e:platform-form-leak`** — credential-leak check on every
    pre-hydration form submit in the platform surface. Three tiers: a
    live submit on the platform login form with JS disabled, a live
    submit on one auth-gated form with JS enabled, and a source scan
    pinning `method="post"` on every other form statically.

22. **`pnpm e2e:host-boundary`** — the platform surface lives at
    `ops.<base>`, the tenant surface at `<base>`. `middleware.ts`
    enforces this in the routing layer; this pins it against future
    refactors by curling each path with explicit `Host` headers and
    asserting 200 vs 404 against the surface contract.

23. **`pnpm e2e:role-bypass`** — builds production, starts `next start`,
    logs in as owner/coach/receptionist via the real OTP flow, and
    replays three attack shapes (plain GET; RSC request with a
    `Next-Router-State-Tree` claiming the `(owner)` layout is mounted;
    POST with `Next-Action` against every action hash in the
    server-reference manifest), asserting no protected data (member
    names, `dateOfBirth`, dashboard figures) reaches a role that isn't
    entitled to it. A positive control — the entitled role *does*
    receive the data via the same shapes — gates false negatives, so
    every shape is a real request the application services.

## If something is red and it isn't obvious why

Reproduce the exact failing step locally against a *fresh* container,
not the one sitting around from a dev session — state left over from
manual testing is the single most common way "works locally, fails in
CI" happens:

```
docker compose down -v && docker compose up -d db
pnpm db:reset -- --i-understand                # step 11
pnpm db:deploy                                 # step 12
pnpm test                                      # step 13
pnpm exec tsx scripts/check-bundle-budget.ts   # step 14
pnpm exec tsx scripts/check-font-budget.ts     # step 15
pnpm seed                                      # step 17
pnpm exec tsx scripts/e2e-offline.ts           # step 18
```

If that's green and CI is still red, the difference is genuinely
runner-specific (Docker availability for Testcontainers is the prime
suspect — see above) rather than something wrong with the code.
