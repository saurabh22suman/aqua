import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { members } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { batches } from "@/db/schema/programs";
import { addDays, dayRangeUtc, todayInZone } from "@/lib/time/tz";
import {
  locationPredicate,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";

// 4.5 — the owner's attendance-records summary. It lives in its own
// module for the same reason the attendance report and the coach load
// do (the reports module stays readable, and each rule has one named
// home); lib/services/owner-reports.ts re-exports the public names so
// every existing import path keeps working.
//
// WHAT THIS REPORT SAYS
//
//   The human approved this wording on 30 October 2026
//   (docs/audits/staging-blockers-20261029/d-workflows/dot-three-
//   20261030/HUMAN-APPROVED-RETENTION-DEFINITION.md): the owner view
//   shows "Attendance records to review" — an aggregate operational
//   summary, not a risk, churn or absence claim.
//
//   * A RECORD is any attendance mark written for a session that
//     happened in the period: present, late OR absent.
//   * A member with NO mark is UNKNOWN. It is never relabelled
//     absent, never counted as predicted churn and never given an
//     individual score. The same convention the attendance report and
//     the coach's register use (docs/backend/attendance-report-
//     semantics.md).
//   * The COHORT is the members the count is about: active, not
//     deleted, with a KNOWN join date on or before the period start,
//     inside the caller's tenant and location access. A newer
//     member's mark belongs to a different cohort and can never
//     subtract from this one.
//
// THE PERIOD
//
//   The tenant's own last 30 calendar days including today: local
//   midnight 29 days before today through the read time. It is the
//   tenant's calendar, not UTC's — between 00:00 and 05:30 IST the
//   UTC date is still yesterday. A session counts only if it was not
//   cancelled and it had already started when the report was read:
//   no future record creates retrospective history.
//
// The aggregate the report shows. Its shape is PINNED by
// tests/tier1/owner-reports.test.ts ("returns aggregate numbers only
// — never a per-member list"), so it carries the four numbers and
// nothing else — no per-member identifier, and no extra fields.
export type RetentionRow = {
  // LEGACY KEY. The value it carries now is the factual one: eligible
  // members with NO attendance record in the period. The name is kept
  // so the pinned API shape does not change.
  memberCountAtRisk: number;
  // LEGACY KEY — the same number, kept for compatibility.
  membersWithZeroLast30: number;
  // LEGACY KEY, LEGACY MEANING. It counts the eligible members with
  // ONE TO THREE qualifying marks — the partial-attendance proxy the
  // field has always carried, with its one-to-three band unchanged.
  // It is NOT the number of members with a record (a member with four
  // or more marks has a record and is still not "partial"), so the
  // card derives the with-record count from the cohort instead.
  membersWithPartialLast30: number;
  // Every active member in scope, whatever their join date. The
  // cohort above is the one the count is about.
  totalActiveMembers: number;
};

// The report plus the evidence behind it: the cohort the count is
// about, the sessions that actually ran, and whether there is enough
// history to count at all.
export type RetentionReport = {
  row: RetentionRow;
  // The cohort the count is about: active members who were here for
  // the whole period (joined on or before its start).
  eligibleMemberCount: number;
  // Sessions that actually ran in the period (not cancelled, already
  // started when the report was read).
  sessionsInWindow: number;
  // "insufficient" means the view cannot count records yet.
  history: "sufficient" | "insufficient";
};

export async function getRetentionReport(ctx: ActionCtx): Promise<RetentionReport> {
  return withTenant(ctx.tenantId, async (tx) => {
    // O-08 — the caller's resolved location access governs this read,
    // exactly as it governs the owner dashboard (A07) and the fees
    // hub. The cohort, the denominator and the attendance marks are
    // all scoped by the MEMBER's location, so the count compares one
    // population with itself.
    const access = await resolveLocationAccess(tx, ctx);
    const memberPredicate = locationPredicate(members.locationId, access);
    const batchPredicate = locationPredicate(batches.locationId, access);

    // The window is the tenant's own calendar: the last 30 days
    // counted back from the tenant's today, not from the UTC date
    // (which, between 00:00 and 05:30 IST, is still yesterday).
    const readTime = new Date();
    const timezone = (
      await tx
        .select({ timezone: tenants.timezone })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
    )[0]?.timezone ?? "Asia/Kolkata";
    // 30 calendar days INCLUDING today starts 29 days before it, at
    // the tenant's local midnight.
    const periodStartDate = addDays(todayInZone(timezone, readTime.getTime()), -29);
    const { fromUtc: periodStart } = dayRangeUtc(periodStartDate, timezone);

    // The cohort: active, not deleted, with a known join date on or
    // before the period start. A member with no joined_on cannot be
    // shown to have been here for the whole period, so they are not in
    // the cohort at all — and their marks are not records FOR this
    // cohort.
    const cohort = and(
      eq(members.tenantId, ctx.tenantId),
      eq(members.status, "active"),
      isNull(members.deletedAt),
      sql`${members.joinedOn} is not null`,
      sql`${members.joinedOn} <= ${periodStartDate}`,
      ...(memberPredicate ? [memberPredicate] : []),
    );

    // Every active member in scope — the wider population, kept
    // because the pinned row shape carries it.
    const [{ n: totalActiveMembers }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(members)
      .where(and(
        eq(members.tenantId, ctx.tenantId),
        eq(members.status, "active"),
        isNull(members.deletedAt),
        ...(memberPredicate ? [memberPredicate] : []),
      ));

    const [{ n: eligibleMemberCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(members)
      .where(cohort);

    // A session that actually happened in the period: not cancelled,
    // started no earlier than the period's first local midnight and
    // no later than the read time. The sessions are scoped by their
    // BATCH's location (the scope the attendance report uses), so a
    // restricted caller is never told "there was history" because of
    // another site's sessions.
    const sessionInPeriod = and(
      eq(sessions.tenantId, ctx.tenantId),
      sql`${sessions.status} <> 'cancelled'`,
      gte(sessions.startsAt, periodStart),
      lte(sessions.startsAt, readTime),
    );

    const [{ n: sessionsInWindow }] = await tx
      .select({ n: sql<number>`count(distinct ${sessions.id})::int` })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(and(sessionInPeriod, ...(batchPredicate ? [batchPredicate] : [])));

    // The records: the eligible members who have at least one
    // attendance mark on a session that happened in the period. The
    // cohort predicate is applied HERE as well, so a newer member's
    // mark can never subtract from the cohort's count.
    const records = await tx
      .select({
        memberId: attendance.memberId,
        marks: sql<number>`count(*)::int`,
      })
      .from(attendance)
      .innerJoin(
        sessions,
        and(eq(sessions.id, attendance.sessionId), eq(sessions.tenantId, ctx.tenantId)),
      )
      .innerJoin(
        members,
        and(eq(members.id, attendance.memberId), eq(members.tenantId, ctx.tenantId)),
      )
      .where(and(eq(attendance.tenantId, ctx.tenantId), sessionInPeriod, cohort))
      .groupBy(attendance.memberId);

    // Without history there is nothing to count: no session ran, or
    // nobody was here for the whole period. The view says so instead
    // of counting a cohort it knows nothing about.
    const history: RetentionReport["history"] =
      sessionsInWindow > 0 && eligibleMemberCount > 0 ? "sufficient" : "insufficient";
    // Members with at least one qualifying mark. This is the
    // factual with-record count — it is NOT the legacy partial field,
    // which keeps its own one-to-three-marks band.
    const membersWithRecords = records.length;
    // The legacy partial proxy, unchanged: one to three qualifying
    // marks. Scoped to the cohort now, like the rest of the report.
    const legacyPartial = records.filter((r) => r.marks > 0 && r.marks < 4).length;
    const membersWithoutRecords =
      history === "sufficient"
        ? Math.max(0, Number(eligibleMemberCount) - membersWithRecords)
        : 0;

    return {
      row: {
        memberCountAtRisk: membersWithoutRecords,
        membersWithZeroLast30: membersWithoutRecords,
        membersWithPartialLast30: legacyPartial,
        totalActiveMembers: Number(totalActiveMembers),
      },
      eligibleMemberCount: Number(eligibleMemberCount),
      sessionsInWindow: Number(sessionsInWindow),
      history,
    };
  });
}

// The four aggregate numbers, unchanged in shape. The report action
// uses getRetentionReport (it also needs the history state); this
// stays for callers that only want the numbers.
export async function getRetentionView(ctx: ActionCtx): Promise<RetentionRow> {
  return (await getRetentionReport(ctx)).row;
}
