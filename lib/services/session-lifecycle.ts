import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { sessions } from "@/db/schema/scheduling";
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

export type SessionLifecycleResult =
  | { kind: "ok"; sessionId: string; newStatus: "cancelled" | "scheduled"; newSessionDate: string }
  | {
      kind: "error";
      code:
        | "invalid"
        | "session_not_found"
        | "no_change"
        | "cannot_cancel_held";
      message: string;
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
      .select({ id: sessions.id, status: sessions.status, sessionDate: sessions.sessionDate })
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
