# Handoff — app-wide punch list, implementation phase (31 October 2026)

**Branch** `fix/app-wide-ux-20261031` · **model** `minimax/MiniMax-M3.1-Flash`
(direct; session metadata matches — no substitution) · **no commit, push, PR,
merge or deployment**.

Scope: the four reviewed punch-list findings plus the green-first
`owner-periods` extraction. Nothing else was touched.

## 1. Actual RED (this session, before any source edit)

`NODE_OPTIONS=--max-old-space-size=2048 python3 .opencode/scripts/lane_job.py harness test tests/app-wide-ux-20261031/{owner-home-range-toolbar,role-entry-density,staff-leave-copy,ops-activity-narrow-layout}.test.tsx`

→ **4 files / 28 tests, 7 failed / 21 passed, exit 1** (matches the
red-4 handoff). The seven intended failures:

| Finding | Assertion failure |
|---|---|
| Owner range copy | `expected 'Showing this week — a range the three…' to be 'Showing this week'` |
| Coach title/count | `the title row declares no column gap: expected null not to be null` |
| Leave marker ×3 | `'Unpaid · unpaid'`, `'Unpaid leave · unpaid'`, `'unpaid sabbatical · unpaid'` |
| Ops narrow ×2 | row class `grid grid-cols-[minmax(0,1fr)_76px]…` matched neither the stacked nor the wide-variant pattern |

## 2. GREEN

- After findings 1–3 (range copy, coach row, leave marker): same 4 files →
  **26 passed / 2 failed** — only the two intended Ops failures remained.
- After finding 4 (Ops bound extraction + narrow stack): the 4 files plus
  `tests/ops-redesign/ops-activity-filter.test.tsx` → **5 files / 40 tests
  passed, exit 0**. Exact seconds (`47`), the `12:00:47+05:30` bound, date
  validity, noon/midnight and the stale-submission refusal are unchanged.
- Refactor check: `tests/owner-periods.test.ts` + all of
  `tests/app-wide-ux-20261031` + `tests/ops-redesign/ops-activity-filter.test.tsx`
  + `tests/owner-home-surface.test.tsx` + `tests/owner-today-screen.test.tsx`
  + `tests/owner-openpen-20261029/system/foundation-and-home.test.tsx`
  → **26 files / 206 tests passed, exit 0**.
- `lane_job.py harness quick` → `tsc --noEmit` and `eslint . --max-warnings=0`
  → **exit 0**.

## 3. Files changed

| File | Change |
|---|---|
| `components/owner-home/owner-home-range.tsx` | The legacy week state now says only `Showing this week`; the toolbar's fallback label is the window's own name (`OWNER_PERIOD_TAB_LABEL`). Ranges, URLs and the disclosure are untouched. |
| `app/(coach)/coach/page.tsx` | The session header row declares `gap-3`; the title is `min-w-0 flex-1 break-words` (wraps, never truncated), the count is `flex-none`. No label was shrunk and no data was dropped. |
| `components/my-leave-card.tsx` | `unpaidMarker(name, isPaid)` omits the ` · unpaid` suffix when the type name already contains "unpaid" (any case). Values and permissions unchanged. |
| `components/ops/ops-activity-bound.tsx` (new, 135 lines) | The typed bound component: date + time group + seconds. The row is `grid-cols-1 … sm:grid-cols-[minmax(0,1fr)_76px]`, so the seconds control stacks on a narrow width and the AM/PM select keeps real width; the shared `TimeField`/`Select`/`SecondsField` geometry is untouched. Also holds the bound's time split/join helpers. |
| `components/ops/ops-activity-filter.tsx` (382 → 291 lines) | Uses the new bound component; the pure model in `ops-activity-time.ts` and the query API are unchanged. |
| `lib/time/owner-period-model.ts` (new, 117 lines) | The period model: keys, ranges offered, labels, shapes, `comparisonExpansionFor`, `formatInstantRange`. |
| `lib/time/owner-periods.ts` (347 → 286 lines) | Re-exports the same public names (plus the new `OWNER_PERIOD_TAB_LABEL`) and keeps the window arithmetic unchanged. |
| `tests/app-wide-ux-20261031/staff-leave-copy.test.tsx` | Fixture TYPE completed (`usedDays`), because the file did not compile. No assertion changed. |

