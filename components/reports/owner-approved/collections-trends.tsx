import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import { formatINR, formatINRCompact } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import { ColumnChart } from "@/components/charts/report-column-chart";
import { Donut } from "@/components/charts/report-donut";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import type { PaymentMethodKey } from "@/lib/money/payment-groups";

const METHOD_TONES: Record<PaymentMethodKey, { stroke: string; swatch: string }> = {
  cash: { stroke: "stroke-[var(--chart-1)]", swatch: "bg-[var(--chart-1)]" },
  upi: { stroke: "stroke-[var(--chart-2)]", swatch: "bg-[var(--chart-2)]" },
  other: { stroke: "stroke-[var(--chart-3)]", swatch: "bg-[var(--chart-3)]" },
  bank_transfer: { stroke: "stroke-[var(--chart-4)]", swatch: "bg-[var(--chart-4)]" },
  card: { stroke: "stroke-[var(--chart-5)]", swatch: "bg-[var(--chart-5)]" },
};

// 3 November 2026 — two purposeful plot cards.
//
// The approved composition is a compact daily-collections plot and a payment
// mix plot, not one card repeating a total, a count paragraph and a ring. The
// money rules are unchanged: captured paise, the same method keys, counts and
// gross/reversal semantics. Exact figures live inside the disclosure; the
// ring stays at its approved 132px and sits beside its legend without
// wrapping on a phone.
export function CollectionsTrends({ data, facility, facilityScope = facility }: { data: OwnerChartsData; facility?: string; facilityScope?: string }) {
  const { collections, period } = data;
  const buckets = period.key === "day" ? [{ key: period.currentFromDate, label: period.currentFromDate, fullLabel: formatDateIST(period.currentFromDate), totalPaise: collections.totalPaise }] : collections.buckets;
  const methods = collections.methods.filter(method => method.paise > 0);
  return <>
    <form action="/owner/reports/collections" className="mt-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="view" value="trends" />{facilityScope ? <input type="hidden" name="facility" value={facilityScope} /> : null}
      <label className="grid gap-1 text-sm text-ink-2">Range<Select name="period" defaultValue={period.key}><option value="last7">Last 7 days</option><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option></Select></label>
      <Button type="submit" variant="secondary">Apply</Button>
    </form>
    <p className="mt-3 text-sm text-ink-2">{formatDateIST(period.currentFromDate)}{period.currentToDate !== period.currentFromDate ? ` – ${formatDateIST(period.currentToDate)}` : ""}{facility ? " · Selected facility" : " · All permitted facilities"}</p>
    <div data-testid="report-plots" className="mt-4 grid items-start gap-3 lg:grid-cols-2">
      <section data-testid="report-plot" aria-labelledby="collections-chart-title" className={`min-w-0 rounded-card border border-line bg-paper p-4${methods.length ? "" : " lg:col-span-2"}`}>
        <h2 id="collections-chart-title" className="font-display text-lg font-semibold">Daily collections</h2>
        {collections.paymentCount === 0 ? <p className="mt-3 text-sm text-ink-2">No payments recorded in this range.</p> : <div className="mt-3"><ColumnChart points={buckets.map(bucket => ({ label: bucket.label, hint: bucket.fullLabel, value: bucket.totalPaise }))} ariaLabel="Collections by date in Indian rupees" valueLabel={formatINR} axisValueLabel={formatINRCompact} valueTitle="INR" /></div>}
        <details className="mt-3 border-t border-line pt-3" data-testid="collections-exact"><summary className="min-h-11 cursor-pointer text-sm font-medium">View data and method</summary>
          <p className="text-sm text-ink-2">{collections.paymentCount} payments recorded · {formatINR(collections.totalPaise)} collected</p>
          <p className="mt-1 text-sm text-ink-2">Captured payments are gross; reversals are recorded separately and are not subtracted from these figures.</p>
          <p className="mt-1 text-sm text-ink-2">Reversals: {formatINRCompact(collections.reversedPaise)} · {collections.reversalCount} recorded</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Exact collections by date</caption><thead><tr><th scope="col">Date</th><th scope="col">Captured</th></tr></thead><tbody>{buckets.map(bucket => <tr key={bucket.key}><th scope="row" className="py-2">{bucket.fullLabel}</th><td className="tabular-nums">{formatINR(bucket.totalPaise)}</td></tr>)}</tbody></table></div>
        </details>
      </section>
      {/* The payment-mix card only earns its place when there is a mix to
          show. In an empty range it repeated this card's empty sentence and
          left a blank half-grid, so it is not rendered at all and the one
          remaining card spans the full plot grid. */}
      {methods.length ? <section data-testid="report-plot" aria-labelledby="collections-mix-title" className="min-w-0 rounded-card border border-line bg-paper p-4">
        <h2 id="collections-mix-title" className="font-display text-lg font-semibold">Payment mix</h2>
        <div data-testid="method-pair" className="mt-3 flex flex-nowrap items-center gap-4">
          <div className="flex-none"><Donut slices={methods.map(method => ({ label: method.label, value: method.paise, tone: METHOD_TONES[method.key].stroke }))} ariaLabel="Recorded payments by method" /></div>
          <div data-testid="method-legend" className="min-w-0 flex-1">
            <ul className="space-y-1 text-sm text-ink-2">{methods.map(method => <li key={method.key} className="flex min-w-0 items-start gap-1.5"><span aria-hidden="true" className={`mt-1 inline-block h-2.5 w-2.5 flex-none rounded-full ${METHOD_TONES[method.key].swatch}`} /><span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1"><span className="min-w-0 break-normal">{method.label} ·</span><span className="flex-none whitespace-nowrap tabular-nums">{formatINRCompact(method.paise)}</span></span></li>)}</ul>
            <details className="mt-2" data-testid="method-details"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Method details</summary>
              <ul className="mt-1 space-y-1 text-sm text-ink-2">{methods.map(method => <li key={method.key}>{method.label} · {formatINR(method.paise)} · {method.count} payments</li>)}</ul>
            </details>
          </div>
        </div>
      </section> : null}
    </div>
  </>;
}
