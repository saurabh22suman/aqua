# Backend batch 6 — attendance report consistency (2026-10-27)

**Branch:** `fix/attendance-report-consistency-b6`
**Base:** `d692fd322ca8aa369e23ee0b6056130e57aee298` (recorded fetched `develop`; worktree HEAD == base, all work is an uncommitted local diff)
**Worktree:** `/home/soloengine/thedutchrabbit/aqua-worktrees/backend-attendance-reports`
**Delivery:** local diff + evidence only. No commit, push, PR, merge, label, deployment or external-service call was made or is authorised by this assignment.

**Two slices, one branch.** Slice 1 (below) made the report's session
eligibility match the insights view. Slice 2 (§ A) fixed the action
boundary that dropped the caller's location scope. Both are in the
same local diff for the coordinator's reviewed integration into
`develop`.

---

## 1. Objective

Reconcile the owner **attendance report** (`getAttendanceReport`) with the
existing **owner-insights** non-cancelled-session semantics, so the Home
insights view and the attendance drill-down report count the same
sessions.

**Why:** the insights read model excludes cancelled sessions
(`sessions.status <> 'cancelled'`); the attendance report did not. A
cancelled session that still carries marks inflated `sessionCount`,
`presentMarks`, `totalMarks` and `pct` in the report while the chart
the owner drilled down from said the opposite.

**How:** an explicit cancelled-session exclusion in the attendance
report query, inside the `LEFT JOIN` condition so a batch with no
eligible session is still reported (`sessionCount 0`, `pct null`). The
denominator, the present+late convention, the unknown-vs-absent
convention and the public return types are unchanged. The period and
location semantics were verified, not altered.

**Slice 2 (authorised separately):** the two attendance-report
Server Actions dropped the caller's location scope by rebuilding a
narrowed `{ tenantId }` context, so the service's O-08 gate had
nothing to apply. Both now forward the complete authorised context
that `requireDefaultCtx()` resolved — the screen read and the CSV
export — with an action/service integration regression over real
multi-location data. Details in § A.

## 2. Findings

| # | Finding | Status |
| --- | --- | --- |
| F-1 | `getAttendanceReport` counted cancelled sessions — the defect this batch fixes. | **fixed** |
| F-2 | The report and the insights view now agree on eligible sessions and recorded marks; a regression test reads both views over one fixture. | **fixed + guarded** |
| F-3 | Register completeness vs mark presence remain different measurements (report = recorded marks; insights = effective historical roster). Deliberate; documented. | **documented, not changed** |
| F-4 | `late` is folded into attendance in the report and kept separate in the insights view. Deliberate; documented. | **documented, not changed** |
| F-5 | The report **actions** (`lib/actions/owner-reports.ts`) pass a narrowed `{ tenantId }` context, so the service cannot resolve the caller's identity. With O-08 location scoping ON, the report shows a location-restricted caller only tenant-wide batches — **narrower** than entitled to, and narrower than the insights action (which passes the full context). Under-report, never a leak. | **fixed in slice 2 (§ A)** |
| F-6 | The eligibility predicate is written out twice (`attendance-report-query.ts` and `owner-insights-attendance-sql.ts`). A shared predicate module would remove the coupling, but the insights service file is not owned by this batch. | **out of scope — raised below** |
| F-7 | `tests/tier1/owner-reports.test.ts` fails in this environment **at base**: its fixture calls `createMember` with `SYSTEM_USER = 00000000-0000-0000-0000-000000000000`, which has no `users` row, so `audit_log_new_actor_id_fkey` is violated inside `seedMember` — before any report assertion runs. Unrelated to this change. | **pre-existing baseline failure; not mine to fix (protected path)** |
| F-8 | The CSV route `app/(owner)/owner/reports/attendance.csv/route.ts` answers **every** error with `400 Bad period: <message>` — an authorisation failure becomes a "Bad period" and an internal error message is echoed to the browser. The scope itself is correct; the HTTP status mapping and the error text are wrong. Route file is outside this batch's scope. | **out of scope — raised below** |
| F-9 | The other report actions in the same file (`getEnquiryFunnelAction`, `getRetentionViewAction`, `getCoachLoadAction`, `getFacilityUtilisationAction`) still pass a narrowed `{ tenantId }` context. Two of them (`getEnquiryFunnelAction`, `getFacilityUtilisationAction`) read location-bearing tables, so the same under-report applies to them. | **out of scope — raised below (§ A.5)** |

## 3. Threat and trust boundaries

- **Tenant isolation (unchanged, re-verified).** The report reads
  through `withTenant()` (transaction-scoped `app.tenant_id` + RLS) and
  carries explicit `tenant_id` predicates on `batches`, `sessions` and
  `attendance`. New test: another tenant's batch never appears in this
  tenant's report.
- **Location scope (unchanged, re-verified).** The caller's access is
  resolved with `resolveLocationAccess` + `locationPredicate`; a
  requested `locationId` may only **narrow** it. New tests: a
  location-restricted caller sees only their locations plus
  tenant-wide (`location_id IS NULL`) batches, and asking for a
  facility outside their access returns an empty report.
