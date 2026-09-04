import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { sessions } from "@/db/schema/scheduling";
import { staff } from "@/db/schema/staff";
import { detectSessionConflicts } from "@/lib/services/coach-conflicts";
import type { ActionCtx } from "@/lib/auth/context";
import { asStaffId, asTenantId } from "@/lib/ids";

// Phase R.1 — coach substitution. C-20: the recorded coach on
// a session can change (cover for an absent colleague, last-
// minute swap). The substitute is the new coach_id and V-31's
// payout computation reads sessions.coach_id, so a missed
// substitution means the wrong coach gets paid.
//
// The register surface still has to render — the substitute
// row uses sessions.coach_id, the roster's sessionVisibleTo-
// Caller (lib/services/register.ts) keys off the same column,
// so the substitute coach sees the session in their today list
// once the write commits.
//
// A null-coach_id session is also a valid state (the field
// is nullable on the schema). Substitution can therefore
// "assign" by writing a coach id to a previously-coach-less
// session. Empty-string coachId in the input is rejected so
// the surface can't accidentally clear the recorded coach.
//
// Reschedule-style mechanics — substitute preserves the
// session's id, date, times, and attendance rows. Only
// sessions.coach_id changes.
//
// F2 (audit fix): the audit found that substituteCoach, like
// rescheduleSession, silently allowed a coach to be assigned
// to a session that overlapped another of their sessions. We
// now call detectSessionConflicts before the UPDATE and return
// coach_conflict if the proposed new coach has another
// non-cancelled session in this session's date/time window.
// Same gap, same guard — written once, called from both paths.

export type SubstituteCoachResult =
  | { kind: "ok"; sessionId: string; newCoachId: string; previousCoachId: string | null }
  | {
      kind: "error";
      code:
        | "invalid"
        | "session_not_found"
        | "coach_not_found"
        | "no_change"
        | "coach_conflict";
      message: string;
      conflictingSessionIds?: string[];
    };

export async function substituteCoach(
  ctx: ActionCtx,
  input: { sessionId: string; newCoachId: string },
): Promise<SubstituteCoachResult> {
  if (!input.newCoachId) {
    return {
      kind: "error",
      code: "invalid",
      message: "Substitute coach is required.",
    };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const [s] = await tx
      .select({
        id: sessions.id,
        coachId: sessions.coachId,
        sessionDate: sessions.sessionDate,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.tenantId, asTenantId(ctx.tenantId)),
        ),
      )
      .limit(1);
    if (!s) {
      return {
        kind: "error",
        code: "session_not_found",
        message: "Session not found.",
      };
    }

    // Confirm the substitute is a real staff row in this tenant
    // of type 'coach'. The FK enforces tenant + id; the staffType
    // check is a soft guard.
    const [coach] = await tx
      .select({ id: staff.id, staffType: staff.staffType })
      .from(staff)
      .where(
        and(
          eq(staff.id, asStaffId(input.newCoachId)),
          eq(staff.tenantId, asTenantId(ctx.tenantId)),
          sql`${staff.deletedAt} is null`,
        ),
      )
      .limit(1);
    if (!coach || coach.staffType !== "coach") {
      return {
        kind: "error",
        code: "coach_not_found",
        message: "Substitute coach not found in this tenant.",
      };
    }

    if (s.coachId === coach.id) {
      return {
        kind: "ok",
        sessionId: s.id,
        newCoachId: coach.id,
        previousCoachId: s.coachId,
      };
    }

    // F2 guard — coach conflict for the proposed substitute.
    // Detects whether `coach` already has another non-cancelled
    // session in this session's date/time window. excludeSessionId
    // drops this very session (the substitute is being applied
    // to it, so it should not flag itself). Runs inside the
    // withTenant scope of the caller — sharing the tx means
    // the check and the write see the same snapshot, and we
    // don't open a nested withTenant (db/scope.ts refuses).
    const conflicts = await detectSessionConflicts(ctx, {
      coachId: coach.id,
      sessionDate: s.sessionDate,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      excludeSessionId: s.id,
      tx,
    });
    if (conflicts.conflicts.length > 0) {
      return {
        kind: "error",
        code: "coach_conflict",
        message:
          "This coach already has another session in this time window.",
        conflictingSessionIds: conflicts.conflicts.map((c) => c.sessionId),
      };
    }

    const previousCoachId = s.coachId;
    await tx
      .update(sessions)
      .set({
        coachId: asStaffId(coach.id),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(sessions.id, s.id));

    // TODO(tenant-audit-log): tenant-initiated mutation
    // (substitute). Same gap as the rest of the staff-invitations
    // and transfer code; architecture §8.10.

    return {
      kind: "ok",
      sessionId: s.id,
      newCoachId: coach.id,
      previousCoachId,
    };
  });
}

void asStaffId;
void sql;
