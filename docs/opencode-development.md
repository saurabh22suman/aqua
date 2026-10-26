# OpenCode development setup

## Active harness — OpenCode V2 (25 October 2026)

OpenCode **2.1.4** is installed on this workstation. Global and project configs,
agent permissions and delegated commands use native V2 syntax. Older tooling
notes below describe the previous verified setup where stated. V2 does not run
LSP servers: use the project compiler/lint commands. No model is forced by this
harness; review agents inherit the selected model. Credentials stay outside Git.

Global commands: `/task-contract`, `/diagnose`, `/quality-review`,
`/browser-check`, `/verify-change`, `/harness-doctor`. Global MCPs are the pinned
isolated Playwright and Context7; Aqua overrides Playwright with its pinned
Chromium configuration and `.playwright-mcp` output. Do not install another
browser/profile MCP or broad database-access server merely to run tests.

Project commands: `/aqua-doctor`, `/aqua-test-env`, `/aqua-check [test paths]`,
`/aqua-ui-check [URL and acceptance scope]`, `/review [scope]`, `/verify`.
Use `opencode reload` after configuration changes. OpenCode's background service
has a default Location: programmatic V2 API callers must supply the intended
`location[directory]` rather than assume the caller's current directory is used.

Current collaboration rules: `docs/agent-workflow.md`; UI acceptance:
`docs/ui-quality-contract.md`. New work branches from develop and feature PRs
return to develop. Human testing and promotion to main remain separate.
Read the dated owner handoff for WIP; an old pause note is not current task state.
Load aqua-ui-quality for UI changes and aqua-parallel-work for parallel sessions.
Commands: `/aqua-ui-contract [scope]`, `/aqua-integration-check [branches]`.

### Isolated verification

```bash
python3 .opencode/scripts/harness.py doctor
python3 .opencode/scripts/harness.py prepare-test
python3 .opencode/scripts/harness.py quick
python3 .opencode/scripts/harness.py test tests/money.test.ts
python3 .opencode/scripts/harness.py release
python3 .opencode/scripts/test_harness.py
```

`prepare-test` creates a checkout-specific disposable Postgres 16 container on
127.0.0.1:55433 (override with `--port` if occupied), bootstraps roles/migrations
and saves an ignored **0600** `.env.aqua-harness-test.local`. It does not overwrite
root `.env` or seed/reset the running club. The database is named `aqua_test_*`,
runtime uses `app_login`, migration uses `aqua`. Tests reject a development target,
remote DB, mismatched URLs or missing disposable marker. Each worktree needs its
own profile/container/port. The tmpfs test data is disposable; restarting the
container discards it, so do not restart it casually. No cleanup is automatic.

The harness serializes its operations per checkout. It cannot stop arbitrary
commands outside the harness: do not run raw competing tests or builds. Release
checks refuse when a Next process owns the checkout; use an isolated verification
worktree rather than kill another owner's dev server. The existing scripts each
perform their own bundle/font builds and remain serial. Change-specific CI
scanners and e2es still apply. A passing harness setup is not certification that
the current product changes pass their application gate.

## Local development

Use Node 22 (`nvm use`) and pnpm 11.22.0 from `package.json`.
`pnpm install --frozen-lockfile` installs app tooling; there is no formatter,
pre-commit hook or codegen prerequisite. Playwright needs separate binaries:

```bash
pnpm exec playwright install chromium chromium-headless-shell
```

On a bare Linux host, use `--with-deps` too (installs OS browser libraries).
The default `docker-compose.yml` is the **database-only** development stack.
`docker-compose.local.yml` instead builds the production-style web/worker image;
Dokploy Dev/Production have separate immutable-image Compose files.

Copy `.env.example` to `.env` only when `.env` does not already exist. Scripts
load `.env`, while Next also loads `.env.local`; keep connection settings aligned.
The runtime URL must use `app_login`, never the migration/superuser identity.

Start Postgres and bootstrap a fresh database without dropping schemas:

```bash
docker compose up -d --wait db
pnpm db:deploy
pnpm dev
# Separate terminal with the same environment:
pnpm worker
```

