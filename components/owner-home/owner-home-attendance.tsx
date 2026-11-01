import Link from "next/link";
import { OwnerChartIsland } from "@/components/charts/owner-chart-island";
import {
  ChartComparison,
  ChartTable,
  PanelTotal,
} from "@/components/owner-home-chart-parts";
import { MiniLine } from "@/components/owner-mini-chart";
import { addDays } from "@/lib/time/tz";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

// Owner Home — attendance.
//
// Attendance is an OPERATIONAL fact, not money, so it does not live
// inside the Money section (a collections/attendance switch inside
// Money was the defect). It has its own panel here.
//
// THE CHART IS KEPT, ONCE. Tranche 1 removed the attendance line chart
// along with the duplicates, and that removed a capability the owner
// used: the daily shape, the dated buckets, the unit on the axis and the
// gap where a register was never marked. The chart lives HERE — outside
// Money, next to the attendance summary it explains — and it appears
// exactly once on the page.
//
// Two states are never confused:
//   * NO MARKS RECORDED — unknown, never 0%. A register that has not
//     been marked is not an absent class.
//   * MARKS RECORDED — present or late over ALL marks recorded.
//
// The exact marks are always reachable in the data table, and the
// methodology (what the percentage counts) sits in a disclosure instead
// of as loose prose under every figure.

const CHART_LABEL =
  "Attendance percentage by day for the selected range. A day with no marks recorded is a gap in the line — unknown, not 0%.";

export function OwnerHomeAttendance({
  data,
  facility,
}: {
  /** The read model. null → the attendance read itself failed. */
  data: OwnerChartsData | null;
  facility: string | null;
}) {
  if (!data) {
    // The money band and the attendance panel are SEPARATE reads with
    // SEPARATE messages: a financial failure must not be reported as an
    // attendance failure, and vice versa.
    return (
      <section
        data-testid="owner-home-attendance"
        aria-label="Attendance"
        className="mt-5 rounded-card border border-line bg-paper p-5"
      >
        <h2 className="font-display text-[16px] font-semibold">Attendance</h2>
        <p className="mt-2 text-[13px] text-ink-2">
          Attendance for the selected range could not be read. Reload to try
          again.
        </p>
      </section>
    );
  }

  const { attendance, period } = data;
  const reportQuery = new URLSearchParams({
    from: period.currentFromDate,
    to: addDays(period.currentToDate, 1),
  });
  if (facility) reportQuery.set("facility", facility);
  const hasMarks = attendance.total > 0;

  return (
    <section
      data-testid="owner-home-attendance"
      aria-label="Attendance"
      className="mt-5 rounded-card border border-line bg-paper p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="font-display text-[16px] font-semibold">Attendance</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            Marks recorded in the selected range
          </p>
        </div>
        <ChartComparison
          label={period.comparisonLabel}
          text={attendance.comparison}
        />
      </header>

      <div className="mt-3">
        <PanelTotal
          amount={attendance.pct === null ? "—" : `${attendance.pct}%`}
          suffix={`${attendance.present} of ${attendance.total} marks present or late`}
        />
      </div>

      {hasMarks ? (
        <>
          {/* The desktop draws the same series with the chart engine; the
              phone draws it as a server-rendered SVG, so a phone never
              downloads the engine (DESIGN.md §5). One chart on the
              page, in two renderings. */}
          <div className="mt-2 hidden lg:block">
            <OwnerChartIsland
              kind="line"
              ariaLabel={CHART_LABEL}
              buckets={attendance.buckets.map((bucket) => ({
                label: bucket.label,
                fullLabel: bucket.fullLabel,
                pct: bucket.pct,
                present: bucket.present,
                total: bucket.total,
              }))}
            />
          </div>
          <div className="mt-2 lg:hidden">
            <MiniLine
              buckets={attendance.buckets.map((bucket) => ({
                label: bucket.label,
                fullLabel: bucket.fullLabel,
                pct: bucket.pct,
              }))}
              ariaLabel={CHART_LABEL}
            />
          </div>
          {/* The exact marks, always reachable, on every screen. */}
          <ChartTable
            caption="Attendance by day — marks present or late over marks recorded"
            head={["Bucket", "Present or late", "Marks", "Attendance"]}
            rows={attendance.buckets.map((bucket) => [
              bucket.fullLabel,
              String(bucket.present),
              String(bucket.total),
              bucket.pct === null ? "No marks recorded" : `${bucket.pct}%`,
            ])}
          />
          {/* What the percentage counts is methodology, so it lives in a
              disclosure rather than as prose under every figure. */}
          <details
            data-testid="owner-home-attendance-detail"
            className="mt-1 max-w-[52ch] rounded-ctl bg-deck px-3 py-1"
          >
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center text-[12px] text-ink-2 marker:content-none">
              How attendance is counted
            </summary>
            <p className="text-[12px] text-ink-3">
              A day with no marks recorded is unknown, not 0%. Attendance counts
              present or late marks over all marks recorded.
            </p>
          </details>
        </>
      ) : (
        <p className="mt-3 rounded-ctl bg-deck px-3 py-4 text-[13px] text-ink-2">
          No attendance marks recorded in this period — unknown, not zero. A
          register that has not been marked is not an absent class.
        </p>
      )}

      <Link
        href={`/owner/reports?${reportQuery.toString()}`}
        className="mt-2 inline-flex min-h-[44px] items-center text-[12.5px] text-[var(--accent-ink)]"
      >
        Open the attendance report →
      </Link>
    </section>
  );
}
