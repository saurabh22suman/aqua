# Parallel delivery lanes

All new sessions read AGENTS.md, engineering-standard.md and this folder first.
All use strict RED→GREEN→REFACTOR, secure SDLC and pragmatic SOLID. Only setup is
performed by the coordinator; OpenCode sessions implement. No commits, pushes,
PRs, merges or deploys in this initial assignment; report reviewable local diffs.
Feature delivery eventually targets develop, human promotion to main afterward.

## Baseline preservation and integration

Original owner/chart/history work remains in the original checkout and its
completed session history. ui-system contains an explicit source-only snapshot
and baseline.json plus reviewed docs cleanup; no .env, .next, credentials or
node_modules were copied. Every new worktree starts at develop b22b3cd with this
same UNCOMMITTED overlay. A plain diff against develop therefore includes other
people's work: review against the recorded snapshot and stage only assigned
paths if later authorized. Do not commit the overlay as your feature. Integration
coordinator must review/package the inherited baseline separately before PRs.

Docs/CI maintenance worktrees remain separate and uncommitted. None of these
snapshots is a claim that the complete combined baseline is green. Preserve
existing known failures and report new versus baseline failures distinctly.
Do not restore/reset/stash somebody else's work. Before finishing save a task
handoff including files actually changed and exact RED/GREEN evidence.

## Assigned scopes and dependencies

| Lane | Branch / directory suffix | Exclusive write scope | Initial delivery |
| --- | --- | --- | --- |
| UI foundation | feat/ui-foundation / ui-foundation | app/globals.css, root app/layout.tsx, components/ui/**, components/owner-shell.tsx, components/owner-side-nav.tsx, components/bottom-nav.tsx, theme modules under components/theme/** and lib/theme/**, package.json/pnpm-lock.yaml/components.json, root DESIGN.md, agent-owned foundation tests | Two themes, selected shadcn source wrappers, responsive shell and motion primitives, component fixture |
| Tenant PWA | feat/tenant-pwa / tenant-pwa | app/manifest.ts or own manifest route, public manifest/icons, public/sw.js, components/sw-registrar.tsx, components/pwa/**, lib/offline/**, own PWA and offline tests | Installability/update/offline UX preserving security; request root metadata changes from foundation |
| Screen contracts | design/screen-contracts / screen-contracts | docs/design-system/screens.md, flows.md, component-usage.md and own design previews | Route-by-route role/task map, states and responsive composition; no product code edits |
| Backend insights | feat/owner-insights / owner-insights | lib/services/owner-insights.ts, lib/actions/owner-insights.ts only if needed, own insight types/tests | Scoped attendance-by-batch and current enquiry-stage read models; no money/schema refactor |
| Mock gate access | feat/mock-access / mock-access | new lib/services/mock-access/**, new lib/actions/mock-access/** only if required, new db/schema/mock-access.ts and new migration if justified, own tests/docs/mock-access.md | Mock-only main PIN/RFID and two court RFID gate decisions/logs/override contracts |

Use new files inside exclusive directories where possible. Shared barrel exports,
action permission map, root metadata, dependency additions and integration wiring
are change requests to their one owner/coordinator, not cross-lane edits. No writer
may silently add permissions or expose an unfinished API. Backend contracts can be
implemented/tested at service boundary first; actions require real authorization
before exposure. RFID is sole owner of any new migrations this wave; use the
existing migration generator, enforce tenant RLS/audit and no destructive changes.
UI pages consume backend contracts only after an agreed handoff.

PWA and UI foundation coordinate theme metadata without both editing root layout.
Screen-contract lane inspects existing pages but cannot change UI primitives or
page code. Owner page migration, coach/reception pages and ops redesign start as
subsequent separate assignments after foundation interfaces and screens are ready.
Customer features remain only those already authorized; no complete new customer
app created from the eight-screen illustration.

## Runtime ownership

Dedicated dev ports: foundation3111, PWA3112, insights3114, access3115. Screen
contracts use static previews3113 only when useful. Each writer prepares its own
disposable DB/profile on55441/55442/55444/55445 respectively; inspect occupied
ports rather than kill them. None uses main localhost3100 or its club DB for tests.
Own node_modules installs and .next only. Do not share ignored runtime files.

To limit workstation load, run focused tests first. Full release builds require
one serialized build slot across these lanes (coordinate before starting); no
parallel full builds/Docker image builds. Leave human servers untouched. Evidence
must identify role, URL, viewport, revision+dirty delta and build mode.

## Integration gates

Every behavior has real RED then GREEN and refactor evidence; security cases
reviewed; typecheck/lint/scanners relevant; physical PWA testing pending honestly
if unavailable. UI acceptance is separate from functional checks. Independent
review must exercise real long-page scrolling and all changed controls/states.
No weakening protected tests or budgets, no paid delivery, no false completion.
