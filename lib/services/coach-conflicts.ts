import { and, eq, ne, sql, inArray } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { batches } from "@/db/schema/programs";
import { sessions } from "@/db/schema/scheduling";
import type { ActionCtx } from "@/lib/auth/context";
import type { TenantId } from "@/lib/ids";

// Phase R.2 — coach conflict detection. A coach double-booked
// across overlapping sessions warns at assignment time. The
// check runs before the save (per the work guide: "with the
// warning emitted before the save, not after"). The form
// renders the conflict names and lets the user proceed — the
// service is informational, not blocking.
//
// A "conflict" is a same-coach batch on overlapping days AND
// overlapping time ranges, on another live batch (deletedAt is
// null). The batch the user is editing is excluded so we don't
// warn against itself.
//
// Return shape carries the conflicting batch id + name +
// days-of-overlap, for the UI to render. No mutation here.
//
// F2 (audit fix): the audit found that rescheduleSession (R.4)
// silently allowed moving a session into a slot already held by
// the same coach on another session — detectCoachConflicts here
// only inspects batches, not sessions, so the gap was invisible
// to it. The companion `detectSessionConflicts` below is the
// session-level check; it is the one rescheduleSession and
// substituteCoach (R.1) call. Keeping both checks in this file
// means a future "guard exists for X" question has one answer
// — both batch and session level — and not "look in two places."

export type CoachConflict = {
  batchId: string;
  batchName: string;
  daysOverlap: number[];
};

export type CoachConflictCheckResult = {
  conflicts: CoachConflict[];
};

export type SessionConflict = {
  sessionId: string;
  batchId: string;
  sessionDate: string;
  startsAt: string;
  endsAt: string;
};

export type SessionConflictCheckResult = {
  conflicts: SessionConflict[];
};

export async function detectCoachConflicts(
  ctx: ActionCtx,
  args: {
    coachId: string;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    excludeBatchId?: string;
  },
): Promise<CoachConflictCheckResult> {
  if (!args.coachId || args.daysOfWeek.length === 0) {
    return { conflicts: [] };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    // The four rows-touched predicates:
    //   1. tenant scope (RLS would also catch this; the explicit
    //      check keeps the WHERE self-documenting)
    //   2. coach_id match
    //   3. excludeBatchId when supplied
    //   4. deleted_at is null
    // The two overlap predicates:
    //   5. daysOfWeek && unrolled days of week — implemented by
    //      fetching candidate days as int[] and matching via
    //      sql.raw('<daysOfWeek column> && <int[]>')
    //   6. time-window overlap: candidate.start < existing.end and
    //      existing.start < candidate.end, the canonical
    //      interval-overlap predicate
    const daysArray = `ARRAY[${args.daysOfWeek.join(",")}]::int[]`;
    const startTimeLit = `'${args.startTime}'::time`;
    const endTimeLit = `'${args.endTime}'::time`;
    const rows = await tx
      .select({
        id: batches.id,
        name: batches.name,
        daysOfWeek: batches.daysOfWeek,
      })
      .from(batches)
      .where(
        and(
          eq(batches.tenantId, ctx.tenantId as TenantId),
          eq(batches.coachId, args.coachId as never),
          args.excludeBatchId
            ? ne(batches.id, args.excludeBatchId as never)
            : sql`true`,
          sql`${batches.deletedAt} is null`,
          sql.raw(`${batches.daysOfWeek.name} && ${daysArray}`),
          sql.raw(`${batches.startTime.name} < ${endTimeLit} and ${startTimeLit} < ${batches.endTime.name}`),
        ),
      );

    const conflicts: CoachConflict[] = rows.map((r) => ({
      batchId: r.id,
      batchName: r.name,
      daysOverlap: r.daysOfWeek.filter((d) => args.daysOfWeek.includes(d)),
    }));
    return { conflicts };
  });
}

// detectSessionConflicts — the session-level guard F2 added.
//
// What it answers: "does this coach already have a non-cancelled
// session whose time range overlaps the proposed date/time
// window?" Used by:
//   - rescheduleSession (R.4) — before applying a new date/time,
//     so moving a session into a slot the same coach already
//     holds on another session is reported (and refuses).
//   - substituteCoach (R.1) — before writing a new coach onto a
//     session, so swapping the coach onto a slot they already
//     have a different session in is reported (and refuses).
//
// Note: the check is intentionally informational-then-blocking,
// matching the batch-level detectCoachConflicts pattern: the
// caller decides whether to block or to warn. rescheduleSession
// BLOCKS (this is the audit's named failure class — the bug was
// a silent double-book), substituteCoach BLOCKS too for the same
// reason (the substitute taking the slot would not have known
// they were already booked).
//
// Cancellation handling: a cancelled session does not occupy a
// slot. The status predicate below excludes it.
//
// excludeSessionId lets the caller pass its own id so it is not
// reported against itself (the reschedule path uses this; the
// substitute path uses the session's own id the same way).
export async function detectSessionConflicts(
  ctx: ActionCtx,
  args: {
    coachId: string | null;
    sessionDate: string;
    startsAt: Date;
    endsAt: Date;
    excludeSessionId?: string;
    tx?: TenantTx;
  },
): Promise<SessionConflictCheckResult> {
  if (!args.coachId) {
    return { conflicts: [] };
  }
  if (args.endsAt <= args.startsAt) {
    // Invalid range — caller will already have rejected on
    // end<=start; return empty here so the conflict check is
    // not the one to fail the request on a malformed input.
    return { conflicts: [] };
  }

  const runCheck = async (tx: TenantTx): Promise<SessionConflictCheckResult> => {
    // The overlap predicate is the canonical interval-overlap
    // form: existing.startsAt < candidate.endsAt AND
    //        candidate.startsAt < existing.endsAt.
    // The sessionDate predicate is intentionally NOT bound to
    // a single date — sessions whose date spans a long enough
    // window could in principle overlap; in practice sessionDate
    // matches the date portion of startsAt so adding the date
    // filter is harmless redundancy that also lets the planner
    // skip a row early.
    const rows = await tx
      .select({
        id: sessions.id,
        batchId: sessions.batchId,
        sessionDate: sessions.sessionDate,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.tenantId, ctx.tenantId as TenantId),
          eq(sessions.coachId, args.coachId as never),
          eq(sessions.sessionDate, args.sessionDate),
          sql`${sessions.status} <> 'cancelled'`,
          args.excludeSessionId
            ? ne(sessions.id, args.excludeSessionId as never)
            : sql`true`,
          sql`${sessions.startsAt} < ${args.endsAt.toISOString()}::timestamptz`,
          sql`${args.startsAt.toISOString()}::timestamptz < ${sessions.endsAt}`,
        ),
      );

    const conflicts: SessionConflict[] = rows.map((r) => ({
      sessionId: r.id,
      batchId: r.batchId,
      sessionDate: r.sessionDate,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
    }));
    return { conflicts };
  };

  // If a transaction is supplied, run inside it (no nested
  // withTenant). Otherwise open a withTenant scope of our own.
  if (args.tx) {
    return runCheck(args.tx);
  }
  return withTenant(ctx.tenantId, runCheck);
}

void inArray;
