# Handoff — shared calendar / date-only, REVIEW RED phase (31 October 2026)

**Branch** `fix/app-wide-ux-20261031` · **HEAD** `54e6d80` (no commit, push, PR,
merge or deployment in this phase) · **model** `minimax/MiniMax-M3.1-Flash`
(direct provider; session metadata matches — no substitution, no paid
fallback).

**Phase** RED only. **No production file was edited**: `components/ui/*`,
`lib/time/calendar.ts`, `components/ops/*`, `app/(platform)/ops/activity/*`
and `db/platform-activity.ts` are byte-identical to the state the previous
guarded writer left (md5 in §7). Only test files and this handoff were
written.

**Contract** `docs/design-system/product-acceptance.md` (calendar revision,
31 Oct 2026) + `docs/design-system/README.md` + `DESIGN.md`. Predecessor
handoff: `docs/handoffs/app-wide-ux-20261031-calendar-date-only-red.md`
(initial RED 43 cases / 31 fails / 12 controls — closed; **not** re-run as
RED here).

**Evidence**
`.playwright-mcp/app-wide-ux-20261031/evidence/calendar-review-red.txt`
(three blocks: the three review files verbose, the whole lane directory,
and typecheck + lint).

---

## 1. The RED — 14 intended assertion failures, 10 passing controls

Command (one heavy job at a time, disposable DB `aqua_test_4413576bec`,
role `app_login`):

```
NODE_OPTIONS=--max-old-space-size=2048 python3 .opencode/scripts/lane_job.py \
  harness test -- tests/app-wide-ux-20261031/date-field-calendar-review.test.tsx \
  tests/app-wide-ux-20261031/ops-activity-page-date-normalization.test.tsx \
  tests/app-wide-ux-20261031/ops-activity-date-model.test.ts --reporter=verbose
```

Result **3 files failed · 14 failed | 10 passed (24)**. Every failure is an
**assertion** failure — no import, fixture or setup error is left in the run
(the one lint warning the first run raised, a missing `aria-selected` on a
test-only `role="option"`, was repaired before the run was counted).

The whole lane (`harness test -- tests/app-wide-ux-20261031`) is
**28 files · 14 failed | 191 passed (205)**: the 14 failures are exactly the
ones above, so no other lane test moved. `harness quick` (typecheck + lint)
is **clean**.

### The seven review findings → the assertion that carries each

| # | Finding | RED (fails today) | Control (green today) |
|---|---|---|---|
| 1 | the date display does not open; Enter/Space/AltDown must open **before** a parent Enter commits | click the display → no calendar; Enter → no calendar **and** the enclosing editor committed the old value; Space → no calendar | — |
| 2 | the validity control ignores `disabled` | a **disabled required** date blocks the form (`checkValidity()` false) | blank required → invalid with **no premature** `role="alert"`; optional blank → valid; the read-only control is barred from validation (`willValidate === false`) |
| 3 | the document pointer press must know the calendar's **own** nested popup | — | the calendar's own month listbox survives a press **and** a choice (the calendar stays open); an **unrelated** listbox still dismisses it |
| 4 | the header clips at 320; the popup ignores the client viewport and short viewports | the header cannot reflow; the arrows are < 44px; the month/year tracks can collapse to zero; the popup claims 320px inside a 300px client viewport; a 420px popup on a 300px viewport can neither fit nor scroll | the shared select keeps its own `pl-4`/`pr-9` (no global padding shrink) |
| 5 | the calendar steals the header select's keys; the blur is suppressed for ever | the calendar moved the month **and** the day when the header select handled ArrowDown/PageDown; the consumer was never told the edit ended, and the popup stayed open | moving the focus **into** the calendar does **not** end the edit |
| 6 | the page pre-throws a malformed filter before the audited read | the refusal never reached the audited `activity.list` boundary (0 calls, expected exactly 1) | the refusal never becomes an unfiltered read; the session is asked for **first** (an unauthenticated caller reaches no read and no audit) |
| 7 | `normalizeActivityDate` rolls an impossible local date into the next month | `2026-02-30T12:00:00+05:30` → `"2026-03-02"` (expected `null`); the page read that day instead of refusing | a real instant still names its IST day (`2026-02-28T23:30:00Z` → `2026-03-01`); the calendar-date rules are unchanged; the page's query and its visible controls still agree |

Also RED: **the calendar offers a day the product does not accept** —
walking back one month from January 1900 shows December 1899 and emits
`1899-12-15`, which `parseCalendarDate` refuses.

## 2. Files written in this phase

- **NEW** `tests/app-wide-ux-20261031/date-field-calendar-review.test.tsx`
  (16 cases: 11 RED, 5 controls) — findings 1, 2, 3, 4, 5 and the date range.
- **NEW** `tests/app-wide-ux-20261031/ops-activity-date-model.test.ts`
  (3 cases: 1 RED, 2 controls) — the pure date model, finding 7.
- **CHANGED** `tests/app-wide-ux-20261031/ops-activity-page-date-normalization.test.tsx`
  (5 cases: 2 RED, 3 controls) — the page, findings 6 and 7.

### The one existing assertion that had to change, and why

