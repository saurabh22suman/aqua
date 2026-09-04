import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { sessions } from "@/db/schema/scheduling";
import { detectSessionConflicts } from "@/lib/services/coach-conflicts";
import type { ActionCtx } from "@/lib/auth/context";

// Phase R.4 — session cancellation / rescheduling.
//
// Schema already has 'cancelled' as a valid status (the
// sessions_status_check constraint at db/schema/scheduling.ts
// accepts 'scheduled' | 'held' | 'cancelled'). This service
// drives transitions to / from 'cancelled' and updates the
// session date (for reschedules). Attendance rows are
// preserved — the register still reads them, the cancelled
// session just stops appearing in the coach's today view.
//
// Reschedule preserves the `id` (so any clientId-keyed offline
// rows still map back to the same session). Only session_date /
// startsAt / endsAt / status change; coach_id stays the same
// (R.1 coach substitution is the path for "actual coach took
// it" — different concern).
//
// F2 (audit fix): the audit found that rescheduleSession
// silently allowed moving a session into a slot the same coach
// already holds on another session — detectCoachConflicts (R.2)
// inspects the BATCHES table for overlap, but reschedule moves
// SESSIONS, and the audit's named failure was moving a
// batch-A session into batch-B's slot. We now call
// detectSessionConflicts before the UPDATE and return
// coach_conflict if the proposed new date/time overlaps an
// existing non-cancelled session for the session's recorded
// coach. This is the missing guard.

export type SessionLifecycleResult =
  | {
      kind: "ok";
      sessionId: string;
      newStatus: "cancelled" | "scheduled";
      newSessionDate: string;
    }
  | {
      kind: "error";
      code:
        | "invalid"
        | "session_not_found"
        | "no_change"
        | "cannot_cancel_held"
        | "coach_conflict";
      message: string;
      conflictingSessionIds?: string[];
    };

export async function cancelSession(
  ctx: ActionCtx,
  sessionId: string,
): Promise<SessionLifecycleResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [s] = await tx
      .select({ id: sessions.id, status: sessions.status, sessionDate: sessions.sessionDate })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.tenantId, ctx.tenantId),
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
    if (s.status === "cancelled") {
      return {
        kind: "ok",
        sessionId: s.id,
        newStatus: "cancelled",
        newSessionDate: s.sessionDate,
      };
    }
    // A 'held' session has attendance rows already in
    // 'present' / 'late' state — rolling it back to
    // 'cancelled' would silently orphan the day's mark. The
    // owner-facing flow should not see this; coach-side
    // cancellation happens before the session is held.
    if (s.status === "held") {
      return {
        kind: "error",
        code: "cannot_cancel_held",
        message: "Cannot cancel a session that has already been held.",
      };
    }

    await tx
      .update(sessions)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(sessions.id, sessionId));

    return {
      kind: "ok",
      sessionId: s.id,
      newStatus: "cancelled",
      newSessionDate: s.sessionDate,
    };
  });
}

export type RescheduleSessionInput = {
  sessionId: string;
  newSessionDate: string;
  newStartsAt: Date;
  newEndsAt: Date;
};

export async function rescheduleSession(
  ctx: ActionCtx,
  input: RescheduleSessionInput,
): Promise<SessionLifecycleResult> {
  if (input.newEndsAt <= input.newStartsAt) {
    return {
      kind: "error",
      code: "invalid",
      message: "End time must be after start time.",
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.newSessionDate)) {
    return {
      kind: "error",
      code: "invalid",
      message: "Session date must be YYYY-MM-DD.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const [s] = await tx
      .select({
        id: sessions.id,
        status: sessions.status,
        sessionDate: sessions.sessionDate,
        coachId: sessions.coachId,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.tenantId, ctx.tenantId),
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

    // F2 guard — coach conflict on the proposed new slot.
    // Runs before the UPDATE so a refused reschedule does not
    // partially apply. coach_id is preserved across reschedule
    // (R.1 substitution is the path for changing it), so the
    // session's existing coach is the one whose other sessions
    // we check against. excludeSessionId drops this very session
    // from the candidate set — without it, a session would
    // conflict with itself. A null coach_id skips the check
    // (no recorded coach, no conflict to detect).
    //
    // The check runs INSIDE this withTenant transaction by
    // passing the tx — opening a nested withTenant would throw
    // (db/scope.ts's enterScope refuses). Sharing the tx means
    // the check and the write see the same snapshot.
    if (s.coachId) {
      const conflicts = await detectSessionConflicts(
        ctx,
        {
          coachId: s.coachId,
          sessionDate: input.newSessionDate,
          startsAt: input.newStartsAt,
          endsAt: input.newEndsAt,
          excludeSessionId: s.id,
          tx,
        },
      );
      if (conflicts.conflicts.length > 0) {
        return {
          kind: "error",
          code: "coach_conflict",
          message:
            "This session's coach already has another session in the proposed time window.",
          conflictingSessionIds: conflicts.conflicts.map((c) => c.sessionId),
        };
      }
    }

    // Reschedule flips a cancelled session back to scheduled
    // AND updates the date. Held sessions stay held; the coach
    // has to write the post-attendance state separately.
    if (s.status === "cancelled") {
      // Uncancel + reschedule
      await tx
        .update(sessions)
        .set({
          status: "scheduled",
          sessionDate: input.newSessionDate,
          startsAt: input.newStartsAt,
          endsAt: input.newEndsAt,
          updatedAt: new Date(),
          updatedBy: ctx.userId,
        })
        .where(eq(sessions.id, input.sessionId));
    } else if (s.sessionDate === input.newSessionDate) {
      return {
        kind: "error",
        code: "no_change",
        message: "Session is already on that date.",
      };
    } else {
      // Rescheduling a scheduled (or held) session — the date
      // changes, the rest follows. Status is preserved.
      await tx
        .update(sessions)
        .set({
          sessionDate: input.newSessionDate,
          startsAt: input.newStartsAt,
          endsAt: input.newEndsAt,
          updatedAt: new Date(),
          updatedBy: ctx.userId,
        })
        .where(eq(sessions.id, input.sessionId));
    }
    return {
      kind: "ok",
      sessionId: s.id,
      newStatus: (s.status === "cancelled" ? "scheduled" : s.status) as "cancelled" | "scheduled",
      newSessionDate: input.newSessionDate,
    };
  });
}

void sql;
