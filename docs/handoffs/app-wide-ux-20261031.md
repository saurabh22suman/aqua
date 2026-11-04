# Handoff — app-wide UI correction, tranche 1 (31 October 2026)

**Branch** `fix/app-wide-ux-20261031` · **baseline** `54e6d80` (verified staged
combined) · **worktree** `/home/soloengine/thedutchrabbit/aqua-worktrees/app-wide-ux-20261031`
· **model** `minimax/MiniMax-M3.1-Flash` (direct provider; session metadata
matches — no substitution, no paid fallback) · **no commits, pushes, PRs,
merges or deployment** (not authorised in this task).

**Contract**: `.playwright-mcp/app-wide-ux-20261031/contract.md` ·
**Coverage ledger**: `.playwright-mcp/app-wide-ux-20261031/coverage-ledger.json`
· **Evidence**: `.playwright-mcp/app-wide-ux-20261031/evidence/`

---

## 1. What changed (tranche 1)

| # | Change | Files |
|---|---|---|
| 1 | A genuine **Last 7 days** default: today + the preceding six IST calendar dates, seven chronological daily buckets, today partial, compared with the equivalent previous elapsed range. `Day` / `Month` remain the shorter and longer ranges. | `lib/time/owner-periods.ts`, `lib/services/owner-home-charts.ts`, `lib/actions/owner-home-charts.ts`, `app/(owner)/owner/page.tsx`, `components/owner-home/owner-home-range.tsx` (new) |
| 2 | **Attendance OUTSIDE Money.** The collections/attendance metric switch is gone from the Money band; attendance has one concise operational panel with a drill-down, outside the Money section. | `components/owner-dashboard.tsx`, `components/owner-home-charts.tsx`, `components/owner-home-chart-panels.tsx`, `components/owner-home/owner-home-attendance.tsx` (new) |
| 3 | **One display owner** for the range, the comparison and the dates: a shared range strip above the band; the duplicated month-history link, the repeated date lines, the payment mix's repeated comparison and the Digital-method prose are gone; exact ranges/methodology moved into accessible `<details>`. | `components/owner-home/owner-home-range.tsx` (new), `components/owner-home-chart-parts.tsx`, `components/owner-ui/owner-payment-mix.tsx`, `components/owner-home-chart-panels.tsx` |
| 4 | **Truthful wording**: recorded payments (not "captured"), "Collections by membership plan" (not "Revenue by plan"), the parent-link description states the page's real visibility, and the Ops empty queue no longer claims every tenant is healthy. | `components/owner-home-chart-panels.tsx`, `components/owner-ui/owner-payment-mix.tsx`, `components/reports/analytics-cards.tsx`, `app/(owner)/owner/reports/page.tsx`, `components/parent-link-panel.tsx`, `components/parent-link-explainer.tsx`, `app/(platform)/ops/page.tsx` |
| 5 | Attendance left the Insights section (it was a third copy). Enquiries keep their own stated 30-day window. | `components/owner-insights-home/owner-insights-home.tsx`, `app/(owner)/owner/page.tsx` |

**Boundary fix (independent review):** the service dropped buckets whose
`startIso` was not strictly before "now". At exactly 00:00 IST the Last-7-days
"today" bucket starts *at* now, so the range came back with six dates. `last7`
now keeps all seven calendar dates (today is simply empty / unknown);
`Day`, `Week` and `Month` keep their existing future-slot behaviour
unchanged.

### Scope adjustments recorded
- **Coordinator-approved**: the narrow preset-enum acceptance in
  `lib/actions/owner-home-charts.ts` (`"last7"` added to the Zod enum).
  Permission checks in that action are **unchanged** (`requireDefaultCtx` →
  `requirePermission(ctx, "dashboard.view")` → service).
- **Coordinator steering**: the Home toggle offers **Day / Last 7 days /
  Month** (three distinct choices). The Monday-to-now `week` key stays
  supported by the URL, the action and the service for compatibility, but it
  is **not** offered as a button beside "Last 7 days". A legacy `trend=`
  parameter is accepted and ignored.
- **Compatibility**: `OwnerHomeCharts` keeps its old public props
  (`metric?`, `today?`) as accepted-and-ignored inputs and still accepts
  `data: null`, so legacy fixtures compile without being rewritten. The
  semantic change is recorded here and in the component's doc comment.

## 2. Intended RED → GREEN → refactor

Every cycle below was run **before** the matching production edit, through the
shared lock (`python3 .opencode/scripts/lane_job.py harness test <paths>`,
disposable DB `aqua_test_4413576bec`, role `app_login`).

| Cycle | Test | RED (actual) | GREEN |
|---|---|---|---|
| 1 | `tests/app-wide-ux-20261031/owner-last-7-days.test.ts` | **7 failed / 1 passed** — `resolveOwnerPeriod("last7")` fell through to the month branch (`fromDate` `2026-10-01`, `tabLabel` "This month") | 8/8 pass |
| 2 | `tests/app-wide-ux-20261031/owner-home-composition.test.tsx` | **10 failed / 1 passed** — no range strip, no attendance panel, attendance inside Money, month-history link present, range/comparison duplicated | 11/11 pass |
| 3 | `tests/app-wide-ux-20261031/owner-charts-range-boundary.test.ts` | **1 failed / 2 passed** — at exact IST midnight the service returned **6** dates, expected 7 | 3/3 pass |
| 4 | `tests/app-wide-ux-20261031/truthful-copy.test.tsx` (copy set 1) | **5 failed / 2 passed** — "Revenue by plan", "No plan-linked collections", parent-link description missing the plan/fees | 7/7 pass |
| 5 | `tests/app-wide-ux-20261031/truthful-copy.test.tsx` (Ops queue) | **1 failed / 7 passed** — "expected … not to match /every tenant is healthy/i" | 8/8 pass |

