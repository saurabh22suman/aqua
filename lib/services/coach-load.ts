import { and, eq, gte, lt, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { staff } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { batches } from "@/db/schema/programs";
import {
  locationPredicate,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";
import type { ReportPeriod } from "./owner-reports";

// Phase 4.6 — coach load. Lives in its own module so the
// reports index file stays under the 300-line soft limit
// (CLAUDE.md). Dependency is the same as the rest of the
// reports module: a tenant-scoped read through withTenant().
//
// Sessions.coach_id is the recorded coach (per C-20 the
// recorded coach is the one who actually took the session).
// Coaches with no sessions in the period are reported at
// zero — useful for "who's under-utilised" without naming
// absence as a problem.

export type CoachLoadRow = {
  coachStaffId: string;
  coachName: string;
  sessionCount: number;
  distinctMembers: number;
};

export async function getCoachLoad(
  ctx: ActionCtx,
  period: ReportPeriod,
): Promise<CoachLoadRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    // O-08 — the caller's location scope applies to this report too:
    // the caller's access is applied FIRST and may only narrow the
    // result (the same rule the sibling reports follow —
    // lib/services/attendance-report-query.ts, lib/services/roster.ts).
    // The batch's location is the one a session belongs to.
    const access = await resolveLocationAccess(tx, ctx);
    const accessPredicate = locationPredicate(batches.locationId, access);
    const sessionsRow = await tx
      .select({
        coachId: sessions.coachId,
        sessionCount: sql<number>`count(distinct ${sessions.id})::int`,
        distinctMembers: sql<number>`count(distinct ${attendance.memberId})::int`,
      })
      .from(sessions)
      .innerJoin(
        batches,
        and(eq(batches.id, sessions.batchId), eq(batches.tenantId, ctx.tenantId)),
      )
      .leftJoin(attendance, eq(attendance.sessionId, sessions.id))
      .where(
        and(
          eq(sessions.tenantId, ctx.tenantId),
          gte(sessions.sessionDate, period.from),
          lt(sessions.sessionDate, period.to),
          sql`${sessions.coachId} is not null`,
          // History: a batch soft-deleted later must not remove the
          // sessions a coach already taught from the load report.
          ...(accessPredicate ? [accessPredicate] : []),
        ),
      )
      .groupBy(sessions.coachId);

    const coachIds = sessionsRow.map((r) => r.coachId).filter(Boolean);
    const names = new Map<string, string>();
    if (coachIds.length > 0) {
      const personRows = await tx
        .select({ staffId: staff.id, fullName: persons.fullName })
        .from(staff)
        .innerJoin(persons, eq(persons.id, staff.personId))
        .where(
          and(
            eq(staff.tenantId, ctx.tenantId),
            sql`${staff.id} in (${sql.join(coachIds.map((id) => sql`${id}`), sql`, `)})`,
          ),
        );
      for (const p of personRows) names.set(p.staffId, p.fullName);
    }

    return sessionsRow.map((r) => ({
      coachStaffId: r.coachId ?? "",
      coachName: r.coachId ? names.get(r.coachId) ?? "Unknown coach" : "Unknown coach",
      sessionCount: Number(r.sessionCount),
      distinctMembers: Number(r.distinctMembers),
    }));
  });
}
