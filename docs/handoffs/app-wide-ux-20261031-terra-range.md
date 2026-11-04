# Home range navigation handoff — 31 October 2026

Branch `fix/app-wide-ux-20261031`, HEAD `54e6d80c25164da8c85c8e33c41511ae467f3d54` plus inherited uncommitted overlay. Runtime metadata: approved `openai/gpt-6.1-terra`. No commit.

## Scope and behavior
- `components/owner-home/owner-home-range.tsx`: only the three Home range controls now use same-origin anchors instead of Next Links. Existing URL/facility construction, accessible names, selected state and styling are unchanged. A range change performs a full GET and authoritative server render rather than a client transition; native new-tab and Back behavior are preserved by the link mechanism, pending browser verification.
- Removed only `tests/app-wide-ux-20261031/owner-range-prefetch.test.tsx`, the implementation-mirroring probe for the unsuccessful prefetch trial. Existing range/facility/money assertions remain.
- No calendar, Select, time, lib, DB, auth, money, global CSS, dependency or protected-test edits; inherited WIP and other worktrees preserved.

## Actual evidence
- Pre-edit intended production browser RED: `.playwright-mcp/app-wide-ux-20261031/chrome-discriminator-10/navigation.json` records four Day/Month timeouts with and without remembered facility, URL/selection unchanged; both Settings journeys passed. This followed the unsuccessful scoped prefetch opt-out. The task packet reports direct Day/Month GETs return 200 with correct selection; browser GREEN for this edit is not yet available.
- Coordinator's diagnostic 10 reports calendar suite passed; no calendar work was performed in this task. Earlier diagnostic 9 stale-CSS findings are not treated as current source defects.
- `NODE_OPTIONS=--max-old-space-size=2048 python3 .opencode/scripts/lane_job.py harness test --profile .env.aqua-harness-regression.local -- tests/app-wide-ux-20261031/owner-home-range-toolbar.test.tsx tests/mobile/facility-switcher.test.tsx tests/owner-home-surface.test.tsx --reporter=verbose`: exit 0, 23 passed / 3 files; `.playwright-mcp/app-wide-ux-20261031/terra-range-evidence/focused.log`. Harness verified disposable `aqua_test_c1a05ac212` / `app_login`.
- `NODE_OPTIONS=--max-old-space-size=2048 python3 .opencode/scripts/lane_job.py harness quick`: exit 0, typecheck and lint passed; `terra-range-evidence/quick.log`.

## Verdict and next action
- **Functional: PARTIAL**, focused tests pass but actual browser navigation on the new artifact is unverified. **Semantic: scoped range/facility assertions pass; independent journey review pending.** **Visual: BLOCKED** pending fresh production browser review.
- Coordinator owns source freeze, clean production build, full suite and same Chrome journeys. Verify Day/Month with and without facility, URL and selected state, Back, and open-in-new-tab; record actual browser GREEN or failure. No build, preview, background job, browser run, deployment, push, PR or merge by worker.
