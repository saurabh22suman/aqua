import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { members } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { batches, programs } from "@/db/schema/programs";
import { attendance, enrolments, sessions } from "@/db/schema/scheduling";
import { todayInZone } from "@/lib/time/tz";
import { listOverdueFollowUps } from "@/lib/services/enquiries";

type ActionCtx = { tenantId: string };

export type NeedsAttentionItem = {
  title: string;
  detail: string;
  href?: string;
};

export type TodaysLane = {
  batchId: string;
  batchName: string;
  programName: string;
  startTime: string;
  enrolled: number;
  capacity: number;
};

export type OwnerDashboardData = {
  tenantName: string;
  today: string; // ISO date, tenant-timezone "today" -- the same value every other query below is scoped to
  todayMarked: number;
  todayTotal: number;
  activeMemberCount: number;
  attendanceThisWeekPct: number | null;
  activeBatchCount: number;
  needsAttention: NeedsAttentionItem[];
  todaysLanes: TodaysLane[];
};

// S4 (Owner home), not C-46 as literally specified: C-46 wants an
// overdue-amount hero and a "collected this month" chip, but no money
// table exists anywhere in this codebase yet (C-28 through C-39 are
// all unbuilt). S4's own Build text is explicit and different --
// "today's batches as capacity lanes, member count, attendance this
// week, needs-attention list... NO money tiles, no placeholders for
// absent data -- honest empty states" -- and that's what this builds.
// Every figure here comes from a real query against data that exists
// today (sessions, attendance, batches, enrolments, members). Nothing
// is invented to fill a slot the mockup happens to have.
//
// Still no money tiles (this update only adds overdue follow-ups,
// C-13's own done-when: "overdue follow-ups surface on the owner
// dashboard"). listOverdueFollowUps opens its own withTenant() and
// withTenant() cannot nest (db/scope.ts) -- called here, before the
// dashboard's own withTenant() below, not inside it.
export async function getOwnerDashboard(ctx: ActionCtx): Promise<OwnerDashboardData> {
  const overdueFollowUps = await listOverdueFollowUps(ctx);

  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const today = todayInZone(tenant.timezone);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [{ n: activeMemberCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(members)
      .where(
        and(
          eq(members.tenantId, ctx.tenantId),
          eq(members.status, "active"),
          isNull(members.deletedAt),
        ),
      );

    const [{ n: activeBatchCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(batches)
      .where(and(eq(batches.tenantId, ctx.tenantId), isNull(batches.deletedAt)));

    // Today's sessions across every batch, joined to their attendance
    // counts and enrolment counts -- the one query everything else in
    // this function is derived from, so "today" and "enrolled" can
    // never drift between the hero, the needs-attention check and the
    // lane list.
    const todaysSessions = await tx
      .select({
        sessionId: sessions.id,
        batchId: sessions.batchId,
        batchName: batches.name,
        programName: programs.name,
        startTime: batches.startTime,
        startsAt: sessions.startsAt,
        capacity: batches.capacity,
        marked: sql<number>`(select count(*)::int from ${attendance} a where a.session_id = ${sessions.id})`,
        enrolled: sql<number>`(select count(distinct e.member_id)::int from ${enrolments} e where e.batch_id = ${sessions.batchId} and e.tenant_id = ${ctx.tenantId})`,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .innerJoin(programs, eq(programs.id, batches.programId))
      .where(and(eq(sessions.tenantId, ctx.tenantId), eq(sessions.sessionDate, today)))
      .orderBy(sessions.startsAt);

    const now = Date.now();
    const todayMarked = todaysSessions.reduce((sum, s) => sum + s.marked, 0);
    const todayTotal = todaysSessions.reduce((sum, s) => sum + s.enrolled, 0);

    // Needs attention: a session that has already started, has real
    // enrolled members to mark, and has zero marks yet. A batch with
    // no one enrolled is not flagged -- there is nothing for a coach
    // to have done. This is the one signal honestly detectable from
    // today's schema; see docs/architecture.md for what's deferred
    // (an unassigned/"uncovered" batch needs sessions.coach_id, only
    // on the not-yet-merged coach-assignment-scoping branch).
    const needsAttention: NeedsAttentionItem[] = todaysSessions
      .filter((s) => s.enrolled > 0 && s.marked === 0 && s.startsAt.getTime() < now)
      .map((s) => ({
        title: "Register not started",
        detail: `${s.batchName} — session began, nothing marked yet`,
      }));

    // C-13 done-when: "overdue follow-ups surface on the owner
    // dashboard." Every item still states why it's here -- how many
    // days overdue, and the enquiry it belongs to -- not a bare count.
    for (const f of overdueFollowUps) {
      const daysOverdue = Math.max(1, Math.floor((now - f.dueAt.getTime()) / (24 * 60 * 60 * 1000)));
      needsAttention.push({
        title: "Follow-up overdue",
        detail: `${f.enquiryName} — due ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} ago${f.note ? `: ${f.note}` : ""}`,
        href: `/owner/enquiries/${f.enquiryId}`,
      });
    }

    const todaysLanes: TodaysLane[] = todaysSessions.map((s) => ({
      batchId: s.batchId,
      batchName: s.batchName,
      programName: s.programName,
      startTime: s.startTime,
      enrolled: s.enrolled,
      capacity: s.capacity,
    }));

    // Attendance this week: present+late over total marks in the last
    // 7 days. Null (not 0) when there are no marks yet at all -- an
    // honest "no data" is different from "0% attendance", and the UI
    // must show them differently (see S4's own done-when: truthful
    // about emptiness, not a fabricated zero).
    const [weekRow] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        present: sql<number>`count(*) filter (where ${attendance.status} in ('present', 'late'))::int`,
      })
      .from(attendance)
      .where(and(eq(attendance.tenantId, ctx.tenantId), gte(attendance.markedAt, weekAgo)));
    const attendanceThisWeekPct =
      weekRow.total > 0 ? Math.round((weekRow.present / weekRow.total) * 100) : null;

    return {
      tenantName: tenant.name,
      today,
      todayMarked,
      todayTotal,
      activeMemberCount,
      attendanceThisWeekPct,
      activeBatchCount,
      needsAttention,
      todaysLanes,
    };
  });
}
