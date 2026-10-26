import Link from "next/link";
import { OwnerChartIsland } from "@/components/charts/owner-chart-island";
import { formatINRCompact } from "@/lib/money/format";
import { addDays } from "@/lib/time/tz";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { ChartMetric } from "@/lib/services/owner-home-charts";

// Owner Home chart band — exactly two panels:
//   * a wide Collections / Attendance panel (one metric at a time, URL
//     state), with the period control and the DoD/WoW/MoM comparison;
//   * a smaller payment-mix doughnut for the selected period.
// The charts are desktop-only islands; every panel also carries a real
// table (always visible on a phone) so the same numbers are readable
// with no JavaScript and from a keyboard.

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
}: {
  data: OwnerChartsData | null;
  metric: ChartMetric;
  facility: string | null;
  canReadFees: boolean;
}) {
  if (!data) {
    return (
      <section className="mt-4 rounded-card border border-line bg-paper px-4 py-4">
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
    <section className="mt-4 grid gap-3 lg:grid-cols-3 lg:items-start" aria-label="Trends and payment mix">
      <article className="min-w-0 rounded-card border border-line bg-paper p-4 lg:col-span-2">
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-semibold">Trends</h2>
            <p className="mt-0.5 text-[12.5px] text-ink-3">
              {data.period.tabLabel} · {data.period.currentLabel} (Asia/Kolkata)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Metric"
              items={(["collections", "attendance"] as ChartMetric[]).map((key) => ({
                key,
                label: METRIC_LABEL[key],
                href: scope({ trend: key, period: data.period.key }),
                active: metric === key,
              }))}
            />
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
        </header>

        {metric === "collections" ? (
          <CollectionsPanel data={data} feesLink={canReadFees ? feesLink : null} />
        ) : (
          <AttendancePanel data={data} facility={facility} />
        )}
      </article>

      <PaymentMixPanel data={data} feesLink={canReadFees ? feesLink : null} />
    </section>
  );
}

function CollectionsPanel({
  data,
  feesLink,
}: {
  data: OwnerChartsData;
  feesLink: ((extra: Record<string, string>) => string) | null;
}) {
  const { collections, period } = data;
  const hasData = collections.totalPaise > 0;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[13px] text-ink-2 tabular-nums">
          <span className="font-display text-[20px] font-semibold text-ink">
            {formatINRCompact(collections.totalPaise)}
          </span>{" "}
          from {collections.paymentCount} payment{collections.paymentCount === 1 ? "" : "s"}
        </p>
        <Comparison
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
          <ul className="mt-2 flex flex-wrap items-center text-[12px] text-ink-3" style={{ columnGap: 16, rowGap: 4 }}>
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-water" aria-hidden="true" />
              Cash
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-marine" aria-hidden="true" />
              Digital
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-ink-3" aria-hidden="true" />
              Other
            </li>
          </ul>
          <TableBlock
            caption={`Collections, ${period.tabLabel} (${period.currentLabel})`}
            mobile
            head={["Bucket", "Cash", "Digital", "Other", "Total"]}
            rows={collections.buckets.map((bucket) => [
              bucket.fullLabel,
              formatINRCompact(bucket.cash),
              formatINRCompact(bucket.digital),
              formatINRCompact(bucket.other),
              formatINRCompact(bucket.totalPaise),
            ])}
            total={[
              "Total",
              formatINRCompact(collections.totalPaise),
              "",
              "",
              "",
            ]}
          />
          <TableBlock
            caption={`Collections, ${period.tabLabel} (${period.currentLabel})`}
            head={["Bucket", "Cash", "Digital", "Other", "Total"]}
            rows={collections.buckets.map((bucket) => [
              bucket.fullLabel,
              formatINRCompact(bucket.cash),
              formatINRCompact(bucket.digital),
              formatINRCompact(bucket.other),
              formatINRCompact(bucket.totalPaise),
            ])}
            total={["Total", formatINRCompact(collections.totalPaise), "", "", ""]}
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

function AttendancePanel({
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

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[13px] text-ink-2 tabular-nums">
          {attendance.pct === null ? (
            <span className="font-display text-[20px] font-semibold text-ink">—</span>
          ) : (
            <span className="font-display text-[20px] font-semibold text-ink">
              {attendance.pct}%
            </span>
          )}{" "}
          present or late · {attendance.present} of {attendance.total} marks
        </p>
        <Comparison
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
          {[true, false].map((mobile) => (
            <TableBlock
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

function PaymentMixPanel({
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
          {period.tabLabel} · captured payments · {period.currentLabel}
        </p>
      </header>

      {hasData ? (
        <>
          <p className="mt-3 font-display text-[20px] font-semibold tabular-nums">
            {formatINRCompact(collections.totalPaise)}
          </p>
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
          <TableBlock
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

function Comparison({
  label,
  meaning,
  text,
  previousLabel,
  capNote,
}: {
  label: string;
  meaning: string;
  text: string;
  previousLabel: string;
  capNote: string | null;
}) {
  const expansion =
    label === "DoD" ? "day over day" : label === "WoW" ? "week over week" : "month over month";
  return (
    <p className="max-w-[42ch] text-[12px] text-ink-3" title={meaning}>
      <span className="font-medium text-ink-2">
        {label} ({expansion})
      </span>{" "}
      {text}
      <span className="block">vs {previousLabel} (Asia/Kolkata)</span>
      {capNote ? <span className="block">{capNote}</span> : null}
    </p>
  );
}

function Segmented({
  label,
  items,
}: {
  label: string;
  items: { key: string; label: string; href: string; active: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-none rounded-pill border border-line p-0.5">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={`flex min-h-[44px] items-center rounded-pill px-3 text-[12.5px] font-medium transition-colors duration-150 ${
            item.active ? "bg-marine text-paper" : "text-ink-2 hover:text-ink"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function TableBlock({
  caption,
  head,
  rows,
  total,
  mobile = false,
}: {
  caption: string;
  head: string[];
  rows: string[][];
  total?: string[];
  mobile?: boolean;
}) {
  return (
    <details className={`${mobile ? "lg:hidden" : "hidden lg:block"} mt-2`}>
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center text-[12.5px] text-ink-2 marker:content-none">
        View data table
      </summary>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px] tabular-nums">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              {head.map((cell) => (
                <th key={cell} scope="col" className="py-1.5 pr-3 font-medium">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row[0]}-${index}`} className="border-b border-line/60">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="py-1.5 pr-3 text-ink-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {total ? (
            <tfoot>
              <tr>
                {total.map((cell, index) => (
                  <td key={index} className="py-1.5 pr-3 font-medium text-ink">
                    {cell}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </details>
  );
}
