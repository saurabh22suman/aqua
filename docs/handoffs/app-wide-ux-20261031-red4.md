# Handoff — app-wide UI correction, tranche 4 RED phase (31 October 2026)

**Branch** `fix/app-wide-ux-20261031` · **model** `minimax/MiniMax-M3.1-Flash`
(direct; session metadata matches — no substitution, no fallback) ·
**no commits, pushes, PRs, merges or deployments**.

**Scope**: the coordinator's independent-Chrome punch list. **RED only** —
`app/`, `components/`, `lib/`, `public/` were not touched. Only agent-owned
tests and the ignored ledger were written.

**Evidence**: `.playwright-mcp/app-wide-ux-20261031/evidence/red-12-chrome-punch-list.txt`

---

## 1. The four bounded regressions (7 intended assertion failures, 21 passing controls)

Run: `lane_job.py harness test <4 paths>`, `NODE_OPTIONS=--max-old-space-size=2048`.
No import or setup error remains — the first Ops run failed with
`ReferenceError: beforeEach is not defined` (a test-side error) and was fixed
before this evidence was taken.

| # | Finding | Test | Actual RED |
|---|---|---|---|
| 1 | Legacy week state prints an implementation sentence | `owner-home-range-toolbar.test.tsx` → "says only 'Showing this week'" | `expected 'Showing this week — a range the three…' to be 'Showing this week'` |
| 2 | Coach Today title and count touch at 390 | `role-entry-density.test.tsx` → "keeps the long title and the count apart on a narrow screen (LAYOUT INTENT)" | `the title row declares no column gap: expected null not to be null` |
| 3 | Leave card prints "Unpaid · unpaid" | `staff-leave-copy.test.tsx` → three cases | `expected 'Unpaid · unpaid' to be 'Unpaid'`; `expected 'Unpaid leave · unpaid' to be 'Unpaid leave'`; `expected 'unpaid sabbatical · unpaid' to be 'unpaid sabbatical'` |
| 4 | Ops activity time/seconds controls clip at 390 | `ops-activity-narrow-layout.test.tsx` → two cases | `the time row still shares one narrow row with the seconds control: expected 'grid grid-cols-[minmax(0,1fr)_76px]…' to match …`; `expected 'grid grid-cols-[minmax(0,1fr)_76px]…' to match /(?:sm|md|lg|xl):…/` |

**Passing negative controls** (21): the week window is still named truthfully
and is not relabelled, the week keeps its own exact instants in the
disclosure, the long batch name and the count stay readable, a paid leave
type carries no marker, an ordinary unpaid type and a special "Volunteer"
label keep the marker, and the Ops **exact-seconds** contract still holds
(the seconds control carries "47" and the applied bound keeps
`12:00:47+05:30`).

## 2. What the assertions do and do not claim

- **#1, #3** are rendered-text contracts: exact strings.
- **#2 and #4 are LAYOUT INTENT**. They assert the intended *composition*
  (a declared column gap ≥ 8px with a bounded, wrapping title and an
  unsqueezed count; a narrow-width stack with a wider side-by-side
  variant). They **cannot certify geometry** — the real fit is the
  coordinator's measured Chrome pass after the rebuild.
- **#4 is corroborated by the independent real-browser RED**, not by this
  file: `.playwright-mcp/app-wide-ux-20261031/chrome-journey-5/review.json`
  measures `ops-activity-since-time-period` and
  `ops-activity-until-time-period` with **5.95px** of available text width
  against **14.18px** required at 390×844 (no clip at 1280×900). The repair
  must be Ops-specific: the shared `TimeField` / `Select` / `SecondsField`
  primitives keep their geometry.
- **#2 is corroborated by the coordinator's screenshot**
  `.playwright-mcp/app-wide-ux-20261031/chrome-production-1/screenshots/coach-0-lavender-390.png`.

## 3. UNRESOLVED — the Owner Home range toggle does not change the URL

**Status: UNRESOLVED. No cause is established here, and none is guessed.**

**The measured browser RED** (the coordinator's independent production
Chrome run, `.playwright-mcp/app-wide-ux-20261031/chrome-journey-5/review.json`):

- clicking "Month" on `/owner` leaves the URL at `/owner` after 30 s;
- the journey failed with `page.waitForURL: Timeout 30000ms exceeded`;
- the RSC requests for the clicked URL answer **200**;
- no page error is raised over HTTP, and the synthetic owner signs in
  normally;
- a **static hard navigation** to the same URL works.

**What is not established:** why the URL does not change. The RED is
recorded exactly as measured; the cause is open and is not asserted.

**Observations only — not a conclusion, not a proposed fix** (recorded so
the next reader starts from facts, not from a theory):

- `next.config.ts:8` sets `output: "standalone"`.
- `.opencode/scripts/owner_preview.py:51` starts the production preview
  with `next start`.
- Next prints *"next start does not work with output: standalone
  configuration"* in `chrome-journey-5/server.log:6` and
  `chrome-production-1/server.log:6`.
- `components/facility-switcher.tsx:64-72` is the only client code on
  the owner surface that rewrites the URL (`router.replace(pathname?query)`
  rebuilt from `useSearchParams()`); in the reviewed run the URL carried
  no `?facility=`.

**No fix, no source change and no preview/build was made for this
issue.** It is carried forward as an open defect for the coordinator's
own investigation and a measured re-test.

## 4. State of the tree

- **No production file changed in this phase.** `find app components lib
  public -newer docs/handoffs/app-wide-ux-20261031-final.md` returns
  nothing. This phase wrote exactly four files: two updated test files and
  two new ones, under `tests/app-wide-ux-20261031/`.
- The ignored coverage ledger is updated: **49 entries**, tranche
  "1 + 2 + 3", with this punch list recorded as NOT IMPLEMENTED and the
  harness finding recorded as a review-harness note (not an app defect).
- No tier1, auth, db, schema, token, manifest or config file was touched.
- The full suite, the build, the preview and the production Chrome review
  remain coordinator-owned.

## 5. Next action

Root reviews the four REDs and the investigation result, then explicitly
reopens source writes for the implementation phase: one bounded cycle per
finding (RED → GREEN → refactor), with the Ops repair scoped to the Ops
filter and the coach/leave fixes scoped to their own components. The
coordinator then rebuilds and re-runs the measured Chrome fit.
