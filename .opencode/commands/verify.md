---
description: Run Aqua's verification gate against an explicitly dedicated test database
agent: build
---

Read AGENTS.md and docs/opencode-development.md. Verify the selected database is
dedicated to tests before invoking pretest or tests; do not assume localhost:5432
belongs to Aqua. Run pnpm typecheck && pnpm lint && pnpm test && pnpm build.
Use pnpm test:sharded instead of pnpm test if full-suite memory is a concern;
report the substitution. Never run a build while another process owns .next.
Run the task-specific scanners/e2es justified by $ARGUMENTS. Report commands,
exit status, failures and skipped prerequisites; do not commit, push or merge.
