import { CollectionsPanel } from "@/components/owner-home-chart-panels";
import { OwnerPaymentMix } from "@/components/owner-ui/owner-payment-mix";
import { addDays } from "@/lib/time/tz";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { ChartMetric } from "@/lib/services/owner-home-charts";

// Owner Home — the Money band.
//
// Money contains financial summaries: what was collected, how members
// paid, and the drill-downs into the recorded transactions. ATTENDANCE
// IS NOT HERE — it is an operational fact and it has its own panel
// below the band.
//
// One range, one owner: the range strip above the band
// (components/owner-home/owner-home-range.tsx) names the selected
// range and keeps the exact instants in its disclosure. Neither panel
// repeats the range, the comparison or the dates.
//
// The two panels share the SAME context: the same range, the same
// facility, the same figures. The collections panel owns the comparison;
// the payment mix owns the composition (Cash / Digital / Other).

export function OwnerHomeCharts({
  data,
  facility,
  canReadFees,
}: {
  data: OwnerChartsData | null;
  facility: string | null;
  canReadFees: boolean;
  /**
   * Legacy inputs, accepted for compatibility and IGNORED. The band no
   * longer switches between two metrics (attendance has its own
   * operational panel below) and it no longer owns the range (the
   * range strip above the band does). Existing callers and fixtures
   * may keep passing them.
   *
   * @deprecated accepted and ignored — the band is financial only.
   */
  metric?: ChartMetric;
  /**
   * @deprecated accepted and ignored — the range strip owns the range.
   */
  today?: string | null;
}) {
  if (!data) {
    // The Money band reads FINANCE only. Attendance has its own
    // operational panel with its own message, so a financial failure is
    // never reported as an attendance failure.
    return (
      <section
        data-testid="owner-home-money"
        className="mt-5 rounded-card border border-line bg-paper px-4 py-4"
        aria-label="Money at a glance"
      >
        <p className="text-[13.5px] font-medium">Money figures are unavailable right now</p>
        <p className="mt-1 text-[12.5px] text-ink-3">
          The collections and the payment mix for the selected range could not be
          read. Reload to try again.
        </p>
      </section>
    );
  }

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

  // A read that SUCCEEDED and found nothing. It is not a failure: the
  // collections card states the empty fact ONCE and the payment mix is
  // not drawn, because a second empty card would print the same fact a
  // second time. The authorized transactions link survives.
  const noCollections =
    data.collections.totalPaise === 0 && data.collections.paymentCount === 0;

  return (
    <section
      data-testid="owner-home-money"
      className="mt-5"
      aria-label="Money at a glance"
    >
      <div className="mb-3">
        <h2 className="font-display text-[16px] font-semibold">Money at a glance</h2>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Collections and how members paid
        </p>
      </div>

      {/* The money band. The split is 60/40 (3 of 5 columns), the ratio
          the approved composition shows: the payment mix needs room for
          the donut AND its legend side by side. At the earlier 2/3-1/3
          split the mix card had roughly 270px of inner width at 1280px,
          and the approved pairing could not fit — it always wrapped.

          The two cards are a RELATED pair: they read the same range and
          the same scope. Their frames therefore end together, by the
          grid's own stretch (each card is a flex column whose footer is
          anchored at the bottom) — not by a written-down pixel height.
          On a phone the band stacks. */}
      <div
        data-testid="owner-home-money-band"
        className="grid gap-3 lg:grid-cols-5"
      >
        <article
          data-testid="owner-home-money-trends"
          className={`min-w-0 rounded-card border border-line bg-paper p-5 ${
            noCollections ? "lg:col-span-5" : "flex flex-col lg:col-span-3"
          }`}
        >
          <h3 className="font-display text-[16px] font-semibold">Collections</h3>
          <CollectionsPanel data={data} feesLink={canReadFees ? feesLink : null} />
        </article>

        {noCollections ? null : (
          <OwnerPaymentMix
            data={data}
            feesLink={canReadFees ? feesLink : null}
            className="lg:col-span-2"
          />
        )}
      </div>
    </section>
  );
}
