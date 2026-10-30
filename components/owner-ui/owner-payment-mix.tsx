import Link from "next/link";
import { OwnerChartIsland } from "@/components/charts/owner-chart-island";
import { MiniDonut } from "@/components/owner-mini-donut";
import { ChartTable } from "@/components/owner-home-chart-parts";
import { formatINRCompact } from "@/lib/money/format";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

// Owner redesign · System lane — the approved Home payment mix.
//
// The human's approved composition (approved-preview.html, "Payment mix
// · same week") and the shared decisions:
//
//   "Home payment mix uses a donut, total in its centre, and direct
//    amounts and percentages in the legend. Same period/facility as
//    collections; real captured payment data and bigint arithmetic.
//    Cash/Digital/Other and existing method drill-downs remain
//    truthful. Never hardcode the preview fixtures in production."
//
// So:
//
//   * ONE donut, with the selected period's captured total in its
//     centre. The total is stated once, not twice.
//   * The legend carries each group's DIRECT amount AND its percentage.
//     The colour swatch repeats the meaning; the words carry it, so
//     colour is never the only cue.
//   * Digital expands into its own methods (UPI, bank transfer, card)
//     and every group and method keeps its drill-down, with the same
//     dates and the same facility the figure was computed under.
//   * The figures are the real service shape — bigint paise, captured
//     payments only. Nothing here recomputes money.
//
// The desktop draws the donut with the ECharts island and the phone
// draws the same composition as a server-rendered SVG ring, so a phone
// never downloads the chart engine (DESIGN.md §5). The legend and the
// data table are the same on both.

const SWATCH_CLASS: Record<string, string> = {
  cash: "bg-[var(--chart-1)]",
  digital: "bg-[var(--chart-2)]",
  other: "bg-[var(--chart-3)]",
};

export function OwnerPaymentMix({
  data,
  feesLink,
  className = "",
}: {
  data: OwnerChartsData;
  feesLink: ((extra: Record<string, string>) => string) | null;
  /** The grid placement of the card inside the money band. */
  className?: string;
}) {
  const { collections, period } = data;
  const hasData = collections.totalPaise > 0;
  const digital = collections.methods.filter((method) => method.group === "digital");

  return (
    <article
      data-testid="owner-payment-mix"
      className={`min-w-0 rounded-card border border-line bg-paper p-5 ${className}`}
    >
      <header>
        <h2 className="font-display text-[16px] font-semibold">Payment mix</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          {period.tabLabel} · captured payments
        </p>
      </header>

      {hasData ? (
        <>
          <p className="mt-2 text-[12px] text-ink-3">
            {collections.paymentCount} payment
            {collections.paymentCount === 1 ? "" : "s"} captured in this period
          </p>

          {/* The donut and the legend sit side by side and wrap
              deliberately on a narrow screen: the legend never forces a
              sideways scroll. */}
          <figure className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
            <div
              data-testid="owner-payment-mix-donut"
              // The APPROVED donut size (144px = w-36) and the APPROVED
              // legend minimum (160px = min-w-40) with a 20px gap: the
              // pair needs 324px. The independent review measured the
              // old 176px slot against a 180px legend minimum — 376px —
              // in a card with only ~335px of inner width at 1280px, so
              // the approved pairing always wrapped. The money band now
              // gives the mix 40% of its width, and these are the
              // board's dimensions.
              className="flex flex-none items-center justify-center sm:w-36"
            >
              <div className="hidden w-full lg:block">
                <OwnerChartIsland
                  kind="doughnut"
                  ariaLabel={`Payment mix for ${period.tabLabel}: cash, digital and other, in rupees. Digital groups UPI, bank transfer and card.`}
                  groups={collections.groups.map((group) => ({
                    key: group.key,
                    label: group.label,
                    paise: group.paise,
                  }))}
                  totalPaise={collections.totalPaise}
                />
              </div>
              <div className="lg:hidden">
                <MiniDonut
                  slices={collections.groups.map((group) => ({
                    key: group.key,
                    label: group.label,
                    paise: group.paise,
                  }))}
                  totalPaise={collections.totalPaise}
                  ariaLabel={`Payment mix for ${period.tabLabel}: cash, digital and other, in rupees.`}
                />
              </div>
            </div>

            <figcaption
              data-testid="owner-payment-mix-legend"
              className="min-w-40 flex-1"
            >
              <ul className="divide-y divide-line">
                {collections.groups.map((group) => (
                  <li key={group.key} className="py-1">
                    <div className="flex items-center gap-2.5">
                      <span
                        data-testid="owner-payment-mix-swatch"
                        aria-hidden="true"
                        className={`h-2.5 w-2.5 flex-none rounded-[3px] ${
                          SWATCH_CLASS[group.key] ?? SWATCH_CLASS.other
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          {feesLink ? (
                            <Link
                              href={feesLink({ group: group.key })}
                              className="inline-flex min-h-11 min-w-[44px] items-center px-1 text-[13px] font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline"
                            >
                              {group.label}
                            </Link>
                          ) : (
                            <span className="inline-flex min-h-11 min-w-[44px] items-center px-1 text-[13px] font-medium">
                              {group.label}
                            </span>
                          )}
                          <span className="text-[12px] text-ink-3">{group.pct}%</span>
                        </span>
                      </span>
                      <span className="flex-none text-[13px] font-medium tabular-nums">
                        {formatINRCompact(group.paise)}
                      </span>
                    </div>
                    {/* Digital expands into its own methods, and every
                        method keeps its own drill-down on the same dates
                        and facility. */}
                    {group.key === "digital" ? (
                      <ul className="space-y-0.5 pl-6">
                        {digital.map((method) => (
                          <li
                            key={method.key}
                            className="flex items-baseline justify-between gap-3"
                          >
                            {feesLink ? (
                              <Link
                                href={feesLink({ method: method.key })}
                                data-testid="owner-payment-mix-method-link"
                                className="inline-flex min-h-11 min-w-[44px] items-center px-1 text-[12px] text-ink-3 underline-offset-2 hover:underline"
                              >
                                {method.label}
                              </Link>
                            ) : (
                              <span className="inline-flex min-h-11 min-w-[44px] items-center px-1 text-[12px] text-ink-3">
                                {method.label}
                              </span>
                            )}
                            <span className="text-[12px] tabular-nums text-ink-3">
                              {formatINRCompact(method.paise)} ({method.pct}%)
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </figcaption>
          </figure>

          <p className="mt-1 text-[12px] text-ink-3">
            Digital = UPI, bank transfer and card. Other is its own category, not
            digital.
          </p>
          <p className="mt-1 text-[12px] text-ink-3">
            <span className="font-medium text-ink-2">{period.comparisonLabel}</span>{" "}
            {collections.comparison} · vs {period.previousLabel}
          </p>
          <ChartTable
            caption={`Payment mix, ${period.tabLabel} (${period.currentLabel})`}
            head={["Method", "Group", "Amount", "Payments"]}
            rows={collections.methods.map((method) => [
              method.label,
              method.group === "digital" ? "Digital" : method.group === "cash" ? "Cash" : "Other",
              formatINRCompact(method.paise),
              String(method.count),
            ])}
          />
        </>
      ) : (
        <p className="mt-3 rounded-ctl bg-deck px-3 py-4 text-[13px] text-ink-2">
          No collections in this period, so there is no mix to draw.
        </p>
      )}
    </article>
  );
}
