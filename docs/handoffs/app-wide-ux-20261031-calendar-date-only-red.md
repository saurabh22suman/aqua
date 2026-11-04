# Handoff — shared calendar + date-only filters, RED phase (31 October 2026)

**Branch** `fix/app-wide-ux-20261031` · **model** `minimax/MiniMax-M3.1-Flash`
(direct provider; session metadata matches — no substitution, no paid
fallback) · **no commits, pushes, PRs, merges, stash or deployment**.

**Contract (human revision)**:
`/home/soloengine/Documents/Codex/2026-10-27/continue-work-on-aqua-currently-planned/work/app-wide-ux-20261031/date-picker-contract.md`
· **RED only** — `app/`, `components/`, `lib/` and `db/` were not touched;
no production file was edited in this phase.

**Evidence**:
`.playwright-mcp/app-wide-ux-20261031/evidence/red-13-calendar-date-only.txt`,
`red-13-calendar-date-only-verbose.txt` (named pass/fail per test),
`red-14-platform-activity-date-only.txt` (the DB suite alone),
`red-13-typecheck-lint.txt` (typecheck + lint, both clean).

---

## 1. The RED (31 intended assertion failures, 12 passing controls)

Run: `python3 .opencode/scripts/lane_job.py harness test -- <5 paths> --reporter=verbose`,
`NODE_OPTIONS=--max-old-space-size=2048`, disposable DB
`aqua_test_4413576bec` (role `app_login`), one heavy job at a time.
Result: **5 files failed · 31 failed | 12 passed (43 tests)**. Every failure
is an **assertion** failure — no import, fixture or setup error is left in
the run.

| File | RED | Actual failure (abridged) |
|---|---|---|
| `tests/app-wide-ux-20261031/date-field-calendar.test.tsx` | 9 / 14 | `a typed date reached the field: expected '28/10/2026' to be ''`; `the date field offers no control that opens a calendar: expected null to be truthy` (×8) |
| `tests/app-wide-ux-20261031/member-inline-date-calendar.test.tsx` | 3 / 4 | `the inline date editor offers no calendar: expected null to be truthy` (×3) |
| `tests/app-wide-ux-20261031/ops-date-only-filter.test.tsx` | 8 / 10 | `the filter still carries /since hour/i`; `the range choices are not date ranges: expected 'Any time \| Last 24 hours \| Last 7 day…'`; `the control has no "/today/i" choice`; `expected '2026-10-31T02:36:40.232Z' to be '2026-10-31'`; `expected '2026-03-01T05:30:00+05:30' to be '2026-03-01'`; `Unable to find an accessible element with the role "alert"` (malformed date); `an inverted range was submitted: expected 'since=2026-03-16&until=2026-03-01' to be ''` (legacy bar) |
| `tests/app-wide-ux-20261031/ops-activity-page-date-normalization.test.tsx` | 2 / 2 | `expected { action: undefined, …(3) } to match object { since: '2026-03-01', …(1) }`; `promise resolved "{ …(10) }" instead of rejecting` |
| `tests/db/platform-activity-date-only.test.ts` | 9 / 13 | `expected [] to deeply equal [ 'dayStart', 'lastMicrosecond', …(2) ]`; `the IST midnight row is missing`; `expected [ 'lastMicrosecond', 'midDay', …(3) ] to deeply equal […(4)]`; `expected [ 'dayStart', 'previousDay' ] to deeply equal […(3)]`; `expected [] to deeply equal [ 'otherTenant' ]`; leap/month/year edges all `[]`; `since="2026-02-30" was accepted as a bound` |

**Passing controls (12)** — the behaviour that must survive the change:
the DD/MM/YYYY display of a given value; a blank **optional** date is
valid; a blank **required** date still makes `form.checkValidity()` false;
a disabled field cannot open a calendar or change; the caller's
`aria-invalid` / `aria-describedby` are honoured; the inline editor still
shows the stored date; the Ops filter still refuses an inverted range; the
legacy filter bar still sends dates with the action and the tenant; the
reader still filters by action; and **all three legacy explicit-timestamp
comparisons still hold** (exact start, exact-and-inclusive end, and an end
that names the next midnight inclusively).

## 2. The real defect the DB suite found

`db/platform-activity.ts` validates a date-only bound with
`z.string().regex(/^\d{4}-\d{2}-\d{2}/)` and `new Date(s)`. The V8 date
parser **rolls an impossible day over** — `new Date("2026-02-30")` is
`2026-03-02`, not an invalid date — so `since=2026-02-30` is accepted
today and silently reads **2 March**. That is the `since="2026-02-30" was
accepted as a bound` RED. A date-only bound also has no IST meaning
today: `new Date("2026-10-28")` is UTC midnight, so the IST day
(18:30Z on the 27th → 18:30Z on the 28th) is not what is read, and
`until` is inclusive at midnight, which drops the whole chosen day.

## 3. What the assertions claim, and the two judgement calls

