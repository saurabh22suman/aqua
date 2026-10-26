import Link from "next/link";
import { OwnerChartIsland } from "@/components/charts/owner-chart-island";
import { ChartTable, PanelFigure } from "@/components/owner-home-chart-parts";
import { MiniDonut } from "@/components/owner-mini-donut";
import { formatINRCompact } from "@/lib/money/format";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

// Owner Home — the payment-mix panel.
//
// The composition of captured payments for the selected period: the
// total, the ring (desktop: the ECharts island; phone: the server-
// rendered SVG ring) and the HTML legend that expands Digital into
// UPI / bank transfer / card. Every category links to the transactions
// it was computed from, with the same dates and facility scope.

export function PaymentMixPanel({
  data,
  feesLink,
}: {
  data: OwnerChartsData;
  feesLink: ((extra: Record<string, string>) => string) | null;
}) {
  const { collections, period } = data;
  const hasData = collections.totalPaise > 0;
  const digital = collections.methods.filter((method) => method.group === "digital");

  return (
    <article className="min-w-0 rounded-card border border-line bg-paper p-4">
      <header>
        <h2 className="font-display text-[15px] font-semibold">Payment mix</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          {period.tabLabel} · captured payments
        </p>
      </header>

      {hasData ? (
        <>
          <PanelFigure amount={formatINRCompact(collections.totalPaise)} />
          <p className="text-[12px] text-ink-3">
            {collections.paymentCount} payment{collections.paymentCount === 1 ? "" : "s"}{" "}
            captured in this period
          </p>
          <div className="hidden lg:block">
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
          <div className="mt-2 lg:hidden">
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
          <ul className="mt-2 divide-y divide-line">
            {collections.groups.map((group) => (
              <li key={group.key} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  {feesLink ? (
                    <Link
                      href={feesLink({ group: group.key })}
                      className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-water"
                    >
                      {group.label}
                    </Link>
                  ) : (
                    <span className="text-[13px] font-medium">{group.label}</span>
                  )}
                  <span className="text-[12.5px] tabular-nums text-ink-2">
                    {formatINRCompact(group.paise)}{" "}
                    <span className="text-ink-3">({group.pct}%)</span>
                  </span>
                </div>
                {group.key === "digital" ? (
                  <ul className="mt-1 space-y-0.5">
                    {digital.map((method) => (
                      <li key={method.key} className="flex items-baseline justify-between gap-3">
                        {feesLink ? (
                          <Link
                            href={feesLink({ method: method.key })}
                            className="text-[12px] text-ink-3 underline-offset-2 hover:underline"
                          >
                            {method.label}
                          </Link>
                        ) : (
                          <span className="text-[12px] text-ink-3">{method.label}</span>
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
