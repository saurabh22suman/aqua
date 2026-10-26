# Aqua — agent instructions

`AGENTS.md` symlinks to this file; edit `CLAUDE.md` to update both.

## Read before changing
- Execute `docs/implementation-plan.md` tasks in dependency order, one at a time per session;
  use the existing `execute-task` skill for numbered tasks.
- Read the task's sections in `docs/architecture.md`; use `docs/project-scope.md`
  for scope/pricing decisions and `DESIGN.md` for every UI task.
- Look up library APIs with Context7 first, matching installed/lockfile versions.
  Next.js is **15.5.24**; do not apply Next 16 cache-components/proxy guidance.
- Setup, tooling provenance and OpenCode shortcuts: `docs/opencode-development.md`.
  Read `db/CLAUDE.md` before data-layer work.

## Mandatory engineering method
- Human requires strict red–green–refactor TDD, secure SDLC and SOLID for all
  development. Read docs/engineering-standard.md and load aqua-tdd-secure BEFORE
  implementation. Record actual intended RED before production edits, GREEN,
  refactor verification and relevant negative/security cases. Do not fabricate
  RED for inherited code or substitute import errors/green snapshots for it.
- For the current redesign read docs/design-system/README.md and delivery.md.
  Two light themes only; mobile-first except ops; no heavy motion library or
  experimental framework migration. Preserve scoped offline security.

## Development and verification
- Node **22** (`.nvmrc`), pnpm **11.22.0** (`packageManager`); install with
  `pnpm install --frozen-lockfile`. This is one package, not a pnpm monorepo.
- Postgres 16: `docker compose up -d --wait db`. If 5432 is occupied, set
  `AQUA_DB_PORT` and change both connection URLs to the same port.
- `DATABASE_URL` uses `app_login`; `MIGRATION_DATABASE_URL` uses privileged `aqua`.
  `APP_LOGIN_PASSWORD` must match the password in `DATABASE_URL`.
- Fresh DB: `pnpm db:deploy` bootstraps roles **before** SQL migrations, then
  pg-boss schema/queues/grants. `db:migrate` alone does not prepare a fresh DB.
- Run `pnpm dev` and `pnpm worker` separately. Ops is at
  `http://ops.localhost:3000/ops`; `/ops` on plain localhost intentionally 404s.
- Scripts load root `.env` only (`lib/load-env.ts`), not `.env.local`.
  Exported values win; `AQUA_NO_DOTENV=1` disables this loader for isolated runs.
- Install browser binaries before tests:
  `pnpm exec playwright install chromium chromium-headless-shell`
  (CI/Linux hosts missing browser libraries also need `--with-deps`).
- Full gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
  CI uses `pnpm test:sharded` instead of `pnpm test` to bound runner memory.
- Focused test: `pnpm test tests/money.test.ts -t 'name fragment'`;
  this includes the platform-catalogue `pretest` seed. `pnpm exec vitest run ...`
  bypasses that seed. Tests mutate the configured DB: use a dedicated test DB.
- Keep test files serial: shared DB cleanups race in parallel. Docker is also
  required for Testcontainers (isolation/migration fixtures use separate DBs).
- Leave `WHATSAPP_PROVIDER` unset for tests; the non-production default is mock.
- `pnpm check:bundle` and `pnpm check:fonts` each run their own build; run them
  serially, never alongside dev/build (all share `.next`). CI's other scanners
  and standalone e2es are listed in `.github/workflows/ci.yml`.

## Data and mutation boundaries
- Tenant queries go through `withTenant()` from `db/tenant.ts`; no raw
  `db/client` import in app/components/lib (including relative imports).
  `withUser()` is pre-tenant identity resolution only; platform scopes live in
  `db/scope.ts`. Never give web/worker the privileged migration connection.
- Global `users` has no tenant RLS: reach users through `tenant_memberships`
  inside `withTenant()`. Missing rows can mean missing scope, not a failed write.
