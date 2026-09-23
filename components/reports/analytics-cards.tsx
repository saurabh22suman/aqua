import { formatINR } from "@/lib/money/format";
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
  type DonutSlice,
} from "@/components/charts";

// U-01 — the four analytics cards on /owner/reports. Each states what
// it can honestly say: real data when it exists, a named empty state
// when it does not. No placeholder numbers, ever.

export function AttendanceTrendCard({ points }: { points: TrendPoint[] }) {
  const present = points.reduce((sum, p) => sum + p.present, 0);
  const total = points.reduce((sum, p) => sum + p.total, 0);
  const pct = total > 0 ? Math.round((present / total) * 100) : null;

  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">
          Attendance trend
        </h2>
        {pct !== null ? (
          <span className="text-[12px] text-ink-3 tabular-nums">
            {pct}% present
          </span>
        ) : null}
      </header>
      {points.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No sessions in this period, so there is no trend to draw.
        </p>
      ) : (
        <>
          <div className="mt-3">
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
          <p className="mt-1 text-[12px] text-ink-3">
            Present or late marks over marks recorded · {present} of {total}
          </p>
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
        <h2 className="font-display text-[15px] font-semibold">
          Collections vs expenses
        </h2>
        <span className="text-[12px] text-ink-3 tabular-nums">
          {formatINR(series.totalPaise)}
        </span>
      </header>
      {series.byDay.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No payments recorded in this period — nothing collected, nothing to
          compare.
        </p>
      ) : (
        <div className="mt-3">
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
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-water" />
          Collections
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-deck border border-line" />
          Expenses — not recorded in Aqua yet
        </li>
      </ul>
      {series.expensesPaise === null ? (
        <p className="mt-2 text-[12px] text-ink-3">
          Expense tracking is Phase 5, so only the real collections series is
          drawn. There is no target in the schema, so no target arc either.
        </p>
      ) : null}
    </article>
  );
}

export function PlanRevenueCard({ rows }: { rows: PlanRevenueRow[] }) {
  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">
          Revenue by plan
        </h2>
        <span className="text-[12px] text-ink-3">{rows.length} plans</span>
      </header>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No payments linked to a plan in this period.
        </p>
      ) : (
        <div className="mt-3">
          <HorizontalBars
            ariaLabel="Collections by membership plan"
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
  const donutSlices: DonutSlice[] = slices
    .filter((s) => s.count > 0)
    .map((s) => ({
      label:
        MEMBER_STATUS_LABELS[s.status as keyof typeof MEMBER_STATUS_LABELS] ??
        s.status,
      value: s.count,
      tone: MIX_TONES[s.status] ?? "stroke-ink-3",
    }));

  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">
          {memberLabel} mix
        </h2>
        <span className="text-[12px] text-ink-3 tabular-nums">{total}</span>
      </header>
      {total === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No {memberLabel.toLowerCase()} records yet.
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
