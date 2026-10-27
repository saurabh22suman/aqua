import Link from "next/link";
import { AttendancePanel, CollectionsPanel } from "@/components/owner-home-chart-panels";
import { OwnerPaymentMix } from "@/components/owner-ui/owner-payment-mix";
import { addDays, formatDateIST } from "@/lib/time/tz";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { ChartMetric } from "@/lib/services/owner-home-charts";

// Owner Home chart band — the composition: two panels, one period.
//
//   * a wide Collections / Attendance panel (one metric at a time, URL
//     state), with the DoD/WoW/MoM comparison;
//   * a smaller payment-mix doughnut for the selected period.
//
// The panels themselves live in components/owner-home-chart-panels.tsx;
// the shared comparison block, table and legend in
// components/owner-home-chart-parts.tsx.
//
// Batch 4 (26 October 2026) — three visible fixes:
//   * the selected period wears the PRESET ACCENT (`--accent-strong`),
//     not the structural `marine` colour, so the control belongs to
//     the theme in both presets (it used to stay teal in Lavender);
//   * the month history is a labelled, one-click destination: the
//     owner's day starts at zero on a quiet morning, and the month's
//     figures were only one small pill away;
//   * a phone gets a chart as well as a table: the ECharts island is
//     `lg+` only, so below `lg` the panels carry a server-rendered SVG
//     of the same numbers (components/owner-mini-chart.tsx).
//
// Owner Lavender B (27 October 2026) — the band is now "Money at a
// glance" and the Day / Week / Month control sits ABOVE both panels,
// so the collections panel and the payment mix always describe the
// same period. The control keeps the metric and the facility scope in
// the URL, so a period change never widens what the owner may read.

const METRIC_LABEL: Record<ChartMetric, string> = {
  collections: "Collections",
  attendance: "Attendance",
};

const PERIOD_LABEL = { day: "Day", week: "Week", month: "Month" } as const;

export function OwnerHomeCharts({
  data,
  metric,
  facility,
  canReadFees,
  today = null,
}: {
  data: OwnerChartsData | null;
  metric: ChartMetric;
  facility: string | null;
  canReadFees: boolean;
  // The tenant's local today (ISO date). It is used ONLY to label the
  // month range in the history link — the figures themselves come from
  // the service.
  today?: string | null;
}) {
  if (!data) {
    return (
      <section
        data-testid="owner-home-money"
        className="mt-5 rounded-card border border-line bg-paper px-4 py-4"
      >
        <p className="text-[13.5px] font-medium">Charts are unavailable right now</p>
        <p className="mt-1 text-[12.5px] text-ink-3">
          The figures above are unchanged; reload to try the charts again.
        </p>
      </section>
    );
  }

  const scope = (extra: Record<string, string>) => {
    const query = new URLSearchParams({ ...extra });
    if (facility) query.set("facility", facility);
    return `/owner?${query.toString()}`;
  };
  const feesLink = (extra: Record<string, string>) => {
    const query = new URLSearchParams({
      tab: "transactions",
      from: data.period.currentFromDate,
      to: addDays(data.period.currentToDate, 1),
      ...extra,
    });
    if (facility) query.set("facility", facility);
    return `/owner/fees?${query.toString()}`;
  };

  return (
    <section
      data-testid="owner-home-money"
      className="mt-5"
      aria-label="Money at a glance"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-semibold">Money at a glance</h2>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Collections and how members paid
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
            Period
          </span>
          <Segmented
            label="Period"
            items={(["day", "week", "month"] as const).map((key) => ({
              key,
              label: PERIOD_LABEL[key],
              href: scope({ trend: metric, period: key }),
              active: data.period.key === key,
            }))}
          />
        </div>
      </div>

      {/* The money band. The split is 60/40 (3 of 5 columns), the ratio
          the approved composition shows: the payment mix needs room for
          the donut AND its legend side by side. At the earlier 2/3-1/3
          split the mix card had roughly 270px of inner width at 1280px,
          and the approved pairing could not fit — it always wrapped. */}
      <div
        data-testid="owner-home-money-band"
        className="grid gap-3 lg:grid-cols-5 lg:items-start"
      >
        <article
          data-testid="owner-home-money-trends"
          className="min-w-0 rounded-card border border-line bg-paper p-4 lg:col-span-3"
        >
          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h3 className="font-display text-[15px] font-semibold">Trends</h3>
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                {METRIC_LABEL[metric]} · {data.period.tabLabel} ·{" "}
                {data.period.currentLabel} (Asia/Kolkata)
              </p>
              <HistoryLink
                isMonth={data.period.key === "month"}
                href={scope({ trend: metric, period: "month" })}
                monthRange={monthRange(today)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-3">
                  Metric
                </span>
                <Segmented
                  label="Metric"
                  items={(["collections", "attendance"] as ChartMetric[]).map((key) => ({
                    key,
                    label: METRIC_LABEL[key],
                    href: scope({ trend: key, period: data.period.key }),
                    active: metric === key,
                  }))}
                />
              </div>
            </div>
          </header>

          {metric === "collections" ? (
            <CollectionsPanel data={data} feesLink={canReadFees ? feesLink : null} />
          ) : (
            <AttendancePanel data={data} facility={facility} />
          )}
        </article>

        <OwnerPaymentMix
          data={data}
          feesLink={canReadFees ? feesLink : null}
          className="lg:col-span-2"
        />
      </div>
    </section>
  );
}

// The month's history, as a labelled destination. A quiet morning shows
// zero for today; the month still holds the real figures, and the link
// names the exact range it opens. It keeps the metric and the facility
// scope, so the jump never widens what the owner may read.
function HistoryLink({
  isMonth,
  href,
  monthRange,
}: {
  isMonth: boolean;
  href: string;
  monthRange: string | null;
}) {
  if (isMonth) {
    return (
      <p className="mt-1.5 text-[12px] font-medium text-ink-2">
        Month history{monthRange ? ` · ${monthRange}` : ""}
      </p>
    );
  }
  return (
    <Link
      href={href}
      className="mt-1.5 inline-flex min-h-[32px] items-center text-[12px] font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline"
    >
      {monthRange ? `See this month's history (${monthRange}) →` : "See this month's history →"}
    </Link>
  );
}

/** The month-to-date range in IST, labelled from the tenant's today. */
function monthRange(today: string | null): string | null {
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const first = `${today.slice(0, 8)}01`;
  return `${formatDateIST(first)} – ${formatDateIST(today)}`;
}

function Segmented({
  label,
  items,
}: {
  label: string;
  items: { key: string; label: string; href: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-none rounded-pill border border-line bg-paper p-0.5">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={`flex min-h-[40px] items-center rounded-pill px-3 text-[12.5px] font-medium transition-colors duration-150 ${
            // The selected control wears the PRESET accent, so the
            // period reads as part of the theme in both presets.
            item.active
              ? "bg-[var(--accent-strong)] text-white"
              : "text-ink-2 hover:text-ink"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