- Every Server Action parses Zod input, then checks permission/session, before
  service/DB calls; layout checks alone do not authorize actions or page reads.
- Every mutation writes its audit row in the **same transaction**. Tenant audit
  coverage needs manual review; ops mutations use `db/ops-action.ts`'s
  `opsAction()` plus `recordOpsAudit()` inside the service transaction.
- Money is **bigint paise**, using `lib/money/`; no float/numeric arithmetic.
  Store `timestamptz` UTC; display with `timeZone: 'Asia/Kolkata'`.
- Runtime boundaries use Zod; no `any`. Keep product modules under 300 lines;
  tests are exempt and `pnpm check:lines` is report-only, not a CI gate.
- Forward-only SQL lives in `db/migrations/`. Use
  `pnpm db:new-migration <snake_case_name>` then `pnpm check:migrations`.
  `db:generate` outputs to **db/drizzle**, which the SQL runner does not consume.
  Never edit an applied migration or use `drizzle-kit push` here.
- Release 1 records cash/UPI QR/card-terminal references; no PSP/Razorpay
  integration. Older roadmap text mentioning a gateway is superseded.

## UI contracts
- Tailwind v4 tokens are in `app/globals.css` (`@theme`), not tailwind.config.
  Follow `DESIGN.md`; no new hex colours or component-library dependency.
  Accent is an action/branding token, never a status colour.
- Import lucide icons from individual paths. First-load JS budget: 150 KB/route;
  self-hosted Latin fonts: 60 KB combined. Budget scripts, not guesses, decide.
- Verify owner at **390×844 and 1280×900**; coach/reception at **390×844**;
  ops at **1280×900**. Parent `/p/[token]` stays zero-JS: verify the production
  artifact with `pnpm e2e:parent-link-zero-js`, not a dev-server assertion.
- For UI implementation/review load `aqua-ui-quality` and follow
  `docs/ui-quality-contract.md`. Verify long-page scrolling, short viewports,
  shared-shell parity and actual rendered styles, not just JSX classes.
- Diagnose stale assets using the served artifact and an isolated clean build.
  Do not clear a user browser profile or service-worker/offline data as a routine
  prerequisite; use an isolated test context and preserve unsynced user work.

## Workflow and stop conditions
- Active integration branch: **develop**. New feature/fix branches start from
  the latest verified develop; feature PRs target develop. No direct work on
  main or develop. See `docs/agent-workflow.md` and load `aqua-parallel-work`
  before coordinating multiple sessions or integrating a branch.
- Only the human promotes tested develop to main. Feature agents must not merge
  their own PRs, enable auto-merge, self-apply approval labels or deploy. A
  designated integrator merges to develop only when explicitly assigned and
  after independent review and required checks; no approval bypasses.
- Commit/push/PR creation require task authorization; a skill saying “commit”
  is not authorization. Preserve unrelated dirty work and never use git add .
- Parallel writers use separate worktrees, file ownership and isolated DBs,
  build outputs and ports. Shared shell/tokens/primitives have one owner.
- Required CI and agent-protected-paths apply to the PR itself. Preserve human
  ownership of tests/tier1/** and existing protected paths. Instructions are
  not GitHub branch protection; never claim enforcement without verifying it.
- Ask before an unapproved dependency, schema/architecture decision or bundle
  budget exception. Existing task authorization takes precedence over generic
  skill stop levels; stop on unresolved money, isolation, consent or child-data
  ambiguity, not merely because a file belongs to one of those domains.
- DEMO_MODE permits synthetic seeding/banner only, never service/DB branches.
  Never reset a non-disposable DB without explicit authorization.
- Functional checks, visual acceptance and human design approval are separate.
  Report CHANGES REQUIRED for visible shell/spacing/overflow failures even when
  tests pass. Do not call uncommitted code “shipped” or “deployed”.