- **The action boundary (fixed in slice 2).** The scope above is only
  real if the caller's authorised context reaches the service. An
  adapter that rebuilds `{ tenantId }` silently drops the location
  scope, and the service's gate cannot see what the adapter threw
  away — the report answers a question nobody asked. The two
  attendance actions now forward the complete context that
  `requireDefaultCtx()` resolved; the permission gate, the feature
  gate and the service's own scope logic are untouched. New tests
  cover the restricted owner, the all-locations owner, an explicit
  facility, an empty scope, the CSV, the permission refusal and the
  feature refusal.
- **CSV parity.** The export runs the same context, the same
  permission gate and the same service call as the screen read, so the
  exported rows are the rows on screen. A new test compares the two
  row-for-row.
- **Eligibility is not an access control.** Excluding cancelled
  sessions removes rows from an *aggregate* a caller is already
  authorised to read. It narrows, never widens.
- **Data exposure unchanged.** The report returns per-batch
  aggregates only — no member identifier, no per-child score. The
  report keeps that shape (no new fields were added to
  `BatchAttendanceReportRow`).
- **Input validation unchanged.** `reportPeriodSchema` /
  `ownerInsightInputSchema` still parse `from`/`to` at the action
  boundary; the service is unchanged in what it accepts. The new
  predicate is a static SQL fragment — no interpolation of caller data.
- **No new writes, no audit surface.** This batch adds a read
  predicate only. No new table, column, migration, dependency,
  endpoint, entitlement or permission was introduced.
- **No secrets or PII in logs or fixtures.** The fixture uses opaque
  ids, asserts on counts only, and never prints member data. Test
  output contains no personal data.

## 4. Exact files changed

Modified (2):

- `lib/services/owner-reports.ts` — the attendance-report portion was
  moved out; the module now re-exports `getAttendanceReport` and
  `BatchAttendanceReportRow` from the new module so **every existing
  import path and export name is unchanged**. 372 → 311 lines.
- `lib/actions/owner-reports.ts` — **slice 2 only**: the two
  attendance actions (`getAttendanceReportAction`,
  `attendanceReportCsvAction`) now forward the complete authorised
  context to the service instead of a narrowed `{ tenantId }`. No
  other action in the file was touched. 103 → 111 lines.

Added (5):

- `lib/services/attendance-report-query.ts` (126 lines) — the report
  query, the eligibility rule, the period semantics and the location
  scope, documented in place.
- `tests/backend-b6/attendance-reports/fixture.ts` (261 lines) — the
  disposable-tenant fixture (three locations, tenant-wide batches).
- `tests/backend-b6/attendance-reports/attendance-report-eligibility.test.ts`
  (220 lines) — eligibility, controls, boundaries, cross-view
  reconciliation.
- `tests/backend-b6/attendance-reports/attendance-report-scope.test.ts`
  (161 lines) — tenant isolation, location scope, the scoped-read
  eligibility case, the service's fail-closed characterization.
- `tests/backend-b6/attendance-reports/attendance-report-action-scope.test.ts`
  (357 lines) — **slice 2**: the action/service integration
  regression.

Added (1, documentation):

- `docs/backend/attendance-report-semantics.md`.

**Not touched:** `lib/actions/owner-insights.ts`,
`lib/services/owner-insights*.ts`, `lib/services/coach-load.ts`,
`lib/services/owner-analytics.ts`, `lib/services/utilisation.ts`,
the enquiry funnel, the retention metrics, every `app/`,
`components/`, `db/` file, every `tests/tier1/**` file, every
scanner, every CI config, every permission or entitlement
definition.

`git status --short`:

```
 M lib/actions/owner-reports.ts
 M lib/services/owner-reports.ts
?? docs/backend/
?? docs/handoffs/
?? lib/services/attendance-report-query.ts
?? tests/backend-b6/
```

## 5. RED — observed intended failing test, before the production change

The new tests were written first and run against the **unchanged**
production code. Command (harness, disposable test DB, port 55462):

```
python3 .opencode/scripts/harness.py test tests/backend-b6/attendance-reports/
```

Output at base (`/tmp/opencode/b6-logs/RED-final-at-base.txt`):

```
 ❯ tests/backend-b6/attendance-reports/attendance-report-eligibility.test.ts (7 tests | 3 failed)
 ❯ tests/backend-b6/attendance-reports/attendance-report-scope.test.ts (6 tests | 1 failed)
   × excludes a cancelled session that carries marks from every figure
   × counts only the non-cancelled sessions of a mixed batch
   × counts the same eligible sessions and the same recorded marks
   × applies the cancelled-session rule to a scoped read too

 FAIL  ... > excludes a cancelled session that carries marks from every figure
AssertionError: expected 1 to be +0 // Object.is equality
   130|     expect(row?.sessionCount).toBe(0);

 FAIL  ... > counts only the non-cancelled sessions of a mixed batch
AssertionError: expected 2 to be 1 // Object.is equality
   141|     expect(row?.sessionCount).toBe(1);

 FAIL  ... > counts the same eligible sessions and the same recorded marks
AssertionError: expected 2 to be 1 // Object.is equality
   199|       expect(reportRow?.sessionCount).toBe(insightRow.sessions);

 Test Files  2 failed (2)
      Tests  4 failed | 9 passed (13)
```

