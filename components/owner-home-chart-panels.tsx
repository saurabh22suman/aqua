import Link from "next/link";
import { OwnerChartIsland } from "@/components/charts/owner-chart-island";
import {
  ChartComparison,
  ChartLegend,
  ChartTable,
  PanelTotal,
} from "@/components/owner-home-chart-parts";
import { MiniBars } from "@/components/owner-mini-chart";
import { formatINRCompact } from "@/lib/money/format";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

// Owner Home — the collections panel of the Money band.
//
// The panel owns the collections total and the ONE comparison of the
// band. It does not print the range: the range strip above the band is
// the single display owner of the selected range, and the exact
// instants live in its disclosure.
//
// Attendance is NOT here: it is an operational fact and it has its own
// panel (components/owner-home/owner-home-attendance.tsx).

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
  const caption = period.key === "day" ? "Collections by hour" : "Collections by day";

  return (
    <div className="mt-3 flex flex-1 flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <PanelTotal
          amount={formatINRCompact(collections.totalPaise)}
          suffix={`from ${collections.paymentCount} recorded payment${
            collections.paymentCount === 1 ? "" : "s"
          }`}
        />
        <ChartComparison
          label={period.comparisonLabel}
          text={collections.comparison}
        />
      </div>

      {hasData ? (
        <>
          <div className="hidden lg:block">
            <OwnerChartIsland
              kind="stacked"
              ariaLabel="Collections by payment group, in rupees. Cash, digital and other are stacked per bucket."
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
              ariaLabel="Collections by payment group, in rupees. Cash, digital and other are stacked per bucket."
            />
          </div>
          {/* The phone legend. Above lg the ECharts canvas draws its
              own legend, painted from the same chart tokens. */}
          <ChartLegend className="lg:hidden" />
          <ChartTable
            caption={caption}
            mobile
            head={["Bucket", "Cash", "Digital", "Other", "Total"]}
            rows={rows}
            total={total}
          />
          <ChartTable
            caption={caption}
            head={["Bucket", "Cash", "Digital", "Other", "Total"]}
            rows={rows}
            total={total}
          />
        </>
      ) : (
        <p className="mt-3 rounded-ctl bg-deck px-3 py-4 text-[13px] text-ink-2">
          No payments recorded in this period. Reversals and receipts are not
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
          className="mt-auto inline-flex min-h-[44px] items-center pt-1 text-[12.5px] text-[var(--accent-ink)]"
        >
          Open the transactions for this period →
        </Link>
      ) : null}
    </div>
  );
}
