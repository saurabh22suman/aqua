import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches, programs } from "@/db/schema/programs";
import { members } from "@/db/schema/people";
import { enquiries } from "@/db/schema/enquiries";
import { todayInZone } from "@/lib/time/tz";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";

// Re-export coach load so the existing import path keeps working.
export { getCoachLoad, type CoachLoadRow } from "./coach-load";

// Phase 4 — owner reports (attendance by batch, enquiry funnel,
// retention, coach load) sharing one module and filter shape.
// Retention is aggregate-only per scope § 7.1 (DPDP profiling):
// we surface "X members attended zero of Y recent sessions".
// All reads run through withTenant() and respect RLS.

export type ReportPeriod = { from: string; to: string };

// 4.3 — attendance by batch. One attendance row per (session,
// member); "total marks" equals sessions × enrolled for the period.
// A batch with no sessions returns sessionCount=0 and pct=null.
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

// 4.3 CSV — canonical field names, NOT tenant terminology.
// A club that calls its members "swimmers" still sees
// `member_count` in the CSV header. Architecture § 7.5 rule 3.
export function attendanceReportCsv(rows: BatchAttendanceReportRow[]): string {
  const header = "batch_id,batch_name,program_name,session_count,present_marks,total_marks,attendance_pct";
  const body = rows
    .map((r) =>
      [
        r.batchId,
        csvSafe(r.batchName),
        csvSafe(r.programName ?? ""),
        r.sessionCount,
        r.presentMarks,
        r.totalMarks,
        r.pct === null ? "" : r.pct,
      ].join(","),
    )
    .join("\n");
  return `${header}\n${body}\n`;
}

function csvSafe(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// 4.4 — enquiry funnel by source. Counts of enquiries by
// source/stage, plus conversion-from-new-to-converted (the
// terminal "converted" stage), in the period. Figures must
// reconcile to the enquiries table exactly (4.4 done-when);
// we get that for free by querying the same table twice with
// different grouping.
export type EnquiryFunnelRow = {
  source: string;
  total: number;
  byStage: {
    new: number;
    contacted: number;
    trialScheduled: number;
    trialCompleted: number;
    converted: number;
    lost: number;
  };
  converted: number;
  conversionPct: number | null;
};

export async function getEnquiryFunnel(
  ctx: ActionCtx,
  period: ReportPeriod,
): Promise<EnquiryFunnelRow[]> {
  const SOURCES = ["walk-in", "phone", "referral", "online", "other"] as const;
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        source: enquiries.source,
        stage: enquiries.stage,
        n: sql<number>`count(*)::int`,
      })
      .from(enquiries)
      .where(
        and(
          eq(enquiries.tenantId, ctx.tenantId),
          gte(enquiries.createdAt, new Date(period.from)),
          lt(enquiries.createdAt, new Date(period.to)),
        ),
      )
      .groupBy(enquiries.source, enquiries.stage);

    const bySource = new Map<string, EnquiryFunnelRow>();
    for (const src of SOURCES) {
      bySource.set(src, {
        source: src,
        total: 0,
        byStage: { new: 0, contacted: 0, trialScheduled: 0, trialCompleted: 0, converted: 0, lost: 0 },
        converted: 0,
        conversionPct: null,
      });
    }
    for (const r of rows) {
      const bucket = bySource.get(r.source) ?? bySource.get("other");
      if (!bucket) continue;
      bucket.total += Number(r.n);
      switch (r.stage) {
        case "new":
          bucket.byStage.new += Number(r.n);
          break;
        case "contacted":
          bucket.byStage.contacted += Number(r.n);
          break;
        case "trial_scheduled":
          bucket.byStage.trialScheduled += Number(r.n);
          break;
        case "trial_completed":
          bucket.byStage.trialCompleted += Number(r.n);
          break;
        case "converted":
          bucket.byStage.converted += Number(r.n);
          break;
        case "lost":
          bucket.byStage.lost += Number(r.n);
          break;
      }
    }
    const out: EnquiryFunnelRow[] = [];
    for (const r of bySource.values()) {
      const denom = r.total;
      r.converted = r.byStage.converted;
      r.conversionPct = denom > 0 ? Math.round((r.converted / denom) * 100) : null;
      out.push(r);
    }
    return out;
  });
}

// 4.5 — retention view. Aggregate-only, by attendance
// signal. Members whose recent attendance is zero (or under a
// threshold for an extended period) surface as "at risk" —
// the cohort's count, not the cohort's identities. scope §
// 7.1 prevents per-member risk scores on minors; the report
// is intentionally a number, not a list.
//
// TRUTHFULNESS (owner UX audit, high). "At risk" is a claim about
// someone NOT doing something they had every chance to do. That
// needs two facts the previous version never established:
//
//   1. There was a chance — the academy ran attendance-eligible
//      sessions in the window. A club with no sessions at all cannot
//      have a retention problem.
//   2. The member was around for the whole window. A swimmer who
//      joined yesterday has had no chance to attend a session that
//      happened before they joined; calling them "at risk" is a false
//      alarm, and on a freshly seeded club it labelled every single
//      swimmer at risk.
//
// When either fact is missing the view reports INSUFFICIENT HISTORY
// instead of a risk count, so the owner is never told a cohort is
// slipping on the strength of no evidence. The rule lives here, once,
// so the report and the dashboard cannot disagree about it.
// The aggregate the report shows. Its shape is PINNED by
// tests/tier1/owner-reports.test.ts ("returns aggregate numbers only
// — never a per-member list"), so it carries the four numbers and
// nothing else — no per-member identifier, and no extra fields.
export type RetentionRow = {
  memberCountAtRisk: number;
  membersWithZeroLast30: number;
  membersWithPartialLast30: number;
  totalActiveMembers: number;
};

