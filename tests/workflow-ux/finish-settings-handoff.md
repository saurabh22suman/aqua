# Finish lane: settings — club-facing workflow UX

Date: 2026-11-21
Worktree: `/home/soloengine/Documents/Codex/2026-11-20/khelsuite-audit-2026-11-20/work/all-role-brief/finish-lanes/settings`
Branch state: current dirty continuation overlay preserved. No commit, push, deploy or shared-process change.

> Path note: the requested `/tmp/khelsuite-finish-settings-handoff.md` could not be created because the sandbox rejects writes outside this worktree (`write` and `touch` were both blocked). This file is the same handoff, kept under the lane-owned `tests/workflow-ux/` directory. Copy it to `/tmp` from a shell with normal permissions if the exact path is required.

## Scope actually touched

Owner settings route files:

- `app/(owner)/owner/settings/page.tsx`
- `app/(owner)/owner/settings/academy/page.tsx`
- `app/(owner)/owner/settings/activities/page.tsx`
- `app/(owner)/owner/settings/alerts/page.tsx`
- `app/(owner)/owner/settings/appearance/page.tsx`
- `app/(owner)/owner/settings/booking-prices/page.tsx`
- `app/(owner)/owner/settings/branding/page.tsx`
- `app/(owner)/owner/settings/configuration/page.tsx`
- `app/(owner)/owner/settings/holidays/page.tsx`
- `app/(owner)/owner/settings/locations/[locationId]/page.tsx`
- `app/(owner)/owner/settings/menu/page.tsx`
- `app/(owner)/owner/settings/payment-qrs/page.tsx`
- `app/(owner)/owner/settings/plans/page.tsx`
- `app/(owner)/owner/settings/skills/page.tsx`
- `app/(owner)/owner/settings/workspace/page.tsx` (existing untracked overlay file, edited in place)

Settings-owned components:

- `components/settings/location-manager.tsx`
- `components/settings/settings-states.tsx` (new, shared recovery/prerequisite shapes)

Tests:

- `tests/workflow-ux/finish-settings.test.tsx` (new, 17 mocked jsdom tests; agent-owned, not tier1)

Not touched: owner shell, facility-scope authority, token vocabulary/globals, settings schema, configuration registry code, migrations, env/secrets, API authorization, `DESIGN.md`, other worktrees.

Count: 18 assigned routes audited; 16 have page/composition changes (locations changes through its settings-owned manager); 2 are unchanged and listed below with their existing evidence.

## Verification status (important)

I could not execute commands in this worktree. The harness rejected `pnpm`, `node`, `bash -lc`, and even `git --version` with “Blocked by configuration policy”; only read-style git/ls/grep operations were permitted. Therefore:

- The tests were authored before the production edits, but **no RED or GREEN output was observed in this environment**. Do not treat this handoff as test-verified.
- No typecheck, lint, build or browser evidence was produced here.
- The tests are mocked unit checks, not browser proof.
- No existing test was modified.

Coordinator follow-up commands (isolated test DB, not the development club):

```sh
DATABASE_URL=postgresql://app_login:<pw>@127.0.0.1:5432/<isolated_db> \
MIGRATION_DATABASE_URL=postgresql://aqua:<pw>@127.0.0.1:5432/<isolated_db> \
pnpm exec vitest run tests/workflow-ux/finish-settings.test.tsx

pnpm typecheck
pnpm lint
```

Highest-value existing regressions to run alongside:

```text
tests/master-workflows-20261113/settings-setup.test.tsx
tests/master-workflows-20261113/booking-price-return.test.tsx
tests/master-workflows-20261113/closure-review-integration.test.tsx
tests/owner-card-design-20261116/navigation/settings-cards.test.tsx
tests/owner-redesign-20261116/navigation/settings-cards.test.tsx
tests/owner-redesign-20261116/navigation/settings.test.ts
tests/facility-branding-20261114/facility-ui-entry.test.tsx
tests/facility-branding-20261114/facility-ui-route.test.tsx
tests/facility-branding-20261114/facility-ui-club-default.test.tsx
tests/master-family-platform-20261113/branding-install-entry.test.tsx
tests/mobile/back-link-wiring-guard.test.ts
tests/mobile/owner-fees-hub.test.tsx
tests/mobile/cafe-surface-guard.test.ts
tests/tier1/loading-files.test.ts
```

