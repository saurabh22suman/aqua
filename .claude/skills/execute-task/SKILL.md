---
name: execute-task
description: >
  Execute a numbered task from docs/implementation-plan.md (IDs like
  S-01, F-08, B-05, C-22, V-45). Reads the task and its dependencies,
  implements the smallest change that satisfies Done when, runs the
  verification gate, proves tests can fail, commits with the task ID
  prefix, and stops or continues according to the task's stop level.
---

# Execute task

## Loop

1. Read the task in `docs/implementation-plan.md` plus every task it
   depends on. Read any section it cites (`Read first:`).
2. Classify the **stop level** (below). When a task spans several
   subjects, the highest tier wins.
3. Build the smallest change that satisfies **Done when**. Follow
   existing conventions; do not redesign.
4. Verify. Run `pnpm typecheck && pnpm lint && pnpm test` minimum;
   run the task-specific proof where one is named. A green test alone
   proves nothing — show that breaking the thing makes the test red
   (mutation proof), whenever the task guards a safety property.
5. Commit once, message prefixed with the task ID:
   `feat(B4): ...`, `docs(V-45): ...`. One commit per task.
6. Act on the stop level.

## Stop levels

Assigned per task in the plan. Standing classification for tasks
without an explicit level:

**GREEN — build, verify, commit, CONTINUE without asking.**
Schema for non-sensitive tables, UI, reports, CRUD, seeds, refactors
contained within a task.

**AMBER — build, verify, commit, then STOP and report.**
Anything that adds a dependency; any schema change to a table from a
completed task; anything altering a migration pattern; anything that
changes a decision recorded in architecture.md.

**RED — STOP BEFORE BUILDING. Propose, wait for approval.**
Tenant isolation, authentication, money, children's data, consent,
anything carrying a FLAGGED DECISION NEEDED marker, anything requiring
legal input.

A GREEN task that turns out to need a new dependency or to touch a
completed task's schema becomes AMBER on the spot: commit nothing
further, stop, report.

## Batch execution

When the instruction is a range ("run B3 to B8", "continue until the
next stop"): execute consecutive tasks, pausing only at the first
AMBER or RED task (report and wait there), or at the end of the range.
Skip tasks already marked complete in the plan unless asked to redo
them.

End-of-batch report — one block, never one per task:

- tasks completed, with commit hashes
- verification evidence per task, condensed
- anything deferred or noticed
- why you stopped
- what you propose next

## Verification gate

Never claim done without running:

```
pnpm typecheck && pnpm lint && pnpm test
```

plus the task's own proof. For data-layer work add `pnpm db:migrate`
against a clean database and, when RLS or grants changed, the pg_class
and role-flag queries from `docs/review-checklist.md`.
