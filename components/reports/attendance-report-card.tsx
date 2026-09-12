import { Download } from "lucide-react";
import { attendanceReportCsvAction } from "@/lib/actions/owner-reports";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import type { BatchAttendanceReportRow, ReportPeriod } from "@/lib/services/owner-reports";

// Phase 4.3 — attendance report. CSV uses canonical field
// names (member_count, not "swimmer_count"); the UI does the
// vocabulary mapping. Owner sees the period picker + a CSV
// download button per row.

export async function AttendanceReportCard({
  rows,
  period,
}: {
  rows: BatchAttendanceReportRow[];
  period: ReportPeriod;
}) {
  // L3 audit — the report title routes the closed-key `batch`
  // singular form through resolveTerm so a football preset
  // (which renames `batch` to `squad`) reads "Attendance by
  // squad" instead of "Attendance by batch". Other report
  // surfaces below do the same.
  const terminology = await getTerminologyAction();
  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">
          Attendance by {resolveTerm(terminology, "batch", 1)}
        </h2>
        <a
          href={`/owner/reports/attendance.csv?from=${period.from}&to=${period.to}`}
          // Server-rendered download link — no client JS. min-h-44px:
          // the old py-1.5 link was ~30px tall. [automatable]
          className="rounded-ctl px-3 min-h-[44px] inline-flex items-center text-[12px] font-medium bg-deck text-ink-2 gap-1.5 hover:bg-line"
        >
          <Download size={12} /> CSV
        </a>
      </header>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No {resolveTerm(terminology, "batch", "other")} ran any {resolveTerm(terminology, "session", "other")} in this period.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.batchId} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
              <span className="min-w-0">
                <span className="font-medium">{r.batchName}</span>
                {r.programName ? <span className="text-ink-3"> · {r.programName}</span> : null}
              </span>
              <span className="flex-none text-ink-3 text-[12px]">
                {r.sessionCount} {r.sessionCount === 1 ? "session" : "sessions"} ·{" "}
                {r.pct === null ? "No attendance recorded" : `${r.pct}% present`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

// The CSV action lives here too — keeps the export adjacent
// to the surface that triggers it. The /owner/reports/attendance.csv
// route handler uses the same action.
void attendanceReportCsvAction;