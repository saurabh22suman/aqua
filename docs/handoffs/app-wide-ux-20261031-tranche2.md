# Handoff — app-wide UI correction, tranche 2 (31 October 2026)

**Branch** `fix/app-wide-ux-20261031` · **baseline** `54e6d80` (+ tranche-1 WIP,
uncommitted) · **worktree**
`/home/soloengine/thedutchrabbit/aqua-worktrees/app-wide-ux-20261031`
· **model** `minimax/MiniMax-M3.1-Flash` (direct provider; session metadata
matches — no substitution, no paid fallback) · **no commits, pushes, PRs,
merges or deployment** (not authorised in this task).

**Contract**: `.playwright-mcp/app-wide-ux-20261031/tranche-2-contract.md`
**Coverage ledger**: `.playwright-mcp/app-wide-ux-20261031/coverage-ledger.json`
(37 entries; tranche 1 + 2) · **Evidence**:
`.playwright-mcp/app-wide-ux-20261031/evidence/`

---

## 1. What changed in tranche 2

| # | Change | Files |
|---|---|---|
| R1 | **The attendance chart is KEPT, once.** Tranche 1 removed the line chart along with the duplicates and removed a capability. It is back in its own operational attendance panel outside Money: one line chart on the page, seven dated buckets, the unit on the axis, the exact data in a table, and an unmarked day shown as a gap (unknown), never 0%. | `components/owner-home/owner-home-attendance.tsx` |
| R2 | **Money and attendance no longer share an error.** The money band names financial figures only; the attendance panel carries its own unavailable message. | `components/owner-home-charts.tsx`, `components/owner-dashboard.tsx`, `components/owner-home/owner-home-attendance.tsx` |
| W3 | **The shared date/time controls replace the native ones.** Three real native consumers migrated: the platform activity filter bar (2 dates), the Ops activity filter (2 dates + 2 times, plus a small shared seconds control so the EXACT seconds contract survives), the enquiry follow-up (one labelled date + time group replacing `datetime-local`). Every date and time part reports its validity, and an imperative Apply / Add follow-up REFUSES an incomplete or impossible entry instead of submitting a stale or vanished bound. | `components/ui/SecondsField.tsx` (new), `components/activity-filter-bar.tsx`, `components/ops/ops-activity-filter.tsx`, `components/ops/ops-activity-time.ts`, `components/enquiry-detail-view.tsx` |
| W4 | **One small shared icon family.** Dot's ORIGINAL revision-1 glyphs (16) integrated as typed static React in `components/icons/khel-icons.tsx` — no dependency, no remote fetch, no raw HTML injection. The two tone slots are two DIFFERENT theme tokens pinned by the family, so they cannot collapse. Used on task/module surfaces only: Owner settings categories, Owner Home quick actions, reception Today, Ops module entries, the shifts and attendance self-service cards. | `components/icons/khel-icons.tsx` (new) + 6 consumers |
| W5 | **Reception Today is a compact grid** with short purposes instead of five stacked verbose cards under a tall top padding; the 56px target, the permission gating and the manual payment-confirmation cue are unchanged. | `app/(reception)/reception/page.tsx` |
| W6 | **The remaining visible redundancy.** The comparison block prints the comparison and the change (the expansion and the exact instants keep ONE owner, the range disclosure); the parent link panel drops the implementation term "Zero JavaScript" and keeps one concise description, the visibility/expiry facts, the anyone-with-the-link warning and the contents list in a disclosure; the insights preview no longer reserves a second column for one preview. | `components/owner-home-chart-parts.tsx`, `components/parent-link-panel.tsx`, `components/owner-insights-home/owner-insights-home.tsx` |

### Baseline verification (NOT a change)

The member detail page's `type="date"` (line 227) is **not** a native input and
not a renewal field: it is the `InlineEditField` type discriminator, and
`InlineEditControl` already renders the shared `DateField`. A source scan
flagged it as a native-control candidate; **rendering disproved it**. The
characterization test proves the rendered editor is the day-first masked field,
that no `input[type="date"]` is rendered, and that the server receives the
canonical ISO date (`31/12/2015` → `2015-12-31`). **No wrapper and no
server-form change was introduced.** Ledger entry `member-dob-editor` is
marked as a baseline verification, not intended RED.

