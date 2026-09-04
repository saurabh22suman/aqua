import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { members, persons } from "@/db/schema/people";
import { asMemberId, type TenantId } from "@/lib/ids";

// C-45 — parent-page view service. Used by `/p/[token]` ONLY.
//
// The scope of this query is bounded by tenant_id from the verified
// token claims; the route layer never accepts a tenantId from the
// request. The token's personId gates which member's data is loaded.
// This is the only safe way to read a single child's data for a
// parent link — anything that took an id from the URL would expose
// other tenants' or other members' data on a successful guess.
//
// All queries below use the SAME tenant_id (the token's) and filter
// to the token's personId at the member level. A parent with three
// children gets three links, one per child.

export type ParentViewNextSession = {
  sessionId: string;
  sessionDate: string;
  startsAt: Date;
  endsAt: Date;
  batchName: string;
  coachName: string | null;
};

export type ParentViewAttendance = {
  presentCount: number;
  totalCount: number;
  pct: number | null;
  recent: Array<{
    sessionDate: string;
    batchName: string;
    status: "present" | "absent" | "late";
  }>;
};

export type ParentViewData = {
  child: {
    id: string;
    fullName: string;
    memberCode: string;
  };
  nextSession: ParentViewNextSession | null;
  attendance: ParentViewAttendance;
  // Placeholder for R.16 progress data. Reserved here so the route
  // shape is stable; populated once the assessments schema lands.
  progress: null;
};

const MAX_RECENT = 8;

export async function getParentViewData(args: {
  tenantId: TenantId;
  personId: string;
  today: string;
  monthStart: string;
  monthEnd: string;
}): Promise<ParentViewData | null> {
  return withTenant(args.tenantId, async (tx) => {
    const [child] = await tx
      .select({
        id: members.id,
        fullName: persons.fullName,
        memberCode: members.memberCode,
        deletedAt: members.deletedAt,
      })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(eq(members.tenantId, args.tenantId), eq(members.id, asMemberId(args.personId))))
      .limit(1);
    if (!child || child.deletedAt) return null;

    // Next upcoming session for this child, across any of the batches
    // they are enrolled in as of the link's date.
    const nextSessionRow = await tx.execute<{
      session_id: string;
      session_date: string;
      starts_at: Date;
      ends_at: Date;
      batch_name: string;
      coach_name: string | null;
    }>(sql`
      select s.id as session_id,
             s.session_date::text as session_date,
             s.starts_at,
             s.ends_at,
             b.name as batch_name,
             coach_person.full_name as coach_name
      from sessions s
      inner join batches b on b.id = s.batch_id and b.tenant_id = s.tenant_id
      left join staff st on st.id = s.coach_id and st.tenant_id = s.tenant_id
      left join persons coach_person on coach_person.id = st.person_id
      inner join enrolments e
        on e.batch_id = s.batch_id
        and e.tenant_id = s.tenant_id
        and e.member_id = ${args.personId}
        and e.enrolled_on <= s.session_date
      where s.tenant_id = ${args.tenantId}
        and s.session_date >= ${args.today}
        and s.status <> 'cancelled'
      order by s.session_date asc, s.starts_at asc
      limit 1
    `);
    const next = (nextSessionRow as unknown as { rows: Array<{
      session_id: string;
      session_date: string;
      starts_at: Date;
      ends_at: Date;
      batch_name: string;
      coach_name: string | null;
    }> }).rows[0] ?? null;

    // This calendar month's attendance. Same shape as
    // getMemberAttendanceHistory but trimmed (recent rows for the
    // history list).
    const monthRows = await tx
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
          eq(attendance.tenantId, args.tenantId),
          eq(attendance.memberId, asMemberId(args.personId)),
          gte(sessions.sessionDate, args.monthStart),
          lte(sessions.sessionDate, args.monthEnd),
        ),
      )
      .orderBy(asc(sessions.sessionDate));

    const presentCount = monthRows.filter(
      (r) => r.status === "present" || r.status === "late",
    ).length;
    const totalCount = monthRows.length;

    // Recent = last MAX_RECENT rows across the whole history (not
    // bounded to this month), so a parent can see beyond the 30-day
    // window when the page is viewed on day 28.
    const recentRows = await tx
      .select({
        sessionDate: sessions.sessionDate,
        batchName: batches.name,
        status: attendance.status,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(
        and(
          eq(attendance.tenantId, args.tenantId),
          eq(attendance.memberId, asMemberId(args.personId)),
        ),
      )
      .orderBy(asc(sessions.sessionDate))
      .limit(MAX_RECENT);

    return {
      child: {
        id: child.id,
        fullName: child.fullName,
        memberCode: child.memberCode,
      },
      nextSession: next
        ? {
            sessionId: next.session_id,
            sessionDate: next.session_date,
            startsAt: new Date(next.starts_at),
            endsAt: new Date(next.ends_at),
            batchName: next.batch_name,
            coachName: next.coach_name,
          }
        : null,
      attendance: {
        presentCount,
        totalCount,
        pct: totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : null,
        recent: recentRows
          .filter((r) => r.status === "present" || r.status === "absent" || r.status === "late")
          .map((r) => ({
            sessionDate: r.sessionDate,
            batchName: r.batchName,
            status: r.status as "present" | "absent" | "late",
          })),
      },
      progress: null,
    };
  });
}

void lte;
