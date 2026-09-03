import { and, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches, programs } from "@/db/schema/programs";
import { members } from "@/db/schema/people";
import { enquiries } from "@/db/schema/enquiries";
import { todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

// Re-export coach load so the existing import path keeps working.
export { getCoachLoad, type CoachLoadRow } from "./coach-load";

// Phase 4 — owner reports. Three reads — attendance by batch,
// enquiry funnel by source, retention (aggregate-only,
// members meeting an absence signal), coach load — all share
// one service module so they can sit on the same /owner/reports
// page and share a common filter shape.
//
// 4.5 (retention) is intentionally aggregate-only. Per scope
// § 7.1 (DPDP profiling restriction), risk-scoring an
// individual minor is out of scope; we surface the aggregate
// "X members attended zero of Y recent sessions" only.
//
// All four reads run through withTenant() and respect RLS.

export type ReportPeriod = { from: string; to: string };

// 4.3 — attendance report by batch. Per C-22's upsert, an
// attendance row exists exactly once per (session, member)
// pair; "total marks" therefore equals "sessions × enrolled"
// for that batch in the period. A batch with no sessions
// returns sessionCount=0 and pct=null — the honest empty.
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
): Promise<BatchAttendanceReportRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
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
      .where(and(eq(batches.tenantId, ctx.tenantId), sql`${batches.deletedAt} is null`))
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
export type RetentionRow = {
  memberCountAtRisk: number;
  membersWithZeroLast30: number;
  membersWithPartialLast30: number;
  totalActiveMembers: number;
};

export async function getRetentionView(ctx: ActionCtx): Promise<RetentionRow> {
  return withTenant(ctx.tenantId, async (tx) => {
    // active-member denominator
    const [{ n: totalActiveMembers }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(members)
      .where(and(eq(members.tenantId, ctx.tenantId), eq(members.status, "active"), sql`${members.deletedAt} is null`));

    // distinct members with at least one attendance row in
    // the last 30 days.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const attendanceWindow = await tx
      .select({
        memberId: attendance.memberId,
        markedSessions: sql<number>`count(*)::int`,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .where(and(eq(attendance.tenantId, ctx.tenantId), gte(sessions.sessionDate, since.toISOString().slice(0, 10))))
      .groupBy(attendance.memberId);

    const withZero: string[] = [];
    const withPartial: string[] = [];
    for (const r of attendanceWindow) {
      if (r.markedSessions === 0) withZero.push(r.memberId);
      else if (r.markedSessions < 4) withPartial.push(r.memberId);
    }
    // The "at risk" headline: distinct active members who
    // appear in neither window (i.e. were active at the
    // head of the period and haven't marked at all). Privacy-
    // preserving aggregate: we count, we do not list.
    const presentIds = new Set(attendanceWindow.map((r) => r.memberId));
    const [{ n: activeIds }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(members)
      .where(and(eq(members.tenantId, ctx.tenantId), eq(members.status, "active"), sql`${members.deletedAt} is null`));
    const memberCountAtRisk = Math.max(0, Number(activeIds) - presentIds.size);

    return {
      memberCountAtRisk,
      membersWithZeroLast30: withZero.length,
      membersWithPartialLast30: withPartial.length,
      totalActiveMembers: Number(totalActiveMembers),
    };
  });
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