These are **intended assertion failures**, not import, setup or
environment errors: the suite ran, the fixture built a real tenant on
a real database, and the assertions failed on the production value.

The 9 that passed at base are the honest-green controls (a
non-cancelled session's marks, a partially marked session, the period
boundaries, tenant isolation, location narrowing, the location-widening
negative case). They pin behaviour that must **not** move.

## 6. GREEN — smallest production change, then the full suite

**Green step.** One predicate added to the `LEFT JOIN` condition of the
sessions join (in the new module, which was extracted from
`owner-reports.ts` without changing the query):

```ts
.leftJoin(
  sessions,
  and(
    eq(sessions.batchId, batches.id),
    eq(sessions.tenantId, ctx.tenantId),
    // A cancelled session is not a chance to attend, so it is
    // not an attendance-eligible session.
    sql`${sessions.status} <> 'cancelled'`,
    gte(sessions.sessionDate, period.from),
    lt(sessions.sessionDate, period.to),
  ),
)
```

Because it sits in the `JOIN` condition and not the `WHERE`, a batch
whose only session was cancelled is still reported — with
`sessionCount 0` and `pct null`.

```
python3 .opencode/scripts/harness.py test tests/backend-b6/attendance-reports/
→ Test Files  2 passed (2)
  Tests  13 passed (13)
```

**Consumers and protected tests** (read-only; the protected files were
not edited):

```
python3 .opencode/scripts/harness.py test \
  tests/backend-b6/attendance-reports/ \
  tests/tier1/owner-reports.test.ts \
  tests/review-owner-ui-remediation.test.ts \
  tests/tier1/no-superuser-on-request-path.test.ts \
  tests/owner-insights.test.ts tests/owner-insights-period.test.ts \
  tests/owner-insights-actions.test.ts tests/owner-insights-enquiry-aggregate.test.ts \
  tests/mobile/attendance-csv-scope.test.tsx tests/mobile/owner-reports-page.test.tsx \
  tests/reports/retention-truthfulness.test.ts tests/review-resource-integrity.test.ts
→ Test Files  1 failed | 12 passed (13)
  Tests  2 failed | 98 passed (100)
```

The 2 failures are the pre-existing baseline failures of
`tests/tier1/owner-reports.test.ts` (F-7), verified **identical at
base** by stashing only the production change and re-running
(`/tmp/opencode/b6-logs/BASELINE-tier1-owner-reports.txt`):
`Tests 2 failed | 5 passed (7)` — same two test names, same
`audit_log_new_actor_id_fkey` cause, in the fixture's `seedMember`
helper and not in any report assertion.

**Typecheck and lint** (the harness `quick` gate):

```
python3 .opencode/scripts/harness.py quick
→ $ tsc --noEmit
→ $ eslint . --max-warnings=0
→ exit 0
```

**CI scanners run** (all pass):

| Scanner | Result |
| --- | --- |
| `pnpm check:location-scope` | pass — 136 service files, enforcement or an allowlisted reason |
| `pnpm check:tenant-conventions` | pass — 43 migrations conform |
| `pnpm check:migrations` | pass — 111 files |
| `pnpm check:scripts-exist` | pass |
| `pnpm check:ops-actions` | pass |
| `pnpm check:lines` | report-only (not a CI gate): `owner-reports.ts` 372 → 311 lines; the new module is 126 lines |

**Not run by design:** the full release suite, `pnpm build`,
`pnpm check:bundle`, `pnpm check:fonts`, `pnpm check:focus-contrast`.
The coordinator runs the combined full gate on the integrated
revision; this assignment forbids each writer from running the full
release suite or repeated full builds. No build was run, so the
`design-build.lock` was never taken.

## 7. REFACTOR evidence

The extraction was a **pure refactor** with an honest green baseline:
the RED in §5 was observed against the *pre-change* production code,
and the extraction itself moved the already-green query verbatim into
a new module and turned the old module into a re-export.

- Every export name and import path is preserved:
  `getAttendanceReport`, `BatchAttendanceReportRow`,
  `attendanceReportCsv`, `ReportPeriod`, `reportPeriodSchema`,
  `defaultMonthPeriod`, `getCoachLoad`, `getEnquiryFunnel`,
  `getRetentionReport`, `getRetentionView` are all still exported
  from `@/lib/services/owner-reports`. `lib/actions/owner-reports.ts`
  and `lib/actions/owner-insights.ts` are untouched and still compile
  (`pnpm typecheck` exit 0).
- The pre-existing circular *type-only* pattern is reused exactly as
  `lib/services/coach-load.ts` already does it (`import type
  { ReportPeriod } from "./owner-reports"`), so no new coupling shape
  was introduced.
- The new module uses `resolveLocationAccess` + `locationPredicate`
  from the shared helper, so `check:location-scope` stays green.
