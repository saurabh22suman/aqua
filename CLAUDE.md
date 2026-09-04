# Aqua

Multi-tenant SaaS for sports academies in India. Next.js 15 · TypeScript ·
Postgres · Drizzle · Better Auth · pg-boss · Razorpay · WhatsApp.

## Before writing code
- Task list: `docs/implementation-plan.md`. Work one task at a time, in order.
- Technical decisions: `docs/architecture.md`. Read the sections the task names.
- Visual rules: `DESIGN.md`. Non-negotiable.
- Library APIs: **look them up with Context7 first.** See §4 of `docs/agent-setup.md`.

## Git workflow
- Feature branch per task/change. Never commit directly to `main`.
- Open a PR into `main`; the `ci` check must run and pass on the PR itself.
- Merge only when `ci` is green. No exceptions. `docs/branch-protection.md`
    is a runbook for a rule not yet applied to this repo (verify with the
    GitHub API before assuming otherwise) — until it is, this is a discipline
    rule, not a platform guarantee. Treat it as absolute regardless.
- `main` being green is what makes auto-deploy from `main` safe. Treat a
  broken `main` as an incident, not a follow-up task.
- **Self-merge is suspended** (F1). Every PR merge comes to the human
  until `.github/workflows/agent-protected-paths.yml` has been verified
  end-to-end against a real PR — see `docs/five-day-work-guide.md`
  §"Self-merge suspension". The rule was memory-dependent before; it
  failed 3 for 3 in the audit window. The workflow + the companion
  test (`tests/tier1/agent-protected-paths.test.ts`) are the mechanical
  replacement. The label `human-approved-merge` is required for any PR
  touching `db/migrations/**`, `lib/auth/**`, `lib/money/**`, or
  consent-related paths, and the agent's token cannot apply it.

## Absolute rules
Annotated with whether each is mechanically checked — an agent
should not assume "absolute" means "the test suite will catch it."
- Tenant data ONLY through `withTenant()`. Never import `@/db/client`.
  (enforced: eslint `import/no-restricted-paths` in `eslint.config.mjs`;
  `tests/tier1/isolation.test.ts` exercises the boundary)
- Money is `bigint` paise. Never float, never numeric. (enforced:
  Drizzle column types + `bigint` arithmetic helpers; runtime guard on
  format is not exhaustive — review is still load-bearing)
- Timestamps `timestamptz`, stored UTC, displayed IST. (enforced at
  the schema layer for storage; display formatting is per-callsite
  — `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'` is the
  convention, not a lint rule)
- Every mutation writes `audit_log` in the same transaction. (NOT
  mechanically checked — relies on reviewer discipline. Phase 1.5
  introduced a `platform_audit_log` analogue that the platform-side
  Service layer uses, but the tenant-side `audit_log` (architecture
  §8.10) is not yet built.)
- TypeScript strict. No `any`. Zod at every boundary. (enforced: `tsconfig`
  strict + CI `pnpm typecheck`)
- Every Server Action opens with (1) a Zod parse, then (2) a permission
  check, before any service/DB call. (**Parse-first is enforced** —
  `tests/tier1/server-action-preamble.test.ts` walks the real AST.
  **Permission-order is NOT enforced despite reading like it is** — the
  test's own ordering check is dead code: `site.isServiceCall` is
  declared and never set to `true` anywhere in the file, so the
  `serviceIndex` it gates never advances past `-1` and the
  `permIndex < serviceIndex` comparison never runs. Proven live: moving
  the permission check in `lib/actions/platform-invite-owner.ts` to
  after the service call left all tests green. Until that AST walk is
  fixed, permission-order is a review-time rule only — verify it by
  reading the action, not by trusting this test passed.)
- Files under 300 lines. (Partial enforcement — `pnpm check:lines`
  reports every file over the soft limit; the script currently exits 0
  because the codebase accumulated over-300-line files before the
  check existed. **Test files under `tests/` are exempt** —
  fixture-heavy cases push test files over 300 lines without that
  reflecting the kind of scope drift the rule guards against.
  Splitting a test file purely for line count fragments the
  regression surface for no real gain. Refactoring the existing
  over-300 product files lands separately; once that work is done,
  flip `STRICT = true` in `scripts/check-line-count.ts` to make
  future violations fail CI.)
- Icons: individual imports from lucide-react. Never the barrel. (NOT
  enforced directly — caught indirectly via the bundle budget script,
  which fails a CI step if the barrel import inflates any route past
  150 KB. A barrel import that stays under budget slips through.)
- No new dependency without asking. (NOT enforced — review-time rule.)
- Never edit an applied migration. Add a new one. (enforced: `pnpm
  check:migrations` runs `scripts/check-migration-naming.ts`, which
  fails on duplicate-naming issues; "edited an applied migration" is
  caught by review only.)

## Demo mode
`DEMO_MODE` (`lib/env.ts`) is a gate, not a feature flag. It permits
seeding synthetic data and shows a banner — nothing else. It must
never appear in `lib/services/**` or `db/**`; if you find yourself
writing `if (DEMO_MODE)` there, stop, that's the wrong shape (enforced:
`tests/tier1/demo-mode-reads.test.ts`, a source-scan whitelisting the
only three places allowed to read it — the parser, the banner
component, the demo reset scripts).
- `lib/env.ts` refuses to boot when `DEMO_MODE=true` and
  `NODE_ENV=production` (enforced: `tests/tier1/demo-mode-env.test.ts`;
  verified against the actual deployment path — Dockerfile sets
  `NODE_ENV=production` before the app starts, `.dockerignore` excludes
  `.env*` from the image, so neither can be bypassed by what ships).
- `db/reset.ts` (`pnpm db:reset`) carries its own gate independent of
  the `demo:reset` wrapper — it drops the entire schema and is directly
  runnable on its own (CI, a deploy script, a human), so it cannot rely
  on a wrapper above it to have already checked anything. See
  `db/reset-guard.ts`.
- Any change to the demo-mode boot guard, the seed/reset scripts, or
  what they're allowed to touch is exactly the class of change the
  "stop and ask" rule below and the normal git workflow above exist
  for — branch, PR, CI-on-the-PR, no exceptions for how late in a
  session it is. (One such change shipped as a direct commit to `main`
  with no PR; it happened to be correct on review, but that was luck,
  not process — see `docs/demo-runbook.md` for the operational runbook.)

## Verify before claiming done
pnpm typecheck && pnpm lint && pnpm test && pnpm build

## Stop and ask when
- A task needs a table or column not in the plan
- The bundle budget would be exceeded
- Anything about money, tenant isolation or children's data is ambiguous
- Anything touching the DEMO_MODE boot guard, or a script capable of
  dropping/reseeding a database outside a disposable CI instance
