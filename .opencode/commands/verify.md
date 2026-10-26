---
description: Run Aqua's verification gate against an explicitly dedicated test database
agent: build
---

Load aqua-verification. Run `python3 .opencode/scripts/harness.py release` with
the checkout's generated disposable test profile. Do not use development exports
or run a build alongside a Next process owning the same .next directory. Use a
separate verification worktree when necessary. Run the task-specific CI scanners
and e2es justified by $ARGUMENTS in the same isolated test environment. Report
commands, exit results, failures and skipped prerequisites; do not commit, push,
merge, deploy or resume paused implementation.
