import { and, eq, gte, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { enquiries } from "@/db/schema/enquiries";
import { tenants } from "@/db/schema/tenants";
import { dayRangeUtc, todayInZone } from "@/lib/time/tz";
import {
  enquiryConditions,
  enquiryScope,
} from "@/lib/services/enquiry-scope";
import type { ActionCtx } from "@/lib/auth/context";
import type { BatchAttendanceReportRow } from "./attendance-report-query";

// Re-export coach load so the existing import path keeps working.
export { getCoachLoad, type CoachLoadRow } from "./coach-load";

// Re-export the attendance report so the existing import path keeps
// working. Its query — and the attendance-eligibility rule it
// applies — lives in ./attendance-report-query.ts.
export { getAttendanceReport, type BatchAttendanceReportRow } from "./attendance-report-query";

// Phase 4 — owner reports (attendance by batch, enquiry funnel,
// retention, coach load) sharing one module and filter shape.
// Retention is aggregate-only per scope § 7.1 (DPDP profiling):
// we surface how many members have NO attendance record in the
// period, and never a per-member list.
// All reads run through withTenant() and respect RLS.

export type ReportPeriod = { from: string; to: string };

// 4.3 — attendance by batch lives in ./attendance-report-query.ts
// (the eligibility rule, the period semantics and the location
// scope are documented there). The CSV shape below is the part that
// stays with the report module.

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
    // The funnel is an enquiry read, so it resolves its visibility
    // through the ONE enquiry rule (lib/services/enquiry-scope.ts):
    // tenant, soft delete and location scope, with the unresolved
    // queue reserved for management. A restricted caller must not see
    // another site's enquiries in the funnel.
    const { predicate } = await enquiryScope(tx, ctx);
    // The period is the tenant's own calendar days (the same
    // half-open window every other report uses), not UTC days:
    // new Date('2026-10-01') is UTC midnight, which is 05:30 IST and
    // silently drops the club's first working hour of the first day.
    const [tenantRow] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const timezone = tenantRow?.timezone ?? "Asia/Kolkata";
    const { fromUtc } = dayRangeUtc(period.from, timezone);
    const { fromUtc: endUtc } = dayRangeUtc(period.to, timezone);

    const rows = await tx
      .select({
        source: enquiries.source,
        stage: enquiries.stage,
        n: sql<number>`count(*)::int`,
      })
      .from(enquiries)
      .where(
        and(
          ...enquiryConditions(ctx, predicate, [
            gte(enquiries.createdAt, fromUtc),
            lt(enquiries.createdAt, endUtc),
          ]),
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

// 4.5 — the owner's attendance-records summary lives in
// ./retention-report-query.ts (the cohort, the period and the record
// rule are documented there). The public names are re-exported here
// so every existing import path keeps working.
export {
  getRetentionReport,
  getRetentionView,
  type RetentionReport,
  type RetentionRow,
} from "./retention-report-query";

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
