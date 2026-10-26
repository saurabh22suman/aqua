# OpenCode tooling

- Project skills are in `.agents/skills/` and `.opencode/skills/`; OpenCode also discovers the existing
  `.claude/skills/execute-task`. Load skills only for the task they describe.
- Repository instructions and installed package versions override upstream
  skills. In particular, Better Auth's generic `drizzle-kit push` workflow does
  not apply; React cache advice must preserve tenant scoping and audit atomicity.
- Use Context7 `resolve-library-id`, then `query-docs`, stating the installed
  version. If unavailable, read version-matched official docs and report the
  fallback; do not silently use current-major examples.
- `@aqua-review` and `@aqua-ui-review` are read-only review subagents. Give them
  specific files/diffs and a question; request browser evidence from the primary
  agent when needed. Review agents do not run tests or change files.
- OpenCode **V2** is active. Config, agents and commands use native V2 syntax;
  do not use the V1 server API or assume V2 provides LSP diagnostics.
- `/aqua-doctor` checks the environment; `/aqua-test-env` prepares an isolated
  disposable test database; `/aqua-check` runs quick/focused checks; `/verify`
  runs the release gate with build ownership protection. Load aqua-verification.
- `/review <scope>` invokes the static reviewer; `/aqua-ui-check` invokes the
  independent browser reviewer. Browser evidence and static inspection are
  different checks. Reviewers inherit the selected model.
- Current task state comes from the latest human instruction and dated handoff,
  not a permanent paused/completed flag in this file. Read the owner handoff
  before continuing its WIP; do not restart design without a design assignment.
- Load `aqua-ui-quality` for UI work and `aqua-parallel-work` for multiple
  sessions/branch integration. Read docs/ui-quality-contract.md and
  docs/agent-workflow.md respectively. Feature PRs target develop; only the
  human promotes develop to main after testing. No feature self-merge.
- Tooling/harness edits and owner-feature WIP are separate scopes. Preserve
  unrelated edits; every session has a worktree, branch, file ownership, ports,
  test DB and acceptance contract. Never run two writers in one checkout.
- Paid provider integrations use mocks in this phase; WhatsApp capture already
  exists and must be reused. Do not activate a paid provider to satisfy a test.
- Use `opencode reload` after configuration edits, or restart the relevant V2
  client. Never restart or message an unrelated project/session as a setup step.

- All implementation uses aqua-tdd-secure and docs/engineering-standard.md:
  intended failing test first, then green, refactor, security review and evidence.
  Current design program: docs/design-system/README.md; exclusive lane ownership
  and inherited baseline rules: docs/design-system/delivery.md. Setup-only human
  coordination does not authorize the coordinator to implement product code.
