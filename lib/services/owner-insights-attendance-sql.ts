import { and, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { attendance, enrolments, sessions } from "@/db/schema/scheduling";
import { batches, programs } from "@/db/schema/programs";
import { members, persons } from "@/db/schema/people";
import {
  locationPredicate,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { assertInsightGrant } from "@/lib/services/owner-insights-access";
import type { TenantTx } from "@/db/tenant";
import type { ActionCtx } from "@/lib/auth/context";

// The two scoped reads behind "Attendance by batch". Data access
// only: no shaping, no policy decisions of its own.
//
//   readSessionMarks   what was MARKED, per session
//   readSessionRosters who was on the EFFECTIVE HISTORICAL ROSTER of
//                      each session, and how many of them carry a mark
//
// Both are tenant-scoped (withTenant's transaction + RLS) and
// location-scoped through the same helper every other staff read uses
// (O-08). A requested location can only NARROW: it intersects with the
// caller's access, it never widens it.
//
// A cancelled session is not a chance to attend, so it is excluded
// from both reads.

export type SessionMarkRow = {
  batchId: string;
  batchName: string;
  programName: string | null;
  locationId: string | null;
  present: number;
  late: number;
  absent: number;
  /** Marks recorded on the session (present + late + absent). */
  marked: number;
};

export type SessionRosterRow = {
  batchId: string;
  /** Members on the effective roster: enrolled on or before the session date. */
  rosterSlots: number;
  /** Roster members that carry a mark. */
  markedSlots: number;
};

export type AttendanceByBatchParams = {
  from: string;
  to: string;
  locationId?: string;
};

export async function readAttendanceRows(
  tx: TenantTx,
  ctx: ActionCtx,
  params: AttendanceByBatchParams,
): Promise<{ marks: SessionMarkRow[]; rosters: SessionRosterRow[] }> {
  // The grant is checked HERE, at the lowest level, so no caller can
  // reach these rows without it — not even a caller that imports this
  // module directly. (The tenant's feature switch is checked by the
  // entry points, which can read it outside a transaction.)
  await assertInsightGrant(tx, ctx);
  const access = await resolveLocationAccess(tx, ctx);
  const batchAccess = locationPredicate(batches.locationId, access);
  const batchScope = and(
    eq(batches.tenantId, ctx.tenantId),
    isNull(batches.deletedAt),
    ...(params.locationId ? [eq(batches.locationId, params.locationId)] : []),
    ...(batchAccess ? [batchAccess] : []),
  );
  const sessionWindow = and(
    sql`${sessions.status} <> 'cancelled'`,
    gte(sessions.sessionDate, params.from),
    lt(sessions.sessionDate, params.to),
  );

  const marks = await tx
    .select({
      batchId: batches.id,
      batchName: batches.name,
      programName: programs.name,
      locationId: batches.locationId,
      present: sql<number>`count(*) filter (where ${attendance.status} = 'present')::int`,
      late: sql<number>`count(*) filter (where ${attendance.status} = 'late')::int`,
      absent: sql<number>`count(*) filter (where ${attendance.status} = 'absent')::int`,
      marked: sql<number>`count(${attendance.id})::int`,
    })
    .from(batches)
    .leftJoin(programs, eq(programs.id, batches.programId))
    .innerJoin(
      sessions,
      and(eq(sessions.batchId, batches.id), eq(sessions.tenantId, ctx.tenantId)),
    )
    .leftJoin(
      attendance,
      and(eq(attendance.sessionId, sessions.id), eq(attendance.tenantId, ctx.tenantId)),
    )
    .where(and(batchScope, sessionWindow))
    .groupBy(batches.id, batches.name, programs.name, batches.locationId, sessions.id);

  const rosters = await tx
    .select({
      batchId: sessions.batchId,
      rosterSlots: sql<number>`count(distinct ${enrolments.memberId})::int`,
      markedSlots: sql<number>`count(distinct ${attendance.memberId})::int`,
    })
    .from(sessions)
    .innerJoin(
      batches,
      and(eq(batches.id, sessions.batchId), eq(batches.tenantId, ctx.tenantId)),
    )
    .innerJoin(
      enrolments,
      and(
        eq(enrolments.batchId, sessions.batchId),
        eq(enrolments.tenantId, ctx.tenantId),
        lte(enrolments.enrolledOn, sessions.sessionDate),
      ),
    )
    .innerJoin(
      members,
      and(
        eq(members.id, enrolments.memberId),
        eq(members.tenantId, ctx.tenantId),
        inArray(members.status, ["active", "trial"]),
        isNull(members.deletedAt),
      ),
    )
    .innerJoin(
      persons,
      and(
        eq(persons.id, members.personId),
        eq(persons.tenantId, ctx.tenantId),
        isNull(persons.deletedAt),
      ),
    )
    .leftJoin(
      attendance,
      and(
        eq(attendance.sessionId, sessions.id),
        eq(attendance.memberId, enrolments.memberId),
        eq(attendance.tenantId, ctx.tenantId),
      ),
    )
    .where(
      and(
        eq(sessions.tenantId, ctx.tenantId),
        batchScope,
        sessionWindow,
      ),
    )
    .groupBy(sessions.batchId, sessions.id);

  return { marks, rosters };
}
