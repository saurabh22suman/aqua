import Link from "next/link";
import { formatINR } from "@/lib/money/format";
import { addDays, formatDateIST } from "@/lib/time/tz";
import {
  ATTENDANCE_DRILL,
  COLLECTIONS_DRILL,
  type DashboardTrendPoint,
} from "@/lib/dashboard-charts";
import type { CollectionsSeries, TrendPoint } from "@/lib/services/owner-analytics";
import { ColumnChart, LineTrend } from "@/components/charts";
import { EchartsIsland } from "@/components/charts/echarts-island";

// W1-6 continuation — the owner landing trends. Two decision charts
// maximum (attendance, collections), each with an honest empty state
// and a drill-through: desktop clicks land on the report filtered to
// the clicked day; mobile keeps the server SVG plus a full report
// link. Charts are data (water), never decoration.

export function DashboardTrends({
  attendance,
  collections,
}: {
  attendance: TrendPoint[] | null;
  collections: CollectionsSeries | null;
}) {
  if (!attendance && !collections) return null;

  return (
    <section className="mt-4" aria-label="Trends" data-testid="dashboard-trends">
      <div className="grid gap-3 lg:grid-cols-2">
        {attendance ? (
          <AttendanceTrend points={attendance} />
        ) : null}
        {collections ? <CollectionsTrend series={collections} /> : null}
      </div>
    </section>
  );
}

function AttendanceTrend({ points }: { points: TrendPoint[] }) {
  const present = points.reduce((sum, p) => sum + p.present, 0);
  const total = points.reduce((sum, p) => sum + p.total, 0);
  const pct = total > 0 ? Math.round((present / total) * 100) : null;
  const chartPoints: DashboardTrendPoint[] = points.map((p) => ({
    date: p.date,
    value: p.pct,
  }));

  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">Attendance</h2>
        <span className="text-[12px] text-ink-3 tabular-nums">
          {pct === null ? "no marks yet" : `${pct}% last 30 days`}
        </span>
      </header>
      {points.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-3">
          No sessions in the last 30 days, so there is no trend to draw.
        </p>
      ) : (
        <>
          <div className="mt-3 hidden lg:block">
            <EchartsIsland
              points={chartPoints}
              kind="line"
              format="percent"
              ariaLabel={`Attendance percentage by day, ${points.length} days. Select a day to open its report.`}
              drill={ATTENDANCE_DRILL}
            />
          </div>
          <div className="mt-3 lg:hidden">
            <LineTrend
              ariaLabel={`Attendance percentage by day, ${points.length} days`}
              maxValue={100}
              points={points.map((p) => ({
                label: p.date,
                value: p.pct,
                hint: `${formatDateIST(p.date)} (${p.present}/${p.total})`,
              }))}
            />
          </div>
          <Link
            href={ATTENDANCE_DRILL.replace("{from}", points[0]!.date).replace(
              "{to}",
              addDays(points[points.length - 1]!.date, 1),
            )}
            className="mt-2 inline-flex min-h-[44px] items-center text-[12.5px] text-[var(--accent-ink)]"
          >
            Open the full attendance report →
          </Link>
        </>
      )}
    </article>
  );
}

function CollectionsTrend({ series }: { series: CollectionsSeries }) {
  const chartPoints: DashboardTrendPoint[] = series.byDay.map((p) => ({
    date: p.date,
    value: p.paise,
  }));

  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">Collections</h2>
        <span className="text-[12px] text-ink-3 tabular-nums">
          {formatINR(series.totalPaise)} last 30 days
        </span>
      </header>
      {series.byDay.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-3">
          No payments recorded in the last 30 days — nothing collected yet.
        </p>
      ) : (
        <>
          <div className="mt-3 hidden lg:block">
            <EchartsIsland
              points={chartPoints}
              kind="bar"
              format="currency"
              ariaLabel={`Collections by day, ${series.byDay.length} days. Select a day to see its transactions.`}
              drill={COLLECTIONS_DRILL}
            />
          </div>
          <div className="mt-3 lg:hidden">
            <ColumnChart
              ariaLabel={`Collections by day, ${series.byDay.length} days`}
              valueLabel={formatINR}
              points={series.byDay.map((p) => ({
                label: p.date,
                value: p.paise,
                hint: formatDateIST(p.date),
              }))}
            />
          </div>
          <Link
            href="/owner/reports/collections"
            className="mt-2 inline-flex min-h-[44px] items-center text-[12.5px] text-[var(--accent-ink)]"
          >
            Daily collections report →
          </Link>
        </>
      )}
    </article>
  );
}
