import { formatINR, formatINRCompact } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import { MEMBER_STATUS_LABELS } from "@/lib/member-status-graph";
import type {
  CollectionsSeries,
  MemberMixSlice,
  PlanRevenueRow,
  TrendPoint,
} from "@/lib/services/owner-analytics";
import {
  ColumnChart,
  Donut,
  HorizontalBars,
  LineTrend,
  ReportDataTable,
  type DonutSlice,
} from "@/components/charts";

// U-01 — the four analytics cards on /owner/reports. Each states what
// it can honestly say: real data when it exists, a named empty state
// when it does not. No placeholder numbers, ever.

export function AttendanceTrendCard({ points }: { points: TrendPoint[] }) {
  const present = points.reduce((sum, p) => sum + p.present, 0);
  const total = points.reduce((sum, p) => sum + p.total, 0);
  const pct = total > 0 ? Math.round((present / total) * 100) : null;
  // A session with no mark is unknown, not zero. When the whole period
  // is unrecorded there is nothing to plot, so the card says so
  // instead of drawing an empty frame (DESIGN.md, "Never draw an empty
  // chart frame").
  const hasMarks = points.some((p) => p.total > 0);
  const first = points[0]!;
  const last = points[points.length - 1]!;

  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[16px] font-semibold">
          Attendance trend
        </h2>
        {pct !== null ? (
          <span className="text-[12px] text-ink-3 tabular-nums">
            {pct}% present or late
          </span>
        ) : null}
      </header>
      {points.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No sessions in this period, so there is no trend to draw.
        </p>
      ) : !hasMarks ? (
        <p className="mt-2 text-[13px] text-ink-3">
          Sessions ran in this period, but no attendance mark was recorded.
          Attendance here is unknown, not zero.
        </p>
      ) : (
        <>
          <div className="mt-3">
            <LineTrend
              ariaLabel={`Attendance percentage by day, ${points.length} days`}
              maxValue={100}
              formatValue={(value) => `${value}%`}
              valueTitle="Percent present or late"
              timeTitle="Date"
              points={points.map((p) => ({
                label: p.date,
                value: p.pct,
                hint: `${formatDateIST(p.date)} (${p.present}/${p.total})`,
              }))}
            />
          </div>
          <p className="mt-1 text-[12px] text-ink-3">
            {formatDateIST(first.date)} – {formatDateIST(last.date)} · Present
            or late marks over marks recorded · {present} of {total}
          </p>
          <ReportDataTable
            summaryLabel="View data table"
            regionLabel="Attendance by day table"
            caption="Exact recorded attendance for each day"
            columns={[
              { label: "Date" },
              { label: "Present or late", numeric: true },
              { label: "Recorded marks", numeric: true },
              { label: "Attendance", numeric: true },
            ]}
            rows={points.map((point) => [
              formatDateIST(point.date),
              String(point.present),
              String(point.total),
              point.pct === null ? "—" : `${point.pct}%`,
            ])}
          />
        </>
      )}
    </article>
  );
}

export function CollectionsExpensesCard({
  series,
}: {
  series: CollectionsSeries;
}) {
  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[16px] font-semibold">Collections over time</h2>
        <span className="text-[12px] text-ink-3 tabular-nums">
          {formatINR(series.totalPaise)}
        </span>
      </header>
      {series.byDay.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No payments recorded in this period — nothing collected yet.
        </p>
      ) : (
        <>
        <div className="mt-3">
          <ColumnChart
            ariaLabel={`Collections by day, ${series.byDay.length} days`}
            valueLabel={formatINR}
            axisValueLabel={formatINRCompact}
            valueTitle="INR collected"
            timeTitle="Date"
            points={series.byDay.map((p) => ({
              label: p.date,
              value: p.paise,
              hint: formatDateIST(p.date),
            }))}
          />
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          {formatDateIST(series.byDay[0]!.date)} –{" "}
          {formatDateIST(series.byDay[series.byDay.length - 1]!.date)} · INR per
          day. Each bar is that day&apos;s recorded collections.
        </p>
        <ReportDataTable
          summaryLabel="View data table"
          regionLabel="Collections by day table"
          caption="Exact recorded collections for each day"
          columns={[{ label: "Date" }, { label: "Collected", numeric: true }]}
          rows={series.byDay.map((point) => [
            formatDateIST(point.date),
            formatINR(point.paise),
          ])}
        />
        </>
      )}
      <p className="mt-2 text-[12px] text-ink-3">
        Expenses are not tracked in Aqua yet, so this chart shows collections
        only — there is no comparison series or target.
      </p>
    </article>
  );
}

