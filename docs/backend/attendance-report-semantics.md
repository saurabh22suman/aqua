# Attendance report semantics

What the owner attendance report counts, what it deliberately does not
count, and where the Home insights view still measures something
different. Written after backend batch 6 (2026-10-27), which made
the report's session eligibility match the insights view's.

The query lives in `lib/services/attendance-report-query.ts`; the
public entry point is still `getAttendanceReport` exported from
`lib/services/owner-reports.ts`.

## The eligibility rule

An **attendance-eligible session** is a session that actually
happened:

| Condition | Rule |
| --- | --- |
| Status | `sessions.status <> 'cancelled'` — `scheduled` and `held` count, `cancelled` does not |
| Window | `sessions.session_date >= from` AND `sessions.session_date < to` (from inclusive, to exclusive) |
| Tenant | `sessions.tenant_id = the caller's tenant` |
| Batch | the session belongs to a batch the caller may see (see *Scope*) |

A **cancelled session is not a chance to attend**. Cancelling a
session keeps its attendance rows (`lib/services/session-lifecycle.ts`
preserves marks so the register still reads them), but the session
stops being a chance to attend, so it contributes:

- no session to `sessionCount`,
- no mark to `presentMarks` or `totalMarks`,
- no share to `pct`.

The eligibility predicate sits in the **JOIN condition**, never in the
`WHERE`. The sessions join is a `LEFT JOIN`, so a batch whose only
session was cancelled is still reported — with `sessionCount 0` and
`pct null`. "No sessions yet" and "nobody came" must never look the
same; `pct` is `null`, not `0`.

## The numbers

| Field | Meaning |
| --- | --- |
| `sessionCount` | attendance-eligible sessions in the period for that batch |
| `presentMarks` | recorded marks with status `present` **or** `late` |
| `totalMarks` | recorded marks of any status (`present`, `late`, `absent`) — the denominator |
| `pct` | `round(presentMarks ÷ totalMarks × 100)`, or `null` when `totalMarks` is 0 |

**The denominator is the marks that were recorded, never a roster
estimate.** A member who was enrolled but never marked is *unknown*:
the mark was never written, so it never enters the denominator and is
never counted as absent. That is the same convention the coach's
register and the insights view use (scope § 7.1 keeps per-child risk
profiles out of these surfaces).

`late` counts as attendance in this report. The insights view keeps
`present` and `late` apart; the report folds them together. Same
total, different cut — see *Differences that remain on purpose*.

## Scope

The report is a tenant read with a location boundary inside it
(O-08). Two independent filters apply, and both must pass:

1. **The caller's access.** `resolveLocationAccess(tx, ctx)` resolves
   what the caller may see. Unrestricted callers see every location.
   A restricted caller sees their own locations, and a batch with
   `location_id IS NULL` is tenant-wide ("the whole business"), so it
   stays visible to them.
2. **The requested facility.** `options.locationId` may only
   **narrow** the caller's access. A restricted caller asking for a
   facility outside their access gets an empty report, never a wider
   one.

The location scope is applied to the **batch**, and the batch is what
a report row is about. Sessions are not separately location-filtered,
in either this report or the insights view.

Tenant isolation is enforced by `withTenant()` (transaction-scoped
`app.tenant_id` plus RLS) and by explicit `tenant_id` predicates in
the query. A batch from another tenant can never appear.

## Period boundaries

The period is **half-open**: `from` is inclusive, `to` is exclusive.
`from = 2026-11-01, to = 2026-12-01` covers 1 November to 30
November inclusive; a session on 1 December is outside the window.
This is the same convention the insights view and every other report
in the product use, so one screen never disagrees with another about
which days are on it.

## Differences that remain on purpose

The report and the Home insights view ("Attendance by batch",
`lib/services/owner-insights-attendance.ts`) now agree on **which
sessions are eligible** and on **how many marks were recorded**. They
still measure different things in two places, on purpose:

