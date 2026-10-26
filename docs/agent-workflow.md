# Aqua agent collaboration and integration

Effective 26 October 2026. This supersedes historical roadmap/skill instructions
that feature branches or PRs target main. Latest human task authorization wins.

## Branch flow

`develop → feature/fix branch → reviewed PR to develop → integrated testing → human promotion to main`

- New tasks branch from latest fetched develop. Never silently fall back to
  main when develop is missing. The initial develop was created from origin/main b22b3cd on 26 October
  and is now published as origin/develop. Publishing that baseline did not
  integrate the owner or harness changes; follow the integration PR and fetched
  remote revision for the current state.
- Existing feat/owner-dashboard-composition WIP stays where it is. Do not reset,
  stash, switch, cherry-pick partial files or pretend it is in develop. Package
  it separately after review and authorization; integrate via the same process.
- Feature agents implement/verify only their assigned branch and report evidence.
  Commit/push/create PR only when their assignment authorizes it. Feature PRs
  target develop. No direct pushes to main/develop, self-merges or auto-merge.
- A designated integrator may merge approved feature PRs into develop only with
  explicit assignment, green required PR checks and independent review. Protected
  changes still require the existing human approvals; never self-apply labels.
- Only the human promotes develop to main after integrated testing and visual
  acceptance. Never auto-deploy from agent completion. Publishing a develop
  branch is not permission to change production Dokploy tracking.
- Local instructions do not enforce repository rules. Before first remote
  integration verify develop exists remotely, PR checks run for that base and
  branch protections/rulesets are appropriate. CI currently runs all PR bases
  but push CI is main-only; develop push CI/protection is a separate reviewed
  workflow task. Do not weaken main protections or claim these are configured.

## Parallel session contract

Coordinator records one compact assignment per task before launching writers:

| Field | Required value |
| --- | --- |
| Identity | task, OpenCode session ID, owner/coordinator |
| Git | base SHA, feature branch, absolute worktree path |
| Write scope | exact files/directories; shared files explicitly excluded |
| Dependencies | needed upstream interface/commit; blockers and merge order |
| Runtime | dev URL/port, test profile/DB/port, process ownership |
| Acceptance | user outcome, regression scope, browser/functional evidence |
| Delivery | commit/PR authority, target develop, review/integration owner |

- Each writer has a separate Git worktree and branch, its own .next, dev port
  and disposable test DB. Harness default port 55433 is not a pool: select a
  distinct free DB port per worktree. Do not copy dev credentials into task
  instructions, share mutable fixtures or use the running club as a test DB.
- New worktrees contain committed files only. Until this harness is committed,
  coordinator must explicitly provision its reviewed tooling changes without
  sweeping owner WIP into other tasks. Do not assume worktrees inherit setup.
- One owner for shell/layout/nav, globals/tokens, DESIGN.md, package manifests
  and shared primitives. A page task needing those changes sends a request to
  that owner; it does not edit them in parallel. Schema/migrations also have
  one integration owner. Partition by dependency and files, not arbitrary pages.
- Agree interfaces first. If scopes overlap, serialize or move shared work into
  a prerequisite task. Read-only reviews may run in parallel with writers.
- Use independent OpenCode sessions with explicit cwd/branch; open native
  computer terminals with descriptive task titles when the human asks. Keep
  credentials/model choice unchanged. Messages are explicit task assignments,
  not permission to contact unrelated sessions or external recipients.
- Before stopping, save a dated handoff with exact branch/dirty files, completed
  and pending work, evidence, blockers and owned process/resource IDs. Never
  mark unfinished work complete to meet a speed request.

## Integration checklist

1. Inspect each feature diff against its recorded base and check ownership.
2. Independent code review plus independent browser review for UI; fix findings.
3. Run focused checks and required CI on the proposed feature PR to develop.
4. Integrator serializes merges; resolve semantic conflicts, not just Git markers.
5. Re-run affected checks on combined develop and full release gate at the final
   integration revision; test real browser navigation across joined features.
6. Report revision, test totals/skips/failures, screenshots, unresolved defects
   and whether human design approval is still pending. No silent failure waivers.
7. Human decides promotion to main. A green gate is evidence, not permission.
