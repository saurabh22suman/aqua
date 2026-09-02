import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { enrolments } from "@/db/schema/scheduling";
import { members, persons } from "@/db/schema/people";
import { coachStaffIdSubquery } from "@/lib/services/staff";
import type { ActionCtx } from "@/lib/auth/context";

export type CoachScheduleRow = {
  id: string;
  sessionDate: string;
  batchName: string;
  startsAt: Date;
  endsAt: Date;
  marked: number;
  total: number;
};

// A coach's upcoming sessions across the batches they coach, between
// two dates (inclusive). Non-coach staff callers would get a subquery
// that matches nothing and thus an empty list — this is used by the
// coach schedule surface only, where the caller is always a coach.
export async function listCoachSchedule(
  ctx: ActionCtx & { roleKey: string },
  fromDate: string,
  toDate: string,
): Promise<CoachScheduleRow[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        id: sessions.id,
        sessionDate: sessions.sessionDate,
        batchName: batches.name,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        marked: sql<number>`(
          select count(*)::int from ${attendance} a
          where a.tenant_id = ${ctx.tenantId} and a.session_id = ${sessions.id}
        )`,
        total: sql<number>`(
          select count(distinct e.member_id)::int from ${enrolments} e
          where e.tenant_id = ${ctx.tenantId}
            and e.batch_id = ${sessions.batchId}
            and e.enrolled_on <= ${sessions.sessionDate}
        )`,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(
        and(
          eq(sessions.tenantId, ctx.tenantId),
          eq(sessions.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)),
          sql`${sessions.sessionDate} >= ${fromDate}`,
          sql`${sessions.sessionDate} <= ${toDate}`,
        ),
      )
      .orderBy(sessions.sessionDate, sessions.startsAt),
  );
}

export type CoachRosterRow = {
  memberId: string;
  name: string;
  code: string;
  batches: string[];
};

// Members enrolled in the batches this coach coaches, deduped across
// batches. Enrolments carries one row per member per batch per day, so
// a member in two of the coach's batches appears twice — deduped here,
// with the batch names aggregated onto one row.
export async function listCoachRoster(
  ctx: ActionCtx & { roleKey: string },
): Promise<CoachRosterRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        memberId: members.id,
        name: persons.fullName,
        code: members.memberCode,
        batchName: batches.name,
      })
      .from(enrolments)
      .innerJoin(members, eq(members.id, enrolments.memberId))
      .innerJoin(persons, eq(persons.id, members.personId))
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(batches.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)),
          isNull(members.deletedAt),
          isNull(batches.deletedAt),
        ),
      )
      .orderBy(persons.fullName, batches.name);

    const byMember = new Map<string, CoachRosterRow>();
    for (const r of rows) {
      const existing = byMember.get(r.memberId);
      if (existing) {
        if (!existing.batches.includes(r.batchName)) existing.batches.push(r.batchName);
      } else {
        byMember.set(r.memberId, {
          memberId: r.memberId,
          name: r.name,
          code: r.code,
          batches: [r.batchName],
        });
      }
    }
    return Array.from(byMember.values());
  });
}