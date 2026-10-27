# Owner Home — Lavender Club Option B (feat/owner-lavender-b8)

**Status:** local, reviewable implementation. No commit, no push, no PR, no merge, no
deploy, no approval labels. Nothing was committed; the worktree holds the change
for the coordinator to review against the inherited snapshot.

**Branch / base:** `feat/owner-lavender-b8`, based on `origin/develop`
`d692fd322ca8aa369e23ee0b6056130e57aee298`. The inherited 29-file uncommitted
overlay (`integration-batch5-20261027`, manifest
`/home/soloengine/.local/share/aqua-task-backups/owner-lavender-b8/inherited-baseline.json`)
was **not** reset, stashed, discarded or wholesale staged. 27 of the 29 inherited
files are byte-identical to the manifest; the two that changed are files this
task owns (`app/(owner)/owner/page.tsx`, `components/owner-dashboard.tsx`).

---

## 1. What was built

The human-approved **Lavender Club — Option B** owner home and owner shell, with
the later illustration direction, delivered as **one markup** that renders in
**both** approved presets (Lavender Club Option B and Mint Garden) — no theme
branch, no duplicated page, no second component.

Reference material (provisioned inside this worktree, git-ignored):
`.playwright-mcp/approved-reference/`.

### Owner shell (`components/owner-shell.tsx`, `components/owner-side-nav.tsx`)

- Pale, viewport-bound sidebar: brand mark + academy card above the navigation,
  the account row and the exit control below it. Only the **navigation region**
  scrolls; the brand, the account and the exit control stay reachable on a short
  screen.
- The selected row is the **preset's own selection pill**
  (`--selected-surface` / `--selected-ink`), not a hard-coded white card.
- Compact **56px** sticky header: a breadcrumb derived from the *same*
  navigation list the sidebar renders, the record search, the appearance control.
- Grouped navigation unchanged (Main / Operations / Scheduling / Insights /
  Account); the mobile four-item bottom nav unchanged.

### Owner Home (`components/owner-dashboard.tsx` + `components/owner-home/**`)

1. **Context first** — the tenant's day, the academy and the location the
   figures cover, with a small piece of club artwork beside the heading.
2. **Four figures on a desktop** (2×2 between the shell breakpoint and 1180px,
   four across at ≥1180px); on a phone the two money figures stay as cards and
   the member and session counts collapse into one compact real line.
3. **One dominant action** (Collect payment → the real Dues journey) and quiet
   secondary actions (Add member, Capture enquiry), each behind its permission.
4. **Today's sessions** as a timeline with the real occupancy fraction and a
   capacity bar, a truthful current/next distinction, and an **attention queue**
   in the service's priority order where every item stays reachable and a
   money-late item is never folded away behind the disclosure.
5. **"Money at a glance"** — the collections panel and the payment mix on ONE
   shared Day/Week/Month control **above both panels**, so the two always
   describe the same period; the metric control (Collections / Attendance) stays
   inside the wide panel.
6. The inherited **insights** preview (attendance by batch, enquiries by stage)
   with its progressive disclosure, unchanged.

### Illustrations (`components/illustrations/**`)

- `sport-illustration.tsx` — original SVG art (swimmer, badminton, football) plus
  a neutral club mark, drawn from six semantic **illustration tokens**, on one
  64×48 grid with one stroke language.
- Chosen from the club's **own programme names** (`resolve-sport.ts`), stable for
  the visit via a seed (tenant id + day) — never re-randomised on a re-render,
  a hydration pass or a route change. A specific context wins over the names.
- Static first: no idle loop, no SMIL (which ignores `prefers-reduced-motion`),
  a single small transform on hover/focus, and a still picture for a
  reduced-motion reader.
- `club-footer-art.tsx` — the quiet horizon that closes the sidebar.

### Themes (`app/globals.css`, `lib/theme/**`, `components/theme/**`)