- After the extraction: `tests/backend-b6/attendance-reports/` 13/13
  pass, `tests/review-owner-ui-remediation.test.ts` 6/6 pass,
  `pnpm typecheck` and `pnpm lint` exit 0.
- Line budget: `owner-reports.ts` 372 → 311 lines (the 300-line rule
  is report-only); the extracted module is 126.

## 8. Negative and security cases covered by the new tests

| Case | Assertion | Result |
| --- | --- | --- |
| Cancelled session that still carries marks | `sessionCount 0`, `presentMarks 0`, `totalMarks 0`, `pct null`, batch still present | pass |
| Mixed batch (one cancelled + one held) | only the held session counts | pass |
| Batch with only a cancelled session | row present, `pct null` (never `0%`) | pass |
| Partially marked session (2 marks, 5 members) | denominator is the 2 recorded marks; unmarked members are unknown, not absent | pass |
| Exact period start / end | session on `from` counts; session on `to` does not | pass |
| Cross-view reconciliation | report `sessionCount`/`totalMarks`/`presentMarks` equal the insights view's `sessions`/`marks.total`/`marks.present + marks.late` for every shared batch | pass |
| Scoped read | a location-restricted caller sees only their location plus tenant-wide batches; the cancelled session in their location is excluded there too | pass |
| Requested facility (negative) | a location-restricted caller asking for another facility gets `[]` — the request narrows, never widens | pass |
| Tenant isolation (negative) | another tenant's batch never appears; it is reported to its own tenant | pass |
| Privileged-connection scanner | `tests/tier1/no-superuser-on-request-path.test.ts` stays green — the fixture names the credential in **one** place, the shared `tests/db/privileged-fixture.ts` helper | pass |

No entitlement, permission or authz policy was changed, so no
permission-matrix case needed re-baselining.

## 9. Remaining failures and requests for the coordinator

### 9.1 Pre-existing baseline failure — not mine, needs an owner

`tests/tier1/owner-reports.test.ts` — 2 of 7 tests fail **at base** in
this environment:

```
audit_log_2026_10 ... violates foreign key constraint "audit_log_new_actor_id_fkey"
  Detail: Key is not present in table "users".
  at seedMember → createMember → writeAudit
```

The fixture uses `SYSTEM_USER = 00000000-0000-0000-0000-000000000000`
as the audit actor, and no `users` row with that id exists in a
freshly migrated database, so the member audit insert violates the FK.
It is a **fixture/environment** problem that occurs before any report
assertion, and it is identical with and without this batch's change
(`Tests 2 failed | 5 passed (7)` at base, `Tests 2 failed | 13 passed
(15)` with the change and the same two test names failing).

**Request:** the owner of `tests/tier1/**` decides whether to seed the
actor row or to use a real `users` row. I did not edit the protected
test.

### 9.2 Blocked shared decision — the duplicated eligibility predicate (F-6)

The rule now exists in two places:
`lib/services/attendance-report-query.ts` and
`lib/services/owner-insights-attendance-sql.ts`. The insights service
file is explicitly outside this batch's write scope, so I did not
factor it out. The coupling is documented in
`docs/backend/attendance-report-semantics.md` and the regression test
reads both views, so a divergence fails the suite rather than reaching
an owner.

**Request:** if the coordinator wants one shared predicate (a small
`lib/services/attendance-eligibility.ts`), that touches the insights
service file — a shared-file decision I am not authorised to make.

### 9.3 Blocked shared decision — the report action drops the caller's identity (F-5)

**RESOLVED IN SLICE 2 (§ A).** This item was raised by slice 1 and
authorised for repair in slice 2; the two attendance actions now
forward the complete authorised context, and the action/service
integration regression in
`tests/backend-b6/attendance-reports/attendance-report-action-scope.test.ts`
pins the behaviour. The finding is kept here for history:

> The report actions (`lib/actions/owner-reports.ts`) pass a narrowed
> `{ tenantId }` context to the service, so the service cannot resolve
> the caller's identity and falls back to "no locations at all". With
> the O-08 location-scoped-staff switch ON, the report therefore resolves to
> "no locations" and shows only tenant-wide batches — an under-report
> for a location-restricted staff member.
>
> No leak is involved; the report only ever shows less
> than the caller may see.

