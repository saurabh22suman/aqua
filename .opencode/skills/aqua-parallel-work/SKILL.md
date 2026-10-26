---
name: aqua-parallel-work
description: Coordinate multiple Aqua OpenCode sessions, isolated worktrees and reviewed integration into develop. Use for splitting tasks, assigning file ownership, handing off branches or preparing integration; not for ordinary single-file edits.
---

Read AGENTS.md and docs/agent-workflow.md. Latest human authorization controls
commits, pushes and merges; do not infer it from this skill.

1. Inspect dirty work, worktrees, branches, active sessions and owned processes.
   Preserve existing WIP. Confirm develop base/upstream; if missing, report the
   prerequisite rather than quietly branch from main.
2. Partition tasks by file ownership and dependency. Record the assignment
   fields from the workflow doc. Shell/tokens/primitives and shared contracts
   each have one owner; defer dependent tasks until the interface is agreed.
3. Give each writer an isolated worktree/branch, separate ports/DB/build output,
   only relevant instructions and an acceptance contract. Ensure uncommitted
   harness setup is provisioned deliberately; worktrees do not inherit it.
4. Coordinate blockers and handoffs without expanding scopes. Reviewers read
   independently; they do not modify a builder's files or declare tests run.
5. All feature PRs target develop. Only an explicitly designated integrator
   merges after required approvals/checks, serially, then verifies the combined
   revision. No feature self-merges, approval-label bypass or direct main work.
6. Human alone promotes tested develop to main. Report exact evidence and any
   remaining remote protection/CI prerequisites; instructions are not enforcement.

Do not launch unrelated design tasks merely because parallel sessions are
allowed. A documentation/setup-only request does not authorize implementing the
next redesign. Preserve selected models and show native terminal sessions when
requested.