Evidence files: `evidence/red-1-last-7-days.txt`, `red-2-composition.txt`,
`red-3-range-boundary.txt`, `red-4-truthful-copy.txt`, `red-5-ops-queue.txt`,
`green-*.txt`.

**Two expectation corrections, reported honestly** (the implementation was
right; my first assertion was wrong — no assertion was weakened to reach
green):
1. `owner-last-7-days.test.ts` — the previous range's last date is
   **2026-10-21**, not `2026-10-22`: the comparison runs for the same elapsed
   span (6 d 8 h from 15 Oct 00:00), so it ends at the same wall-clock time on
   the seventh date before the window and touches dates 15–21.
2. `owner-charts-range-boundary.test.ts` — the retained Day/Week behaviour at
   exact midnight is **0 buckets (Day)** and **5 buckets (Week, Mon–Fri)**; my
   first draft assumed 1/1. The test now pins the *existing* behaviour, which
   is what had to be retained.
3. `truthful-copy.test.tsx` — the negative regex `/every tenant is healthy/i`
   also matched the new, negated sentence. It now matches the old claims
   specifically ("every tenant is healthy right now", "never goes stale").

**Refactor / verification**: `comparisonExpansion` was dropped from the public
`OwnerChartsData.period` DTO (it broke typed fixtures) and replaced by one
shared helper, `comparisonExpansionFor(label)` in `lib/time/owner-periods.ts`,
so the phrase beside a comparison has a single source.

## 3. Test totals

- New suite `tests/app-wide-ux-20261031/**`: **4 files, 30 tests, all pass**.
- Targeted existing suites re-run after the change (owner home surface, chart
  band, lavender money band, insights home + page + scope, mobile trends,
  c1 home mix): **all pass**.
- `pnpm typecheck` — pass. `pnpm lint` — pass (0 warnings).
- Full gate `pnpm test:sharded` — **see `evidence/full-suite.txt`** for the
  final result of this run.
- Not run here (heavy/serial, coordinator-owned): `pnpm build`,
  `pnpm check:bundle`, `pnpm check:fonts`, `pnpm check:focus-contrast`,
  `pnpm e2e:parent-link-zero-js`. The first `pnpm typecheck` run OOM'd at the
  1024 MB default heap — **infrastructure evidence, not product RED**; every
  subsequent run used `NODE_OPTIONS=--max-old-space-size=2048` through
  `lane_job.py` (one heavy job at a time, no parallel Next/build/browser job).

## 4. Roles and states in scope

Owner/Admin `/owner` (range, money band, attendance panel, insights, drill-down
scope), Ops `/ops` (empty queue), Owner reports `/owner/reports` (membership
plan card), Parent/public `/p/[token]` + `/parent` (link description). The
coverage ledger separates **functional / semantic / visual** verdicts per entry
and names the evidence layer: a jsdom-rendered or service-level assertion can
establish a functional or semantic fact, but **no visual or device verdict is
claimed** — every 390×844 / 1280×900 / theme / real-browser state stays
**BLOCKED** until the coordinator's independent Chrome review runs. Reception,
coach, worker, public/auth and future screens are marked NOT TESTED / PLANNED —
a source audit, not a rendered pass.

## 5. Known issues / remaining checks

- **Visual acceptance is NOT adjudicated in this tranche.** The coordinator's
  independent Chrome review on the built artifact is still required at
  390×844, 1280×900, both themes, for: the new range strip, the attendance
  panel, the money band without the metric switch, and the "How this is
  measured" / "What counts as digital?" disclosures.
- The Owner Home **attendance line chart and its data table** are gone from
  Home (they were part of the duplicated trio); the detail is the attendance
  report drill-down. Confirm that is acceptable in review.
- `components/owner-insights-home/attendance-by-batch.tsx` and
  `attendancePreview()` are no longer rendered on Home (the component and its
  read model still exist and are still tested directly). Left in place rather
  than deleted — no request to remove the read model.
- `components/owner-home-payment-mix.tsx` is a pre-existing, unreferenced
  older duplicate of the payment mix; left untouched (out of this tranche).
- The Ops empty-queue copy names the queue's checks; the underlying rules live
  in `db/tenant-health.ts` and were not changed.
- Nothing is committed, pushed or deployed. Nothing is claimed as visually
  accepted.

## 6. Next action

1. Coordinator: run the independent Chrome review of the changed Owner Home,
   Ops overview and reports screens (both themes, 390×844 + 1280×900) and
   record the **functional / semantic / visual** verdicts separately.
2. Reviewer: read the diff against `docs/design-system/product-acceptance.md`
   and this handoff; confirm the semantic verdicts (attendance outside Money,
   one scope owner, truthful wording) — the functional verdicts are the
   executed tests above.
3. Then: the later tranche (shared density/forms/date/select geometry, reviewed
   custom-icon integration across all current roles) and the remaining
   coverage-ledger entries.
