# Handoff — app-wide UI correction, tranche 3, RED phase (31 October 2026)

**Branch** `fix/app-wide-ux-20261031` · **baseline** `54e6d80` (+ tranche-1 and
tranche-2 WIP, uncommitted) · **worktree**
`/home/soloengine/thedutchrabbit/aqua-worktrees/app-wide-ux-20261031`
· **model** `minimax/MiniMax-M3.1-Flash` (direct provider; session metadata
matches — no substitution, no paid fallback) · **no commits, pushes, PRs,
merges or deployment** (not authorised in this task).

**Contract**: `.playwright-mcp/app-wide-ux-20261031/tranche-3-contract.md`
**Evidence**: `.playwright-mcp/app-wide-ux-20261031/evidence/red-8-reviewed-density.txt`
(the final RED run), `red-8-final-density.txt` (the first, root-reviewed run),
`typecheck-lint-red3.txt`

**This phase wrote NOTHING to product source.** `app/`, `components/`, `lib/`
and `public/` were filesystem read-only. Only agent-owned tests, the contract
and the evidence were written. The implementation phase has NOT started.

---

## 1. What this phase produced

Eight new agent-owned test files under `tests/app-wide-ux-20261031/`, one per
work item, plus the tranche-3 contract:

| File | Work item |
|---|---|
| `owner-home-session-occupancy.test.tsx` | W1 — one owner for the day's occupancy; three-vs-many disclosure; up-next; permission-scoped schedule link |
| `owner-home-attention-empty.test.tsx` | W2a — the empty decision queue says it once |
| `owner-home-range-toolbar.test.tsx` | W2b — the range is a compact toolbar |
| `owner-home-facility-breakdown.test.tsx` | W2c — the per-facility footer is about members only |
| `owner-home-financial-pair-alignment.test.tsx` | W2d — the related financial pair is one frame; one financial empty state |
| `owner-home-quick-link-permissions.test.tsx` | W5 — a shortcut is withheld when the destination is not permitted |
| `owner-insights-empty-enquiries.test.tsx` | W4 — the empty enquiries section says it once |
| `role-entry-density.test.tsx` | W3 — coach Today and staff self-service density (LAYOUT INTENT) |

## 2. The actual REDs — 22 intended failures, 37 passing controls

Final run: **8 files, 59 tests, 22 failed / 37 passed** (evidence
`red-8-reviewed-density.txt`). Every failure below is an assertion about
today's rendered behaviour, not an import or setup error. There is **no
missing-import RED** anywhere in the set.

### W1 — the day's occupancy has one display owner (3 REDs)

| Test | Actual failure today |
|---|---|
| does not print the same per-batch capacity twice | the `owner-home-capacity` section is still rendered (and "16 / 20" is printed twice) |
| shows three session rows first and keeps the rest in a native disclosure | `expected null to be truthy` — there is **no** `<details>` in the today panel; all six sessions are printed flat |
| says how many sessions the disclosure holds | `expected '' to match /3/` — no disclosure summary exists |

The fixture is chronological and realistic: 05:30, 06:00 and 06:30 have
started; the 07:00 session has **not** started and is the **fourth** of the
day, so it is the up-next session and it falls inside the folded set; 17:00
and 23:00 have not started. `nextUpcomingIndex` therefore returns index 3.

### W2a — the empty decision queue says it once (2 REDs)

| Test | Actual failure today |
|---|---|
| prints one empty-state statement, not two | `expected [ 'Nothing needs', 'Nothing needs' ] to have a length of 1 but got 2` — the panel prints **"Nothing needs your attention today"** *and* **"Nothing needs attention right now."** |
| keeps the onboarding nudge as a different statement | the same count of 2 |

### W2b — the range is a compact toolbar (2 REDs)

| Test | Actual failure today |
|---|---|
| does not print a redundant visible sentence or eyebrow | the strip still prints `Range` + **"Collections, payment mix and attendance"** |
| is a compact control, not an always-visible filled bar (LAYOUT INTENT) | the disclosure is still `mt-1 max-w-[72ch] rounded-ctl bg-deck …` — a full-width filled bar |

### W2c — the per-facility footer is about members (2 REDs)

| Test | Actual failure today |
|---|---|
| prints no attendance window beside the member counts | the footer still reads `Andheri 18 active · 80% this week` — a second attendance window |
| speaks the tenant's configured terminology | the footer contains no member term at all ("members" / "swimmers" absent) |

### W2d — the financial pair (2 REDs, one of them LAYOUT INTENT)

| Test | Actual failure today |
|---|---|
| lays the pair out in one grid row, without opting out of the shared height (LAYOUT INTENT) | the money band is `grid gap-3 lg:grid-cols-5 lg:items-start` — the two related cards end at different heights |
| prints one financial empty state, not two repeated empty cards | `expected [ 'No payments recorded', …(1) ] to have a length of 1 but got 2` — a zero read prints "No payments recorded in this period." **and** "No collections in this period, so there is no mix to draw." |