## 4. Inherited findings for the coordinator (not caused by this phase)

- `tests/owner-lavender-b8/owner-home-money.test.tsx` has **2 stale
  expectations** against copy this branch already changed earlier:
  "Charts are unavailable right now" → the component now prints "Money
  figures are unavailable right now" (`components/owner-home-charts.tsx`,
  changed in an earlier tranche), and "No collections in this period" →
  the comparison now reads "No collections in either range" (the test's
  own fixture at line 152 says "either range" while line 162 asserts "this
  period"). Left untouched: out of this phase's scope, and the assertions
  must not be weakened. The same stale strings appear in
  `tests/mobile/dashboard-trends.test.tsx` (lines 163, 228) — found by
  grep, not run here.
- The RED-phase test file `staff-leave-copy.test.tsx` did not typecheck
  before this phase (missing `usedDays` in its fixture type), which
  failed `pnpm typecheck` for the whole branch; that is fixed above.

## 5. Remaining gates (coordinator-owned)

- **Chrome geometry**: the layout assertions are intent, not measurement.
  The coordinator's independent pass must confirm the Ops AM/PM select at
  390×844 (previously 5.95px of text width against 14.18px needed), the
  coach title/count separation at 390, the "Showing this week" line and
  the leave marker.
- **Owner Home range navigation is still unresolved and unchanged**: the
  URL does not change on a range click in the production preview. No
  speculative plain-anchor or prefetch hack was added; it stays pending
  the coordinator's supported standalone-server preview retest.
- Full suite, production build, scanners, bundle/font gates and the final
  Chrome journey remain coordinator-owned after the freeze.

## 6. Method

Strict RED → GREEN → refactor, one cycle at a time. Every heavy command
ran through `lane_job.py` (max 2048) one at a time; exit statuses were
captured without a masking pipeline. No background jobs remain. No
protected, auth, db, tier1, manifest or global-CSS file was touched.

## 7. Addendum — stale-copy compatibility (same day, coordinator request)

Compatibility maintenance for the already-approved Money-only / one-fact
copy change. **Production stayed read-only**; only two non-tier1 test
files were edited.

**Recorded RED (stale-copy assertions, NOT a product defect)** —
`lane_job.py harness test tests/owner-lavender-b8/owner-home-money.test.tsx
tests/mobile/dashboard-trends.test.tsx` → **2 files / 14 tests, 4 failed /
10 passed, exit 1**. Every failure was an obsolete expected string:

| File / line | Expected (obsolete) | Actual (approved copy) |
|---|---|---|
| `owner-home-money.test.tsx:162` | `No collections in this period` | `No collections in either range` |
| `owner-home-money.test.tsx:175` | `Charts are unavailable right now` | `Money figures are unavailable right now` |
| `dashboard-trends.test.tsx:163` | `No collections in this period` | `No collections in either range` |
| `dashboard-trends.test.tsx:228` | `Charts are unavailable right now` | `Money figures are unavailable right now` |

**Change (four expectations only).** The empty fixture's own comparison
value is `No collections in either range`, so that accurate comparison is
now required; a failed financial read must read `Money figures are
unavailable right now`. Every neighbouring assertion was kept — "No
payments recorded in this period", the no-fake-zero `not.toContain("₹0")`
and the no-empty-chart `queryByTestId("owner-chart")` null check. No
assertion was deleted, skipped or relaxed, no component was mocked away,
and no production file was touched.

**GREEN** — the same two files → **2 files / 14 tests passed, exit 0**.

No full suite, build, preview or stash was run; the coordinator's freeze
and build remain the gate.

## 8. Addendum — shared TimeField narrow layout (same day, RED-only phase)

**Production stayed READ-ONLY** in this phase: `components/ui/TimeField.tsx`
and `components/ui/Select.tsx` are unchanged. The deliverable is the
agent-owned layout contract for the shared primitive.

**The measured RED** (the coordinator's independent production Chrome run,
`.playwright-mcp/app-wide-ux-20261031/chrome-standalone-6/review.json`) —
the shared hour/minutes/AM-PM group clipped at 320 and 360 in BOTH the Ops
activity filter and the reception enquiry follow-up:

| Consumer / viewport | Control | Text room available | Text room needed |
|---|---|---|---|
| reception follow-up, 320 | "AM" | 7.75px | 26.14px |
| reception follow-up, 360 | "AM" | 19.67px | 26.14px |
| Ops, 320 | "AM/PM" | 0.00px | 26.14px |
| Ops, 320 | "12" (hour) | 7.39px | 14.98px |
| Ops, 320 | "00" (minutes) | 7.41px | 21.55px |
| Ops, 360 | "AM/PM" | 22.06px | 26.14px |

390 is green. The cause is the shared group's own tracks — `minmax(0,1fr)`
— whose zero minimum lets every select be compressed.

**New agent-owned test** — `tests/app-wide-ux-20261031/time-field-narrow-layout.test.tsx`
(3 cases, LAYOUT INTENT):

1. no track may collapse below the text its control must show (the 16px
   "AM" needs 26.14px + the shared control's own 54px of padding and
   border);
2. the group must be able to WRAP when its container cannot fit three
   usable widths — a content-responsive grid (`auto-fit`/`auto-fill`) or a
   wrapping row, not a per-page fix or a viewport guess;
3. no clipping, negative-spacing or tiny-text workaround.

**Actual RED (intended)** — `lane_job.py harness test
tests/app-wide-ux-20261031/time-field-narrow-layout.test.tsx
tests/owner-openpen-20261029/shared/time-field.test.tsx
tests/owner-openpen-20261029/shared/time-field-consumer.test.tsx`
→ **3 files / 14 tests, 2 failed / 12 passed, exit 1**:

- *never lets a track collapse…*: `the group declares a zero-minimum track,
  so a select can collapse` — the group is
  `grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.85fr)] gap-2`;
- *wraps the group instead of squeezing three controls into one row*:
  `the group cannot wrap: it lays three controls in one row and squeezes
  them`.

**Controls green**: the third case (no clipping/negative-spacing
workaround) passes, and the existing TimeField behaviour suite
(`tests/owner-openpen-20261029/shared/time-field.test.tsx`: canonical
HH:mm, midnight/noon, partial and invalid reporting, controlled reset,
form names, labels/ARIA/disabled/error, validity reporting) and its
consumer suite both pass — they were not duplicated.

The contract is satisfiable: the helper logic was checked against the
current class string (rejected) and against
`grid-cols-[repeat(auto-fit,minmax(84px,1fr))]` (accepted), which is the
coordinator's preferred content-responsive form.

`harness quick` (`tsc --noEmit` + `eslint --max-warnings=0`) → **exit 0**,
so the new test compiles for the coordinator's freeze.

**Next step (not started here, production still read-only):** implement
the shared group's content-responsive grid with a ~84px minimum track in
`components/ui/TimeField.tsx`; the coordinator then verifies the real
geometry for every actual consumer. The Owner Home range links remain
root's separate diagnosis and were not investigated.

## 9. Checkpoint — human steering of 31 October 2026 (task revision)

**Steering.** Human steering overrides the previous Ops exact-second UI
requirement. The approved scope is now: a shared **calendar date-picker
popup** across app date selection, and **DATE-ONLY filters** (including
Ops Activity) — hours/minutes/AM-PM/seconds leave the filter UI.
Scheduling forms keep the time controls they need. The coordinator sends
the focused revised contract after the inventory.

**What stopped here.** The narrow shared-control (TimeField) work stops
at its RED checkpoint: no further Ops time controls were implemented and
`components/ui/TimeField.tsx` / `components/ui/Select.tsx` are unchanged.
Its recorded RED (section 8: 2 intended failures / 12 passing controls,
exit 1) stands as the durable evidence for that contract.

**Superseded contract tests — marked, retained, NOT deleted.** Every
affected file carries a dated `SUPERSEDED` marker naming what was
withdrawn and what still stands. No assertion was changed, skipped or
removed, and no unrelated test was touched.

| Test file | Withdrawn by the steering | Still in force |
|---|---|---|
| `tests/app-wide-ux-20261031/ops-activity-narrow-layout.test.tsx` | the whole file: the Ops filter's time-group + seconds narrow layout | — (replaced by the revised contract) |
| `tests/app-wide-ux-20261031/shared-date-time-seconds-and-validity.test.tsx` | "the Ops bound keeps its exact seconds" (5 cases) and "refuses a half-chosen time in the Ops filter" | the DATE refusals, the platform activity filter bar, the add-follow-up guard |
| `tests/app-wide-ux-20261031/shared-date-time-controls.test.tsx` | the Ops filter's shared hour/minutes/AM-PM group and the instant it carried | the platform activity filter bar, the enquiry follow-up |
| `tests/ops-redesign/ops-activity-filter.test.tsx` | the hours/minutes/AM-PM/seconds parts of the visible bounds and of the query | the date range, the "Custom" state, the tenant picker, the refusal of an inverted range |
| `tests/app-wide-ux-20261031/time-field-narrow-layout.test.tsx` | PARKED, not withdrawn: the consumer evidence (Ops/reception filters) is superseded, the primitive survives for scheduling forms | the primitive-level contract stands until the revised contract replaces it |

Not superseded (time controls these forms need): the shared TimeField
behaviour suite, the batch/shift/business-hours/session forms and their
tests, and the booking-time display.

**Inventory for the revised contract (read-only, nothing implemented):**

- *Filters that must become date-only*: `components/ops/ops-activity-bound.tsx`
  (the Ops bound: date + time group + seconds) and the range wording in
  `components/ops/ops-activity-filter.tsx` ("Any time", the 24h/7d/30d
  relative ranges). `components/activity-filter-bar.tsx` is ALREADY
  date-only (DateField only).
- *Forms that keep their time controls*: `components/roster/add-shift-form.tsx`,
  `components/batch-create-form.tsx`, `components/batch-edit-form.tsx`,
  `components/shift-template-editor.tsx`,
  `components/settings/business-hours-editor.tsx`,
  `components/bookings/booking-price-rule-form.tsx`,
  `components/session-lifecycle-control.tsx`, and the enquiry follow-up
  (`components/enquiry-detail-view.tsx` — a due date AND time, i.e. a
  form rather than a filter; the coordinator decides).
- *Shared primitives in play*: `components/ui/DateField.tsx` (masked text
  field), `components/ui/TimeField.tsx`, `components/ui/SecondsField.tsx`,
  `components/ui/Select.tsx`.

**Questions the revised contract has to settle:** whether a date-only
Ops filter still carries a time-of-day in the QUERY (the backend
compares `created_at` against an offset-aware timestamp, so the day
boundary needs a definition); what replaces the relative hour ranges in a
date-only filter; whether the calendar popup replaces the masked
`DateField` everywhere or only in filters, and how it keeps the current
day-first, keyboard-operable behaviour; whether the enquiry follow-up
keeps its time.

**Clean stop.** No build, preview, full suite, deployment, stash or
commit. No background jobs remain. Production source is unchanged since
the punch-list phase; this phase wrote test comments only.
