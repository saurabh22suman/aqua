import { and, eq, gte, lt, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches, programs } from "@/db/schema/programs";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";
import type { ReportPeriod } from "./owner-reports";

// 4.3 — attendance by batch. Lives in its own module so the reports
// file stays readable (the same reason coach load lives in
// ./coach-load.ts) and so the eligibility rule below has one named
// home. Dependency is the same as the rest of the reports module: a
// tenant-scoped read through withTenant().
//
// THE ELIGIBILITY RULE
//
//   An ATTENDANCE-ELIGIBLE session is a session that actually
//   happened: status 'scheduled' or 'held', inside the requested
//   period. A CANCELLED session is not a chance to attend, so it is
//   not eligible — it contributes no session, no mark and no
//   percentage to this report.
//
//   This is the same rule the Home insights view applies
//   (lib/services/owner-insights-attendance-sql.ts filters
//   `sessions.status <> 'cancelled'`), and the two must stay in
//   step: an owner who drills down from the insights chart into the
//   attendance report has to see the same sessions. The shared
//   wording and the differences that remain on purpose are written
//   down in docs/backend/attendance-report-semantics.md.
//
//   The predicate sits in the JOIN condition, never in the WHERE:
//   the sessions join is a LEFT JOIN so a batch with no eligible
//   session is still reported, with sessionCount 0 and pct null
//   ("no sessions yet"), instead of disappearing from the report.
//
// WHAT THE NUMBERS MEAN
//
//   sessionCount  eligible sessions in the period for this batch
//   presentMarks  recorded marks with status 'present' or 'late'
//   totalMarks    recorded marks of any status ('present', 'late',
//                 'absent') — the DENOMINATOR is the marks that were
//                 actually recorded, never a roster estimate
//   pct           presentMarks ÷ totalMarks, or null when no mark
//                 was recorded at all
//
//   A member on the roster with no mark is UNKNOWN, not absent: the
//   mark was never written, so it never enters the denominator.
//   Register completeness (how many roster members carry a mark)
//   is a different measurement and lives in the insights view.
//
// PERIOD AND SCOPE
//
//   The period is half-open: `from` is inclusive, `to` is
//   exclusive. Location scope follows the O-08 boundary — the
//   caller's access is applied first, and a requested locationId may
//   only narrow it further, never widen it.

export type BatchAttendanceReportRow = {
  batchId: string;
  batchName: string;
  programName: string;
  sessionCount: number;
  presentMarks: number;
  totalMarks: number;
  pct: number | null;
};

export async function getAttendanceReport(
  ctx: ActionCtx,
  period: ReportPeriod,
  options: { locationId?: string } = {},
): Promise<BatchAttendanceReportRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    // O-08 — restricted callers see/export only their locations; the
    // requested locationId can only narrow further.
    const access = await resolveLocationAccess(tx, ctx);
    const accessPredicate = locationPredicate(batches.locationId, access);
    const rows = await tx
      .select({
        batchId: batches.id,
        batchName: batches.name,
        programName: programs.name,
        sessionCount: sql<number>`count(distinct ${sessions.id})::int`,
        presentMarks: sql<number>`count(*) filter (where ${attendance.status} in ('present', 'late'))::int`,
        totalMarks: sql<number>`count(${attendance.id})::int`,
      })
      .from(batches)
      .leftJoin(programs, eq(programs.id, batches.programId))
      .leftJoin(
        sessions,
        and(
          eq(sessions.batchId, batches.id),
          eq(sessions.tenantId, ctx.tenantId),
          // A cancelled session is not a chance to attend, so it is
          // not an attendance-eligible session.
          sql`${sessions.status} <> 'cancelled'`,
          gte(sessions.sessionDate, period.from),
          lt(sessions.sessionDate, period.to),
        ),
      )
      .leftJoin(
        attendance,
        and(eq(attendance.sessionId, sessions.id), eq(attendance.tenantId, ctx.tenantId)),
      )
      .where(
        and(
          eq(batches.tenantId, ctx.tenantId),
          sql`${batches.deletedAt} is null`,
          ...(options.locationId ? [eq(batches.locationId, options.locationId)] : []),
          ...(accessPredicate ? [accessPredicate] : []),
        ),
      )
      .groupBy(batches.id, batches.name, programs.name)
      .orderBy(batches.name);

    return rows.map((r) => ({
      batchId: r.batchId,
      batchName: r.batchName,
      programName: r.programName ?? "",
      sessionCount: Number(r.sessionCount),
      presentMarks: Number(r.presentMarks),
      totalMarks: Number(r.totalMarks),
      pct: r.totalMarks > 0 ? Math.round((Number(r.presentMarks) / Number(r.totalMarks)) * 100) : null,
    }));
  });
}