### W5 — shortcuts are withheld without the destination grant (5 REDs)

| Test | Actual failure today |
|---|---|
| withholds the fees shortcut without the fees read | `<a href="/owner/fees">` is still rendered |
| withholds the enquiries shortcut without the enquiries read | `<a href="/owner/enquiries">` is still rendered |
| withholds the programs shortcut without the programs read | `<a href="/owner/programs">` is still rendered |
| withholds the staff shortcut without the staff read | `<a href="/owner/staff">` is still rendered |
| keeps the rest of the shortcut grid when one link is withheld | the grid text still contains "Enquiries" |

The two booleans that already exist (`can.readFees`, `can.readEnquiries`) are
the ones the coordinator named. `can.readPrograms` and `can.readStaff` are the
two UI booleans this tranche adds; they are derived in
`app/(owner)/owner/page.tsx` from the destinations' **existing** guards —
`programs.read` (`/owner/programs` → `requirePagePermission(ctx,
"programs.read")`) and `staff.read` (`/owner/staff` →
`requirePagePermission(ctx, "staff.read")`), which are the same keys the
sidebar already uses in `lib/nav.ts` (`OWNER_NAV_PERMISSION_GATES`). The
authorization keys are **not** invented and **no auth helper or grant
changes**; the UI names are deliberately distinct from the key strings.

### W4 — the empty enquiries section says it once (1 RED)

| Test | Actual failure today |
|---|---|
| prints one no-enquiries statement, not two | `expected [ 'No enquiries', 'No enquiries' ] to have a length of 1 but got 2` — the preview says "No enquiries created in the last 30 days." and the disclosure says "No enquiries were created in this window…" |

### W3 — coach Today and staff self-service density (5 REDs, LAYOUT INTENT)

| Test | Actual failure today |
|---|---|
| coach Today: drops the tall top padding and declares a bounded frame | `<main class="px-5 pt-10 pb-8">` — the tall `pt-10` |
| coach Today: keeps the quiet-day state useful | the same `pt-10` |
| worker Me: bounded frame | `<main class="px-5 pt-6 pb-8">` — no `max-w-`; the page is full-bleed at 1280 px |
| coach Me: bounded frame | the same |
| reception Me: bounded frame | the same |

The coach and worker route layouts (`app/(coach)/layout.tsx`,
`app/(worker)/layout.tsx`) impose **no** width constraint, so the bound has
to come from the page.

## 3. What stayed green — the negative controls (37 passing)

These are the guards that must survive the implementation, and they are green
today, so they will catch an implementation that removes something:

