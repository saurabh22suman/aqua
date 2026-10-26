---
name: aqua-verification
description: Run Aqua verification against its isolated local test database and serialize build resources. Use for tests, release checks and environment diagnosis; do not use to reset or seed the running development club.
---

Read AGENTS.md, db/CLAUDE.md for data work and docs/opencode-development.md.
The active runtime is OpenCode V2. Use the project's real commands, not an
assumed monorepo or Next 16 workflow. Node 22, pnpm from packageManager.

- `python3 .opencode/scripts/harness.py doctor` shows branch, process ownership,
  paused handoff and private test-profile readiness without exposing credentials.
- `python3 .opencode/scripts/harness.py prepare-test` creates a separate local
  disposable Postgres container and ignored mode-0600 test profile. It runs
  db:deploy, never db:reset, and does not change root .env. If the container or
  port is already owned, inspect it rather than deleting it. The tmpfs data is
  disposable; do not stop/restart the container casually and assume it persists.
- `python3 .opencode/scripts/harness.py quick` runs typecheck and lint.
- `python3 .opencode/scripts/harness.py test tests/path.test.ts` runs focused
  Vitest through pnpm test, preserving pretest. With no file paths it runs the
  full serial sharded suite. Do not bypass the guard with development exports.
- `python3 .opencode/scripts/harness.py release` runs typecheck, lint, sharded
  tests, focus contrast, build and bundle/font gates serially. It refuses if a
  Next process owns the same checkout. Use a separate verification worktree
  rather than killing another owner's server. Relevant CI scanners and e2es
  still apply; the harness is not a replacement for the full workflow inventory.

Each worktree generates its own test database/profile. Do not share test DBs,
ports or build output between writers. Keep files serial under current Vitest
contracts. Full application failures may belong to paused/incomplete work:
report them honestly, never weaken protected tier1 tests to pass.

For browser checks use the isolated Playwright MCP, supplied safe fixtures and
required role viewports. Run checks against the intended branch and wait for
hydration before testing controls. Verify actual outcomes and distinguish
tool/server readiness problems from application bugs. No paid external delivery;
reuse the existing WhatsApp capture mock. Record untested states explicitly.

For UI work also load aqua-ui-quality; a functional gate cannot certify visual
quality. For parallel sessions read docs/agent-workflow.md and use distinct DB
ports (the default 55433 is not automatically allocated). All feature PRs target
develop; final integrated verification must identify the combined revision.