- **Outcomes, not markup.** The calendar is *discovered*
  (`tests/app-wide-ux-20261031/calendar-probe.ts`): the trigger by
  `aria-haspopup` or by a date/calendar name, the days by their numeric
  content, the focused day by focus or `aria-activedescendant`. No
  proposed module is imported, so any reasonable calendar markup passes.
- **Judgement call 1 — "no free text".** The test asserts the *outcome*
  (a typed date never reaches the field and never emits) and accepts
  either a read-only control or one that ignores the keystrokes. It does
  **not** assert a `readonly` attribute, so the implementation keeps the
  choice — but the contract's own warning ("read-only inputs are barred
  from native constraint validation, so do not silently lose it") means
  the native `required` check must still hold, and
  `keeps the native required validation on a blank required date` is a
  passing control that must stay green.
- **Judgement call 2 — the filter ranges.** `Today` is asserted to send
  **the same IST date for both ends**, and `Last 7 days` is asserted to
  be **today and the preceding six IST dates** (`Last 30 days` follows the
  same rule). The option *values* are never assumed — the tests select
  the option by its label.
- **Deliberately NOT asserted** (to avoid over-specifying): that a
  required field must lack a Clear control; the exact DOM of the
  calendar; that a naive (offset-less) timestamp must be refused by the
  service; anything about the popup's visual fit.
- **Default view.** The date-choice test uses `2026-03-15` and expects
  `2026-03-16`, so it also pins "the calendar opens on the **selected**
  date's month" (March 2026 is not today's month).

## 4. Fixtures and hygiene

- The DB suite uses `tests/db/privileged-fixture.ts` for **fixture setup
  only** (two synthetic tenants and thirteen synthetic `platform_audit_log`
  rows with a run-unique action). Every assertion runs against the real
  service `listPlatformActivity` on the app pool / `app_user`.
  `db/CLAUDE.md` was read first; **no schema, migration, role or grant
  was touched**, and `db/` stayed read-only.
- The rows are removed in `afterAll`; verified afterwards:
  `platform_audit_log` rows matching `dateonly.%` = **0**, tenants
  matching `dateonly-%` = **0**.
- `pnpm typecheck` and `pnpm lint --max-warnings=0` both pass
  (`red-13-typecheck-lint.txt`).
- Only six **new, untracked** files were written:
  `tests/app-wide-ux-20261031/{calendar-probe.ts, date-field-calendar.test.tsx,
  member-inline-date-calendar.test.tsx, ops-date-only-filter.test.tsx,
  ops-activity-page-date-normalization.test.tsx}` and
  `tests/db/platform-activity-date-only.test.ts`. No existing test was
  edited or replaced.

## 5. Older suites that the implementation will have to reconcile

Left untouched on purpose (the coordinator's instruction: do not replace
superseded tests before the implementation compatibility step):

- `tests/ops-redesign/ops-activity-filter.test.tsx` — asserts the
  hour/minutes/AM-PM/seconds contract and the "Any time / Last 24 hours"
  choices this revision withdraws.
- `tests/app-wide-ux-20261031/shared-date-time-controls.test.tsx` and
  `shared-date-time-seconds-and-validity.test.tsx` — assert the Ops
  filter's instant-carrying query.
- `tests/owner-openpen-20261029/shared/date-field-validity.test.tsx`,
  `.../mobile/date-field-a11y.test.tsx`,
  `.../people/mobile/subscription-date-validity.test.tsx`,
  `.../scheduling/mobile/booking-date-nav.test.tsx`,
  `.../management/collections-datefield.test.tsx` — type a date into the
  field, which the calendar replaces.
- `tests/app-wide-ux-20261031/time-field-narrow-layout.test.tsx` — the
  already-recorded TimeField layout RED (2 fails / 12 controls); the
  shared TimeField survives for the scheduling forms.

## 6. Not run, not claimed

No build, no preview, no browser pass, no full suite, no `check:bundle`,
`check:fonts`, `check:focus-contrast` or `e2e:parent-link-zero-js` — all
remain coordinator-owned after the source freeze. **No visual or device
verdict is claimed**: the calendar's fit at 320/360/390 and 1280, in both
themes, is unverified.

## 7. Next action

Root reviews the RED and the two judgement calls, then explicitly reopens
source writes for one bounded cycle at a time:

1. `components/ui/DateField.tsx` + the calendar module → GREEN for
   `date-field-calendar.test.tsx`;
2. `components/member-detail/inline-edit-control.tsx` and
   `inline-edit-field.tsx` → GREEN for
   `member-inline-date-calendar.test.tsx`;
3. `components/ops/ops-activity-filter.tsx`, `ops-activity-bound.tsx`,
   `ops-activity-time.ts`, `components/activity-filter-bar.tsx`,
   `app/(platform)/ops/activity/page.tsx` → GREEN for
   `ops-date-only-filter.test.tsx` and
   `ops-activity-page-date-normalization.test.tsx`;
4. `db/platform-activity.ts` (the only db file the worker may touch) →
   GREEN for `platform-activity-date-only.test.ts`.

Only then: the compatibility step for the superseded suites in §5, the
full suite, the build and the coordinator's own Chrome review.