`db:deploy` prepares roles, SQL migrations, pg-boss queues, schedules and grants.
`db:migrate` does not do the other steps. `db:reset` drops the schema and requires
explicit approval for a non-disposable target; it is not a setup prerequisite.
Synthetic seeding is an explicit follow-up, using the appropriate runbook
(`docs/demo-runbook.md` for demo mode), not an automatic development startup step.

### When default ports are occupied

Check `docker ps` before starting a DB. For a dedicated Aqua instance on 55432
and web on 3100, export these **development-only** settings in each terminal:

```bash
export AQUA_DB_PORT=55432
export DATABASE_URL=postgresql://app_login:change-me-app@localhost:55432/aqua
export MIGRATION_DATABASE_URL=postgresql://aqua:aqua@localhost:55432/aqua
export APP_LOGIN_PASSWORD=change-me-app
export BETTER_AUTH_URL=http://localhost:3100
docker compose up -d --wait db
pnpm db:deploy
pnpm dev --port 3100
```

Open `http://localhost:3100/login` or `http://ops.localhost:3100/ops/login`.
If `ops.localhost` does not resolve on your machine, provide a local hosts mapping
to 127.0.0.1; opening `/ops` on the apex host intentionally returns 404.
Exported settings override `.env`; do not overwrite another project's database.

This machine's ignored `.env.aqua-dev.local` contains the local-only settings
above, including development signing keys. Reuse it in each development terminal:

```bash
set -a
source .env.aqua-dev.local
set +a
pnpm dev --port 3100
```

It is deliberately not auto-loaded by Next or scripts. Tests need their own
connection URLs; do not run them after sourcing the development profile.

## Tests

Tests perform inserts, updates and cleanup deletes. Point both URLs at a
**dedicated disposable test database**, not the development/customer database.
The verification run used a separate tmpfs-backed Postgres on port 55433:

```bash
docker run --detach --rm --name aqua-test-db --publish 127.0.0.1:55433:5432 \
  --tmpfs /var/lib/postgresql/data --env POSTGRES_USER=aqua \
  --env POSTGRES_PASSWORD=aqua --env POSTGRES_DB=aqua postgres:16
# Wait for: docker exec aqua-test-db pg_isready -U aqua -d aqua
export AQUA_NO_DOTENV=1 NODE_ENV=test
export DATABASE_URL=postgresql://app_login:agent-test-pw@localhost:55433/aqua
export MIGRATION_DATABASE_URL=postgresql://aqua:aqua@localhost:55433/aqua
export APP_LOGIN_PASSWORD=agent-test-pw
export BETTER_AUTH_SECRET=agent-verification-only-not-a-real-secret
export BETTER_AUTH_URL=http://localhost:3100
export PARENT_LINK_SECRET=agent-verification-only-not-a-real-secret DEMO_MODE=false
unset WHATSAPP_PROVIDER
pnpm db:deploy
# Run tests below, then: docker stop aqua-test-db (removes this disposable DB).
```

After `db:deploy`, `pnpm test` automatically seeds the platform catalogue via
`pretest`; focused invocations preserve that behavior:

