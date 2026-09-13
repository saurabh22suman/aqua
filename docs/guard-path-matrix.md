# Guard × Path matrix — F2 audit response

**This is the audit's named deliverable:** the full list of guards
that exist, every path that should call each one, and whether it
does. It is the response to "this is the sixth instance of 'a
guard built, a second path added later, the guard never re-run.'"

**This table and `tests/tier1/guard-coverage.test.ts`'s
`MATRIX_PATHS`/`EXPECTED` constants are two independent copies of
the same data — if you add or change a row here, you must also
update the test file, or they will silently drift. The test does
not derive its data from this file.** The only thing the test
reads out of this markdown is a `toContain()` check for the guard
ID strings (`G1`…`G10`) plus the literals `rescheduleSession` and
`substituteCoach`. Everything else it asserts comes from its own
hardcoded TypeScript constants.

Note also that `tests/tier1/**` is read-only to the agent (see
`docs/testing-strategy.md` §5) — so a change that adds a row here
needs a human to land the matching test-side change.

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

### Paths added after the F2 audit — documented here, NOT yet pinned by the test

Every row below is missing from `guard-coverage.test.ts`'s
`MATRIX_PATHS`/`EXPECTED`. They are covered by nothing mechanical;
adding them to the test needs a human (Tier-1 files are read-only
to the agent). G1/G2/G4 are `⚪` for all of them — none of these
paths touch batch or session scheduling — so those columns are
omitted for width.

| Path | Where | G3 capacity | G7 permission | G8 uniqueness | G9 status graph | G10 consent |
|---|---|---|---|---|---|---|
| `createEnquiry` | enquiries.ts | ⚪ | ✅ via `lib/actions/enquiries.ts` | ⚪ (an enquiry is not a natural-key entity — duplicates are legitimate) | ⚪ | ⚪ |
| `transitionEnquiryStage` | enquiries.ts | ⚪ | ✅ via action | ⚪ | ✅ **but a second implementation** — `ENQUIRY_STAGE_TRANSITIONS` in `enquiries.ts`, not `transitionMemberStatus`; takes `for("update")` on the row first | ⚪ |
| `addFollowUp` | enquiries.ts | ⚪ | ✅ via action | ⚪ (composite FK `enquiry_follow_ups_enquiry_tenant_fkey` pins the parent to the same tenant) | ⚪ | ⚪ |
| `addMemberFacility` | facility-optins.ts | ⚪ | ✅ via `lib/actions/facility-optins.ts` | ✅ open-optin pre-check + partial `uniqueIndex` `member_facility_optins_active_idx` | ⚪ | ⚪ |
| `createGuardianship` | consent.ts | ⚪ | ⚪ **not a top-level path** — takes a `TenantTx`, sole caller is `register.ts:createMember`, which carries the G7/G10 checks | ⚪ | ⚪ | ⚪ (its caller enforces) |
| `updateBranding` | branding.ts | ⚪ | ✅ via `lib/actions/branding.ts`; also re-parses its own input at the service | ⚪ | ⚪ | ⚪ |
| `inviteStaff` | staff-invitations.ts | ⚪ | ✅ via `lib/actions/staff-invitations.ts` | ✅ find-or-create user by phone + existing-membership pre-check on (tenant, user) | ⚪ | ⚪ |
| `createStaff` | staff.ts | ⚪ | ✅ via `lib/actions/staff.ts` | ✅ `onConflictDoNothing` on (tenant, person, staffType) where not deleted | ⚪ | ⚪ |
| `updateMember` | people.ts | ⚪ | ✅ via `lib/actions/people.ts` | ⚪ | ⚪ | ⚠️ **needs a human decision** — see the finding below |
| `updateTermOverride` | terminology.ts | ⚪ | ✅ via `lib/actions/terminology.ts` | ⚪ (closed-key schema re-validation of the merged object, which is a different invariant) | ⚪ | ⚪ |
| `updateAbsenceAlertThreshold` | absence-alerts.ts | ⚪ | ✅ via `lib/actions/absence-alerts.ts` | ⚪ | ⚪ | ⚪ |
| `setCredential` | credentials.ts | ⚪ | ⚪ **not tenant-scoped** — runs under `withPlatform()`; the boundary check is at `app/api/account/set-pin/route.ts` | ⚪ (overwrite-by-design: reset must replace an existing PIN) | ⚪ | ⚪ |
| `setCredentialForPhone` | credentials.ts | ⚪ | ⚪ **no HTTP caller** — seed/demo path only; wraps `ensureBaUserForPhone` + `setCredential` | ⚪ | ⚪ | ⚪ |
| `issueLoginLink` | invite-link-issue.ts | ⚪ | ✅ via `lib/actions/invite-link.ts` | ⚪ | ✅ membership must be `invited` or `active`; `revoked` is refused explicitly | ⚪ |
| `redeemLoginLink` | invite-link.ts | ⚪ | ⚪ **unauthenticated by design** — the signed token *is* the credential; verified via `verifyInviteLinkToken`, plus a defence-in-depth `roleKey === "owner"` check for `reset` tokens | ✅ single-use: `onConflictDoNothing` on `invite_link_uses.jti`, consumed before any other write | ✅ membership `revoked` refused; tenant must be `trial`/`active` | ⚪ |

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

