import Link from "next/link";
import { OwnerChartIsland } from "@/components/charts/owner-chart-island";
import {
  ChartComparison,
  ChartLegend,
  ChartTable,
  PanelTotal,
} from "@/components/owner-home-chart-parts";
import { MiniBars, MiniLine } from "@/components/owner-mini-chart";
import { formatINRCompact } from "@/lib/money/format";
import { addDays } from "@/lib/time/tz";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

// Owner Home — the wide trend panel: Collections or Attendance for the
// selected period, one metric at a time.
//
// The desktop draws it with the ECharts island; below `lg` the same
// numbers are drawn as a server-rendered SVG (components/owner-mini-
// chart.tsx), and the data table stays beside both.

// Owner Home chart band — the two panels of the band:
//   * a wide Collections / Attendance panel (one metric at a time, URL
//     state), with the period control and the DoD/WoW/MoM comparison;
//   * a smaller payment-mix doughnut for the selected period.
// Each panel carries a real table (always reachable, on every screen)
// so the same numbers are readable with no JavaScript and from a
// keyboard.
//
// Batch 4 (26 October 2026) — three visible fixes:
//   * the selected period wears the PRESET ACCENT (`--accent-strong`),
//     not the structural `marine` colour, so the control belongs to
//     the theme in both presets (it used to stay teal in Lavender);
//   * the month history is a labelled, one-click destination: the
//     owner's day starts at zero on a quiet morning, and the month's
//     figures were only one small pill away;
//   * a phone gets a chart as well as a table: the ECharts island is
//     `lg+` only, so below `lg` these panels now carry a server-rendered
//     SVG of the same numbers (components/owner-mini-chart.tsx).

export function CollectionsPanel({
  data,
  feesLink,
}: {
  data: OwnerChartsData;
  feesLink: ((extra: Record<string, string>) => string) | null;
}) {
  const { collections, period } = data;
  const hasData = collections.totalPaise > 0;
  const bars = collections.buckets.map((bucket) => ({
    label: bucket.label,
    fullLabel: bucket.fullLabel,
    cash: bucket.cash,
    digital: bucket.digital,
    other: bucket.other,
    total: bucket.totalPaise,
  }));
  const rows = collections.buckets.map((bucket) => [
    bucket.fullLabel,
    formatINRCompact(bucket.cash),
    formatINRCompact(bucket.digital),
    formatINRCompact(bucket.other),
    formatINRCompact(bucket.totalPaise),
  ]);
  const total = ["Total", formatINRCompact(collections.totalPaise), "", "", ""];

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <PanelTotal
          amount={formatINRCompact(collections.totalPaise)}
          suffix={`from ${collections.paymentCount} payment${
            collections.paymentCount === 1 ? "" : "s"
          }`}
        />
        <ChartComparison
          label={period.comparisonLabel}
          meaning={period.comparisonMeaning}
          text={collections.comparison}
          previousLabel={period.previousLabel}
          capNote={period.capNote}
        />
      </div>

      {hasData ? (
        <>
          <div className="hidden lg:block">
            <OwnerChartIsland
              kind="stacked"
              ariaLabel={`Collections by payment group for ${period.tabLabel}, ${period.currentLabel}, in rupees. Cash, digital and other are stacked per bucket.`}
              buckets={collections.buckets.map((bucket) => ({
                label: bucket.label,
                fullLabel: bucket.fullLabel,
                cash: bucket.cash,
                digital: bucket.digital,
                other: bucket.other,
                total: bucket.totalPaise,
              }))}
            />
          </div>
          {/* The phone chart: the same numbers, server-rendered, with
              no chart engine on a mobile route (DESIGN.md §5). */}
          <div className="mt-2 lg:hidden">
            <MiniBars
              buckets={bars}
              ariaLabel={`Collections by payment group for ${period.tabLabel}, ${period.currentLabel}, in rupees. Cash, digital and other are stacked per bucket.`}
            />
          </div>
          <ChartLegend />
          <ChartTable
            caption={`Collections, ${period.tabLabel} (${period.currentLabel})`}
            mobile
            head={["Bucket", "Cash", "Digital", "Other", "Total"]}
            rows={rows}
            total={total}
          />
          <ChartTable
            caption={`Collections, ${period.tabLabel} (${period.currentLabel})`}
            head={["Bucket", "Cash", "Digital", "Other", "Total"]}
            rows={rows}
            total={total}
          />
        </>
      ) : (
        <p className="mt-3 rounded-ctl bg-deck px-3 py-4 text-[13px] text-ink-2">
          No payments captured in this period. Reversals and receipts are not
          collections.
        </p>
      )}

      {collections.reversalCount > 0 ? (
        <p className="mt-2 text-[12px] text-ink-3">
          {collections.reversalCount} reversal
          {collections.reversalCount === 1 ? "" : "s"} (
          {formatINRCompact(collections.reversedPaise)}) recorded in this period are
          ledger-only and not netted into the figures above.
        </p>
      ) : null}
      {feesLink ? (
        <Link
          href={feesLink({})}
          className="mt-1 inline-flex min-h-[44px] items-center text-[12.5px] text-[var(--accent-ink)]"
        >
          Open the transactions for this period →
        </Link>
      ) : null}
    </div>
  );
}

