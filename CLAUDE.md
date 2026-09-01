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
- Merge only when `ci` is green. No exceptions — branch protection has no
  admin bypass (`docs/branch-protection.md`), so this isn't optional.
- `main` being green is what makes auto-deploy from `main` safe. Treat a
  broken `main` as an incident, not a follow-up task.

## Absolute rules
- Tenant data ONLY through `withTenant()`. Never import `@/db/client`.
- Money is `bigint` paise. Never float, never numeric.
- Timestamps `timestamptz`, stored UTC, displayed IST.
- Every mutation writes `audit_log` in the same transaction.
- TypeScript strict. No `any`. Zod at every boundary.
- Files under 300 lines.
- Icons: individual imports from lucide-react. Never the barrel.
- No new dependency without asking.
- Never edit an applied migration. Add a new one.

## Verify before claiming done
pnpm typecheck && pnpm lint && pnpm test && pnpm build

## Stop and ask when
- A task needs a table or column not in the plan
- The bundle budget would be exceeded
- Anything about money, tenant isolation or children's data is ambiguous