## Route-by-route audit and change

### 1. `/owner/settings` — `app/(owner)/owner/settings/page.tsx`

- User goal: find the right settings task and the clubs they run.
- Observed problem: the overview showed one card per club, but those cards open the club’s *financial* page. There was no persistent route from the overview to the club editor where a club is added and its address/hours are changed. Category and back links were plain `<a>` (full document navigation).
- Change: added a 44px “Manage club” / “Manage clubs” link to the Club settings header pointing at `/owner/settings/locations`; switched the category rows and category back link to `OwnerLink`. Existing business-account card, club cards, permission filtering, category deep links and account/install area remain.
- Preserved: destination permission map, feature gates (`reports`, `messaging`), category test ids/labels, onboarding checklist, sign-out.
- Re-verify: two locations (plural label), one location (singular), zero locations, restricted permissions; keyboard focus on the new link.

### 2. `/owner/settings/academy` — `app/(owner)/owner/settings/academy/page.tsx`

- User goal: correct the club identity and the legal/billing identity used on future invoices.
- Observed problem: two independently saving forms are stacked. An owner can edit both and press one Save, then reasonably assume both persisted.
- Change: added a short “Club identity and billing identity save separately” note above the forms. Existing club-default error recovery, plan-price and booking-price links remain.
- Re-verify: edit only identity, only billing, both; error state; non-INR/stored-timezone notices.

### 3. `/owner/settings/activities` — `app/(owner)/owner/settings/activities/page.tsx`

- User goal: define the pool/court/table resources at each site.
- Observed problem: used a bespoke small uppercase breadcrumb instead of the shared 44px back link; “Next: Club profile & GST” sent the owner backwards rather than to the catalogues these resources unlock.
- Change: shared `BackLink`; a “Next steps” nav to Membership plans and Booking slot prices. The manager still owns per-site empty states and the link to add a physical site.
- Re-verify: no sites (manager recovery), one site with no resources, several resources with long names.

### 4. `/owner/settings/alerts` — `app/(owner)/owner/settings/alerts/page.tsx`

- User goal: set the monthly low-attendance threshold.
- Observed problem: a rejected threshold read crashed the route; a failed read was not distinguished from a real threshold.
- Change: recoverable read state with `role="alert"` and a “Try again” link to the same route; the form is not rendered with a default/zero value. The fixed-rule copy and form are unchanged.
- Re-verify: normal threshold, rejected read, 0/100 boundaries, keyboard number input.

### 5. `/owner/settings/appearance` — `app/(owner)/owner/settings/appearance/page.tsx`

- User goal: choose their personal theme and artwork.
- Observed problem: no route back to Settings from the page; the page title “Appearance” did not match the hub destination “Theme & artwork”.
- Change: shared `BackLink`; h1 is now “Theme & artwork”. The existing per-device wording and three-preset choice are unchanged.
- Re-verify: all three presets, artwork choice, reduced motion, 390×844 and 1280×900.

### 6. `/owner/settings/booking-prices` — `app/(owner)/owner/settings/booking-prices/page.tsx`

- User goal: price resource slots by day/time.
- Observed problem: with no resources the page opened a price catalogue the owner could not meaningfully complete, with no route to the blocking task; bespoke breadcrumb.
- Change: shared `BackLink`; a prerequisite notice (“No sports resources yet”) with a link to `/owner/settings/activities`. The return-to-selected-slot link and query preservation are unchanged.
- Re-verify: no resources; one resource with no rules; return query (`resource`, `date`, `slot`, `facility`).

