# Handoff — demo history generator (`feat/demo-history-b7`)

**Date:** 27 October 2026 · **Base:** `develop` @ `d692fd3` · **Branch:** `feat/demo-history-b7`
**Worktree:** `/home/soloengine/thedutchrabbit/aqua-worktrees/demo-history-b7`
**Writer:** demo-history session · **Integration owner:** coordinator (not this session)
**Delivery:** no commit, no push, no PR, no merge, no deploy — the coordinator integrates after review.

---

## 1. What this is

A demo-only generator that fills the demo tenant's recent past with the history the
owner's charts need in order to be readable: money actually collected, membership
dues that are paid / late / part-paid / split / still open, the sessions those dues
pay for, the registers that were filled in, and the enquiries that came in.

**It writes rows. It never writes a chart value.** Every figure the owner sees is
produced by the application's own reads over ordinary tables — no service, component
or migration was touched. The generator reuses the app's rules rather than
re-implementing them loosely: the gapless per-financial-year invoice counter
(`allocateInvoiceNumber`), the GST/Bill-of-Supply decision (`gstDocumentKind` +
`computeTax`), the SAC code and GST rate from the config chain
(`resolveConfigInTx`), the payment-method rules (cash carries no reference, every
other method carries one, a reference is unique per tenant + method), and the money
arithmetic in integer paise throughout.

**Nothing outside the demo is touched.** The guards refuse a non-demo tenant, a
non-loopback database, a production environment, and any write that is not
explicitly opted into.

### The gap it closes

The demo seed (`scripts/seed-demo.ts`) produces 21 days of attendance, 8 enquiries,
and **no payments at all** — no invoices, no plans, no subscriptions. Two further
facts make the existing history unusable for a trend review:

* every attendance mark the demo seed writes is stamped with the clock of the
  **seed run**, not with the session it belongs to — three weeks of registers land
  in a single hour bucket, so the attendance chart cannot show a trend;
* there is no dues history at all, so "collected / outstanding / overdue / to
  collect" is empty and the payment-mix doughnut has nothing to draw.

Both are closed by this generator (the second one by re-stamping, see §7).

---

## 2. Files (owned by this session — nothing else was touched)