- **W1:** one progress meter per session with a distinct label; the places
  total ("30 of 86 places booked"); the register states ("Register complete —
  16 of 16 marked", "No one enrolled yet", "Register opens when the session
  starts"); no percentage in the places panel; a small day has no disclosure
  and keeps its row; a quiet day stays useful; the full-schedule shortcut is
  permission-gated and keeps `date` + `location`; the up-next row still
  carries `owner-home-next-session` and its batch is named on the collapsed
  screen.
- **W2a:** the populated queue keeps every title, every detail, the true
  count ("4 things to keep your club on track"), the folded row stays
  reachable in a native disclosure that says how many are folded, and a
  money-late row is never one of the folded ones.
- **W2b:** Day / Last 7 days / Month with `aria-current="page"` on the
  selected one; the facility scope in every range link; the exact instants,
  the comparison and the timezone still inside the closed disclosure; the
  instants are not printed outside it.
- **W2c:** the facility names and the active counts stay on the footer; the
  heading follows the configured facility term ("By facilities" / "By
  centres"); the selected-period attendance panel still shows "8 of 10 marks
  present or late"; attendance stays out of Money; the footer does not leak
  its window into the attendance panel.
- **W2d:** the two cards are siblings in one band; no fixed pixel height in
  either card; the unrelated Attendance panel is not inside the band; the
  payment-mix methodology stays a native, closed `<details>`; the phone
  composition stays a single column; the authorized transactions link
  survives the empty state; a successful zero read is not "unavailable" and a
  failed read is not "no payments recorded"; the zero figures stay visible.
- **W5:** a normal owner keeps every authorized shortcut; withholding one
  link leaves the rest of the grid (and "New member") intact.
- **W4:** unavailable stays distinct from empty (no zero is drawn); the
  populated cohort stays informative; the 30-day window stays distinct from
  the selected chart range; the enquiries list is not offered without the
  permission and a narrowed facility keeps its own note; the detail
  disclosure is still reachable with the cohort inside it.
- **W3:** the coach's session card, its real marked/total, the "Open
  register" shortcut and its href; a long batch name carried in full; the
  quiet-day state and its schedule link; the up-next card and its verb; the
  three self-service cards and the caller's own data on worker / coach Me /
  reception Me; the curriculum link appears only with `levels.write` and is
  absent without it; no text below 12 px and no target below 40 px.

## 4. Layout intent — and what it is NOT

The layout assertions in `role-entry-density.test.tsx` and in
`owner-home-financial-pair-alignment.test.tsx` assert **intent**, not
geometry: the presence of a bounded frame token, the absence of the tall
`pt-10`, the absence of `items-start` on the financial pair's grid, the
absence of a fixed pixel height, the absence of a filled full-width
methodology bar, and the phone single-column stacking.

**They cannot certify visual quality.** The actual heights, the ~40 px
misalignment of the Collections and Payment mix cards, the fold position of
the session disclosure and the reading measure of the coach/worker surfaces
are **not** established by any assertion here. They are measured by root's
production Chrome review at 390×844 and 1280×900 in both themes.

## 5. Source-read-only proof

- `git status --porcelain -- app components lib public` is **identical** to
  the session-start snapshot: 24 modified files and 4 untracked paths, every
  one of them tranche-1/tranche-2 work already documented in
  `docs/handoffs/app-wide-ux-20261031-tranche2.md`. No edit or write in this
  phase targeted `app/`, `components/`, `lib/` or `public/`.
- The only files this phase created are the eight test files above, the
  tranche-3 contract, the evidence logs and this handoff.
- The member `type="date"` editor was **not** touched and needs **no**
  change: it is `InlineEditField` → the shared `DateField`, already verified
  in tranche 2. No source candidate was mistaken for a native field.

## 6. Checks run

| Check | Command | Result |
|---|---|---|
| Focused RED | `python3 .opencode/scripts/lane_job.py harness test <8 paths>` with `NODE_OPTIONS=--max-old-space-size=2048` | **22 failed / 37 passed** — `evidence/red-8-reviewed-density.txt` |
| Typecheck + lint | `python3 .opencode/scripts/lane_job.py harness quick` | `tsc --noEmit` clean; `eslint . --max-warnings=0` **0 warnings** — `evidence/typecheck-lint-red3.txt` |

Every heavy job went through the shared lock, one at a time, with a 2048 MB
Node heap. No unawaited background job.

**Not run (coordinator-owned):** the full suite, `pnpm build`, `check:bundle`,
`check:fonts`, `check:focus-contrast`, `e2e:parent-link-zero-js`, and any
preview/dev server. Tranche 1's interrupted full-suite run remains
**INCOMPLETE**, not passed.

## 7. Existing tests that encode the OLD behaviour

These are **not** tier1-protected, but they assert what this tranche
intentionally removes. The implementation phase must update them
deliberately — the intent preserved and pointed at the new single owner,
never deleted to obtain green:

- `tests/owner-openpen-20261029/system/foundation-and-home.test.tsx` —
  *"follows the work with today's sessions and real batch capacity"* expects
  `owner-home-capacity` and "12 of 12" / "8 of 16". It must read those facts
  from the session rows.
- `tests/mobile/facility-switcher.test.tsx` — *"consolidated per-facility
  view"* expects the string "no attendance yet" in the facility footer.

## 8. Open decisions for the implementation phase

1. **The up-next session inside the folded set.** The contract requires the
   collapsed screen to still NAME the up-next session (the test asserts the
   batch name is present outside the `<details>`). The toolbar may state it
   in the disclosure summary or as a separate line — root's call, the test
   only requires the name to be visible.
2. **The financial pair's shared height.** The intent is the grid's own
   stretch (no `items-start`, no fixed height), with the payment mix's
   footer anchored to the bottom of the shared frame.
3. **The one financial empty state.** The test requires exactly one
   "no payments recorded / no collections" statement in the band, the
   authorized transactions link to survive, and the zero figures to stay
   visible. Where the single statement lives is an implementation choice.
4. **The quick-link booleans.** `can.readPrograms` and `can.readStaff` are
   new UI booleans on the dashboard, derived in the owner page from
   `programs.read` and `staff.read`. If root prefers to reuse an existing
   boolean name, the contract names the two derived keys explicitly.

## 9. Next action

Root reviews this RED set and **explicitly reopens source writes**. Then, and
only then, the implementation phase begins: one TDD cycle per work item,
RED → GREEN → refactor, with the tranche-3 suite plus the two existing tests
in §7 updated deliberately. The final Chrome review (390×844 and 1280×900,
both themes, production artifact) and the full release gate remain
coordinator-owned. Nothing here is claimed as shipped, deployed or visually
accepted.
