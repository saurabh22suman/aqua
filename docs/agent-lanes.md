# Agent lanes

**Why this exists.** In one batch of seven parallel-shaped tasks worked
sequentially by a single agent holding the whole picture in context, two
of the five real bugs found were the same shape: a PR changed what a
column meant (`sessions.coach_id` from a bare user id to a real staff
id; a batch became soft-deletable) and a *different* piece of code
elsewhere kept the old assumption, with no test failing until someone
went looking. One agent holding full context caught both by manual
review. Multiple agents working genuinely in parallel will not have
that — each only sees its own branch. Lanes exist to reduce how often
one agent's change silently invalidates another's assumption, by
making it explicit who owns which files and requiring the schema lane
to be the sole writer of the one thing every other lane depends on.

Lanes are a coordination convention, not a technical sandbox — nothing
stops an agent from editing outside its lane. Follow this by
discipline, the same way `docs/review-checklist.md` and the
`execute-task` skill are followed by discipline. The CI check in this
doc *warns*, it does not block (see below) — the actual enforcement is
you reading this before you start.

## The three lanes

| Lane | Owns | Never touches |
|---|---|---|
| **schema** | `db/**` (migrations, `db/schema/*.ts`, `db/tenant.ts`, `db/scope.ts`, bootstrap/reset/migrate scripts), `lib/services/**` | `app/**`, `components/**` |
| **UI** | `app/**`, `components/**`, `lib/actions/**` | `db/migrations/**` (see the migrations rule below) |
| **test/docs** | `tests/**` excluding `tests/tier1/*.test.ts` named in `docs/testing-strategy.md`'s 15-file list (those are human-owned, read-only to any agent), `docs/**` | `db/**`, `app/**`, `components/**`, `lib/**` |

**Shared/cross-cutting, not owned by a single lane:** `lib/schemas.ts`
(Zod input schemas — read by UI, occasionally referenced by services),
`lib/auth/**`, `lib/time/**`, `lib/env.ts`, and other top-level `lib/`
helpers with no natural single owner. Any lane may touch these when a
task requires it, but say so explicitly in the PR description — a
change here has the widest blast radius of anything in the repo
precisely because no one lane is watching it by default.

**The migrations rule, stated plainly: only the schema lane writes
files under `db/migrations/`.** If a UI task needs a new column, the
UI-lane agent requests it (or, on a solo task, temporarily operates as
the schema lane for that step — see below) rather than hand-writing
SQL under UI-lane review. This is the same root cause M1 addresses at
the filename level (two agents both writing migrations independently)
applied to actual schema content: one lane, one set of eyes on every
migration, always.

## When a task needs two lanes

Most of the seven-PR batch this doc grew out of needed exactly this —
a new table or column (schema) that a screen then had to expose (UI).
Two resolutions, in order of preference:

1. **Split into two PRs, schema first.** The schema-lane PR adds the
   table/column/service function with its own tests, lands (or is at
   least stable and reviewed) independently of any UI. A UI-lane PR
   then stacks on it and consumes the new capability. This is what
   `feat/c04-staff-records` → `feat/c16-c17-completion` and
   `feat/c03-c08-member-status-lifecycle` → `feat/c06-people-screens`
   did. It gives each lane's reviewer a diff that's actually theirs to
   review, and — the M1 motivation — means a schema change's consumers
   get checked by someone reading the schema PR's own description
   (see M3) before any UI PR can silently assume the old shape.

2. **One PR, both lanes, self-declared.** When the task is genuinely
   too small to split without manufacturing busywork — one column, one
   form field consuming it — a single PR may touch both lanes. This is
   what `feat/c06-people-screens` did (added `persons.phone` and its
   one caller in the same PR): splitting would have been two PRs for a
   three-line schema change with a single consumer, against
   `execute-task`'s own "smallest change that satisfies Done when."
   State it: a "Lanes touched" line in the PR description
   (`schema + UI: <why not split>`).

Default to (1). Reach for (2) only when the schema change has exactly
one consumer, added in the same PR, and splitting would be pure
overhead — not as a way to avoid the coordination cost of two PRs on a
task that actually has several consumers or genuinely separable
concerns.

## The CI check: warn, not block

A PR touching both `db/migrations/**` and `app/**`/`components/**`
prints a `::warning::` annotation in CI (`scripts/check-lane-overlap.ts`)
but never fails the build.

**Why warn and not block:** `feat/c06-people-screens` (PR #21 in the
batch this doc documents) is real, shipped, tested, CI-green work that
touched `db/migrations/0017_persons_phone.sql` *and*
`app/(owner)/owner/members/**`, `components/**`, and
`lib/actions/**` in one PR — correctly, per case (2) above. A hard
block would have rejected that PR outright, forcing a split the task's
own shape didn't warrant. Blocking optimizes for the coordination
problem (many agents, unaware of each other) at the cost of the solo-
agent-doing-one-well-scoped-vertical-slice case, which is common and
legitimate in this codebase's actual task shapes (see
`docs/implementation-plan.md`'s many small, self-contained tasks). A
warning preserves the split-by-default discipline for the cases lanes
actually exist for — genuine parallel work — without rejecting correct
single-agent work.

If overlap warnings start showing up on PRs that *are* the multi-agent,
uncoordinated-consumer case this doc exists to prevent, revisit this
decision — a warning only works if someone reads it.