### 7. `/owner/settings/branding` — `app/(owner)/owner/settings/branding/page.tsx`

- User goal: set display name, short name, accent, logo and install icon.
- Observed problem: visual branding and the legal GST/billing identity are distinct, but the page offered no direct route to the legal profile.
- Change: header action “Club profile & GST” to `/owner/settings/academy`. The install link and branding form are unchanged.
- Re-verify: logo/accent change, install entry, long display name.

### 8. `/owner/settings/configuration` — `app/(owner)/owner/settings/configuration/page.tsx`

- User goal: understand effective business rules and request changes to platform-held values.
- Observed problem: a registry read rejection crashed; an unavailable read looked like an empty one; a long rules list had no visible size; bespoke breadcrumb.
- Change: shared `BackLink`; recoverable read error with retry; “N effective rule(s)” count above the list. The empty state and the registry form are unchanged.
- Re-verify: zero rules, one rule, many rules, rejected read, read-only vs editable keys.

### 9. `/owner/settings/holidays` — `app/(owner)/owner/settings/holidays/page.tsx`

- User goal: declare closures so sessions are not generated.
- Observed problem: a rejected holiday read crashed the route; an unavailable calendar could be mistaken for “no closures”.
- Change: recoverable read error with retry; the board is not rendered as an empty calendar on failure. Existing affected-session review remains.
- Re-verify: one-off closure, recurring closure, no affected sessions, >2 affected sessions, rejected read.

### 10. `/owner/settings/locations` — `app/(owner)/owner/settings/locations/page.tsx` via `components/settings/location-manager.tsx`

- User goal: add/edit a club, its address and weekly hours.
- Observed problem: with zero locations the add section said “Add a second location”, which is false for the first site.
- Change: the add heading/copy now say “Add your first location”, “Add a second location” or “Add another location” based on the real count. Existing per-site cards, hours editor, financial-settings link, single-site wording and create form remain.
- Re-verify: 0, 1, 2+ locations; save success/failure; hours not set; long site names.

### 11. `/owner/settings/locations/[locationId]` — `app/(owner)/owner/settings/locations/[locationId]/page.tsx`

- User goal: set the site’s financial/billing identity.
- Observed problem: the hub opens this page from a club card, but the page only offered a back link to the list; there was no direct route to the club’s own address/hours.
- Change: header action “Edit club details and hours” to `/owner/settings/locations`. Existing UUID validation, not-found behaviour, error/retry and billing form are unchanged.
- Re-verify: inheriting site, overriding site, foreign/missing site, read failure.

### 12. `/owner/settings/menu` — `app/(owner)/owner/settings/menu/page.tsx`

- User goal: build the café catalogue.
- Observed problem: a menu category attaches to a site; with none, the form had no usable destination and no explanation; bespoke breadcrumb.
- Change: shared `BackLink`; facility prerequisite with a link to add a physical facility. The manager’s category/item empty states remain.
- Re-verify: no locations, empty catalogue, categories/items, long item names and prices.

### 13. `/owner/settings/payment-qrs` — `app/(owner)/owner/settings/payment-qrs/page.tsx`

- User goal: manage the QRs reception shows for collection.
- Observed problem: bespoke breadcrumb (small target and inconsistent with sibling pages). The manager already has a truthful empty state.
- Change: shared 44px `BackLink` only. Manager behaviour is unchanged.
- Re-verify: zero QRs, several QRs, missing image, reception read-only view.

### 14. `/owner/settings/plans` — `app/(owner)/owner/settings/plans/page.tsx`

- User goal: price membership plans members can subscribe to.
- Observed problem: a plan attaches to a site; with no site the page gave no route to unblock it; purpose was terse; bespoke breadcrumb.
- Change: shared `BackLink`; fuller purpose; facility prerequisite with a link to add a physical facility. `PlanManager` and the `settings.manage` 404 guard are unchanged.
- Re-verify: no locations, templates + location, custom plan, long plan names/prices.

### 15. `/owner/settings/reports` — unchanged

