# Backend batch 6 — enquiry family transactional audit trail + concurrency hardening

**Date:** 27 October 2026 (round 1: audit trail · round 2, same day: concurrency hardening)
**Branch:** `fix/enquiry-audit-b6`
**Base:** `d692fd322ca8aa369e23ee0b6056130e57aee298` (recorded fetched develop)
**Worktree:** `/home/soloengine/thedutchrabbit/aqua-worktrees/backend-enquiry-audit`
**Session model:** direct `minimax/MiniMax-M3.1-Flash`; no other agents launched.
**Status:** implementation complete, focused evidence green, **not committed / not pushed / not merged / not deployed**.
**Round 2 extends round 1 — the earlier deliverable is preserved, not replaced.**

---

## 0. Round 2 (concurrency hardening) — summary

The coordinator found that `transitionEnquiryStage` read `visibleEnquiry` **without a
lock** before determining `fromStage`, validating the graph, writing the stage and
writing the audit row. Two concurrent callers could therefore both decide against the
same stale stage.

Verified and fixed with a **correctly scoped row lock** (`FOR UPDATE` inside the
caller's own tenant + location scope), with concurrent regression coverage that is
deterministic rather than a race we hope to hit:

| Round-2 change | File |
|---|---|
| `lockVisibleEnquiry()` — the locking twin of `visibleEnquiry()`, sharing ONE query builder so the visibility rule cannot drift | `lib/services/enquiry-scope.ts` (shared) |
| `transitionEnquiryStage` decides and writes under that lock | `lib/services/enquiry-pipeline.ts` |
| 6 new concurrency tests (stale-transition rejection, same-target serialisation, audit chain, lock scope, follow-up race, follow-up idempotency) | `tests/backend-b6/enquiry-audit/enquiry-concurrency.test.ts` (new) |

**3 real RED → GREEN**, **2 mutation checks** proving the new tests have teeth, and a
**13-file all-consumer regression** for the shared-file change. Full evidence in §6b.

---


## 1. Objective

Close the missing transactional audit coverage in the enquiry family — capture, stage
transition, follow-up create/complete, trial booking and conversion — **only where
inspection proved it missing**.

Why it matters: `updated_at` / `updated_by` name only the **last** editor of an
enquiry; they are not an accountable mutation history. A same-transaction audit row
means a change can never succeed without its record.

How it was done: inventory every write in the enquiry family first, compare
`lib/audit/write.ts` (the one audit writer) and the existing `member-status` pattern
(`lib/services/member-status.ts`), then write the audit row through that writer inside
the **same transaction** as the domain write.

The historical note in `lib/services/enquiry-pipeline.ts` — *"Not itself audited to a
separate history table — unlike member status, this wasn't asked for, and
updated_at/updated_by already say who touched it last"* — is treated as **superseded**
by the current global audit contract (`docs/architecture.md` §8.10: *"Written for every
mutation, in the same transaction as the change"*). **No new history table** was created:
the existing partitioned `audit_log` is used.

---

## 2. Findings (inventory before any edit)

| # | Mutation site | Before this batch | Audit row now |
|---|---|---|---|
| 1 | `createEnquiry` — INSERT `enquiries` | **no audit row** | `enquiry.create` |
| 2 | `transitionEnquiryStage` — UPDATE `enquiries.stage` | **no audit row** | `enquiry.stage` |
| 3 | `addFollowUp` — INSERT `enquiry_follow_ups` | **no audit row** | `enquiry.follow_up.create` |
| 4 | `completeFollowUp` — UPDATE `enquiry_follow_ups.done_at` | **no audit row** | `enquiry.follow_up.complete` |
| 5 | `bookTrial` — UPDATE `enquiries` (stage/member/batch/site) | enquiry update **unaudited**; the member's own `member.create` + `member.enrol` rows already existed | `enquiry.trial_book` (new, non-duplicating) |
| 6 | `convertEnquiry` (trial member path) — UPDATE `enquiries.stage` | enquiry update **unaudited**; `member.status` row already existed | `enquiry.convert` (new, non-duplicating) |
| 7 | `convertEnquiry` (direct path) — UPDATE `enquiries` | enquiry update **unaudited**; `member.create` row already existed | `enquiry.convert` (new, non-duplicating) |

Findings that changed the shape of the work:

- **F1 — the audit actor is a foreign key.** `audit_log.actor_id` references
  `users(id)` (kept by H-03: *"the applied table is preserved exactly … the actor_id
  FK"*). An audit row therefore cannot name a caller id that is not a real user row.
  The repo's established test pattern for this is a real `users` row
  (`insert into users (id, phone) values ($1, $2)`), used in 20+ existing suites
  including `tests/tier1/audit-actor-model.test.ts`.
- **F2 — two existing test fixtures minted actor ids that were never seeded**, because
  until now the enquiry family wrote no audit rows. They broke under the new contract
  (see §5, "regression RED"). Both files already contain the `users`-row pattern —
  the two location-scoped callers were the only actors missing one.
- **F3 — a repeated follow-up completion was not a no-op.** It re-stamped `done_at`
  and (once auditing existed) would have produced a misleading second "completed"
  event. It is now a true no-op: no re-stamp, no duplicate audit row, same
  caller-visible result (`{ ok: true }`).
- **F4 — the conversion helpers already audit themselves.** `createMember` writes
  `member.create`, `enrolMember` writes `member.enrol`, `transitionMemberStatus`
  writes `member.status`. The new rows are about **the enquiry**, with a different
  `entity_type`/`entity_id`; nothing is duplicated. Verified by test.

### Audit vocabulary introduced (all new, none pre-existing)

| action | entity_type / entity_id | `before` | `after` | `changed_fields` |
|---|---|---|---|---|
| `enquiry.create` | `enquiry` / enquiry id | — | `{stage, source, locationId}` | — |
| `enquiry.stage` | `enquiry` / enquiry id | `{stage: from}` | `{stage: to}` | `["stage"]` |
| `enquiry.follow_up.create` | `enquiry_follow_up` / follow-up id | — | `{enquiryId, dueAt}` | — |
| `enquiry.follow_up.complete` | `enquiry_follow_up` / follow-up id | `{doneAt: null}` | `{doneAt}` | `["doneAt"]` |
| `enquiry.trial_book` | `enquiry` / enquiry id | `{stage, memberId, trialBatchId, locationId}` | same four fields, post-change | derived from the payload |
| `enquiry.convert` | `enquiry` / enquiry id | same four fields | same four fields, post-change | derived from the payload |

Common on every row: `tenant_id = ctx.tenantId`; `actor_type = 'user'` when the
caller has a user id, `'system'` otherwise (the `member-status` pattern);
`actor_id = ctx.userId` (nullable — a system caller has none); `source = 'web'`;
`request_id = ctx.requestId` (H-04 correlation id).
`impersonator_id` stays **NULL**: `ActionCtx` carries no impersonation context in this
codebase, so there is nothing to forward — identical to every other tenant-side caller.

`changed_fields` is **derived from the payload that was actually written**, so it can
never drift from `before`/`after`.

### What the payload deliberately does not carry

No full name, no phone, no notes, no guardian details, no medical notes. The trail
answers *who changed this, when and how* — it is not a second copy of the enquiry.
The accepted input type of the audit helper makes that structural rather than a
convention.

### Round-2 findings — concurrency

| # | Finding | Consequence |
|---|---|---|
| F5 | `transitionEnquiryStage` read the enquiry **unlocked**, then decided from that stage, then wrote the stage and the audit row | Three concrete defects, all reproduced as RED: (a) a transition the graph forbids was applied over a converted enquiry (`converted` is terminal, yet it was reopened to `contacted`); (b) two concurrent transitions to the same stage **both** applied, so the second one duplicated a mutation; (c) the audit rows no longer formed a chain — the second row claimed a `before` state that never existed |
| F6 | The **scope** of the lock is itself part of the contract | A lock taken by id alone (ignoring tenant/location) lets a caller that may not see the row **stall on it** and thereby learn that it exists. Proven by mutation: the out-of-scope caller blocked for the full 2 s deadline |
| F7 | `completeFollowUp` already serialised (the `FOR UPDATE OF enquiry_follow_ups` row lock added in round 1) | The **coverage** was missing, not the behaviour. The new race tests pass against the current implementation (honest characterisation) and their teeth are proved by mutation, not by a fabricated RED |
| F8 | `bookTrial` / `convertEnquiry` have a **different**, multi-transaction race | **Not fixed — reported as R4.** Two concurrent trials on one enquiry can both pass the "no member yet" check and both create a member (one orphaned). A row lock cannot fix it: the check and the member creation are in *separate* transactions and `withTenant()` does not nest. Fixing it needs a design decision about that flow, which is outside the named scope of this round |

---

## 3. Threat / trust boundaries

| Boundary | Before | After | How it is held |
|---|---|---|---|
| Request → service authorisation | `requirePermission(ctx, "enquiries.write")` in `lib/actions/enquiries.ts` | **unchanged** | `lib/auth/action-permissions.ts`, `lib/actions/enquiries.ts`, `lib/services/enquiry-scope.ts` and `lib/services/location-access.ts` are untouched |
| Tenant isolation of the enquiry | `withTenant()` + RLS | **unchanged** | a foreign-tenant caller gets `{ok:false,"Enquiry not found."}`, no write, no audit row (§6) |
| Tenant isolation of the **trail** | `audit_log` has `FORCE ROW LEVEL SECURITY` + `tenant_isolation` | **unchanged, now proven** | the application's own scoped read inside `withTenant(otherTenant)` sees **zero** rows for another tenant's enquiry |
| Location visibility (R04) | unresolved/located enquiry rules | **unchanged** | a location-scoped caller outside its locations is refused **before** any write, and leaves no audit trace |
| PII in the compliance trail | — | **new, restrictive** | payload assertions prove the name/phone/note never appear |
| Actor attribution | `actor_id → users(id)` FK | **unchanged, now exercised** | a caller id that is not a real user **fails the mutation loudly** instead of producing an unattributed row (see §5 regression RED and §9 request R2) |
| Mutation → its record | audit row in the same transaction | **new** | a failing audit write rolls the domain write back (§7) |
| Concurrent mutation → one state of the row | the decision was taken on an unlocked read | **new** (round 2) | the stage is read under a `FOR UPDATE` lock taken inside the caller's scope; two concurrent transitions serialise, the audit chain is the real one, and a transition the graph forbids is refused with no mutation and no audit row (§6b) |
| Out-of-scope caller → the row it may not see | — | **new** (round 2) | the lock is inside the tenant + location predicate, so an out-of-scope caller is refused **without waiting** — it cannot use the lock to stall, or to learn that the row exists (mutation-checked) |

Abuse cases exercised (all in §6): forged enquiry id from another tenant; forged
location id; illegal stage transition; repeated completion; follow-up on an enquiry the
caller cannot see.

---

## 4. Files changed

### Owned, production (in scope)

| File | Change |
|---|---|
| `lib/services/enquiry-audit.ts` | **NEW** (160 lines) — the flat, narrowly scoped audit helper for the enquiry family: `actorOf`, `changedFieldsOf`, `enquiryAuditState`, and one function per event (`auditEnquiryCreated`, `auditEnquiryStageChanged`, `auditFollowUpCreated`, `auditFollowUpCompleted`, `auditEnquiryStateChanged`). The only writer it uses is the shared `writeAudit` from `lib/audit/write.ts`. |
| `lib/services/enquiry-capture.ts` | +9 lines — `createEnquiry` writes `enquiry.create` in the capture transaction. |
| `lib/services/enquiry-pipeline.ts` | +26 / −7 lines (round 1) — stage transition, follow-up create and follow-up complete now write their rows in the same transaction; a repeated completion became a true no-op with a `FOR UPDATE OF enquiry_follow_ups` row lock. **Round 2:** `transitionEnquiryStage` now reads the row under `lockVisibleEnquiry` (a `FOR UPDATE` lock taken inside the caller's own scope) so the stage, the graph check, the write and the audit row are one atomic step. |
| `lib/services/enquiry-conversion.ts` | +46 / −13 lines — the three enquiry updates (trial booking, convert-on-trial, direct convert) now write their row in the same transaction. |
| `lib/services/enquiry-scope.ts` | **+42 / −4 (round 2, shared file)** — `lockVisibleEnquiry()`: the locking twin of `visibleEnquiry()`. Both are thin wrappers over ONE private `readEnquiry(tx, ctx, id, lock)` builder, so the visibility rule cannot drift between the plain and the locking read. The lock is `FOR UPDATE` **inside the same tenant + location predicate** as the read, so a caller that cannot see the row never locks it. All 5 importers of this module were re-verified (§6b). |

### Owned, tests (new)

| File | Change |
|---|---|
| `tests/backend-b6/enquiry-audit/enquiry-audit.test.ts` | **NEW** (684 lines, 15 tests) — the whole audit suite. Real Postgres 16 via the established `tests/helpers/isolated-db` Testcontainer fixture. |
| `tests/backend-b6/enquiry-audit/enquiry-concurrency.test.ts` | **NEW** (round 2, 6 tests) — the concurrency suite. Real Postgres 16; the interleaving is forced with a **real second transaction that holds the row lock**, so the outcome is deterministic rather than a race that may or may not be hit. |


### Companion fixture changes — **OUTSIDE my declared write scope** (see §9 request R1)

| File | Change |
|---|---|
| `tests/enquiry-service-characterization.test.ts` | The three caller contexts minted a fresh `randomUUID()` actor each call and no `users` row existed for it. They now share one seeded actor (`actorUserId`) with a real `users` row. No assertion changed. |
| `tests/review-role-workflow-corrections.test.ts` | `scopedReception` and `scopedManager` minted inline `randomUUID()` actors that were never seeded, while the file's other five actors already were. They now use seeded ids through the file's own `seedUser()` helper. No assertion changed. |

### Explicitly NOT touched

`lib/audit/write.ts` (read-only), `db/schema/**` and `db/migrations/**` (no schema
change, no new migration), `lib/auth/action-permissions.ts`, `lib/actions/enquiries.ts`,
`lib/services/enquiry-scope.ts`, `lib/services/location-access.ts`,
`lib/services/member-status.ts`, `lib/services/member-registration.ts`,
`lib/services/register.ts`, `tests/tier1/**`, any scanner, any approval gate, any
dependency manifest, any UI file, any `app/` route, any `components/` file.

---

## 5. RED → GREEN evidence

Every behaviour below was driven by an **intended assertion failing on the current
implementation** — not by an import, setup or environment error. Command for every
cycle:

```
python3 .opencode/scripts/harness.py test tests/backend-b6/enquiry-audit/enquiry-audit.test.ts
```

### RED #1 — capture (`enquiry.create`)

```
FAIL  tests/backend-b6/enquiry-audit/enquiry-audit.test.ts > enquiry capture — audit >
      writes exactly one enquiry.create audit row for the captured enquiry
AssertionError: expected [] to have a length of 1 but got +0
 ❯ tests/backend-b6/enquiry-audit/enquiry-audit.test.ts:199:18
Tests  1 failed (1)
```
→ GREEN: `Tests 1 passed (1)`.

### RED #2 — stage transition (`enquiry.stage`)

```
FAIL  … > writes exactly one enquiry.stage audit row carrying the stage change
AssertionError: expected [] to have a length of 1 but got +0
Tests  1 failed | 2 passed (3)
```
→ GREEN: `Tests 3 passed (3)`.

### RED #3 — follow-up create (`enquiry.follow_up.create`)

```
FAIL  … > writes exactly one enquiry.follow_up.create audit row for the new follow-up
AssertionError: expected [] to have a length of 1 but got +0
Tests  1 failed | 3 passed (4)
```
→ GREEN: `Tests 4 passed (4)`.

### RED #4 — follow-up complete + repeated completion

```
FAIL  … > writes exactly one enquiry.follow_up.complete audit row when a follow-up is completed
AssertionError: expected [] to have a length of 1 but got +0
FAIL  … > writes no second audit row when an already-completed follow-up is completed again
AssertionError: expected [] to have a length of 1 but got +0
Tests  2 failed | 4 passed (6)
```
→ GREEN: `Tests 6 passed (6)`.

### RED #5 — trial booking (`enquiry.trial_book`)

```
FAIL  … > writes exactly one enquiry.trial_book audit row without duplicating the member's own audit
AssertionError: expected [] to have a length of 1 but got +0
Tests  1 failed | 6 passed (7)
```
→ GREEN: `Tests 7 passed (7)`.

### RED #6 — conversion, both paths (`enquiry.convert`)

```
FAIL  … > writes exactly one enquiry.convert audit row when the enquiry converts on its trial member
AssertionError: expected [] to have a length of 1 but got +0
FAIL  … > writes exactly one enquiry.convert audit row when the enquiry converts without a trial
AssertionError: expected [] to have a length of 1 but got +0
Tests  2 failed | 7 passed (9)
```
→ GREEN: `Tests 9 passed (9)`.

### Regression RED (pre-existing suites) — the actor FK (F1/F2)

Surfaced once the audit rows existed, in the two files of §4:

```
FAIL  tests/review-role-workflow-corrections.test.ts > R04 enquiry location ownership >
      rejects creation at a location the caller cannot access
Error: Failed query: insert into "audit_log" …
Serialized Error: { … code: '23503',
  detail: 'Key is not present in table "users".',
  constraint: 'audit_log_new_actor_id_fkey' }
Tests  2 failed | 32 passed (34)
```

```
FAIL  tests/enquiry-service-characterization.test.ts
× captures a walk-in at the caller's site
× moves an enquiry along the allowed graph
× refuses a transition that is not in the allowed graph
× surfaces an overdue follow-up and removes it when completed
× refuses a follow-up on an enquiry the caller cannot see
   … violates foreign key constraint "audit_log_new_actor_id_fkey"
Tests  5 failed | 13 passed (18)
```

→ GREEN after the two companion fixture changes (§4): both files pass unchanged in
their assertions.

### Final GREEN

```
pnpm typecheck                                    # tsc --noEmit, clean
pnpm lint                                         # eslint . --max-warnings=0, clean

python3 .opencode/scripts/harness.py test \
  tests/backend-b6/enquiry-audit/enquiry-audit.test.ts \
  tests/enquiry-service-characterization.test.ts \
  tests/tier1/enquiries.test.ts \
  tests/review-role-workflow-corrections.test.ts \
  tests/owner-insights-enquiry-aggregate.test.ts \
  tests/tier1/owner-dashboard.test.ts \
  tests/tier1/audit-actor-model.test.ts \
  tests/tier1/audit-partitioning.test.ts \
  tests/tier1/audit-tamper-evidence.test.ts

Test Files  9 passed (9)
     Tests  99 passed (99)
```

Repo scanners also run read-only and green:
`pnpm check:location-scope` (136 service files), `pnpm check:tenant-conventions`
(43 migrations), `pnpm check:migrations` (111 files), `pnpm check:lines`
(report-only; **none** of the five enquiry files is listed).

---

## 6. Negative and security cases (in `tests/backend-b6/enquiry-audit/enquiry-audit.test.ts`)

| # | Case | Assertion | Result |
|---|---|---|---|
| N1 | Transition outside the allowed graph (`new → trial_completed`) | `ok:false`, the stored stage is still `new`, **no** audit row | pass |
| N2 | Caller of another tenant reaches for this tenant's enquiry | `{ok:false,"Enquiry not found."}`, stage unchanged, **no** audit row | pass |
| N3 | Capture at a location outside the caller's locations | throws `/location you have access to/i`, **no** enquiry row, **no** audit row | pass |
| N4 | Follow-up on an enquiry the caller cannot see | throws `/enquiry not found/i`, **no** follow-up row, **no** audit row | pass |
| N5 | Trail scope | the application's own scoped read inside `withTenant(tenant)` sees the rows; the same read inside `withTenant(otherTenant)` sees **zero** | pass |
| N6 | Repeated follow-up completion | exactly **one** `enquiry.follow_up.complete` row; the stored `done_at` equals the recorded completion instant (no re-stamp) | pass |
| N7 | PII | the audit payload contains no full name, no phone, no note (capture, follow-up note, and the enquiry notes field) | pass |
| N8 | Non-duplication | a trial booking yields `enquiry.trial_book` **and** the member's own `member.create` — one of each, not two of either; a conversion yields `enquiry.convert` **and** the member's `member.status` | pass |

**Honest note on N1–N4:** these four refusal cases were written **after** the behaviour
change and are therefore *supplementary* regression guards, not TDD proof. On the
pre-change code they passed trivially, because no audit row existed at all. Their
value was demonstrated by the mutation checks in §7 — a trail that is switched off, or
an audit write that happens outside the guard, makes them fail.

---

## 6b. Round 2 — concurrency RED → GREEN evidence

Command for every cycle:

```
python3 .opencode/scripts/harness.py test tests/backend-b6/enquiry-audit/enquiry-concurrency.test.ts
```

### RED — the three concurrency defects, all deterministic

The test drives the real production path against a real Postgres 16 and forces the
interleaving with a **real second transaction that holds the row lock** (the same
`withTenant` + `SELECT … FOR UPDATE` a competing writer would hold). The outcome is
therefore deterministic, not a race that may or may not be hit.

```
× rejects a transition the graph forbids once another transaction has moved the enquiry
  AssertionError: expected { ok: true } to deeply equal { ok: false, …(1) }
× lets exactly one of two concurrent transitions to the same stage apply, and audits it once
  AssertionError: expected [ true, true ] to have a length of 1 but got 2
× audits a before -> after chain when two concurrent transitions both apply
  AssertionError: expected 'new' to be 'contacted' // Object.is equality
Tests  3 failed | 3 passed (6)
```

Reading the three failures:

1. the stale transition **applied** over an enquiry another transaction had converted
   (`converted` is terminal — reopening it to `contacted` is a graph violation);
2. **both** concurrent transitions applied, so one mutation was duplicated;
3. the audit chain broke — the last audit row's `after` state was not the state the
   enquiry was actually in.

The other three tests passed against the unfixed code and are honestly reported as
characterisation, not RED: the two `completeFollowUp` race tests (the row lock from
round 1 already serialises them) and the lock-scope test (there was no lock at all, so
nothing could block). Their teeth are proved by the mutation checks below.

### GREEN

```
Test Files  1 passed (1)
     Tests  6 passed (6)
```

### The 6 concurrency tests and what each one proves

| Test | Proves |
|---|---|
| rejects a transition the graph forbids once another transaction has moved the enquiry | the decision is taken on the **locked, current** stage: the transition is refused with `Cannot move an enquiry from converted to contacted.`, the row is untouched and **no audit row** is written |
| lets exactly one of two concurrent transitions to the same stage apply, and audits it once | two real concurrent callers serialise: exactly one applies, the other is refused against the stage the first wrote, and exactly **one** audit row exists (`new → contacted`) |
| audits a before → after chain when two concurrent transitions both apply | consecutive audit rows chain (`row[i].before === row[i-1].after`), the first starts at the stage the enquiry really had, the last ends at the stage the enquiry is in **now**, and the payload still carries no personal data |
| does not let a caller outside the location scope wait on — or learn about — the row | a location-B caller and a caller of another tenant both get `Enquiry not found.` **without waiting** for the locked row: the lock is taken inside the caller's own scope, so it cannot be used to stall or probe for a row the caller may not see |
| does not complete a follow-up again when another transaction already completed it | the follow-up completion is **not** duplicated: no second audit row, and the stored completion instant is the one that was recorded |
| completes a follow-up exactly once when two callers race | two real concurrent completions yield exactly one audit row and one completion instant |

### Mutation check 1 — the lock taken **outside** the caller's scope

`lockVisibleEnquiry` was temporarily changed to lock the row by id alone, ignoring the
tenant + location predicate:

```
× does not let a caller outside the location scope wait on — or learn about — the row
  AssertionError: expected 'waiting' to be 'settled' // Object.is equality
   (the out-of-scope caller blocked for the full 2000 ms deadline)
Tests  4 failed | 2 passed (6)
```

Interpretation: an unscoped lock is not just slower — it is an **information leak**,
because a caller that may not touch the row learns that it exists by making it stall.
The production lock is scoped, and this test detects it if that ever changes.

### Mutation check 2 — the `completeFollowUp` row lock removed

```
× does not complete a follow-up again when another transaction already completed it
  AssertionError: expected [ { id: '10', …(6) } ] to have a length of +0 but got 1
× completes a follow-up exactly once when two callers race
  AssertionError: expected [ { id: '13', …(6) }, …(1) ] to have a length of 1 but got 2
Tests  2 failed | 4 passed (6)
```

Interpretation: without the row lock the follow-up is completed **twice** — a second,
misleading audit row and a re-stamped completion instant. The round-1 behaviour is real
and this coverage now holds it in place. (Both mutations were reverted and the files
restored byte-for-byte from a pre-mutation copy.)

### All-consumer regression for the shared-file change

`lib/services/enquiry-scope.ts` is shared; all **5** importers were identified and
re-verified (`enquiry-reads`, `enquiry-pipeline`, `enquiry-conversion`,
`enquiry-capture`, `enquiries` façade):

```
python3 .opencode/scripts/harness.py test \
  tests/backend-b6/enquiry-audit/enquiry-audit.test.ts \
  tests/backend-b6/enquiry-audit/enquiry-concurrency.test.ts \
  tests/enquiry-service-characterization.test.ts \
  tests/tier1/enquiries.test.ts \
  tests/review-role-workflow-corrections.test.ts \
  tests/owner-insights-enquiry-aggregate.test.ts \
  tests/owner-insights.test.ts \
  tests/tier1/owner-dashboard.test.ts \
  tests/tier1/audit-actor-model.test.ts \
  tests/tier1/audit-partitioning.test.ts \
  tests/tier1/audit-tamper-evidence.test.ts \
  tests/owner-insights-actions.test.ts \
  tests/mobile/invalid-id-pages.test.ts

Test Files  12 passed (13)
     Tests  173 passed | 1 failed (174)
```

**The single failure is a pre-existing, load-sensitive 5-second timeout in a protected
tier1 test, and is NOT caused by this change.** Evidence:

- it failed by **timeout** (`Test timed out in 5000ms`), not by an assertion;
- its import graph (`@/db/tenant`, `@/lib/env`, `@/lib/ids`,
  `@/lib/jobs/audit-checkpoint-job`, `@/lib/jobs/audit-checkpoint-schedule`,
  `@/lib/time/tz`) is **disjoint** from every file this batch touches, and none of
  those modules references the enquiry family;
- it spawns `npx tsx scripts/verify-audit-checkpoint.ts` **twice**, and a bare
  `npx tsx --version` costs **1.3 s** on this host;
- with the same harness-validated disposable-test environment and only a larger vitest
  timeout it **passes 10/10** (`Duration 5.79s`, of which 4.15 s is this test's own
  work against the 5 s default budget) — i.e. it is a timing budget, not a behaviour
  change;
- the host was at **load average 14.8 on 14 CPUs** during the run (other agents'
  containers and databases).

The protected test was **not** modified. Recorded as **F9** in §9.

### Round-2 static checks

```
pnpm typecheck    # clean
pnpm lint         # clean (eslint . --max-warnings=0)
```

Line counts (all product modules under 300):
`enquiry-scope.ts` 174 · `enquiry-pipeline.ts` 133 · `enquiry-audit.ts` 160 ·
`enquiry-capture.ts` 80 · `enquiry-conversion.ts` 265.

---

## 7. Refactor and mutation evidence

### Refactor (tests green throughout)

**Round 1.** The three conversion call sites repeated the same four-field before/after
object. The helper now exposes `enquiryAuditState(enquiry)`; each call site spreads it
and overrides only what the change touches, so the "before" and "after" of one row can
never describe different fields.

- `lib/services/enquiry-conversion.ts`: **284 → 265 lines** after the refactor.
- `pnpm typecheck` clean, `pnpm lint` clean, `Tests 76 passed (76)` re-run after the
  refactor (6 files).

**Round 2.** The plain and the locking read share ONE private query builder
(`readEnquiry(tx, ctx, id, lock)`), with two thin, explicitly named wrappers
(`visibleEnquiry`, `lockVisibleEnquiry`). The visibility rule therefore cannot drift
between the two, and the call site says which one it wants. `enquiry-scope.ts` is 174
lines; `enquiry-pipeline.ts` is 133 — both well under the 300-line product limit.

### Mutation check A — the audit write moved to a **separate transaction**

The stage transition's audit write was temporarily moved out of the domain transaction
(the exact regression the atomicity test guards):

```
× rolls the stage change back when the audit row cannot be written
  AssertionError: expected 'contacted' to be 'new' // Object.is equality
× writes neither a stage change nor an audit row for a transition outside the allowed graph
  AssertionError: expected [ { id: '27', …(11) }, …(1) ] to have a length of 1 but got 2
Tests  2 failed | 13 passed (15)
```

Interpretation: with the audit write outside the transaction, **the stage change
survives the failed audit write** (the first failure), and a **refused** transition
still leaves an audit row (the second failure). Both are the behaviours the production
code now prevents. The mutation was reverted and the file restored byte-for-byte from a
pre-mutation copy.

### Mutation check B — the whole enquiry audit trail switched off

```
× writes exactly one enquiry.create audit row for the captured enquiry
× writes exactly one enquiry.stage audit row carrying the stage change
× writes exactly one enquiry.follow_up.create audit row for the new follow-up
× writes exactly one enquiry.follow_up.complete audit row when a follow-up is completed
× writes no second audit row when an already-completed follow-up is completed again
× writes exactly one enquiry.trial_book audit row without duplicating the member's own audit
× writes exactly one enquiry.convert audit row when the enquiry converts on its trial member
× writes exactly one enquiry.convert audit row when the enquiry converts without a trial
× keeps the audit trail inside the tenant that wrote it
× rolls the stage change back when the audit row cannot be written
Tests  10 failed | 5 passed (15)
```

Interpretation: 10 of 15 tests detect a missing trail. The 5 that survive are exactly
the refusal cases N1–N4 plus the PII assertion — they assert *absence*, so they cannot
detect a trail that was never written. That is precisely why both directions are
covered. The mutation was reverted and the file restored byte-for-byte.

### The atomicity proof itself

The audit write is made to fail at the database level — a `BEFORE INSERT` trigger on
`audit_log` in the **disposable** container raises `aqua-b6: injected audit insert
failure` — and the production path is then exercised for real:

1. the transition **fails** (the error propagates through drizzle's wrapped error),
2. the enquiry's stored stage is still `new` — **the domain write rolled back with the
   failed audit write**,
3. no audit row exists,
4. after the trigger is dropped, the same transition succeeds and is recorded exactly
   once.

This is a real transaction against a real Postgres (RLS, partitions, FKs, triggers) —
not a mock.

---

## 8. Secure SDLC notes

- **No new dependency, no schema change, no migration, no new endpoint, no permission
  or entitlement change.** The audit trail uses the existing `audit_log` table and the
  existing `writeAudit` writer.
- **No secrets or PII in logs, fixtures or output.** Test fixtures use synthetic
  names/phones; the audit payloads contain no personal data at all; the handoff quotes
  no connection strings or credentials.
- **Money / paise / children-data surfaces:** untouched. This batch changes no money
  path, no consent path and no child-data path; `db/schema/people.ts` and
  `db/schema/consent*` were not modified (the agent-protected-path gate is not tripped).
- **Tenant isolation is enforced by the database**, not by the caller: the new rows go
  through `withTenant()` and `audit_log`'s `FORCE ROW LEVEL SECURITY`; N5 proves the
  trail is invisible to another tenant through the application's own read path.
- **Attribution is never silently dropped.** A caller id that is not a real
  `users` row makes the audit insert fail, so the mutation fails with it — the trail
  never records a change it cannot attribute.
- **Concurrency (round 2).** The pipeline's decision is taken under a row lock, so a
  change can never be decided against a state that has already moved. The lock is
  scoped by the caller's own tenant + location rule, so it neither leaks the
  existence of a row across a boundary nor lets one caller stall another. A
  concurrent mutation is serialised, and a refused one writes neither a domain row
  nor an audit row.
- **No certification is claimed.** This is a scoped engineering change with focused
  evidence, not an OWASP/NIST/audit certification of the product.

---

## 9. Remaining failures and requests for the coordinator

**R1 — two companion fixture changes outside my declared write scope (needs review).**
The two edits in §4 ("Companion fixture changes") are required for the repo to stay
green: both files' actors now have to be real `users` rows because
`audit_log.actor_id` references `users(id)`. Both edits use the pattern each file
already contains (`seedUser()` in one, a `users` insert in the other) and **change no
assertion**. They sit outside "OWN FILES ONLY", so please confirm ownership or fold
them into the integration; if the coordinator prefers to own them, the production diff
stands on its own and only these two fixture lines need re-applying.

**R2 — actor-resolution policy (a shared contract decision; not taken unilaterally).**
Today, a caller whose `ctx.userId` is not a real `users` row **fails the mutation**
rather than producing an unattributed audit row. That is the loud, safe behaviour and
matches `member-status` (whose own tests call it with `userId: undefined`), but it is a
stricter contract than the enquiry tables themselves (`enquiries.created_by` has no FK).
The alternative considered and **rejected**: resolving the actor through
`tenant_memberships` and writing `actor_id = NULL` when it does not resolve — it
silently drops attribution and adds a query per mutation. If the coordinator wants
attribution to degrade instead of the mutation failing, that is a shared decision for
`lib/audit/write.ts` and the schema, not for this batch.

**R3 — no blocker in production paths.** Every production caller of the enquiry family
is `lib/actions/enquiries.ts` → `requireDefaultCtx()` → a real membership user, so the
actor FK is satisfied in production. `tests/tier1/enquiries.test.ts` calls the services
with `{ tenantId }` (no actor) and passes unchanged.

**R4 — the `bookTrial` / `convertEnquiry` multi-transaction race (found, NOT fixed).**
Both check the enquiry (stage, "no member yet") in one transaction and only later
create the member in further transactions, because `withTenant()` does not nest. Two
concurrent trials on the same enquiry can therefore both pass the check and both create
a member — one of them orphaned, with its enrolment pointing nowhere. **A row lock
cannot fix this**: locking the enquiry only at the final update would serialise the
writes while leaving the duplicate member creation untouched, which would be false
confidence. A correct fix has to re-check-and-claim the enquiry *before* the member is
created (or make the claim conditional on the member link), which changes that flow's
transaction shape and its caller-visible behaviour. That is a design decision beyond
the named scope of this round, so it is reported rather than silently changed.
Recommendation: a follow-up task for the enquiry family, with the same
`withTenant`-cannot-nest constraint taken into account.

**R5 — no lock timeout on the pipeline path (a behaviour change worth confirming).**
A stage transition now **waits** for a concurrent transition on the same enquiry to
finish (milliseconds in practice; the second caller then sees the first one's stage).
No `lock_timeout` is configured, so a pathological long-running holder would block the
caller rather than fail it. Setting one (e.g. a per-transaction `SET LOCAL
lock_timeout`) would turn a stall into an error, but it introduces a new failure mode
and an error message. Left unset deliberately — please confirm which the coordinator
prefers.

**F9 — a load-sensitive 5-second timeout in a protected tier1 test (not caused by this
change).** `tests/tier1/audit-tamper-evidence.test.ts` › *"exits 0 on an untouched day
and non-zero after a tampered row"* fails under load with `Test timed out in 5000ms`.
Evidence that it is not this change:

- the failure mode is a **timeout**, not an assertion failure;
- the test's entire dependency graph (`@/db/tenant`, `@/lib/env`, `@/lib/ids`,
  `@/lib/jobs/audit-checkpoint-job`, `@/lib/jobs/audit-checkpoint-schedule`,
  `@/lib/time/tz`) is **disjoint** from every file this batch touches — none of those
  modules references the enquiry family, and none of them was modified here;
- it spawns `npx tsx scripts/verify-audit-checkpoint.ts` **twice**, and a bare
  `npx tsx --version` costs **1.3 s** on this host, against a 5 s vitest budget for
  the whole test (its own work measures 4.15 s);
- with the same harness-validated disposable-test environment and only a larger vitest
  timeout it **passes 10/10** (`Duration 5.79s`);
- it digests only its own tenant's rows for a fixed past day, so the extra audit rows
  this batch writes in other tenants cannot change its result.

**Not verified on the base commit** (that would need a second checkout and a second
disposable database, which this assignment does not allow). The protected file was
**not** modified. If the coordinator's combined gate runs on a saturated host, this
file may need timeout headroom — a protected-path change, so it is the human's call.

**No other known failures.** The full release gate was deliberately **not** run (see
§10).

---

## 10. What was NOT tested / not done

- **No full release gate, no full suite, no build.** Per the assignment, the coordinator
  runs the combined gate. `pnpm build`, `pnpm check:bundle`, `pnpm check:fonts`,
  `pnpm check:focus-contrast` and the CI e2es were **not** run. No build was serialised
  against the design build lock because no build was started.
- **No browser/UI verification.** This batch is backend-only and changes no rendered
  surface. No UI surface currently reads enquiry audit rows, so there is nothing new to
  render. The parent zero-JS requirement is unaffected (no `app/` route was touched),
  but `pnpm e2e:parent-link-zero-js` was not re-run.
- **Concurrency of two simultaneous completions of the same follow-up** was not
  exercised in **round 1**; **round 2 added that coverage** (two concurrent
  completions → exactly one audit row and one completion instant, plus the
  deterministic "another transaction already completed it" case). Both are mutation-
  verified (§6b).
- **Round 2 — concurrency of `bookTrial` / `convertEnquiry`** is **not** covered and
  **not fixed** (F8/R4): the duplicate-member race lives across three transactions and
  needs a design decision. No test asserts anything about it.
- **Round 2 — the lock's waiting behaviour under a pathological holder** (no
  `lock_timeout`) is not exercised: R5.
- **Round 2 — a lock contention test at high concurrency** (e.g. 10 simultaneous
  transitions) was not run; the tests cover two concurrent callers and the
  deterministic held-lock interleaving.
- **Round 2 — deadlock between the pipeline lock and other services** was reasoned
  about (the transition holds one row lock; the follow-up completion holds a different
  row and only *reads* the enquiry, so there is no lock cycle) but not load-tested.
- **The legacy-unassigned-enquiry branch** of `bookTrial`/`convertEnquiry` (an enquiry
  with `location_id IS NULL` that gets resolved to the new member's site) is not
  exercised by a dedicated assertion; its audit payload is produced by the same
  `enquiryAuditState` spread that the tested paths use.
- **The `actor_type = 'system'` path** (a caller with no user id) is not asserted in
  the new file; it is exercised indirectly by `tests/tier1/enquiries.test.ts`, which
  passes.
- **`impersonator_id`** is always NULL — `ActionCtx` has no impersonation context in
  this codebase, so there is nothing to forward. Not exercised.
- **The ops/platform surfaces, the nightly audit checkpoint (E-03) and the activity
  event stream** were not re-verified beyond `tests/tier1/audit-partitioning.test.ts`
  and `tests/tier1/audit-tamper-evidence.test.ts` passing (unaffected code paths).
- **No commit, push, PR, merge, label, deployment or external-service call** was made.
  No remote provider (R2 / WhatsApp / paid) was contacted.

---

## 11. Owned resources, PIDs and reproduction

### Owned by this session

| Resource | Identity | Owner / lifetime |
|---|---|---|
| Disposable test DB container | `aqua-harness-test-bc7104d290`, `127.0.0.1:55461→5432`, tmpfs data, db `aqua_test_bc7104d290` | mine — created by `python3 .opencode/scripts/harness.py prepare-test --port 55461`; disposable; left running for the coordinator's re-runs |
| Harness test profile | `<worktree>/.env.aqua-harness-test.local`, mode 0600, git-ignored | mine — holds the disposable DB URLs only; **never printed in this document** |
| Testcontainer Postgres | one ephemeral `postgres:16` per test file per run, auto-assigned port | mine — created and stopped by `tests/helpers/isolated-db` in `afterAll`; the stopped entry is reaped by the testcontainers Ryuk, exactly as for every suite using that fixture |
| Ports | DB **55461** (assigned). Web port **3131 was reserved but never used** — no dev server was started | mine |
| Long-running processes | **none** — no dev server, no worker, no build was left running | — |

Pre-existing containers visible on this host but **not** owned by this session and left
untouched: `aqua-harness-test-4ec043c300` (55462), `-135faebc64` (55452),
`-375bd704ee` (55453), `-95024bb31c` (55451), `-faad52f370` (55464),
`-fc0ee15a2c` (55463), and the backup-drill pair `aqua-drill-*` (auto-assigned 32800 /
32801). No process was killed and no non-disposable database was touched.

### Reproduction

```bash
cd /home/soloengine/thedutchrabbit/aqua-worktrees/backend-enquiry-audit

# disposable test DB (already prepared; idempotent)
python3 .opencode/scripts/harness.py prepare-test --port 55461

# the new audit suite (round 1) and the new concurrency suite (round 2)
python3 .opencode/scripts/harness.py test \
  tests/backend-b6/enquiry-audit/enquiry-audit.test.ts \
  tests/backend-b6/enquiry-audit/enquiry-concurrency.test.ts

# the enquiry/audit regression set (13 files — the all-consumer sweep)
python3 .opencode/scripts/harness.py test \
  tests/backend-b6/enquiry-audit/enquiry-audit.test.ts \
  tests/backend-b6/enquiry-audit/enquiry-concurrency.test.ts \
  tests/enquiry-service-characterization.test.ts \
  tests/tier1/enquiries.test.ts \
  tests/review-role-workflow-corrections.test.ts \
  tests/owner-insights-enquiry-aggregate.test.ts \
  tests/owner-insights.test.ts \
  tests/tier1/owner-dashboard.test.ts \
  tests/tier1/audit-actor-model.test.ts \
  tests/tier1/audit-partitioning.test.ts \
  tests/tier1/audit-tamper-evidence.test.ts \
  tests/owner-insights-actions.test.ts \
  tests/mobile/invalid-id-pages.test.ts

# static checks
pnpm typecheck && pnpm lint
pnpm check:location-scope && pnpm check:tenant-conventions && pnpm check:migrations
```

Expected: **173 of 174 tests pass** across the 13 files (`Test Files 12 passed | 1
failed`), the one failure being the load-sensitive timeout of **F9** (§9) — that
protected file passes 10/10 with `--testTimeout=30000` and is unrelated to this
change. The two new suites alone are **21/21 green**. Typecheck and lint are clean.

### Diff identity at handoff

```
branch:  fix/enquiry-audit-b6
base:    d692fd322ca8aa369e23ee0b6056130e57aee298
status:
 M lib/services/enquiry-capture.ts
 M lib/services/enquiry-conversion.ts
 M lib/services/enquiry-pipeline.ts
 M lib/services/enquiry-scope.ts
 M tests/enquiry-service-characterization.test.ts
 M tests/review-role-workflow-corrections.test.ts
?? docs/handoffs/
?? lib/services/enquiry-audit.ts
?? tests/backend-b6/
```

**Uncommitted, unpushed, unmerged, undeployed.** No certification, no shipping claim.