- Lavender Club is now the approved **Option B** palette: canvas `#F8F7FC`,
  sidebar `#EFEBF7`, plum action `#634889`, aubergine ink `#292136`.
- The shared semantic layer stays declared once (it follows the base palette);
  every token whose **value** differs per preset is declared in **both**
  presets. The owner home and shell never branch on the preset.
- New chart-surface tokens (`--chart-axis`, `--chart-grid`,
  `--chart-tooltip-surface/-ink/-border`) so the **ECharts canvas** — series,
  axis, grid, legend and tooltip — is painted from the preset too.

---

## 2. Changed paths

### New (this task)

```
components/illustrations/club-footer-art.tsx
components/illustrations/resolve-sport.ts
components/illustrations/sport-illustration.tsx
components/owner-home/owner-account-control.tsx
components/owner-home/owner-home-actions.tsx
components/owner-home/owner-home-attention.tsx
components/owner-home/owner-home-header.tsx
components/owner-home/owner-home-illustration.tsx
components/owner-home/owner-home-metrics.tsx
components/owner-home/owner-home-timeline.tsx
components/owner-home/session-state.ts
components/owner-shell-crumb.tsx
tests/owner-lavender-b8/illustrations.test.tsx
tests/owner-lavender-b8/owner-home-composition.test.tsx
tests/owner-lavender-b8/owner-home-money.test.tsx
tests/owner-lavender-b8/owner-shell-nav.test.tsx
tests/owner-lavender-b8/theme-plug-and-play.test.ts
docs/handoffs/owner-lavender-b8.md
b8-evidence/**                       (screenshots, git-ignored directory)
```

### Modified — production code

```
app/(owner)/layout.tsx               owner shell host: names the academy, the role
app/(owner)/owner/page.tsx           passes the tenant id as the artwork seed
app/globals.css                      Option B palette, per-preset tokens,
                                     --app-sticky-offset, the `wide` breakpoint,
                                     the artwork motion guard
components/charts/echarts-owner.tsx   chartTheme(): series + axis + grid + legend
                                     + tooltip read from the preset tokens
components/owner-dashboard.tsx        the new composition (orchestration only)
components/owner-home-chart-panels.tsx  phone legend only (the canvas draws its own)
components/owner-home-chart-parts.tsx   ChartLegend accepts a className
components/owner-home-charts.tsx     "Money at a glance" + the shared period control
components/owner-shell.tsx           brand / academy / account / crumb / offset
components/owner-side-nav.tsx        the selected row wears the selection tokens
components/demo-banner-strip.tsx     publishes its height as --app-sticky-offset
                                     (see §6 — a shared component, flagged)
eslint.config.mjs                    ignores the git-ignored .playwright-mcp/
                                     reference boards (see §6 — flagged)
DESIGN.md                            §7 amendment: Lavender Club Option B
docs/ui-quality-contract.md          narrow approved-direction amendment
```

### Modified — existing tests (4, each explained in §6)

```
tests/foundation/owner-chart-theme.test.tsx   the approved Option B plum
tests/mobile/kpi-label-size.test.ts           the tiles moved into a module
tests/mobile/facility-switcher.test.tsx       the layout gained a branding read
tests/review-dashboard-scope.test.ts          the composition moved into modules
```

**Not touched:** any service, action, schema, migration, package or dependency
file; `tests/tier1/**`; the coach, reception, ops and parent surfaces; the
login/reset work in the inherited overlay; the backend booking/enquiry/report
branches.

---

## 3. RED → GREEN → REFACTOR evidence

**RED — the intended failing tests, observed before the implementation.**

New modules were stubbed first (`components/illustrations/resolve-sport.ts` and
`sport-illustration.tsx` existed with a placeholder body) so the imports
resolved and the failures were *behavioural*, not import errors.

```
$ pnpm exec vitest run tests/owner-lavender-b8/
 Test Files  5 failed (5)
      Tests  71 failed | 31 passed (102)
```

Representative failures (all assertion failures, none an import error):