```bash
pnpm test tests/money.test.ts -t 'name fragment'
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

For CI parity/memory limits use `pnpm test:sharded`: four serial processes with
discovery/coverage accounting and one seed. Do not parallelize files, suites or
builds against shared DB/`.next` state. Docker must remain available for the
Testcontainers isolation/migration fixtures. `AQUA_NO_DOTENV=1` lets an isolated
runner opt out of script-side `.env` loading; Next's env loading is separate.
Leave `WHATSAPP_PROVIDER` unset so tests get the default non-production mock.
Full CI scanners/e2es live in `.github/workflows/ci.yml`.

## OpenCode tooling

`opencode.json` enables anonymous Context7 MCP access, requiring no npm server
or API secret. Confirm with `opencode mcp list`; use `resolve-library-id` then
`query-docs` with the installed version. A Context7 key is optional for higher
limits: add an Authorization Bearer header in your **user-level** OpenCode config
using `{env:CONTEXT7_API_KEY}`; project secrets do not belong in tracked config.

The project overrides the inherited browser MCP with Microsoft's
[`@playwright/mcp@0.0.83`](https://github.com/microsoft/playwright-mcp/tree/f183dad4a52965583e3cc1d59b88cdc279e2e57d):
headless Chromium, isolated sessions (no stale service-worker profile), artifacts
under ignored `.playwright-mcp/`. It runs via pnpm dlx, outside app dependencies.
The MCP uses Playwright `1.64.0-alpha-1790635538000`, independently of the app's
stable version. Its matching binaries were installed with:
`pnpm dlx playwright@1.64.0-alpha-1790635538000 install chromium`.
Review subagents deny browser tools as well as edits/shell.

Project-local commands: `/task <ID>`, `/verify [scope]`, `/review <files>`.
Read-only specialists: `@aqua-review` for data/action correctness and
`@aqua-ui-review` for design/accessibility review. They inherit the user's model
and cannot edit, run shell commands or delegate. They supplement the existing
build/plan/explore agents. Validate discovery with `opencode debug skill` and
`opencode agent list`. **Quit and restart OpenCode after configuration changes.**

### Research and installed skills (2026-10-04)

Installed project-local copies with `skills@1.7.0 --agent opencode --copy` from
commit-pinned URLs; `skills-lock.json` records the installation. Keep upstream
copies intact and place Aqua-specific overrides in `.opencode/instructions.md`.

| Skill | Upstream revision | Why it fits |
|---|---|---|
| `vercel-react-best-practices` | [vercel-labs/agent-skills@063bee94](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/react-best-practices) | RSC data flow, waterfalls, client bundle budget; includes all rule references |
| `web-design-guidelines` | [vercel-labs/agent-skills@063bee94](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills/web-design-guidelines) | Targeted accessibility/UI review; fetches current guidelines when invoked |
| `better-auth-best-practices` | [better-auth/skills@20c9e88a](https://github.com/better-auth/skills/tree/20c9e88a5c007461a703f1c213572b073196113e/better-auth/best-practices) | Version-aware adapter/session/plugin documentation; Aqua's SQL migration rules override generic setup commands |
| `execute-task` | Existing `.claude/skills/execute-task/SKILL.md` | Repo-specific task dependencies, stop levels and verification proofs |

Do not run blanket skill updates: inspect the new revision and compatibility,
then reinstall only the selected skills using a commit-pinned tree URL.
Vercel's [next-skills relocation](https://github.com/vercel-labs/next-skills)
retires `next-best-practices` in favor of Next 16.3+ bundled docs. Aqua is Next
15.5.24, so use Context7/official version-matched docs rather than installing
cache-components adoption skills or letting a codemod rewrite agent instructions.

Configuration sources: [OpenCode skills](https://opencode.ai/docs/skills/),
[agents](https://opencode.ai/docs/agents/), [schema](https://opencode.ai/config.json),
[skills CLI](https://github.com/vercel-labs/skills), and
[Context7 setup](https://github.com/upstash/context7).

## Verification findings (2026-10-04)

Frozen install, typecheck, lint, production build, Compose interpolation and
Context7 resolve/query succeeded. A complete serial sharded run discovered all
316 test files: **2,495 passed, 2 failed, 3 skipped** with the messaging provider
unset. Focused reruns confirmed the two failures in existing application/tests:

- `tests/mobile/absence-alerts.test.ts:163`: uses the actual date and seeds the
  previous four days; near month start fewer than four marks belong to the
  current month, so the service correctly omits the expected monthly alert.
- `tests/tier1/announcements.test.ts:249`: fresh bootstrap-before-migrate grants
  leave announcements UPDATE/DELETE and notifications DELETE privileges present.
  The assertion expects revocation. This needs a separate reviewed DB change;
  agents must not modify tier1 tests or applied migrations to silence it.

These failures mean the full gate is **not green**. Reproduce on a disposable DB;
do not skip the assertions or change the system clock to obtain a passing run.

Both MCPs connected, all four project skills/three commands/two review agents
were discovered, and real Chromium navigated the development login at 390×844.
Live HTTP probes confirmed tenant/ops login 200s and cross-host 404s on port 3100.
The worker started and drained after SIGINT using app_login without a migration
credential. The smoke server/worker and disposable test container were stopped;
the database-only development Compose service remains available on port 55432.