export function AttendancePanel({
  data,
  facility,
}: {
  data: OwnerChartsData;
  facility: string | null;
}) {
  const { attendance, period } = data;
  const hasMarks = attendance.total > 0;
  const reportQuery = new URLSearchParams({
    from: data.period.currentFromDate,
    to: addDays(data.period.currentToDate, 1),
  });
  if (facility) reportQuery.set("facility", facility);
  const line = attendance.buckets.map((bucket) => ({
    label: bucket.label,
    fullLabel: bucket.fullLabel,
    pct: bucket.pct,
  }));

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <PanelTotal
          amount={attendance.pct === null ? "—" : `${attendance.pct}%`}
          suffix={`present or late · ${attendance.present} of ${attendance.total} marks`}
        />
        <ChartComparison
          label={period.comparisonLabel}
          meaning={period.comparisonMeaning}
          text={attendance.comparison}
          previousLabel={period.previousLabel}
          capNote={period.capNote}
        />
      </div>

      {hasMarks ? (
        <>
          <div className="hidden lg:block">
            <OwnerChartIsland
              kind="line"
              ariaLabel={`Attendance percentage for ${period.tabLabel}, ${period.currentLabel}. Buckets without marks have no line point — unknown, not zero.`}
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
              buckets={line}
              ariaLabel={`Attendance percentage for ${period.tabLabel}, ${period.currentLabel}. A gap means no marks recorded — unknown, not 0%.`}
            />
          </div>
          {[true, false].map((mobile) => (
            <ChartTable
              key={String(mobile)}
              caption={`Attendance, ${period.tabLabel} (${period.currentLabel})`}
              mobile={mobile}
              head={["Bucket", "Present or late", "Marks", "Attendance"]}
              rows={attendance.buckets.map((bucket) => [
                bucket.fullLabel,
                String(bucket.present),
                String(bucket.total),
                bucket.pct === null ? "No marks recorded" : `${bucket.pct}%`,
              ])}
            />
          ))}
          <p className="mt-2 text-[12px] text-ink-3">
            A bucket with no marks is unknown, not 0%. Attendance counts present
            or late marks over all marks recorded.
          </p>
        </>
      ) : (
        <p className="mt-3 rounded-ctl bg-deck px-3 py-4 text-[13px] text-ink-2">
          No attendance marks recorded in this period — unknown, not zero. A
          register that has not been marked is not an absent class.
        </p>
      )}
      <Link
        href={`/owner/reports?${reportQuery.toString()}`}
        className="mt-1 inline-flex min-h-[44px] items-center text-[12.5px] text-[var(--accent-ink)]"
      >
        Open the attendance report →
      </Link>
    </div>
  );
}