```
FAIL tests/owner-lavender-b8/illustrations.test.tsx > reads a swimming programme as swimming
AssertionError: expected 'club' to be 'swimming'
FAIL tests/owner-lavender-b8/owner-home-composition.test.tsx > names the day, the club and the location the figures cover
TestingLibraryElementError: Unable to find an element by: [data-testid="owner-home-context"]
FAIL tests/owner-lavender-b8/owner-shell-nav.test.tsx > paints the active row with the selection tokens
AssertionError: expected 'flex min-h-11 items-center gap-3 roun…' to contain 'var(--selected-surface)'
FAIL tests/owner-lavender-b8/theme-plug-and-play.test.ts > declares --illustration-ink in the second preset
AssertionError: --illustration-ink missing from the second preset: expected false to be true
```

**GREEN — per area, after the implementation.**

```
$ pnpm exec vitest run tests/owner-lavender-b8/theme-plug-and-play.test.ts
 Test Files  1 passed (1)      Tests  65 passed (65)
$ pnpm exec vitest run tests/owner-lavender-b8/illustrations.test.tsx
 Test Files  1 passed (1)      Tests  11 passed (11)
$ pnpm exec vitest run tests/owner-lavender-b8/owner-home-composition.test.tsx
 Test Files  1 passed (1)      Tests   7 passed (7)
$ pnpm exec vitest run tests/owner-lavender-b8/ tests/owner-today-screen.test.tsx \
    tests/owner-home-surface.test.tsx tests/mobile/dashboard-trends.test.tsx \
    tests/mobile/dashboard-and-lists.test.tsx tests/mobile/kpi-label-size.test.ts \
    tests/mobile/facility-switcher.test.tsx tests/review-dashboard-scope.test.ts \
    tests/foundation/
 Test Files  23 passed (23)    Tests 241 passed (241)
$ pnpm exec vitest run tests/owner-lavender-b8/ tests/owner-today-screen.test.tsx \
    tests/owner-home-surface.test.tsx tests/mobile/ tests/review-dashboard-scope.test.ts \
    tests/foundation/
 Test Files  120 passed (120)  Tests 656 passed (656)
```

**REFACTOR.** The composition was split out of the 470-line dashboard into
`components/owner-home/**` (header, metrics, actions, timeline, attention,
illustration, account control) plus the pure `session-state.ts`; the pure rules
(`registerState`, `nextUpcomingIndex`, `occupancy`, `placesBooked`,
`resolveSportKey`) were extracted so they are testable without a DOM. The suite
was re-run after every extraction and stayed green.

**A full-suite run was also done** (`pnpm test`, 434 files). It surfaced five
failures caused by this refactor and three that were already failing on the
inherited baseline. All five were fixed (§6). The three baseline failures are
unchanged and are reported in §5.

---

## 4. Browser evidence

Server: this worktree's own dev server on **port 3136**, against its **own
second disposable Postgres** on **port 55469** (`aqua-b8-dev-db`, tmpfs,
`app_login`), seeded with the repository's own `scripts/seed-demo.ts` (the demo
tenant "Aqua Worli Aquatic Club", 40 members, 28 days of sessions, 21 days of
attendance, 8 enquiries).

> **The test database (port 55466) is never seeded.** An earlier run seeded the
> demo club into the harness test database and that broke the migration
> fixtures (`tests/migrations/invite-persons-staff-backfill.test.ts`, an FK
> violation from the seeded rows) and made two other files flaky. The test
> database was recreated clean and the demo seed moved to its own container on
> 55469. Anyone reproducing this evidence must do the same: **a separate
> disposable database for the dev server, and an unseeded one for the tests.**

The coordinator's dev 3122, the preview 3211 and the demo-history agent's
55465/3135 were not touched. No user browser profile, cache or service-worker
data was cleared; the evidence was captured in an isolated Playwright context.

Screenshots (`b8-evidence/`):