export function PlanRevenueCard({ rows }: { rows: PlanRevenueRow[] }) {
  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[16px] font-semibold">
          Revenue by plan
        </h2>
        {/* Owner UX audit (2026-10-24): "0 plans" in the header read as
            "no plans are configured", which is a different claim. The
            count only appears when there IS something to count, and the
            empty state says what the report actually measures. */}
        {rows.length > 0 ? (
          <span className="text-[12px] text-ink-3">{rows.length} plans</span>
        ) : null}
      </header>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No plan-linked collections in this period.
        </p>
      ) : (
        <div className="mt-3">
          <HorizontalBars
            ariaLabel="Collections by membership plan"
            valueLabel={formatINR}
            rows={rows.map((r) => ({
              label: r.planName,
              value: r.paise,
              hint: `${formatINR(r.paise)} across ${r.paymentCount} payment${
                r.paymentCount === 1 ? "" : "s"
              }`,
            }))}
          />
        </div>
      )}
    </article>
  );
}

const MIX_TONES: Record<string, string> = {
  trial: "stroke-water",
  active: "stroke-good",
  paused: "stroke-warn",
  lapsed: "stroke-late",
  left: "stroke-ink-3",
};

const MIX_DOT_TONES: Record<string, string> = {
  trial: "bg-water",
  active: "bg-good",
  paused: "bg-warn",
  lapsed: "bg-late",
  left: "bg-ink-3",
};

export function MemberMixCard({
  slices,
  memberLabel,
}: {
  slices: MemberMixSlice[];
  memberLabel: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  const present = slices.filter((s) => s.count > 0);
  const donutSlices: DonutSlice[] = present.map((s) => ({
    label:
      MEMBER_STATUS_LABELS[s.status as keyof typeof MEMBER_STATUS_LABELS] ??
      s.status,
    value: s.count,
    tone: MIX_TONES[s.status] ?? "stroke-ink-3",
  }));

  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[16px] font-semibold">
          {memberLabel} mix
        </h2>
        <span className="text-[12px] text-ink-3 tabular-nums">{total}</span>
      </header>
      {total === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No {memberLabel.toLowerCase()} records yet.
        </p>
      ) : present.length === 1 ? (
        // Owner UX audit (2026-10-24): a donut with one slice is a
        // chart of nothing. One category reads better as a sentence.
        <p className="mt-2 text-[13px]">
          All {total} {memberLabel.toLowerCase()} are{" "}
          {(MEMBER_STATUS_LABELS[present[0]!.status as keyof typeof MEMBER_STATUS_LABELS] ??
            present[0]!.status).toLowerCase()}
          .
        </p>
      ) : (
        <div className="mt-3 flex items-center gap-4">
          <Donut ariaLabel={`${memberLabel} mix by status`} slices={donutSlices} />
          <ul className="min-w-0 flex-1 space-y-1 text-[13px]">
            {slices.map((s) => (
              <li key={s.status} className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      MIX_DOT_TONES[s.status] ?? "bg-ink-3"
                    }`}
                  />
                  {MEMBER_STATUS_LABELS[
                    s.status as keyof typeof MEMBER_STATUS_LABELS
                  ] ?? s.status}
                </span>
                <span className="tabular-nums text-ink-3">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