## 2. Intended RED → GREEN → refactor

Every cycle ran **before** its production edit, through the shared lock
(`python3 .opencode/scripts/lane_job.py harness test <paths>`, disposable DB
`aqua_test_4413576bec`, role `app_login`, `NODE_OPTIONS=--max-old-space-size=2048`,
one heavy job at a time).

| Cycle | Test | RED (actual) | GREEN |
|---|---|---|---|
| 1 | `attendance-chart-outside-money.test.tsx` | **6 failed** — no attendance chart; money's error named attendance; attendance had no message of its own | 6/6 → 17/17 with the tranche-1 suite |
| 2 | `shared-date-time-controls.test.tsx` | **6 failed** — native date/time controls present in all three consumers; no shared time group | 6/6 |
| 3 | `shared-date-time-seconds-and-validity.test.tsx` | **9 failed / 2 passed** — inbound seconds rendered blank (the shared time control cannot parse `HH:mm:ss`); a partial date was submitted as no bound; a partial time was submitted as no bound | 11/11 |
| 4 | `icon-family.test.tsx` | **4 failed** — Owner settings categories, reception Today, staff self-service cards, Owner Home quick actions and Ops module entries carried no family glyph | 13/13 |
| 5 | `icon-family.test.tsx` (consumers) | **4 failed** — Owner Home quick actions and Ops module entries carried no family glyph | 13/13 |
| 6 | `icon-geometry-equivalence.test.tsx` | **3 passed on the first run** — see the method deviation below | 3/3 |
| 7 | `tranche2-surfaces.test.tsx` | **3 failed / 4 passed** — reception kept `pt-10` and 74-character descriptions; the parent panel said "Zero JavaScript" | 7/7 |

Evidence: `evidence/red-1-attendance-chart.txt`,
`red-2-shared-date-time.txt`, `red-3-seconds-and-validity.txt`,
`red-4-icon-family.txt`, `red-5-icon-consumers.txt`,
`red-7-tranche2-surfaces.txt`, and the matching `green-*.txt` /
`regress-*.txt` files.

### Recorded method deviations — stated honestly

1. **`components/icons/khel-icons.tsx` was written before its own contract
   test.** The module is the transcription of the reviewed assets; its
   contract assertions were green on their first run. This is **not**
   presented as intended RED. What *did* drive the work with a genuine RED
   was the CONSUMER set (cycle 4/5): the Owner settings, reception Today,
   staff self-service, Owner Home and Ops surfaces carried no family glyph
   before the change. The geometry is instead verified by an executed
   equivalence test against the reviewed SVG files (cycle 6) — the
   adaptation is asserted element for element, with the only intended
   difference being the secondary tone slot, which shipped in the study as a
   hex fallback and is integrated as a theme token.
2. **Cycle 2's first attempt was an import error** (a not-yet-existing
   `DateTimeField` module) and is recorded as **infrastructure/test setup
   only, NOT a valid RED** (`evidence/red-2-shared-date-time.txt` was
   rewritten). The valid RED was re-run against existing consumers only.
3. **`tests/ops-redesign/ops-activity-filter.test.tsx` (agent-owned, NOT
   tier1) was updated** for the changed control shape and the minute/second
   split. Every original intent is preserved — Custom vs Any time, the IST
   rendering, the instant round trip, start-after-end refusal, the tenant
   picker, the relative bounds — and no assertion was weakened. The
   pure-model expectations (`formatIstParts` → `HH:mm:ss`,
   `buildActivityQuery` → `…T17:30:00+05:30`) are **unchanged**.
4. Two selector refinements in the new test files (`getAllByRole("alert")`
   because the implementation adds a second alert; `.disabled` instead of
   `toBeDisabled`, which is unavailable without jest-dom). The expectations
   themselves are unchanged.

## 3. Test totals and checks

- New tranche-2 suite `tests/app-wide-ux-20261031/**`: **10 files, 76 tests,
  all pass**.
- Focused existing suites re-run after the change: `tests/ops-redesign/ops-activity-filter.test.tsx`,
  `tests/owner-insights-home*.test.tsx`, `tests/owner-home-surface.test.tsx`,
  `tests/design-screen-contracts.test.tsx` — all pass
  (`evidence/regress-tranche2-focused.txt`: 14 files / 113 tests, then the
  tranche-2 suite alone at 76/76).