| File | What it shows |
|---|---|
| `owner-home-1280x900-lavender.png` | Owner Home, Lavender Option B, 1280×900 |
| `owner-home-1280x900-mint.png` | the same markup in Mint Garden |
| `owner-home-1280x600-lavender.png` | short desktop: the sidebar fits exactly, the account row is fully visible |
| `owner-home-1024x768-lavender.png` | the shell breakpoint: 2×2 figures, readable timeline |
| `owner-home-390x844-lavender.png` | phone: two money figures, the compact summary line, the attention panel |
| `owner-home-390x844-lavender-scrolled.png` | the sticky header and the money band on a phone |
| `owner-home-320x760-lavender.png` | narrowest phone, no horizontal overflow |
| `owner-home-200pct-640x450-lavender.png` | 200 % zoom: reflows to the phone shell, navigation not clipped |
| `owner-home-1280x900-lavender-money.png` | the money band in Lavender: the shared period control above both panels, and the honest empty state |
| `owner-home-1280x900-attendance-chart.png` | the themed ECharts canvas (the attendance series the seed does populate) |
| `owner-members-1280x900-{top,mid,bottom}.png`, `…-nav-scrolled.png` | long Members: the sidebar and header stay at y=29 through the whole scroll, the nav region scrolls to "Settings" |
| `owner-fees-1280x900-accountant.png` | the permission-limited role: four permitted destinations, the shell-level sign-out |
| `illustration-variants.png` | the four artworks side by side |

**Measured, not asserted:**

- Sidebar `top` = 29px and header `top` = 29px at scroll 0, at 1499px and at
  the bottom of the long Members page — the shell does not move.
- The navigation region is the only scroller (`scrollHeight 715 > clientHeight
  323` at 1280×600); its last item ("Settings") is fully visible above the
  account row after scrolling it.
