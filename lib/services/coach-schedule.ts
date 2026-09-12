import { and, eq, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { enrolments } from "@/db/schema/scheduling";
import { members, persons } from "@/db/schema/people";
import { staff } from "@/db/schema/staff";
import { tenants } from "@/db/schema/tenants";
import { coachStaffIdSubquery } from "@/lib/services/staff";
import { addDays, isMinor } from "@/lib/time/tz";
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

export type UpcomingSessionRow = {
  id: string;
  sessionDate: string;
  startsAt: Date;
  endsAt: Date;
  batchId: string;
  batchName: string;
  coachId: string | null;
  coachName: string | null;
  status: string;
};

// F3 (R.1) — upcoming sessions across the whole tenant, for the
// owner/admin view. Unlike listCoachSchedule, this is NOT scoped
// to the calling coach — it lists every batch's upcoming sessions
// so an owner can substitute a coach on any of them. The Coach
// role is not the target caller (the audit's "coach sees a
// conflict" promise for R.2 is met by BatchEditForm's existing
// warning, surfaced to whoever is editing the batch — typically
// the owner). This service is management-only.
export async function listUpcomingSessions(
  ctx: ActionCtx,
  fromDate: string,
  toDate: string,
): Promise<UpcomingSessionRow[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        id: sessions.id,
        sessionDate: sessions.sessionDate,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        batchId: batches.id,
        batchName: batches.name,
        coachId: sessions.coachId,
        coachName: persons.fullName,
        status: sessions.status,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .leftJoin(staff, eq(staff.id, sessions.coachId))
      .leftJoin(persons, eq(persons.id, staff.personId))
      .where(
        and(
          eq(sessions.tenantId, ctx.tenantId),
          isNull(batches.deletedAt),
          sql`${sessions.sessionDate} >= ${fromDate}`,
          sql`${sessions.sessionDate} <= ${toDate}`,
          sql`${sessions.status} <> 'cancelled'`,
        ),
      )
      .orderBy(sessions.sessionDate, sessions.startsAt),
  );
}

// Coach-scoped "next upcoming session" lookup. Used by the coach
// home's empty state: when there's nothing on today, the page
// surfaces the soonest future session the coach would act on next
// (so the verb and target on the empty-state card can match the
// distance — "Open register" if it's today or tomorrow, "Show on
// schedule" otherwise). Coach-scoping mirrors listCoachSchedule so
// a coach cannot see another coach's register through this path.
// Returns null if the coach has no future sessions in the next
// `daysAhead` window.
export async function getCoachNextUpcoming(
  ctx: ActionCtx & { roleKey: string; userId: string },
  afterDate: string,
  daysAhead: number,
): Promise<CoachScheduleRow | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const fromDate = addDays(afterDate, 1);
    const toDate = addDays(afterDate, daysAhead);
    const rows = await tx
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
            and e.enrolled_on <= ${fromDate}
        )`,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(
        and(
          eq(sessions.tenantId, ctx.tenantId),
          eq(sessions.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId!)),
          sql`${sessions.sessionDate} >= ${fromDate}`,
          sql`${sessions.sessionDate} <= ${toDate}`,
        ),
      )
      .orderBy(sessions.sessionDate, sessions.startsAt)
      .limit(1);
    return rows[0] ?? null;
  });
}

export type CoachRosterRow = {
  memberId: string;
  name: string;
  code: string;
  batches: string[];
  // P1-8 (mobile UX audit): the owner roster marks minors; the coach
  // roster must too (consent/guardian context). Derived at read time
  // from date_of_birth in the tenant's timezone, never stored.
  isMinor: boolean;
};

// Members enrolled in the batches this coach coaches, deduped across
// batches. Enrolments carries one row per member per batch per day, so
// a member in two of the coach's batches appears twice — deduped here,
// with the batch names aggregated onto one row.
export async function listCoachRoster(
  ctx: ActionCtx & { roleKey: string },
): Promise<CoachRosterRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [tenantRow] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const timezone = tenantRow?.timezone ?? "UTC";

    const rows = await tx
      .select({
        memberId: members.id,
        name: persons.fullName,
        code: members.memberCode,
        dateOfBirth: persons.dateOfBirth,
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
          isMinor: r.dateOfBirth ? isMinor(r.dateOfBirth, timezone) : false,
        });
      }
    }
    return Array.from(byMember.values());
  });
}