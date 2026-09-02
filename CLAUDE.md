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

## Verify before claiming done
pnpm typecheck && pnpm lint && pnpm test && pnpm build

## Stop and ask when
- A task needs a table or column not in the plan
- The bundle budget would be exceeded
- Anything about money, tenant isolation or children's data is ambiguous