1. **Register completeness vs mark presence.**
   The insights view reports, per batch, how many roster members carry
   a mark against the session's *effective historical roster* (the
   members enrolled on or before the session date). The report has no
   roster notion at all: its denominator is the marks that exist.

   Concretely: a session with 10 enrolled members and 3 marks reads
   **100%** in this report (3 of 3 marks were attendance) and **30%
   register completion** in the insights view (3 of 10 roster members
   carry a mark). Both are true; they answer different questions. An
   owner reading "100% attendance" should read it as "every mark
   recorded was an attendance", not "every member attended". Changing
   the report's denominator to a roster estimate would change what
   the number has always meant and would break the reconciliation with
   the marks the coach actually wrote — that is a product decision,
   not a bug fix, and it is out of scope for batch 6.

2. **`late` is folded into attendance.** The report counts
   `present + late` as attendance; the insights view reports `late`
   separately, and shows `absent` as a share of recorded marks. Same
   recorded marks, different cut.

A third difference is structural rather than semantic: a batch with no
eligible session is **reported by this report** (with `sessionCount 0`
and `pct null`) and is **absent from the insights view**, whose read
model joins sessions with an inner join and therefore has no row to
show.

## Where the rule is written

| Place | What it holds |
| --- | --- |
| `lib/services/attendance-report-query.ts` | the report's query and the eligibility rule |
| `lib/services/owner-insights-attendance-sql.ts` | the insights view's query and the same rule |
| `lib/actions/owner-reports.ts` | the action boundary — the caller's authorised context must reach the service intact |

The two service modules currently spell the predicate out separately
(`sessions.status <> 'cancelled'` in both). They must stay in step: if
one of them changes, the other has to change with it. A shared
predicate module would remove the coupling, but that is a change to a
file this batch does not own — raised as a follow-up in
`docs/handoffs/backend-batch6-2026-10-27.md` rather than made here.

The regression tests in `tests/backend-b6/attendance-reports/` read
**both** views over the same fixture and require them to agree on the
session count and on the recorded marks, so a future divergence in
either module fails the suite rather than reaching an owner.

## The action boundary

The scope described above is only real if the caller's context reaches
the service intact. The report's two Server Actions —
`getAttendanceReportAction` (the screen read) and
`attendanceReportCsvAction` (the CSV export) — must hand the service
the **complete** context that `requireDefaultCtx()` resolved:

```ts
const parsed = periodWithFacilitySchema.parse(raw);
const ctx = await requireDefaultCtx();
requirePermission(ctx, "reports.operational");
return getAttendanceReport(ctx, parsed, { locationId: parsed.locationId });
```

Rebuilding a narrow context here — `{ tenantId: ctx.tenantId }` —
silently drops the caller's **location scope**, and the service's O-08
gate cannot see what the adapter threw away. The failure is quiet: the
report still renders, still passes its permission check, and simply
answers a question nobody asked. The symptom is a location-restricted
staff member seeing the tenant-wide batches and none of their own.

The order is not negotiable and is enforced mechanically by
`tests/tier1/server-action-preamble.test.ts`: parse first, then the
session, then the permission check, then the service call. Each
exported action repeats those steps in its own body — that repetition
is the contract, not an oversight to be factored away.

The screen read and the CSV export must carry the **same** scope. A
CSV that shows a different set of rows than the report on screen is
the same defect wearing a different hat, so the export goes through
the same context and the same service call as the read.

The insight is the same one the owner-insights action already encodes
(`lib/actions/owner-insights.ts`): `requireDefaultCtx()` returns the
user, the role, the resolved permission set **and** the caller's
location scope. Narrowing it at the adapter is how a permission
boundary becomes decorative.

## Known gap (not in this batch's scope)

**The CSV route turns every failure into a 400.** The route handler
`app/(owner)/owner/reports/attendance.csv/route.ts` wraps the CSV
action in a `try/catch` and answers any error with
`400 Bad period: <message>` — including an authorisation failure. A
caller without the operational-reports grant gets a "Bad period"
message rather than a 403, and the error text of an internal failure
is echoed back to the browser.

This is a pre-existing route shape, not something the scope fix
introduced, and the route file is outside this batch's write scope.
The scope itself is still correct: the CSV action enforces the
permission gate before any data is read, and the exported rows are
the rows the caller is allowed to see. Only the HTTP status mapping
and the error text are wrong.
