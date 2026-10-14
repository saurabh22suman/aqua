# Aqua — agent instructions

`AGENTS.md` symlinks to this file; edit `CLAUDE.md` to update both.

## Read before changing
- Execute `docs/implementation-plan.md` tasks in dependency order, one at a time;
  use the existing `execute-task` skill for numbered tasks.
- Read the task's sections in `docs/architecture.md`; use `docs/project-scope.md`
  for scope/pricing decisions and `DESIGN.md` for every UI task.
- Look up library APIs with Context7 first, matching installed/lockfile versions.
  Next.js is **15.5.24**; do not apply Next 16 cache-components/proxy guidance.
- Setup, tooling provenance and OpenCode shortcuts: `docs/opencode-development.md`.
  Read `db/CLAUDE.md` before data-layer work.

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
- Before trusting UI failures, unregister the offline service worker and clear
  browser caches; cached chunks can survive sessions.

## Workflow and stop conditions
- Feature branch per change; no direct commits to `main`. PRs target `main`
  and require green **ci + agent-protected-paths on the PR itself**.
- **Human merges only.** Never self-apply `human-approved-merge`; the token can
  technically do so, but that defeats the gate. The workflow is the source for
  protected paths (including `tests/tier1/**`); agents must not write tier1 tests.
- Ask before adding a dependency, an unplanned table/column, changing a completed
  schema/architecture decision, or exceeding a bundle budget; also stop when
  money, isolation, consent or children's-data requirements are ambiguous.
- `DEMO_MODE` permits synthetic seeding/banner only, never service/DB branches.
  Production serving rejects it. `pnpm db:reset` drops the schema; ask before
  using it on a non-disposable DB or changing demo boot/seed/reset safeguards.