| File | What it is |
| --- | --- |
| `scripts/seed-demo-history.ts` | CLI: argument parsing, the refusals, the JSON summary. |
| `scripts/demo-history/types.ts` | The plan's types (snapshot in → plan out). |
| `scripts/demo-history/keys.ts` | Deterministic UUIDv5 identities + the deterministic hash. |
| `scripts/demo-history/catalogue.ts` | The constants that decide what the history looks like (hours, dues calendar, method/outcome weights, invented names). |
| `scripts/demo-history/plan.ts` | **The planner — pure.** No I/O, no clock beyond the snapshot's anchor, no randomness beyond the hash. Plans the sessions and the registers. |
| `scripts/demo-history/plan-dues.ts` | The planner's dues cycle: subscriptions, invoices, payments. |
| `scripts/demo-history/plan-enquiries.ts` | The planner's enquiries and their follow-ups. |
| `scripts/demo-history/guards.ts` | The refusals (tenant allowlist, loopback, production, opt-in). |
| `scripts/demo-history/snapshot.ts` | Reads one tenant's current state (members, batches, enrolments, holidays, plans, staff) inside `withTenant()`. |
| `scripts/demo-history/plans.ts` | Which membership plans the demo tenant sells (the preset's templates, priced). |
| `scripts/demo-history/apply.ts` | The orchestrator — one transaction, the audit flush, the reconciliation, the chart parity. |
| `scripts/demo-history/write-context.ts` | The writers' shared context (transaction, counters, audit buffer). |
| `scripts/demo-history/write-plans.ts` | Writes the membership plans and the subscriptions. |
| `scripts/demo-history/write-invoices.ts` | Writes the invoices, their lines and the payments. |
| `scripts/demo-history/write-schedule.ts` | Writes the sessions and the registers, and performs the one repair (the re-stamp). |
| `scripts/demo-history/write-enquiries.ts` | Writes the enquiries and their follow-ups. |
| `scripts/demo-history/audit-instant.ts` | The audit row's timestamp, clamped to the audit table's partition horizon. |
| `scripts/demo-history/reconcile.ts` | The aggregates the summary carries (the same reads the charts do). |
| `scripts/demo-history/chart-parity.ts` | Runs the app's own chart service and compares it with the underlying rows. |
| `tests/demo-history.test.ts` | The planner's contract (19 tests). |
| `tests/demo-history-guards.test.ts` | The refusals (11 tests). |
| `tests/demo-history-scaling.test.ts` | The GST scaling of the planned instalments (6 tests). |
| `tests/demo-history-apply.test.ts` | The write path, idempotency, reconciliation and chart parity against the disposable DB (7 tests). |
| `docs/handoffs/demo-history-b7.md` | This document. |

**Deliberately NOT touched:** `scripts/seed-demo.ts`, `package.json`, anything under
`app/`, `components/`, `lib/`, `db/`, `tests/tier1/**`. The integration proposals for
the first two are in §11 — proposals only, for the coordinator.

---

## 3. How to run it

```bash
# 0. Node 22 + the repo's package manager
nvm use && pnpm install --frozen-lockfile

# 1. A DISPOSABLE database (never the running club, never another lane's)
python3 .opencode/scripts/harness.py prepare-test --port 55465
#    → writes .env.aqua-harness-test.local (git-ignored, mode 0600)

# 2. Point the tool at a DEMO database that already has the demo seed
#    (the demo seed is a separate step: DEMO_MODE=true pnpm tsx scripts/seed-demo.ts)
set -a; . ./.env.aqua-demo-history.local; set +a   # DATABASE_URL / MIGRATION_DATABASE_URL

# 3. Dry run — writes nothing, prints what it WOULD write
pnpm tsx scripts/seed-demo-history.ts

# 4. Apply — needs the flag AND the environment variable
AQUA_DEMO_HISTORY_APPLY=1 pnpm tsx scripts/seed-demo-history.ts --apply

# 5. Machine-readable summary (stdout is always JSON; --json also writes a file)
AQUA_DEMO_HISTORY_APPLY=1 pnpm tsx scripts/seed-demo-history.ts --apply \
  --json /tmp/demo-history-summary.json
```

Options: `--tenant <slug>` (default `demo-academy`), `--days <n>` (default 90),
`--today <yyyy-mm-dd>` (pins the anchor for a reproducible run), `--no-restamp`
(leaves the seed's attendance timestamps alone), `--json <path>`.

**Resources this session used** (all disposable, all local):

| Resource | Value | Owner |
| --- | --- | --- |
| Disposable test Postgres | `127.0.0.1:55465`, database `aqua_test_6bc9332ecd` | this session (harness container `aqua-harness-test-6bc9332ecd`) |
| Demo database (created by hand inside the same container) | `127.0.0.1:55465/aqua_test_6bc9332ecd_demo` | this session |
| Web port | `3135` — used once for the rendered evidence in §10.2 and stopped again; no other port was touched (the coordinator's 3122 and the other lanes' ports were left alone) | — |
| Local profile file | `.env.aqua-demo-history.local` (git-ignored by `.env.*.local`; holds only disposable local credentials) | — |
| Processes left running | none (the harness container stays up; it is disposable) | — |

---

## 4. Safety validation (every refusal is a hard failure)

| Guard | Refuses | Where |
| --- | --- | --- |
| `assertDemoTenant` | a tenant slug that is not on the demo allowlist, **and** a demo slug whose name no longer matches | `guards.ts`, enforced in the CLI **and** inside `applyDemoHistory` (a programmatic caller cannot get past it) |
| `assertLocalDatabase` | a non-loopback host, `NODE_ENV=production`, an unreadable URL | `guards.ts` |
| `assertApplyApproved` | any write without `AQUA_DEMO_HISTORY_APPLY=1` (a dry run is always allowed) | `guards.ts` |
| `assertAnchorDate` | an anchor that is not `yyyy-mm-dd` | `guards.ts` |

The demo allowlist is `demo-academy` → "Aqua Worli" and `kicks-academy` →
"Kicks Football Academy": the slug **and** the name must both match, so a real
customer tenant that reused a demo slug is still refused.

**The tool never resets, drops or truncates anything.** It only inserts rows, with
one narrow, reported repair (§7). It never writes a notification outbox row, so no
worker — mock or real — can deliver a message to a synthetic phone number. It never
touches `daily_rollups`: the nightly rollup job owns that table, and fabricating
rollup rows would be exactly the "fake production aggregate" this task forbids.

**Why it is not keyed on the runtime's demo flag:** that flag belongs to the runtime
banner and the demo seed, and `tests/tier1/demo-mode-reads.test.ts` (a human-owned
test this session may not edit) confines it to a whitelist. This tool therefore has
its own, stricter opt-in — an explicit environment variable *and* an explicit
`--apply` flag — plus the tenant allowlist. The first full-suite run failed on that
tier1 scan because a help message in this CLI contained the literal flag name; the
message was reworded and the scan is green again (no tier1 test was modified).

---

## 5. What it writes

| Table | Rows | Notes |
| --- | --- | --- |
| `membership_plans` | 3 | The preset's *Monthly* / *Quarterly* templates, priced for the demo (₹4,500 / ₹12,000), plus an *Annual Membership* (365 days, ₹45,000). The preset ships templates with **no** price on purpose (architecture §7.4), so the generator prices them and records them as the tenant's own plans. An existing plan of the same duration always wins — the generator never re-prices what the operator set up. |
| `subscriptions` | 62 | One per membership cycle, `starts_on`/`ends_on` from the plan's duration, `status` `active`/`expired`. At most one active subscription per member + plan (the schema's partial unique index). |
| `invoices` + `invoice_line_items` | 62 + 62 | `source='membership'`, `issued_on` = the cycle's start, `due_on` = +7 days, GST-exclusive subtotal + tax (the demo tenant has no GSTIN → Bill of Supply → no tax). Invoice numbers come from the app's gapless per-FY counter. Statuses: `paid` / `partial` / `issued`. |
| `payments` | 56 | `status='captured'`, `channel='counter'`, `received_by` = the desk's staff user. Cash carries no reference; UPI / bank transfer / card / other carry a deterministic one (`DEMO-<member code>-<issue date>[-n]`), unique per tenant + method. |
| `sessions` | 108 | `status='held'`, on the batch's own weekdays, `starts_at`/`ends_at` from the batch's wall time, coach and location copied from the batch. |
| `attendance` | 850 | `marked_at` = the session's end + 5 minutes, `client_id` unique per tenant, status present / late / absent. |
| `enquiries` + `enquiry_follow_ups` | 45 + 26 | Invented names (disjoint from the seeded roster), invented phone numbers in the synthetic `+9198123490xx` range, stages across the closed set, `location_id` set, follow-ups some done and some still open. |
| `audit_log` | 184 | `invoice.issue`, `payment.record`, `subscription.create`, `membership_plan.activate` and one `seed.demo_history` run row — all in the **same transaction** as the rows they describe, stamped with the instant of the event (clamped to the audit table's partition horizon, `2026-01`). |

**Money** is integer paise end to end (`BigInt` in the columns, `number` only at the
service boundary, exactly as the app does it). **No chart data is hardcoded
anywhere** — there is no aggregate row, no snapshot table and no service change; the
charts read the tables the application already reads.

### The shape of the history

* **Uneven weekdays.** Each member's membership cycle starts on their own day, so
  dues — and the money that settles them — land on different weekdays.
* **Sparse and zero days.** 44 of the 90 days carry money; 46 are quiet. Sundays
  carry no attendance at all (no batch runs on Sunday), and roughly one register in
  fourteen is never filled in, so an attendance bucket can honestly be "unknown"
  rather than a fabricated 0%.
* **Mixed methods.** All five occur: UPI 19, cash 18, bank transfer 7, card 6, other
  6 — and therefore all three owner-facing groups (digital ₹40,035 / cash ₹12,312 /
  other ₹2,178).
* **Overdue and part-paid.** 41 invoices paid, 10 part-paid (40–70 % paid, balance
  open), 11 unpaid; ₹6,975 outstanding, all of it overdue, across 21 invoices.
* **The anchor day is left empty on purpose.** No payment is ever dated after the
  run's clock and no mark is dated before its session ran, so "today" carries
  nothing when the demo runs in the small hours. The Month period is the view that
  carries the history; the panel's own "See this month's history" link lands there.

---

## 6. The demonstration (this session's own run)

Database: the disposable demo database on `127.0.0.1:55465`, seeded with
`scripts/seed-demo.ts` first, then this generator. Full machine-readable summary:
`/tmp/opencode/demo-history-final.json` (reproduced by the command in §3).

```
APPLIED — Aqua Worli (demo-academy)
window 2026-07-30 .. 2026-10-26 (90 days, anchor 2026-10-27 Asia/Kolkata)
planned  sessions 141 (7 unmarked), marks 1108, subscriptions 62, invoices 62,
         payments 56, enquiries 45
inserted plans 3, subscriptions 62, invoices 62, invoiceLines 62, payments 56,
         sessions 108, marks 850, enquiries 45, followUps 26, auditRows 184
existing sessions 33, marks 258          (the demo seed's own rows)
restamped attendance marks 270
money window 2026-07-30 .. 2026-10-27 (Asia/Kolkata)
collections 54525000 paise over 56 payments on 44 days (46 quiet days)
methods    upi 19 · cash 18 · bank_transfer 7 · card 6 · other 6
groups     digital 40035000 · cash 12312000 · other 2178000
attendance 1106 marks, 944 present (85%), 76 days with marks
dues       62 invoices {issued 11, paid 41, partial 10},
           outstanding 6975000 paise, overdue 6975000 paise
chart/day   chart 0 paise / 0 payments, attendance 0 marks   — rows identical — MATCH
chart/week  chart 0 paise / 0 payments, attendance 14 marks — rows identical — MATCH
chart/month chart 30816000 paise / 21 payments, attendance 326 marks — rows identical — MATCH
chart parity: every period matches the rows
```

A **second run of the same command inserts zero rows** and reports the same
reconciliation (`inserted {…all zero}`, `existing {plans 0, subscriptions 62,
invoices 62, payments 56, sessions 141, marks 1094, enquiries 45}`,
`restamped 0`).

---

## 7. The one non-additive thing it does (and why)

`scripts/seed-demo.ts` writes every attendance mark with `marked_at = now()` — the
clock of the seed run. Three weeks of registers therefore sit in one hour bucket,
and the attendance chart cannot show a trend no matter what else is seeded.

The generator re-stamps those marks onto the instant their session ended (the same
rule it uses for the marks it creates): a tenant-scoped `UPDATE` over the marks of
the window, only where the mark's local date differs from its session's date.
**270 rows** were repaired in the demonstration run; the count is reported in
`restamped.attendanceMarks` and in the run-level audit row. `--no-restamp` turns it
off.

This is the only row mutation in the tool. It is scoped to one tenant, to the
window, and to rows whose timestamp is demonstrably wrong; it is idempotent
(re-stamping an already-correct mark is a no-op); and it changes no status, no
member and no amount.

---

## 8. Reconciliation (run these against the demo database)

The generator's own summary already carries this; these are the queries to run by
hand. Money is `paise` throughout.

```sql
-- 1. The collections total the chart shows (tenant-local day buckets).
select to_char((received_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day,
       sum(amount_paise) as paise, count(*) as payments
  from payments
 where tenant_id = (select id from tenants where slug = 'demo-academy')
   and status = 'captured'
 group by 1 order by 1;

-- 2. The same figure by method and by the three owner-facing groups.
select method, sum(amount_paise) as paise, count(*) as payments
  from payments
 where tenant_id = (select id from tenants where slug = 'demo-academy')
   and status = 'captured'
 group by 1 order by 2 desc;

-- 3. Every invoice balanced against its payments (must return 0 rows).
select i.id, i.invoice_number, i.total_paise, i.paid_paise,
       coalesce((select sum(p.amount_paise) from payments p
                  where p.invoice_id = i.id and p.status = 'captured'), 0) as paid
  from invoices i
 where i.tenant_id = (select id from tenants where slug = 'demo-academy')
   and i.paid_paise <> coalesce((select sum(p.amount_paise) from payments p
                  where p.invoice_id = i.id and p.status = 'captured'), 0);

-- 4. The dues: paid / part-paid / unpaid and what is overdue.
select status, count(*) as invoices,
       sum(total_paise) as total_paise, sum(paid_paise) as paid_paise,
       sum(total_paise - paid_paise) as outstanding_paise
  from invoices
 where tenant_id = (select id from tenants where slug = 'demo-academy')
 group by 1 order by 1;

select count(*) as overdue_invoices, sum(total_paise - paid_paise) as overdue_paise
  from invoices
 where tenant_id = (select id from tenants where slug = 'demo-academy')
   and status in ('issued', 'partial')
   and total_paise > paid_paise
   and due_on < (now() at time zone 'Asia/Kolkata')::date;

-- 5. Attendance by the day the register was filled in (the chart's buckets).
select to_char((marked_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day,
       count(*) as marks,
       count(*) filter (where status in ('present', 'late')) as present
  from attendance
 where tenant_id = (select id from tenants where slug = 'demo-academy')
 group by 1 order by 1;

-- 6. No money from the future, and no money outside the window.
select count(*) as future_payments from payments
 where tenant_id = (select id from tenants where slug = 'demo-academy')
   and received_at > now();

-- 7. The audit trail this run left.
select action, count(*) from audit_log
 where tenant_id = (select id from tenants where slug = 'demo-academy')
 group by 1 order by 1;
```

---

## 9. Tests and the RED → GREEN → REFACTOR record

All tests live in agent-owned files (`tests/demo-history*.test.ts`); no protected
test was touched. The disposable test database is `127.0.0.1:55465`
(`aqua_test_6bc9332ecd`); the fixture tenant is created and removed by the test
itself.

### Cycle 1 — the planner (pure)

```
RED   python3 .opencode/scripts/harness.py test tests/demo-history.test.ts
      → Test Files 1 failed (1) | Tests 11 failed | 8 passed (19)
      → AssertionError: expected '' to be '2026-07-31'   (the window)
      → AssertionError: expected 0 to be greater than 10 (enquiries)
      → … (the stub planner returned an empty plan; no import/setup error)
GREEN same command → 19 passed
```

### Cycle 2 — the refusals

```
RED   python3 .opencode/scripts/harness.py test tests/demo-history-guards.test.ts
      → Tests 8 failed | 3 passed (11)
      → AssertionError: expected [Function] to throw an error   (the stub permitted everything)
GREEN same command → 11 passed
```

### Cycle 3 — the write path (disposable DB)

```
RED   python3 .opencode/scripts/harness.py test tests/demo-history-apply.test.ts
      → Tests 6 failed | 3 skipped, plus a suite failure:
        error: audit_log is append-only: DELETE is not permitted
      → AssertionError: expected 1191000 to be 6825000   (the method totals did not add up)
      → AssertionError: expected 94 to be 88             (a month-vs-window comparison in the test)
      → AssertionError: expected 4 to be 1               (a run-level audit row on every run)
GREEN same command → 6 passed
```

Two of those RED failures were real defects the tests caught and the implementation
fixed: the method totals were being overwritten instead of accumulated (a
reconciliation that would have under-reported collections by ₹5.6 lakh), and the
run-level audit row was written even on a run that changed nothing.

### Cycle 4 — the GST scaling (integration review, see §12)

```
RED   python3 .opencode/scripts/harness.py test tests/demo-history-apply.test.ts
      → Tests 2 failed | 5 passed — a part-paid invoice stopped being part-paid
        as soon as the invoice carried GST
RED   the fix reverted on purpose (mutation check) →
      AssertionError: expected 11800 to be 5900
GREEN the four focused files → 43 passed
```

### Refactor

The extracted helpers (`scalePayments`, `historyId`, `hash01`, `resolveDemoPlans`,
`readChartParity`) were introduced with their own behaviour pinned by the tests
above; the payment/method mix was reworked twice during the cycle (a per-invoice
rotation to a per-payment rotation with a stride) and the planner, the guards and
the apply path were re-verified together after each change — `pnpm typecheck`,
`pnpm lint` and the three focused test files were re-run after every refactor.

The last refactor split the two large modules along their natural seams — the
planner into `plan.ts` (sessions and registers) / `plan-dues.ts` / `plan-enquiries.ts`
/ `catalogue.ts`, and the writer into `apply.ts` (the transaction) plus one
module per thing written — so every module is under 300 lines and each has one
reason to change. The split was mechanical: the demo re-run afterwards produced
byte-identical figures (collections 54525000 paise over 56 payments, attendance
1106 marks, dues 62 invoices, chart parity MATCH on all three periods) and the
43 focused tests stayed green.

---

## 10. Verification evidence

| Check | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck` | pass |
| Lint | `pnpm lint` | pass (0 errors, 0 warnings) |
| Focused tests | `python3 .opencode/scripts/harness.py test tests/demo-history.test.ts tests/demo-history-guards.test.ts tests/demo-history-scaling.test.ts tests/demo-history-apply.test.ts` | 43 passed |
| Full suite (CI parity) | `python3 .opencode/scripts/harness.py test` | see §10.1 |
| Live demo run | the command in §3 | applied, reconciled, chart parity MATCH on all three periods |
| Rendered UI | `pnpm dev --port 3135` against the demo database, Chromium at 1280×900 | see §10.2 |

### 10.1 Full suite

```
python3 .opencode/scripts/harness.py test          # = pnpm test:sharded, CI parity
→ Aggregate: 424/424 files, 3386 passed, 0 failed, 1 skipped; 0 failing files.   exit 0
   Shard 1/4: 106 files; 648 passed, 0 failed
   Shard 2/4: 106 files; 658 passed, 0 failed
   Shard 3/4: 106 files; 1118 passed, 0 failed
   Shard 4/4: 106 files; 962 passed, 0 failed, 1 skipped
```

An earlier sharded run of the same command showed 3 failures in two **pre-existing**
tier1 files — `tests/tier1/demo-mode-seed-guard.test.ts` (2) and
`tests/tier1/audit-tamper-evidence.test.ts` (1). The shard JSON evidence shows the
per-test durations were 8.0 s / 5.1 s / 5.3 s against vitest's 5 s default: both
files spawn a subprocess (`npx tsx scripts/seed-demo.ts`, and the audit
verifier), and they timed out while this session was running `pnpm typecheck` and
`pnpm lint` in the same worktree at the same time. Neither file reads anything
this change touched; both pass in isolation (`14 passed`), and the clean re-run
above is green. **No pre-existing test was modified.**


### 10.2 Rendered evidence (the reviewer's question answered in the browser)

Signed in as the seeded owner (`+91 90000 00001`, demo PIN) against the demo
database on the disposable container, `pnpm dev --port 3135`, Chromium at 1280×900.
Screenshots (kept outside the repository, since this session owns only the files
listed in §2): `/tmp/opencode/owner-month-collections.png` and
`/tmp/opencode/owner-month-attendance.png`.

What the owner home now shows on `/owner?period=month`:

* **Header cards** — "Collected today ₹0 · No payments recorded today yet" (the
  documented empty-today state), "**Overdue ₹69,750 · 21 invoices past due ·
  ₹69,750 outstanding**", "Active swimmers 32 · 7 batches running", "Sessions
  today 4 · 20 swimmers enrolled".
* **Trends → Collections (This month)** — "**₹3,08,160 from 21 payments**", the
  comparison line "**MoM · month over month — Up 179% vs the previous range**" and
  the stacked cash / digital / other chart (with its data table and the drill
  through to the transactions).
* **Payment mix (This month)** — "₹3,08,160 · 21 payments captured in this
  period": **Cash ₹37,350 (12%)**, **Digital ₹2,70,810 (88%)** → UPI ₹1,66,380
  (54%), Bank transfer ₹35,430 (11%), Card ₹69,000 (22%), Other ₹0 (0%).
* **Trends → Attendance (This month)** — "**84% present or late · 274 of 326
  marks**", comparison "274 of 326 marks against 270 of 324 in the previous range",
  with the disclosure "A bucket with no marks is unknown, not 0%".

The September side of both month-over-month comparisons is real too, which is the
point: the history has to reach past the current month for a comparison to mean
anything.


---

## 11. Integration proposals (NOT applied — the coordinator's call)

These are proposals only. `scripts/seed-demo.ts` and `package.json` were **not**
edited by this session, to avoid overlapping another lane.

1. **`package.json`** — add a script, e.g.

   ```json
   "demo:history": "tsx scripts/seed-demo-history.ts"
   ```

   (an `apply` variant would need the opt-in in the command line, e.g.
   `AQUA_DEMO_HISTORY_APPLY=1 pnpm tsx scripts/seed-demo-history.ts --apply`).

2. **`scripts/seed-demo.ts`** — two options for the coordinator:

   * *chain it*: after the demo seed finishes, run the history generator so
     `pnpm demo:reset` produces the full demo in one command. This needs the
     generator's opt-in inside the chain, and the chain's own guard already
     requires the demo flag — the coordinator decides whether the history is
     part of "the demo" or a separate, explicit step.
   * *fix the seed's timestamps at the source*: change `markAttendance` in
     `scripts/seed-demo.ts` to stamp the mark with the session's end time
     instead of `now()`. That is the cleaner fix and it removes the need for
     the re-stamp entirely — but it is a change to a file this session does not
     own, so it is a proposal, not a change.

3. **`docs/demo-runbook.md`** — the runbook's figures ("21 days of past
   attendance", "no payments") become stale once the history exists, and
   `pnpm check:runbook-sync` only fires when `scripts/seed-demo.ts` changes. If
   the coordinator chains the generator into the seed, the runbook needs the new
   numbers in the same change.

---

## 12. Blocker found in integration review — GST scaling (fixed)

**The defect.** `scalePayments()` in `scripts/demo-history/write-invoices.ts` scaled
the planned instalments to the invoice's real total (plan price + GST) but then
measured the rounding drift against that **full** total. On a part-paid invoice
the drift was the whole unpaid balance, so the last instalment absorbed it and
the invoice became **fully paid**: half of ₹10,000 with 18 % GST became ₹11,800
paid on an ₹11,800 invoice instead of ₹5,900 paid on an ₹11,800 invoice.

**Why it hid.** The demo tenant has no GSTIN, so it issues Bills of Supply
(no tax), the scaling branch was never taken, and every test looked green.

**RED (observed, integration level).** The apply fixture tenant was given a
GSTIN (`27AAPFU0939F1ZV`) so the tax branch is actually exercised, and a new
assertion was added: a part-paid invoice must stay part-paid.

```
python3 .opencode/scripts/harness.py test tests/demo-history-apply.test.ts
→ Test Files 1 failed (1) | Tests 2 failed | 5 passed (7)
  × keeps every invoice balanced against its payments
      TypeError: actual value must be number or bigint, received "undefined"
      (byStatus.partial — there was no part-paid invoice left)
  × keeps a part-paid invoice part-paid when the invoice carries GST
      AssertionError: expected 0 to be greater than 0
```

**RED (observed, unit level).** The reviewer's numbers are pinned in
`tests/demo-history-scaling.test.ts`. A mutation check — the fix reverted, the
test run — shows the test really catches it:

```
AssertionError: expected 11800 to be 5900      ← the reviewer's case
- Expected: 5900
+ Received: 11800
```

**The fix.** The drift is now measured against the amount the invoice is
*actually paid* — the planned paid amount scaled by the same factor — and lands
on the last instalment:

```
intendedPaid = round(invoice.paidPaise * totalPaise / invoice.totalPaise)
drift        = intendedPaid - sum(scaled instalments)
```

So the paid ratio is preserved (a 40–70 % plan payment stays 40–70 % of the
GST-inclusive invoice), the sum of the instalments equals the intended paid
amount to the paisa (no paise lost, none invented), a fully paid invoice still
scales to its full total, a split payment stays split, and an unpaid invoice
stays unpaid.

**GREEN.**

```
python3 .opencode/scripts/harness.py test \
  tests/demo-history-scaling.test.ts tests/demo-history-apply.test.ts \
  tests/demo-history.test.ts tests/demo-history-guards.test.ts
→ Test Files 4 passed (4) | Tests 43 passed (43)
```

**The demo is unaffected, and that is the point.** The demo tenant has no GSTIN,
so the demo's figures are unchanged by the fix (collections 54525000 paise over
56 payments, dues 62 invoices {paid 41, partial 10, issued 11}, chart parity
MATCH on all three periods) — and the reviewer's blocker was invisible in the
demo for exactly that reason. The apply fixture now carries a GSTIN so the tax
branch cannot go untested again.

---

## 13. Documented gaps (known, not hidden)

* **The anchor day is empty.** No payment is dated after the run's clock, so a
  demo generated in the small hours has nothing for "today". The Week period
  covers only the days since Monday. The Month period carries the history. The
  empty/sparse UI states are the coordinator's to design — this session did not
  touch them.
* **No payment reversals.** The collections panel reports reversals beside the
  total; the generator creates none, so that line reads "none". A reversal needs
  a payment to reverse and the app's own `reversePayment` rules; adding them was
  out of scope.
* **No café / orders history.** The product has orders and café billing; the
  generator leaves them empty. The demo's collections are membership dues only,
  which is why the daily curve is a dues curve rather than a counter curve.
* **`daily_rollups` is left to the nightly job.** The owner charts read the
  live tables, so nothing is missing from the charts; the ops "tenant health"
  screen, which reads the rollup table, will only fill in as the job runs.
* **One location.** The demo tenant has a single facility, so all the history is
  at the primary location. The facility switcher's empty view is unchanged (and
  is the coordinator's surface, not this session's).
* **`kicks-academy` is allowed but not demonstrated.** The guards accept it and
  the generator is generic over the tenant's own batches and members, but this
  session's evidence is the Aqua Worli tenant only.
* **The plan prices are demo constants.** ₹4,500 / ₹12,000 / ₹45,000 live in
  `scripts/demo-history/plans.ts` and are the demo's, not the product's.

---

## 14. Security notes

* **Data touched:** members (ids only), invoices, payments, sessions, attendance,
  subscriptions, membership plans, enquiries, follow-ups, audit rows — all inside
  one demo tenant, all through `withTenant()` (RLS-scoped).
* **Trust boundaries:** the CLI's arguments are validated (`--days` range,
  `--today` format, `--tenant` allowlist); the tenant slug is resolved through
  the platform-admin SELECT policy (the one cross-tenant read) and then checked
  against the demo allowlist by slug **and** name.
* **Abuse cases refused:** a misconfigured `DATABASE_URL` pointing at a live
  club (non-loopback → refused), a production environment (refused), a tenant
  that merely looks like a demo (name check), a stray `--apply` without the
  environment opt-in (refused), and a repeat run (idempotent — inserts nothing).
* **No secrets** in the summary, the logs or the source; the tool prints tenant
  ids, not credentials.
* **No external contact:** no notification outbox rows, no WhatsApp/messaging
  writes, no network calls beyond the database.
* **Personal data:** invented names, invented phone numbers in a synthetic
  `+9198123490xx` range, no real contact details. The names are disjoint from the
  seeded roster so a synthetic enquiry is never mistaken for a seeded member.
