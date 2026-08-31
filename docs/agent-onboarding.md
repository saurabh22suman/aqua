# Agent onboarding

You have no memory of any prior session. You may lose context mid-task
and pick back up with only what's on disk and in your task description.
This file exists so that "no memory" still means "no dangerous
mistakes" — read it before touching anything.

## Read, in this order

1. **This file.** All of it, before any tool call that changes state.
2. **`docs/agent-lanes.md`.** Figure out which lane your task belongs
   to (schema / UI / test-docs) before you open an editor. If the task
   needs two lanes, that doc says what to do — read it now, not after
   you've already written the schema change.
3. **`docs/implementation-plan.md`.** Find your task's ID. Read its
   `Depends` line and follow every dependency back until you hit
   something already shipped. Read the task's own `Read first:` line
   if it has one — that's not optional context, it's a named
   prerequisite.
4. **The `execute-task` skill** (`.claude/skills/execute-task/SKILL.md`
   if you're Claude Code; otherwise ask how skills are invoked in your
   environment). It defines the stop levels (GREEN/AMBER/RED) and the
   build-verify-commit loop. Follow it exactly; it is rigid by design.
5. **`DESIGN.md`** and `docs/sports-club-ui-direction.html` — required
   before writing or touching any UI, not optional background reading.
   DESIGN.md itself says why both files, not just the token file, are
   required.
6. **`db/CLAUDE.md`** — required before writing or touching any query.
   The single sanctioned accessor (`withTenant()`), what happens when
   scoping is wrong (zero rows, not an error), and the migration
   invariants.
7. **`docs/testing-strategy.md` §"Tier 1"** — the fifteen named test
   files you may never edit, and why mutation testing exists at all.
8. **`docs/review-checklist.md`** — what a human reviewer will actually
   check before merging your PR. If you can satisfy this yourself
   before opening the PR, do.

Do not skip to the task and read these "if you need them." You will
not always know you need them until after the mistake.

## Never do this

- **Never edit an applied migration.** Add a new one
  (`pnpm db:new-migration <name>`, see `docs/agent-lanes.md` / M1).
- **Never write a file under `db/migrations/` if you're not in the
  schema lane.** Not mechanically blocked — see the table below.
- **Never edit the fifteen canonical Tier 1 test files** named in
  `docs/testing-strategy.md`. Non-canonical files under `tests/tier1/`
  (safety-net tests written by prior agents) are fine to edit.
- **Never import `@/db/client` (or a relative path that resolves to
  it) outside `db/`.** Mechanically enforced, see below.
- **Never run a destructive git command
  (`reset --hard`, `checkout -- .`, `clean -f`) without running
  `git status` first and stashing or committing anything it shows.**
  This is not hypothetical: in the same session that produced the
  bugs this doc's sibling (`agent-lanes.md`) was written to prevent,
  a careless `git reset --hard HEAD~1` — done to discard one throwaway
  test commit — also silently discarded real, uncommitted `package.json`
  and CI workflow edits sitting in the working tree at the time. They
  were recoverable only because the same session still had their exact
  content in context. A fresh agent picking up mid-task would not have
  had that.
- **Never merge a PR touching schema or code without explicit
  authorization.** Not mechanically blocked — `main` has no branch
  protection as of this writing (verified via the GitHub API, not
  assumed). See the table below; this is a pure discipline rule.
- **Never add an npm dependency, change a schema from a completed
  task, or add a table not named in your task, without asking first.**
- **Never hard-code behaviour to a role key** (`if (ctx.roleKey ===
  "coach")`). Several such checks already exist in this codebase as
  documented interim bridges to F-12's real permission model — that's
  a known, tracked exception, not license to add a new one.

## Mechanically enforced vs. memory-dependent

The distinction matters: forgetting something in the left column is
safe — CI or the build catches it. Forgetting something in the right
column is not — nothing stops you, and the failure looks exactly like
correct work until someone notices, possibly much later, possibly a
different agent whose code depended on the old assumption (see M3 in
`docs/agent-lanes.md`'s history for the concrete incident this
distinction is drawn from).

| Mechanically enforced | Enforced by |
|---|---|
| Tenant isolation (RLS forced on every scoped table) | `tests/tier1/isolation.test.ts` (+ Testcontainers), the F-08a catch-all |
| Raw `db/client` import outside `db/` | ESLint `import/no-restricted-paths` (resolved-module identity, not text match) |
| Every Server Action parses input first | `tests/tier1/server-action-preamble.test.ts` — real TypeScript AST walk, not a regex |
| `MIGRATION_DATABASE_URL` confined to migration/bootstrap tooling | `tests/tier1/no-superuser-on-request-path.test.ts` |
| Migration filename collisions / non-ascending numbers | `pnpm check:migrations`, wired into CI before `db:reset` (M1) |
| First-load JS ≤150KB gzipped, per route | `scripts/check-bundle-budget.ts` in CI |
| Font payload ≤60KB, latin-only | `scripts/check-font-budget.ts` in CI |
| TypeScript strict, no implicit `any` | `tsc --noEmit` |
| `--accent` never inside a status/state style | a dedicated lint rule (see DESIGN.md §1.2) |
| A new tenant-scoped table without RLS | F-08a's catch-all query over `pg_class`, no per-table test needed |

| Memory-dependent — discipline only | Why nothing catches it |
|---|---|
| **DESIGN.md's composition rules** (one dominant element per screen, the lane strip's three reuses, colour means money/attendance and nothing else) | A screen with the wrong composition still typechecks, still passes every test, still builds under budget. This is the single most consequential item on this list — an S1/S2-vs-reference audit already found real composition gaps that reading the HTML reference first would have caught. |
| Schema-lane exclusivity on `db/migrations/` | CI's lane-overlap check (M2) *warns*, does not block, and a UI-lane agent writing valid SQL passes the naming check regardless of which lane wrote it |
| No merge without explicit authorization on schema/code PRs | `main` has no branch protection; nothing in GitHub stops a direct merge |
| "Never hard-code behaviour to a role key" (F-04) | No lint rule greps for `roleKey ===`; the existing interim instances are tracked by comment, not by tooling |
| "Smallest change that satisfies Done when" / no scope creep | Nothing measures scope; a PR that does more than its task asked still passes CI |
| Icons imported individually from `lucide-react`, never the barrel | Only indirectly caught, and only if the barrel import pushes a route over the bundle budget — a small barrel pull might not |

If you're ever unsure which column a rule falls into, assume
memory-dependent and verify by hand — the cost of an unnecessary check
is small; the cost of a silent breakage compounding across parallel
agents is the entire reason this file and `agent-lanes.md` exist.
