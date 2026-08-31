import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";

export type Period = { from: string; to: string };

// Default period: the calendar month containing `today` (ISO date,
// tenant-timezone-relative -- the caller passes it, this function
// doesn't compute "now" itself, matching the rest of the codebase's
// convention of resolving "today" once via todayInZone and threading
// it through).
export function currentMonthPeriod(today: string): Period {
  const [y, m] = today.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const nextMonth = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  const to = `${nextMonth.y}-${String(nextMonth.m).padStart(2, "0")}-01`;
  return { from, to };
}

export type AttendanceHistoryRow = {
  sessionId: string;
  sessionDate: string;
  batchName: string;
  status: "present" | "absent" | "late";
};

export type MemberAttendanceHistory = {
  rows: AttendanceHistoryRow[];
  presentCount: number;
  totalCount: number;
  pct: number | null;
};

// C-27 done-when: "a member page shows accurate monthly attendance."
// Counted from the attendance table itself (marked rows only), same
// convention getRosterForSession already uses -- a scheduled but
// not-yet-held session was never marked, so it doesn't inflate the
// denominator.
export async function getMemberAttendanceHistory(
  ctx: ActionCtx,
  memberId: string,
  period: Period,
): Promise<MemberAttendanceHistory> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        sessionId: attendance.sessionId,
        sessionDate: sessions.sessionDate,
        batchName: batches.name,
        status: attendance.status,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(
        and(
          eq(attendance.tenantId, ctx.tenantId),
          eq(attendance.memberId, asMemberId(memberId)),
          gte(sessions.sessionDate, period.from),
          lt(sessions.sessionDate, period.to),
        ),
      )
      .orderBy(asc(sessions.sessionDate));

    const presentCount = rows.filter((r) => r.status === "present" || r.status === "late").length;
    const totalCount = rows.length;

    return {
      rows: rows.map((r) => ({
        sessionId: r.sessionId,
        sessionDate: r.sessionDate,
        batchName: r.batchName,
        status: r.status as AttendanceHistoryRow["status"],
      })),
      presentCount,
      totalCount,
      pct: totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : null,
    };
  });
}

export type BatchAttendanceSummary = {
  batchId: string;
  batchName: string;
  sessionCount: number;
  presentMarks: number;
  totalMarks: number;
  pct: number | null;
};

// C-27's other done-when target: "per-batch summary." Aggregates every
// member's marks across every session of the batch within the period
// -- an overall attendance rate for the batch, not per-member.
export async function getBatchAttendanceSummary(
  ctx: ActionCtx,
  batchId: string,
  period: Period,
): Promise<BatchAttendanceSummary | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [batch] = await tx
      .select({ id: batches.id, name: batches.name })
      .from(batches)
      .where(and(eq(batches.id, batchId), eq(batches.tenantId, ctx.tenantId)));
    if (!batch) return null;

    const [row] = await tx
      .select({
        sessionCount: sql<number>`count(distinct ${sessions.id})::int`,
        presentMarks: sql<number>`count(*) filter (where ${attendance.status} in ('present', 'late'))::int`,
        totalMarks: sql<number>`count(${attendance.id})::int`,
      })
      .from(sessions)
      .leftJoin(
        attendance,
        and(eq(attendance.sessionId, sessions.id), eq(attendance.tenantId, ctx.tenantId)),
      )
      .where(
        and(
          eq(sessions.tenantId, ctx.tenantId),
          eq(sessions.batchId, batchId),
          gte(sessions.sessionDate, period.from),
          lt(sessions.sessionDate, period.to),
        ),
      );

    return {
      batchId: batch.id,
      batchName: batch.name,
      sessionCount: row.sessionCount,
      presentMarks: row.presentMarks,
      totalMarks: row.totalMarks,
      pct: row.totalMarks > 0 ? Math.round((row.presentMarks / row.totalMarks) * 100) : null,
    };
  });
}