- `pnpm typecheck` — pass. `pnpm lint` — pass (**0 warnings**;
  `evidence/typecheck-lint-3.txt`). Two pre-existing tranche-1 lint warnings
  (`tests/app-wide-ux-20261031/truthful-copy.test.tsx`,
  `tests/owner-insights-home.test.tsx`) were fixed on the way.
- **Not run (coordinator-owned):** the full suite, `pnpm build`,
  `pnpm check:bundle`, `pnpm check:fonts`, `pnpm check:focus-contrast`,
  `pnpm e2e:parent-link-zero-js`. Tranche 1's full-suite run was
  **interrupted and is INCOMPLETE**, not passed.
- Every heavy job went through `lane_job.py`, one at a time, with
  `NODE_OPTIONS=--max-old-space-size=2048` (never 6144). No unawaited
  background job.

## 4. Roles and states in scope

Owner/Admin (`/owner`, `/owner/settings`, `/owner/members/[memberId]`),
Ops (`/ops`, `/ops/activity`), reception (`/reception`, enquiry detail),
coach and staff self-service (`/worker`, `/coach/me`, `/reception/me`),
parent-facing copy (the owner panel and `/parent`). Parent/public and auth
surfaces were **not changed** — the parent zero-JS paths are untouched.

States covered: populated, empty, unknown (no marks recorded ≠ 0%), read
failure (money separately from attendance), partial entry, impossible date,
half-chosen time, blank optional bound, reset, permission-denied, noon and
midnight, exact seconds.

**No visual or device verdict is claimed.** Every visual entry in the
ledger is **BLOCKED** until the coordinator's independent Chrome review runs
at 390×844 and 1280×900 in both themes.

## 5. Known issues / remaining checks

- **The icon family's visual verdict is BLOCKED for COMPUTED FILLS.** The
  rendered tone pair must be measured in Chrome in both themes before the
  duotone geometry is accepted. The primary slot is pinned to
  `var(--color-ink-2)` and the secondary to `var(--color-ink-3)` precisely so
  a consumer cannot collapse them — but the actual rendered contrast is the
  coordinator's call.
- **NOT DONE in tranche 2, carried forward** (recorded in the ledger as
  `NOT TESTED`, not as passes):
  - the **coach Today** density pass — `app/(coach)/coach/page.tsx` still
    uses the tall `pt-10` top padding;
  - the **worker/staff Me** card density pass — the cards gained family
    glyphs but their density was not changed;
  - the **Owner Home range strip** — the range eyebrow and the
    always-visible methodology bar were reviewed but not changed; the exact
    ranges and method remain in the accessible disclosure.
- The **Owner Home attendance line chart** is back on the page as ONE chart
  (server-rendered SVG on a phone, the chart engine at lg+). The coordinator
  should confirm that one chart on Home is the right amount.
- `components/owner-home-payment-mix.tsx` is a pre-existing, unreferenced
  older duplicate of the payment mix — left untouched.
- `components/activity-filter-bar.tsx` is **not routed by any page today**.
  It was migrated for consistency because it is a shared consumer; that is
  a source fact, not a rendered pass of a screen.
- The Ops filter's **activity filter bar error copy** is new ("Enter a real
  since date.") and sits in the shared filter surface.
- Nothing is committed, pushed or deployed. Nothing is claimed as visually
  accepted.

## 6. Next action

1. **Coordinator:** run the independent Chrome review on the built artifact —
   390×844 and 1280×900, both themes — for: the Owner Home attendance chart
   and its table, the range strip, the comparisons, the reception Today grid,
   the Owner settings category tiles, the Ops module entries, the shared date
   and time controls (including the seconds control and the invalid-entry
   refusal), the parent link panel, and the insights preview. Record the
   **functional / semantic / visual** verdicts separately, and measure the
   icon tone pair's computed fills.
2. **Coordinator:** run the final combined gates (full suite, build, bundle,
   fonts, focus contrast, parent zero-JS) after the freeze. Tranche 1's
   interrupted full-suite run is **incomplete** and must be re-run.
3. Then: the carried-forward density items above (coach Today, staff Me),
   as the next tranche with its own RED.
