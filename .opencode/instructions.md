# OpenCode tooling

- Project skills are in `.agents/skills/`; OpenCode also discovers the existing
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
- `/verify` runs the repo gate; `/task <ID>` uses the numbered-task skill;
  `/review <scope>` invokes the code reviewer. Restart OpenCode after tooling
  changes; discovery/configuration is loaded at startup.