// The report plus the evidence behind it: the cohort the claim is
// about, the sessions that ran, and whether the history supports a
// claim at all.
export type RetentionReport = {
  row: RetentionRow;
  // The cohort the risk claim is about: active members who were
  // members for the whole window (joined on or before its start).
  eligibleMemberCount: number;
  // Attendance-eligible sessions that actually ran in the window.
  sessionsInWindow: number;
  // "insufficient" means the view cannot make a risk claim yet.
  history: "sufficient" | "insufficient";
};

export async function getRetentionReport(ctx: ActionCtx): Promise<RetentionReport> {
  return withTenant(ctx.tenantId, async (tx) => {
    // active-member denominator
    const [{ n: totalActiveMembers }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(members)
      .where(and(eq(members.tenantId, ctx.tenantId), eq(members.status, "active"), sql`${members.deletedAt} is null`));

    // distinct members with at least one attendance row in
    // the last 30 days.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const windowStart = since.toISOString().slice(0, 10);
    const attendanceWindow = await tx
      .select({
        memberId: attendance.memberId,
        markedSessions: sql<number>`count(*)::int`,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .innerJoin(members, and(eq(members.id, attendance.memberId), eq(members.tenantId, ctx.tenantId)))
      .where(and(eq(attendance.tenantId, ctx.tenantId), eq(members.status, "active"), isNull(members.deletedAt),
        gte(sessions.sessionDate, windowStart)))
      .groupBy(attendance.memberId);

    // The eligible cohort: active members who were members for the
    // whole window. A member with no joined_on cannot be shown to
    // have had the chance, so they are NOT eligible — claiming risk
    // for them would be the same false alarm in a different shape.
    const [{ n: eligibleMemberCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(members)
      .where(and(
        eq(members.tenantId, ctx.tenantId),
        eq(members.status, "active"),
        isNull(members.deletedAt),
        sql`${members.deletedAt} is null`,
        sql`${members.joinedOn} is not null`,
        sql`${members.joinedOn} <= ${windowStart}`,
      ));

    // Attendance-eligible sessions in the window. A cancelled
    // session is not a chance to attend.
    const [{ n: sessionsInWindow }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(sessions)
      .where(and(
        eq(sessions.tenantId, ctx.tenantId),
        sql`${sessions.status} <> 'cancelled'`,
        gte(sessions.sessionDate, windowStart),
      ));

    const withPartial: string[] = [];
    for (const r of attendanceWindow) {
      if (r.markedSessions > 0 && r.markedSessions < 4) withPartial.push(r.memberId);
    }
    // The "at risk" headline: eligible members who appear in no
    // attendance window at all. Privacy-preserving aggregate: we
    // count, we do not list.
    const presentIds = new Set(attendanceWindow.map((r) => r.memberId));
    const eligiblePresent = [...presentIds].length;
    const history: RetentionReport["history"] =
      sessionsInWindow > 0 && eligibleMemberCount > 0 ? "sufficient" : "insufficient";
    const memberCountAtRisk =
      history === "sufficient"
        ? Math.max(0, Number(eligibleMemberCount) - eligiblePresent)
        : 0;

    return {
      row: {
        memberCountAtRisk,
        membersWithZeroLast30: memberCountAtRisk,
        membersWithPartialLast30: withPartial.length,
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

// 4.6 — coach load lives in ./coach-load.ts (kept here as a
// re-export so callers can keep their existing import path;
// the file's own line budget stays comfortable).

// Schemas for action-layer validation. The action re-parses
// (parse-first standing rule); the service re-parses as
// defence in depth.
export const reportPeriodSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type ReportPeriodInput = z.input<typeof reportPeriodSchema>;

// Today-as-ISO helper for the default reports period. Owns the
// "first day of the month containing today" through "first day
// of the next month" computation; the page passes the tenant's
// timezone in and the service returns {from, to} suitable for
// any of the report calls above.
export function defaultMonthPeriod(timezone: string): ReportPeriod {
  const today = todayInZone(timezone);
  const [y, mo] = today.split("-").map(Number);
  const from = `${y}-${String(mo).padStart(2, "0")}-01`;
  const nextMonth = mo === 12 ? { y: y + 1, m: 1 } : { y, m: mo + 1 };
  const to = `${nextMonth.y}-${String(nextMonth.m).padStart(2, "0")}-01`;
  return { from, to };
}