### ⚠️ updateMember × G10 — flagged for human review, not yet classified
`createMember` (register.ts) enforces G10: a minor cannot be
created without a guardian processing-consent row.
`updateMember` (people.ts) writes `dateOfBirth` straight through
to `persons` with no re-check. On the face of it, editing an
adult member's date of birth to a minor's would produce an active
minor with no consent row — the exact state G10 exists to
prevent. **Not asserted as a bug here**: whether that's reachable
depends on product intent for DOB edits (correction of a typo vs
a real change of status), which is a children's-data question and
therefore a stop-and-ask per CLAUDE.md. Needs a human decision
before it's marked ✅, ⚠️ or ⚪.

### ✅ Fixed since F2: G6 + G7 ordering is now enforced
This entry previously recorded the ordering half of the preamble
rule as a gap: the AST walk's `permIndex < serviceIndex`
comparison was dead code, because the `site.isServiceCall` field
it gated on was declared and never set to `true`, so
`serviceIndex` never advanced past `-1`.

**That is fixed (F5/J5).** The never-set field is gone;
`tests/tier1/server-action-preamble.test.ts` now evaluates
`statementLooksLikeServiceCall(stmt)` on every statement, with
built-ins (`String`, `Number`, `revalidatePath`, `formData.get`,
…) excluded from the service-call set so post-parse normalisation
doesn't trip the check. Both halves of the rule — parse first,
then permission-check, before any service call — are enforced.
Proven live: moving the permission check in
`lib/actions/platform-invite-owner.ts` past the service call
flips the test red.

## Companion source-scan test

`tests/tier1/guard-coverage.test.ts` asserts, against its own
`MATRIX_PATHS`/`EXPECTED` constants (not against this table):

1. Every path listed in `MATRIX_PATHS` exists in `lib/services/`
   as an `export [async] function <name>(`.
2. For every `"yes"` cell, the **service source file** either
   references the named guard (`GUARD_IMPORT_NAMES`) or contains
   one of the configured `INLINE_ANCHORS` strings for guards that
   are enforced inline rather than via a helper.
3. For every `"warn"` cell, the **service source file** — not this
   markdown table, and not the row text — matches
   `GAP_COMMENT_REGEX` (`/F2 finding|logged as known gap|form-only|
   intentionally|known gap/i`), i.e. the code itself carries a
   comment near the gap so a reader of the source cannot mistake
   it for complete enforcement.

Separately it asserts this file `toContain()`s each guard ID and
the strings `rescheduleSession` / `substituteCoach` — a presence
check only, not a parse of the table.

This is what prevents the seventh instance of "a guard built, a
second path added later, the guard never re-run" — but only for
the paths the test's own constants list. A row added here and
nowhere else is documentation, not enforcement.