- The account row's bottom edge is exactly the viewport bottom at 1280×600.
- No horizontal overflow at 320, 390, 640, 1024 or 1280.
- Focus: the "Collect payment" link takes a 2px solid `#634889` ring (the
  preset's focus token) in Lavender.
- The period control changes the URL **and** the figures:
  `?trend=collections&period=week` → "Collections · This week · 26 Oct 2026,
  12:00 am – 27 Oct 2026, 05:54 am", and the payment mix panel reads "This
  week · captured payments" — the two panels share one period.
- The metric control changes the URL and the panel
  (`?trend=attendance&period=week`).
- The appearance preference survives a reload (the cookie), and signing out
  clears it — the shared-device rule in `TenantSignOut` still holds.

**Honest limitations of this evidence**

1. **The money band is empty.** The demo seed creates no invoices and no
   payments, so "Collected today" is ₹0 and the panels say *"No payments
   captured in this period"* and *"No collections in this period, so there is no
   mix to draw."* — no fake donut, no fake bars. The **populated** collections
   stack and the payment-mix doughnut therefore have **no rendered screenshot
   here**; they need the coordinator's reviewed seed (the demo-history lane).
   The ECharts canvas itself is verified with the attendance series, which the
   seed does populate.
2. **The attendance chart shows a single point** for the month period, because
   the demo seed marks historical sessions with *today's* `markedAt`, so every
   mark lands in today's bucket. That is a seed artefact, not a product defect.
3. **The artwork chosen here is the swimmer** — the seeded programme names
   ("Learn to swim", "Junior competitive", "Stroke development") resolve to
   swimming. The badminton and football variants are verified by the rendered
   art sheet and by unit tests, not by a live club in this database.
4. The **product name stays "Aqua"**. The approved board used a working brand;
   renaming the product — and with it the cookies, env vars, PWA ids and deploy
   infrastructure — is a coordinated decision outside this work.
5. The **bottom navigation keeps the existing four items** (Home, Members,
   Reports, Settings). The approved board's phone bar reads Home / Schedule /
   Members / More; the mobile nav contract is exactly four items and the
   existing destinations are the ones the product has, so the item set was not
   changed. Worth a product decision.

---

## 5. Baseline failures (not caused by this change)

The full suite on a clean disposable database reports **6 failed files / 17
failed tests** in this worktree. **Every one of them is reproduced on a
pristine checkout of `origin/develop`**, which was verified rather than assumed:

```
$ git worktree add --detach /tmp/opencode/b8-baseline origin/develop   # d692fd3
$ (cd /tmp/opencode/b8-baseline && python3 .opencode/scripts/harness.py prepare-test --port 55470)
$ (cd /tmp/opencode/b8-baseline && pnpm exec vitest run \
     tests/tier1/session-lifecycle.test.ts tests/tier1/batch-transfer.test.ts \
     tests/tier1/onboarding-checklist.test.ts tests/tier1/owner-reports.test.ts \
     tests/tier1/reschedule-coach-conflict.test.ts)
 Test Files  5 failed (5)      Tests  16 failed
```

The same 5 files and the same 16 tests fail on unmodified `develop`. They are
shared-database, order-dependent fixtures: the audit write fails on
`audit_log_new_actor_id_fkey` ("Key is not present in table users") because a
previous file's cleanup removed the `users` row the fixture assumed. They touch
no file this task changed. The baseline worktree was removed afterwards.

The remaining failure is inherited and belongs to another lane:

| Test | Cause |
|---|---|
| `tests/design-screen-contracts.test.ts > documents every shared primitive under components/ui` | the **inherited overlay** added `components/ui/menu-bounds.ts` and `components/ui/menu-name.ts`, which `docs/design-system/component-usage.md` does not yet document. That file is the Screen-contracts lane's exclusive write scope, so this task did not edit it — the coordinator may either assign that lane or accept the two-line documentation. |

**So: 17 failures on this branch, 17 on unmodified `develop`, no new failure
from this change.**

Two further files failed in an *intermediate* run and pass on a clean database
— they were caused by the demo seed having been placed in the test database,
not by this change:

- `tests/migrations/invite-persons-staff-backfill.test.ts` (FK violation from
  the seeded rows) — passes after the test database was recreated clean.
- `tests/a11y/ops-focus-rendered.test.ts` (a 30 s hydration timeout on
  `ops.localhost:3410` under load) — passes when run on its own.

---

## 6. Flagged decisions — please review

1. **`components/demo-banner-strip.tsx` (shared component).** The demo banner
   is sticky at `top:0`, so it sat ON TOP of the shell's sticky header and
   viewport-bound sidebar: in the first browser capture the sidebar's brand was
   clipped by the banner's 29px on every scrolled screen, at every width. The
   banner now **publishes its measured height** as `--app-sticky-offset`
   (`ResizeObserver`, with a `ResizeObserver`-less fallback) and the shell's
   sticky elements start below it. The banner's own behaviour is unchanged
   (it is still sticky and still the first thing on the screen). The banner
   file is shared infrastructure with no assigned lane; the alternative was to
   leave a known clipping defect in the approved shell.
2. **`eslint.config.mjs`.** `.playwright-mcp/**` (the git-ignored reference
   boards provisioned into this worktree) is now ignored by ESLint, exactly like
   the existing `.claude/**` entry. Without it `pnpm lint` fails on the
   reference's own helper scripts, which the product does not ship.
3. **Four existing tests were updated** — each follows the change, none
   weakens a contract:
   - `tests/foundation/owner-chart-theme.test.tsx` — the expected Lavender
     `--chart-2` literal was `#4C2E93`; the approved Option B palette makes the
     digital series the preset's plum `#634889`, and the test's own rule ("the
     digital series takes the preset colour") is now asserted against the
     action colour as well.
   - `tests/mobile/kpi-label-size.test.ts` — the four summary tiles moved into
     `components/owner-home/owner-home-metrics.tsx`; the guard now scans both
     files and additionally asserts that the two money tiles are still named.
   - `tests/mobile/facility-switcher.test.tsx` — the owner layout gained the
     branding read (to name the academy in the sidebar); the test now mocks
     it.
   - `tests/review-dashboard-scope.test.ts` — the source scan that pinned the
     owner's screen ORDER now follows the composition into the
     `components/owner-home/**` modules and asserts the same order from the
     dashboard's own JSX.
4. **`app/(owner)/layout.tsx`** performs one extra read (the academy's
   branding) so the sidebar can name the club. It is the same cheap single-row
   read the Home page already makes; the layout takes it from the service
   directly so it does not resolve the session twice.

---

## 7. Security and engineering notes

- **No new data path.** Nothing here reads or writes the database. The layout's
  only new read goes through `getBranding(ctx)` inside `withTenant` (the
  existing service); the artwork is derived from data the dashboard read
  already returns.
- **No permission was added and no action changed.** The dominant action still
  appears only with `payments.record`, the secondary ones only with their own
  grants, and the drill-downs keep the facility and period scope they were
  computed under.
- **No money arithmetic.** Every figure is the existing bigint-paise value
  formatted by `lib/money/format`; the comparisons and the payment mix are the
  service's, unchanged.
- **The reserved tokens stay reserved.** The new modules use the shared
  primitives (`StatCard`, `ProgressBar`, `CountChip`) and hand their tone
  classes down from `components/owner-dashboard.tsx`, the file the
  semantic-token rule sanctions. No new file uses `good` / `late` / `warn`.
- **The theme never carries authority.** The preset is still a display
  preference validated against an enum; it is read from a cookie by the server
  before the first paint, so there is no flash and no hydration mismatch.
- **Focus and reduced motion.** The focus ring is the preset token (3:1 or
  better on every surface); the artwork's only motion is a single small
  transform, disabled under `prefers-reduced-motion` and free of SMIL.
- **No new dependency, no remote asset, no paid provider.** The artwork is
  inline SVG; the fonts are the repository's existing self-hosted files.

---

## 8. Gates

```
pnpm typecheck      ✅  (tsc --noEmit, no errors)
pnpm lint           ✅  (eslint . --max-warnings=0, no findings)
pnpm build          ✅  (Next 15.5.24 production build, EXIT=0)
pnpm check:bundle   ✅  "All 103 routes within budget"  (/owner = 129 kB first-load JS, budget 150 kB)
pnpm check:fonts    ✅  55.2 kB of 60 kB (bricolage 21.9 + instrument 16.5 + 16.8)
pnpm test           ✅ for this change — 17 failures on this branch, the same 17
                    on unmodified develop (§5); no new failure from this work
```

The build and the two budget scripts each run their own build and were run
**serially** under `~/.local/state/aqua-harness/design-build.lock`. The dev
server was stopped before the build (a Next process owns the checkout).

The owner Home route is **129 kB** of first-load JavaScript. The owner home adds
no chart engine to the first load: the ECharts island is still a lazy
`lg+` island and the phone charts are still server-rendered SVG.

### 8.1 What the gates do NOT cover

- The **populated** collections/payment-mix canvas (no payments in the seeded
  database — §4).
- The **parent zero-JS** contract was not re-verified here; this change does not
  touch `/p/[token]`, and the route's first-load JS is unchanged at 102 kB.
- The **PWA** install/offline contract was not re-verified; this change does
  not touch the manifest, the service worker or the offline code.

---

## 9. What a reviewer should look at first

1. `components/owner-home/owner-home-timeline.tsx` and
   `components/owner-home/session-state.ts` — the current/next distinction and
   the register wording.
2. `components/owner-home/owner-home-attention.tsx` — the priority order and the
   "a money-late item is never folded away" rule.
3. `components/owner-home-charts.tsx` — the one shared period control above both
   panels.
4. `components/illustrations/resolve-sport.ts` — how the artwork is chosen, and
   why it never guesses.
5. `app/globals.css` — the Option B palette and the per-preset token split.