The service-level characterization test that recorded the old
behaviour ("shows only tenant-wide batches to a caller with no
resolved identity") still passes and still documents the service's
fail-closed default — but no request path reaches it any more, and
the comment above it now says so.

The remaining scope questions are in § A.8: the **other** report
actions in the same file (F-9) and the CSV route's error mapping
(F-8).

### 9.4 Not raised as a blocker

The `access.location_scoped_staff` key defaults to **off**, so the F-5
under-report did not affect a default tenant before the fix, and it
does not affect one now. It becomes visible as soon as an operator
turns the switch on — which is exactly when slice 2's fix starts to
matter.

## 10. Owned resources and reproduction

**Owned by this session:**

| Resource | Identifier | Notes |
| --- | --- | --- |
| Worktree | `/home/soloengine/thedutchrabbit/aqua-worktrees/backend-attendance-reports` | branch `fix/attendance-report-consistency-b6`, HEAD == base `d692fd3`, dirty diff only |
| Disposable test Postgres | container `aqua-harness-test-4ec043c300`, published on `127.0.0.1:55462` | label `aqua.harness=disposable`, tmpfs data, created by `python3 .opencode/scripts/harness.py prepare-test --port 55462` |
| Test DB | `aqua_test_4ec043c300` on that container | runtime role `app_login`, migration role `aqua`; **never** the development or customer database |
| Test profile | `.env.aqua-harness-test.local` (mode 0600, git-ignored) | `NODE_ENV=test`, `AQUA_NO_DOTENV=1`, `DEMO_MODE=false` |
| Branch | `fix/attendance-report-consistency-b6` | no commit, no push, no PR, no label |
| Log directory | `/tmp/opencode/b6-logs/` | RED/GREEN/scan outputs listed below |

**Processes owned by this session:** none beyond the OpenCode session
itself. **No dev server was started**, so the reserved web port 3132
was not used, and no `next build`/`next start` process ever owned this
checkout (verified with the harness `doctor` scan and by walking
`/proc` for processes whose cwd is this worktree). No other owner's
process was killed and no other container was touched.

**Other owners' processes observed and left alone:** at the time of
the final sweep, two `next dev` servers were running in **other**
worktrees — `owner-insights-home` (port 3122) and
`ops-review-local-b9` (port 3138). Neither is in this worktree,
neither was signalled, and neither touches the build output or the
database this batch uses. My reserved web port (3132) and my
disposable DB port (55462) are distinct from all of them.

**Durable logs** (`/tmp/opencode/b6-logs/`):

| File | What it shows |
| --- | --- |
| `RED-final-at-base.txt` | the intended RED: 4 failed / 9 passed at base |
| `RED-eligibility.txt` | the first RED run, before the scope file existed |
| `RED-reconciliation-at-base.txt` | RED with the reconciliation test added |
| `BASELINE-tier1-owner-reports.txt` | the tier1 baseline failure at base, unmodified production code |
| `GREEN-eligibility.txt` | GREEN after the one-predicate change |
| `GREEN-b6-suite.txt` | GREEN of the 11-test suite before the reconciliation test |
| `GREEN-reconciliation.txt` | GREEN with the reconciliation test (13 tests) |
| `GREEN-final2.txt` | final GREEN of the new suite (13/13) |
| `GREEN-related-consumers.txt` | first consumer sweep (caught the scanner finding, §11) |
| `GREEN-b6-plus-guard2.txt` | new suite + the superuser guard, green together |
| `FINAL-consumers.txt` | final sweep: 98 passed, 2 pre-existing baseline failures |
| `quick-final.txt` | `tsc --noEmit` + `eslint --max-warnings=0`, exit 0 |
| `RED-action-scope.txt` | **slice 2** RED: 7 failed / 6 passed before the action fix |
| `RED-full-suite-at-true-base.txt` | **slice 2**: the whole B6 suite at the true base — 11 failed / 15 passed |
| `GREEN-action-scope.txt` | **slice 2** GREEN: 26/26 across the three new files |
| `GREEN-action-preamble.txt` | **slice 2**: `server-action-preamble` + the permission scan, 346 passed |
| `FINAL-slice2-consumers.txt` | **slice 2** consumer sweep: 414 passed, 2 pre-existing baseline failures |
| `SLICE2-green-final.txt` | **slice 2** final green of the new suite (26/26) |
| `SLICE2-quick.txt` | **slice 2** `tsc --noEmit` + `eslint --max-warnings=0`, exit 0 |

**Reproduction from a clean shell:**

```bash
cd /home/soloengine/thedutchrabbit/aqua-worktrees/backend-attendance-reports
pnpm install --frozen-lockfile                       # Node 22.23.2, pnpm 11.22.0
python3 .opencode/scripts/harness.py doctor
python3 .opencode/scripts/harness.py prepare-test --port 55462   # idempotent; prints the existing profile
python3 .opencode/scripts/harness.py quick
python3 .opencode/scripts/harness.py test tests/backend-b6/attendance-reports/
```

To re-observe the RED, stash only the production change and re-run the
new suite:

```bash
git stash push -- lib/services/owner-reports.ts
python3 .opencode/scripts/harness.py test tests/backend-b6/attendance-reports/   # 4 failed | 9 passed
git stash pop
```

For slice 2 (the action boundary):

```bash
git stash push -- lib/actions/owner-reports.ts
python3 .opencode/scripts/harness.py test \
  tests/backend-b6/attendance-reports/attendance-report-action-scope.test.ts    # 7 failed | 6 passed
git stash pop
```

Both slices at the true base:

```bash
git stash push -- lib/actions/owner-reports.ts lib/services/owner-reports.ts
python3 .opencode/scripts/harness.py test tests/backend-b6/attendance-reports/   # 11 failed | 15 passed
git stash pop
```

## 11. What was NOT tested

- **No full release suite, no production build.** `pnpm test:sharded`,
  `pnpm build`, `pnpm check:bundle`, `pnpm check:fonts` and
  `pnpm check:focus-contrast` were deliberately not run: the assignment
  reserves the combined full gate for the coordinator. The build lock
  was never taken.
- **No browser / UI verification.** This batch is backend-only and the
  assignment forbids UI work. The owner reports page, the attendance
  card and the CSV route were not exercised in a browser; the reserved
  web port 3132 was not used and no dev server was started.
  `tests/mobile/owner-reports-page.test.tsx` and
  `tests/mobile/attendance-csv-scope.test.tsx` were run as part of the
  consumer sweep and pass, but they are not a visual check.
- **No e2e scripts** (`e2e:parent-link-zero-js`, `e2e:platform-form-leak`,
  `e2e:host-boundary`, `e2e:role-bypass`, `e2e:offline-privacy`) were
  run: none of them touch this read path, and they need a running
  application.
- **No parent-link / offline-identity / logout checks.** This batch
  changes no offline, parent or PWA surface.
- **The insights read model was not modified.** It was read
  (reconciliation test) and its scope, entitlement and grant checks
  were left exactly as they are. `assertInsightAccess` /
  `assertInsightGrant` behaviour is unchanged and was not re-baselined.
- **Real-Postgres behaviour of `count(*) filter (where …)` with NULL
  attendance** was exercised only through the database's own semantics
  on PostgreSQL 16 — no other engine, no mocking of the query layer.
- **Not exercised:** the case of a session whose `status` is NULL or a
  value outside the `sessions_status_check` constraint. The column is
  `NOT NULL` with a CHECK limiting it to `scheduled | held | cancelled`,
  so `<> 'cancelled'` cannot silently exclude a session; this was
  read from the schema, not tested with an illegal row (the database
  refuses to store one).
- **Concurrency, load and index behaviour** were not tested. The added
  predicate filters on `sessions.status` inside a join that already
  filters `session_date` and `tenant_id`; no new index was added and
  no migration was created.
- **No entitlement/permission policy change** was made or tested, so
  the permission matrix and the tenant-feature resolution were left
  untouched.

### Slice 2 — what was NOT tested

- **The session-resolution path was mocked, not exercised end to end.**
  The new action test replaces `requireDefaultCtx()` with a resolved
  context. `resolveDefaultMembership`, `resolveLocationIds` and
  `resolvePermissionContext` were **read** (to establish the access
  model) but not exercised against a real membership row: the test
  supplies `allLocations` and `locationIds` directly. A real
  location-restricted membership with `membership_locations` rows was
  never resolved through `requireDefaultCtx()`.
- **No browser session.** The actions were called directly with a
  mocked session, so no Better Auth cookie, no request headers and no
  `x-request-id` were involved.
- **The CSV route handler was not exercised.** It needs a running
  Next server. The **action** it calls was tested; the route's own
  URL parsing, its `400` mapping and its response headers were not
  (F-8).
- **The reports page was not exercised in a browser.** The screen read
  was tested at the action boundary, not through
  `app/(owner)/owner/reports/page.tsx`; no dev server was started and
  the reserved web port 3132 was not used.
- **Two branches of `resolveLocationAccess` were not exercised:** the
  `systemActor` branch and the database fallback that resolves a
  caller's default membership when the context carries a `userId` but
  neither `allLocations` nor `locationIds`. The propagated context
  always carries both, so those branches are unreachable from this
  action today.
- **The scope of the other report actions was not tested** (F-9) —
  they were left untouched, so no evidence is offered about them.
- **No concurrency, multi-tenant-switching or performance testing**
  of the propagated context. The change forwards an object that was
  already being resolved; it adds no query, no index and no
  migration.

## 12. Statements this batch does not make

This handoff reports **code and test evidence only**. It does not claim
certification of any kind, does not state that the change is shipped,
merged, released or deployed, and does not assert that the product is
production-ready. The combined full gate on the integrated revision,
independent code review, and human design approval remain outstanding
gates owned by the coordinator.

---

# A. Slice 2 — the attendance-report action boundary

**Authorisation:** the coordinator's finding that
`lib/actions/owner-reports.ts` passes only `{ tenantId: ctx.tenantId }`
into the service, dropping the caller's location scope, with an
instruction to fix it with proper authorised context propagation for
both the screen read and the CSV.

## A.1 The access model, read before the fix

`requireDefaultCtx()` (`lib/auth/context.ts`) resolves the caller's
session into a full `Ctx`:

| Field | Meaning | Used by the service? |
| --- | --- | --- |
| `userId` | the resolved membership's user | yes — `resolveLocationAccess` needs an identity |
| `tenantId` | the tenant | yes |
| `roleKey`, `roleId`, `membershipId` | the caller's role | yes (fallback membership lookup) |
| `allLocations` | the membership's all-locations flag | yes — `true` ⇒ unrestricted |
| `locationIds` | the membership's location list (all locations when `allLocations`) | yes — the restricted set |
| `permissions`, `features` | the resolved grant and entitlement sets | yes — `requirePermission` |

`resolveLocationAccess(tx, ctx)` (`lib/services/location-access.ts`)
then resolves, in order:

1. the switch is off ⇒ unrestricted (tenant-wide — the default);
2. `systemActor` without a user ⇒ unrestricted;
3. **no user ⇒ `{ unrestricted: false, locationIds: [] }`** — fail
   closed, and `locationPredicate` turns that into "tenant-wide
   batches only" (`location_id IS NULL`);
4. `allLocations === true` ⇒ unrestricted;
5. `allLocations === false` ⇒ exactly `ctx.locationIds`;
6. otherwise ⇒ a database lookup of the caller's default membership.

So the service already knows how to honour the caller. The defect was
that the adapter threw the answer away before the service could use
it: `{ tenantId: ctx.tenantId }` has **no `userId`**, so the service
took branch 3 and every caller — however restricted — got the
tenant-wide batches and none of their own.

**The fix is propagation, not a filter.** The action hands the
service the context `requireDefaultCtx()` already resolved. Nothing
about the scope is recomputed, guessed or hard-coded at the adapter,
and the service keeps owning the scope decision.

## A.2 The change

`lib/actions/owner-reports.ts`, two functions only:

```ts
 export async function getAttendanceReportAction(raw: unknown) {
   const parsed = periodWithFacilitySchema.parse(raw);
   const ctx = await requireDefaultCtx();
   requirePermission(ctx, "reports.operational");
-  return getAttendanceReport({ tenantId: ctx.tenantId }, parsed, {
+  return getAttendanceReport(ctx, parsed, {
     locationId: parsed.locationId,
   });
 }
```

and the same one-token change in `attendanceReportCsvAction`. The
CSV export therefore runs the **same context, the same permission
gate and the same service call** as the screen read, so the exported
rows are the rows on screen.

Nothing else in the file changed: the enquiry funnel, retention,
coach load and facility utilisation actions are untouched (F-9).

## A.3 RED — action/service integration, observed before the fix

New file
`tests/backend-b6/attendance-reports/attendance-report-action-scope.test.ts`
(13 tests). It is an **action/service integration** test: the real
actions, the real service, the real query and a real database. Only
the session resolution (`requireDefaultCtx`) is mocked, because what
is under test is the propagation of the context it returns.
`requirePermission` stays **real** — the gate must still run, and a
caller without the grant must still be refused.

Fixture: one tenant with **three** locations and `access.location_scoped_staff`
switched **on** (with the switch off the location predicate is a
no-op and the defect would be invisible). Batches: one at each
location, a tenant-wide batch, a zero-session batch, a batch whose
only session was cancelled, plus a second tenant with its own batch.

```
python3 .opencode/scripts/harness.py test \
  tests/backend-b6/attendance-reports/attendance-report-action-scope.test.ts
```

Output before the fix (`/tmp/opencode/b6-logs/RED-action-scope.txt`):

```
 ❯ attendance-report-action-scope.test.ts (13 tests | 7 failed)
   × serves a location-restricted caller only their own location and tenant-wide batches
   × narrows a location-restricted caller to the facility they asked for
   × serves an all-locations caller every facility
   × narrows an all-locations caller to the facility they asked for
   × reports a zero-session batch with no percentage rather than 0%
   × excludes a cancelled session that carries marks
   × exports exactly the rows the screen shows for an explicit facility

 FAIL  serves a location-restricted caller only their own location and tenant-wide batches
AssertionError: expected [ 'Tenant Wide Batch' ] to deeply equal [ 'Cancelled Batch', …(3) ]

 FAIL  narrows a location-restricted caller to the facility they asked for
AssertionError: expected [] to deeply equal [ 'Cancelled Batch', …(2) ]

 FAIL  serves an all-locations caller every facility
AssertionError: expected [ 'Tenant Wide Batch' ] to deeply equal [ 'Cancelled Batch', …(5) ]

 Test Files  1 failed (1)
      Tests  7 failed | 6 passed (13)
```

The failure mode is the predicted one and it is a **silent
under-report**: the restricted caller received `['Tenant Wide Batch']`
instead of their own location's batches, and the explicit-facility
request received `[]`. No error, no leak, no `0` — simply the wrong
rows. Every failure is an intended assertion; there is no import,
setup or environment error in the run.

The whole B6 suite at the **true base** (both slices' production
changes stashed) — `/tmp/opencode/b6-logs/RED-full-suite-at-true-base.txt`:

```
 Test Files  3 failed (3)
      Tests  11 failed | 15 passed (26)
```

## A.4 GREEN

```
python3 .opencode/scripts/harness.py test tests/backend-b6/attendance-reports/
→ Test Files  3 passed (3)
  Tests  26 passed (26)
```

Consumers and protected tests (read-only; no protected file was
edited):

```
python3 .opencode/scripts/harness.py test \
  tests/backend-b6/attendance-reports/ \
  tests/tier1/owner-reports.test.ts \
  tests/review-owner-ui-remediation.test.ts \
  tests/tier1/no-superuser-on-request-path.test.ts \
  tests/tier1/server-action-preamble.test.ts \
  tests/mobile/attendance-csv-scope.test.tsx tests/mobile/owner-reports-page.test.tsx \
  tests/reports/retention-truthfulness.test.ts tests/review-resource-integrity.test.ts \
  tests/action-permission-scan.test.ts tests/owner-insights-actions.test.ts
→ Test Files  1 failed | 12 passed (13)
  Tests  2 failed | 414 passed (416)
```

The 2 failures are the same pre-existing baseline failures of
`tests/tier1/owner-reports.test.ts` (F-7, the invalid `SYSTEM_USER`
audit FK) — unchanged by this slice.

`python3 .opencode/scripts/harness.py quick` → exit 0 (`tsc --noEmit`
and `eslint . --max-warnings=0`). Scanners: `check:location-scope`,
`check:tenant-conventions`, `check:migrations`, `check:scripts-exist`,
`check:ops-actions`, `check:runbook-sync` all pass.

## A.5 Refactor — and why there is none

The two actions repeat parse → session → permission → service. That
repetition is **enforced**, not accidental:
`tests/tier1/server-action-preamble.test.ts` walks the TypeScript AST
of every exported async function in a `"use server"` file and requires
that a function taking input (1) opens with a `.parse()`/
`.safeParse()` call and (2) runs a `requirePermission(ctx, "<key>")`
call after it, with the action/key pair matching
`ACTION_PERMISSION_MAP`. Extracting a shared helper would leave each
exported action's first statement as a helper call, and the scanner
would fail.

So the smallest contract-conformant form is the one delivered: two
actions, each independently parse → session → permission → service,
each forwarding the complete context. The duplication is the
enforced shape of every action in this codebase.

The service needed **no** change for this slice: `resolveLocationAccess`
already reads `allLocations` and `locationIds` off the context and
already fails closed when there is no identity. Fixing the adapter
was sufficient, and the service's behaviour is unchanged — which is
why the existing service-level scope tests (`tests/review-owner-ui-remediation.test.ts`,
6/6) still pass untouched.

## A.6 Negative and security cases added in slice 2

| Case | Assertion | Result |
| --- | --- | --- |
| Location-restricted owner, **no** location filter | sees their own location's batches plus tenant-wide batches; **not** the other locations | pass |
| Location-restricted owner, **explicit** filter on their own facility | their facility's batches; the tenant-wide batch (no facility) is excluded by the explicit request | pass |
| Location-restricted owner, **explicit** filter on a facility they do not hold (negative) | `[]` — the request narrows, it never widens | pass |
| All-locations owner, no filter | every facility's batches | pass |
| All-locations owner, explicit filter | only that facility | pass |
| Zero-session batch | `sessionCount 0`, `totalMarks 0`, `pct null` — never `0%` | pass |
| Cancelled session carrying marks | `sessionCount 0`, `totalMarks 0`, `pct null` | pass |
| CSV vs screen read, no filter | the CSV has exactly the screen's rows; the other locations are absent | pass |
| CSV vs screen read, explicit filter | same | pass |
| CSV with an empty scope | header and **no data rows** — an empty export, not a zeroed one | pass |
| Another tenant's batch | absent from the read **and** from the CSV | pass |
| Caller without `reports.operational` (negative) | both actions throw `forbidden … reports.operational`; no rows returned | pass |
| Caller whose tenant lacks the `reports` feature (negative) | both actions throw | pass |

The permission gate was **not** weakened: `requirePermission` is real
in the new test file, the two negative cases prove a refusal, and the
action's permission key mapping in `lib/auth/action-permissions.ts`
is unchanged (`getAttendanceReportAction` and
`attendanceReportCsvAction` → `reports.operational`).

## A.7 What slice 2 did NOT change

- The **service** (`lib/services/attendance-report-query.ts`,
  `lib/services/owner-reports.ts`) — unchanged by slice 2.
- The **other report actions** in `lib/actions/owner-reports.ts` —
  unchanged (F-9).
- Every **permission, entitlement, role or membership** definition.
- Every **`app/`, `components/`, `db/`** file, including the CSV route
  (F-8) and the reports page.
- Every **protected test**, scanner and CI config.

## A.8 Requests for the coordinator — slice 2

1. **F-9 (other report actions, same file).**
   `getEnquiryFunnelAction` and `getFacilityUtilisationAction` still
   pass `{ tenantId: ctx.tenantId }`. `getFacilityUtilisationAction`
   reads location-bearing tables through
   `resolveLocationAccess`, so with `access.location_scoped_staff` on
   it is under-reporting in exactly the way the attendance report was.
   `getEnquiryFunnelAction` does not scope by location today, so
   narrowing it is a product decision rather than a defect fix.
   `getRetentionViewAction` and `getCoachLoadAction` take no
   location filter and are out of this discussion.
   The assignment scoped this batch to the two attendance actions, so
   I did not touch the others. The fix is the same one-token change
   plus a per-report decision on what "scoped" should mean for a
   report with no facility dimension.
2. **F-8 (the CSV route's error mapping).** Every error becomes
   `400 Bad period: <message>`, including an authorisation failure,
   and internal error text is echoed to the browser. The scope is
   correct; the status mapping and the message are not. The route is
   outside this batch's scope (no `app/` changes).
3. **F-6 (duplicated eligibility predicate)** — unchanged from § 9.2.