`refuses a malformed bound instead of reading everything` asserted
`activityMock.filters` had **length 0**. The reviewed contract says the
refusal must pass through the audited activity list, so the page may now
hand the refused bound to the reader (which refuses it) — the count is no
longer the contract. The assertion was replaced by the same intent, stated
directly: **every read the page attempted carried the bound that was
refused** (no read may be unfiltered). It holds for both admissible fixes
(the page refuses inside the audited boundary, or the reader refuses the
handed-over bound) and it is not weaker: it still fails an unfiltered
trail. No other existing assertion was touched; no tier1 or protected
test was read or changed.

### Mocks, and what they stand in for

The page file now mocks the **reader** (`@/db/platform-activity`) and the
**action** (`@/lib/actions/platform-activity`), not the reader alone. The
action stand-in is faithful to the product's own action: it checks the
session, then reads through the audited boundary under the operation's own
name (`activity.list` / `activity.actions.list`). The audited boundary
(`@/lib/auth/ops-operation`) records the operation names, so the test can
assert that the refusal passed through it **exactly once**. The reader
stand-in applies the reader's own rule: a bound whose calendar parts do not
exist is refused, never rolled over.

## 3. Judgement calls the coordinator should check

1. **The audit contract is observed at the boundary, not in the audit
   table.** The finding notes the real-session audit regressions already
   exist for the helper; this file asserts that the page reaches that
   boundary exactly once with the refused bound, and reads nothing
   unfiltered. Writing an audit row is not asserted here.
2. **`LAYOUT INTENT` assertions** (header reflow, 44px arrows, non-zero
   month/year tracks, popup fits the client viewport, short viewport) are
   composition assertions, not measurements — the same convention as
   `tests/app-wide-ux-20261031/time-field-narrow-layout.test.tsx`. The real
   geometry at 320/360/390 and 1280, in both themes, is the coordinator's
   Chrome pass, after the source freeze. The thresholds are deliberately
   tolerant: a track may declare a pixel minimum ≥ 96px **or** take the
   full row; the arrows may be `h-11`/`min-h-11`/`h-[44px]`.
3. **The short-viewport case mocks `offsetHeight`** (jsdom cannot lay out).
   A fix that shrinks the popup's content without declaring a bounded,
   scrollable height would still read as RED — the coordinator's browser
   pass is the authority there.
4. **`Enter` on the field opens the calendar and is not passed on to the
   enclosing editor.** The consumer's `onKeyDown` is still called for the
   other keys; the parent `inline-edit-field.tsx` (not owned in this phase)
   must not need changing for this to hold.
5. **Finding 3 is already satisfied** in the current DOM: the shared
   `Select` draws its listbox inside the calendar's own subtree, so the
   document press already recognises it. It is pinned as a control
   (press + real choice) rather than left unwritten; the reviewer's
   "portalled listbox" description does not match the shipped `Select`.

## 4. Security and data notes

- The refused bound is refused **inside** the audited boundary, so an
  operator's refusal is auditable like any other operation — the finding
  that the pre-throw made it invisible is the point of finding 6.
- No read is widened: a malformed bound can only produce a refused read,
  never an unfiltered trail.
- The impossible legacy instant (`2026-02-30T12:00:00+05:30`) is refused
  before it can name a day; the reader's exact-and-inclusive instant
  comparison and the date-only IST-day bounds are untouched by this phase.
- No schema, migration, role, grant, auth or global CSS was touched; the
  disposable test database was used and `tests/tier1/**` was not read.

## 5. Not run, not claimed

No build, no preview, no browser pass, no full suite, no `check:bundle`,
`check:fonts`, `check:focus-contrast`, no `e2e:parent-link-zero-js` — all
remain coordinator-owned after the source freeze. **No functional, semantic
or visual verdict is claimed**: this phase produced intended failing
assertions only.

## 6. Next action

The coordinator verifies this RED (the 14 assertion failures are the
intended ones), then reopens source writes for one bounded cycle:

1. `components/ui/DateField.tsx`, `use-date-calendar.ts`,
   `date-field-validity-control.tsx` → GREEN for findings 1, 2, 5 (the
   calendar review file);
2. `components/ui/DateCalendar.tsx`, `DateCalendarHeader.tsx` → GREEN for
   findings 4, 5 (keys) and the date range;
3. `components/ops/ops-activity-date.ts` + `app/(platform)/ops/activity/page.tsx`
   (+ `db/platform-activity.ts`, ordinary reader only) → GREEN for findings
   6 and 7.

## 7. Source identity at this handoff

```
54e6d80  components/ui/DateField.tsx            6147f6498eedfbdb31c02655d00f6fd2
54e6d80  components/ui/DateCalendar.tsx         75deab05252060d66cabf3ecbc49d351
54e6d80  components/ui/DateCalendarHeader.tsx   a223998f044d7f2474c048708aa6848b
54e6d80  components/ui/use-date-calendar.ts      74396a562d61075543a3abdc85f42e1c
54e6d80  lib/time/calendar.ts                   8327d3b0eb68ab4ed3f05e8689cbf067
54e6d80  components/ops/ops-activity-date.ts    9c06c1a565a4986d10adb7657d2c9063
54e6d80  app/(platform)/ops/activity/page.tsx   682bf38a3089310804d8be9189e3715d
```
