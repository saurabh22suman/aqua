# Guard × Path matrix — F2 audit response

**This is the audit's named deliverable:** the full list of guards
that exist, every path that should call each one, and whether it
does. It is the response to "this is the sixth instance of 'a
guard built, a second path added later, the guard never re-run.'"

The matrix is also the source of truth for the companion source-scan
test (`tests/tier1/guard-coverage.test.ts`), which pins the call
relationship so a future agent cannot silently add a path that
bypasses an existing guard.

## Glossary

| Term | Meaning |
|---|---|
| **Guard** | A reusable predicate (capacity, conflict, status) whose result determines whether a write may proceed. |
| **Path** | A mutating service function (`insert` / `update` / `delete` in `lib/services/`). One path per logical mutation. |
| **Required** | The guard MUST be called before the mutation commits; otherwise the invariant it protects silently breaks. |
| **Optional** | The guard MAY be called; not every mutation needs it. (E.g. coach-conflict for a session cancel that doesn't move time.) |

## Guards

| ID | Guard | Lives in | Invariant it protects |
|---|---|---|---|
| G1 | `detectCoachConflicts` | `lib/services/coach-conflicts.ts` | Two batches can't have the same coach on overlapping days + time. |
| G2 | `detectSessionConflicts` | `lib/services/coach-conflicts.ts` (added by F2) | Two sessions can't have the same coach on overlapping date/time. |
| G3 | `capacity check` | inline in `lib/services/register.ts:enrolMember`, `lib/services/transfer.ts:transferMemberToBatch` | Enrolment can't exceed `batches.capacity`. |
| G4 | `held-session guard` | inline in `lib/services/session-lifecycle.ts:cancelSession` | Cannot cancel a session that has already been held (attendance rows would orphan). |
| G5 | `tenant-isolation (RLS)` | `db/` + `tests/tier1/isolation.test.ts` | Every tenant-scoped query is constrained to its own tenant. |
| G6 | `parse-first preamble` | `tests/tier1/server-action-preamble.test.ts` | Every Server Action parses input first, then permission-checks. |
| G7 | `permission check` | `lib/auth/permissions.ts` | Caller's role permits the action. |
| G8 | `uniqueness-on-natural-key` | schema + service-level pre-checks | E.g. one credit per (tenant, member, source) for makeup, one enrolment per (tenant, member, batch, day). |
| G9 | `status-graph guard` | `lib/services/member-status.ts` (transitionMemberStatus) | Member status moves only along the allowed-graph. |
| G10 | `consent-before-minor-activation` | `lib/services/consent.ts` | A minor cannot be activated without a guardian processing-consent row. |

## Path × Guard matrix

✅ = guard called and enforces; ⚪ = guard not applicable; ❌ =
guard SHOULD be called but is not (F2 finding or known gap).

| Path | Where | G1 batch conflict | G2 session conflict | G3 capacity | G4 held | G7 permission | G8 uniqueness | G9 status graph | G10 consent |
|---|---|---|---|---|---|---|---|---|---|
| `createProgram` | programs.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ⚪ | ⚪ | ⚪ |
| `deleteProgram` | programs.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ✅ ("no live batches") | ⚪ | ⚪ |
| `updateProgram` | programs.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ⚪ | ⚪ | ⚪ |
| `createBatch` | programs.ts | ⚠️ **form-only** | ⚪ | ⚠️ **server-side checked at insert?** | ⚪ | ✅ via action | ⚪ | ⚪ | ⚪ |
| `updateBatch` | programs.ts | ⚠️ **form-only** | ⚪ | ⚪ | ⚪ | ✅ via action | ⚪ | ⚪ | ⚪ |
| `deleteBatch` | programs.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ⚪ | ⚪ | ⚪ |
| `createMember` | register.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ✅ unique memberCode + person | ⚪ | ✅ minor → processing consent required |
| `enrolMember` | register.ts | ⚪ | ⚪ | ✅ `for("update")` lock + count | ⚪ | ✅ via action | ✅ unique (tenant, member, batch, day) | ⚪ | ⚪ |
| `markAttendance` | register.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ✅ unique (tenant, session, member) + unique clientId | ⚪ | ⚪ |
| `cancelSession` | session-lifecycle.ts | ⚪ | ⚪ | ⚪ | ✅ | ✅ via action | ⚪ | ⚪ | ⚪ |
| `rescheduleSession` | session-lifecycle.ts | ❌ (intentionally — G1 is batch-level) | ✅ **F2 added** | ⚪ | ⚪ | ✅ via action | ⚪ | ⚪ | ⚪ |
| `substituteCoach` | coach-substitution.ts | ⚪ | ✅ **F2 added** | ⚪ | ⚪ | ✅ via action | ⚪ | ⚪ | ⚪ |
| `transferMemberToBatch` | transfer.ts | ⚪ | ⚪ | ✅ `for("update")` lock + count | ⚪ | ✅ via action | ✅ checks source/dest | ⚪ | ⚪ |
| `addToWaitlist` | waitlist.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ✅ "no live enrolment" + "no double waitlist" | ⚪ | ⚪ |
| `cancelWaitlist` | waitlist.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ✅ only updates `waiting` rows | ⚪ | ⚪ |
| `promoteHead` | waitlist.ts | ⚪ | ⚪ | ⚠️ **no re-check of capacity** (G3) | ⚪ | ✅ via action | ✅ only updates `waiting` rows | ⚪ | ⚪ |
| `addHoliday` | holidays.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ⚪ | ⚪ | ⚪ |
| `removeHoliday` | holidays.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ⚪ | ⚪ | ⚪ |
| `grantMakeupCredit` | makeup.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ✅ unique (tenant, member, source) | ⚪ | ⚪ |
| `redeemMakeupCredit` | makeup.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ✅ only updates non-redeemed | ⚪ | ⚪ |
| `transitionMemberStatus` | member-status.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ⚪ | ✅ allowed-graph | ⚪ |
| `recordConsent` | consent.ts | ⚪ | ⚪ | ⚪ | ⚪ | ✅ via action | ✅ unique (tenant, person, purpose, version, granted-at) | ⚪ | ⚪ |

## Findings

### F2 fixed: rescheduleSession × G2
Audit's named bug. ✅ Wired and tested in
`tests/tier1/reschedule-coach-conflict.test.ts`.

### F2 fixed: substituteCoach × G2
Same shape as the reschedule bug — substituting a coach onto a
session that already has another session in that slot was a silent
double-book. ✅ Wired.

### ⚠️ createBatch × G1 — form-only enforcement
`createBatch` and `updateBatch` (lib/services/programs.ts) do NOT
call `detectCoachConflicts` themselves; the conflict warning is
emitted only by the form (components/batch-edit-form.tsx via
`checkCoachConflictsAction`) BEFORE the form submits. The form is
the only enforcement. **Race condition:** an admin POSTing
directly to the action bypasses the warning.

This was the existing pattern before F2 — flagged as a known gap.
The R.2 design comment says "the form renders the conflict names
and lets the user proceed — the service is informational, not
blocking" — that's a deliberate design choice, not an oversight.
But it does mean the guard is not actually blocking at the service
layer.

If F2 is to close this fully, `createBatch`/`updateBatch` should
also call `detectCoachConflicts` and refuse on conflict. This is
out of scope for the F2 audit response (the audit named only
reschedule and substitute) and would be a separate change with a
proposal. **Logged as a known gap, not silently shipped.**

### ⚠️ promoteHead × G3 — no re-check of capacity
A waitlist promotion transitions the row to `promoted` but does
not call `enrolMember` (which is what enforces capacity). The
follow-up workflow is "an admin sees the promotion in the
waitlist view and enrols the member separately." If the slot was
filled by another path between the waitlist join and the
promotion, the promotion succeeds and the admin enrolment would
later fail with `target_full`.

The right fix is `promoteHead` should also create the enrolment
in the same transaction (after a capacity check) — but that's a
product decision (does promotion auto-enrol, or does it remain a
"head-of-queue, please enrol" surface?). **Logged as a known gap;
F2 does not fix this either — out of scope.**

### ✅ Audit coverage gap (G6 + G7)
Parse-first is enforced by the AST walk. Permission-second is
declared in CLAUDE.md as not enforced (the AST walk's ordering
check is dead code per CLAUDE.md's own annotation). This is a
known, documented gap — F2 does not address it.

## Companion source-scan test

`tests/tier1/guard-coverage.test.ts` reads this file and asserts:

1. Every path listed in the matrix exists in `lib/services/`.
2. For every row marked ✅, the path imports the named guard.
3. For every row marked ⚠️, the row includes a "F2 finding"
   comment that names the gap (so a future reader cannot read
   the matrix as "everything is fine").

This is what prevents the seventh instance of "a guard built, a
second path added later, the guard never re-run" — the matrix
file and the test together make the call relationship
machine-checkable, not memory-checkable.