- Existing evidence: `BackLink` to the scoped reports URL; `reports.operational` guard; feature check with an explicit unavailable state; available report families filtered by `staff.attendance`, `reports.financial` + `invoices.read` + `billing`; the editor states “Personal to you on this device; access does not change.” and reports a failed local write.
- No workflow gap found that justified a change in this lane.
- Exact re-verification: 390×844 and 1280×900; financial vs non-financial user; reports feature off; toggle write failure; back link retains facility query.

### 16. `/owner/settings/skills` — `app/(owner)/owner/settings/skills/page.tsx`

- User goal: review/edit the level and rubric ladder.
- Observed problem: bespoke breadcrumb; the disabled state lacked the shared 44px route back.
- Change: shared `BackLink`. The `swim.levels` disabled state and read-only vs `levels.write` behavior are unchanged.
- Re-verify: module off, module on with empty ladder, read-only, editable.

### 17. `/owner/settings/terminology` — unchanged

- Existing evidence: `BackLink`; locale is in the URL; three locale choices with `aria-current`; read-only note for Hindi/Bengali; editor keyed by locale so state cannot leak across a switch; closed TERM_KEYS only.
- No workflow gap found that justified a change in this lane.
- Exact re-verification: `?locale=en|hi|bn`, keyboard locale switch, saved overrides, long localized labels.

### 18. `/owner/settings/workspace` — `app/(owner)/owner/settings/workspace/page.tsx`

- User goal: choose where the workspace opens on this device.
- Observed problem: no route back to Settings; title “Workspace preferences” differed from the hub destination “Default facility”.
- Change: shared `BackLink`; h1 “Default facility”. The existing device-scoped form help, reports feature guard and visible-facility filtering are unchanged.
- Re-verify: all facilities, assigned subset, invalid saved cookie, no facilities.

## New tests (`tests/workflow-ux/finish-settings.test.tsx`)

17 mocked jsdom tests covering:

1. Manage-clubs route on the settings overview.
2. Academy independent-save note.
3. Activities back link and next catalogues.
4. Alerts read recovery.
5. Branding → legal profile link.
6. Appearance naming/back link.
7. Booking-prices resource prerequisite.
8. Configuration error vs empty.
9. Configuration effective-rule count.
10. Holidays read recovery.
11. First-vs-second location add label.
12. Facility financial → club details link.
13. Menu facility prerequisite.
14. Payment-QR back link.
15. Plans facility prerequisite.
16. Skills back link while the module is off.
17. Workspace naming/back link.

Mocks are deliberately local: auth guards, actions, service reads, server cookie store and the heavy managers. The test uses no real DB and no browser. It asserts route targets and visible states, not layout geometry or computed styles.

Fixture needs for the coordinator’s real-browser pass:

- Two clubs, one with no business hours and one with hours.
- One club with zero sports resources; one with a pool/court.
- A plan template and a member for subscription entry.
- A café menu category/item and a QR with a real image.
- A closed recurring holiday with at least two affected sessions.
- An owner with all settings permissions; a restricted owner without `staff.read`, `members.read`, `levels.read` or `reports` feature as applicable.
- A rejected/offline read for alerts, configuration and holidays if the integrated build can simulate it; otherwise inspect the client error boundary only and mark the recovery path unproven in-browser.

## Residual risks / review gates

- No test execution, typecheck or lint result exists from this worktree because command execution was blocked. The first coordinator action should be the focused test + `pnpm typecheck` + `pnpm lint`.
- The new `.catch(() => null)` recovery paths deliberately convert read rejection into a visible error state. They do not alter guards or authorization, but should be reviewed for any action that uses thrown errors for control flow.
- The settings hub’s new club-management link is additive; confirm the single-location label on the integrated build (it renders “Manage club”, not “Manage clubs”).
- Browser visual acceptance (390×844 and 1280×900, all three presets, reduced motion) is not established here. The coordinator owns before/after captures and the real integrated verification.
