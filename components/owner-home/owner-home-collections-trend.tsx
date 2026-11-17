import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { formatINRCompact } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

/** Render only supplied financial buckets; amounts remain integer paise. */
export function OwnerHomeCollectionsTrend({ data, href }: { data: OwnerChartsData | null | undefined; href: string | null }) {
  const buckets = data?.collections.buckets ?? [];
  const maximum = Math.max(0, ...buckets.map((bucket) => bucket.totalPaise));
  const points = maximum > 0 ? buckets.map((bucket, index) => ({
    x: buckets.length === 1 ? 140 : 8 + (index * 264) / (buckets.length - 1),
    y: 92 - (bucket.totalPaise / maximum) * 76,
  })) : [];
  return (
    <section aria-label="Collections trend" className="min-w-0 rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[18px] font-semibold">Collections trend</h2>
        {href ? <Link href={href} className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline-offset-4 hover:underline">View trend</Link> : null}
      </div>
      {!data ? <p className="mt-3 text-[13px] text-ink-2">Collections trend unavailable.</p> : <>
        <p className="mt-2 text-[12px] text-ink-3">{data.period.key === "last7" ? "Last 7 days" : data.period.tabLabel} · {formatDateIST(data.period.currentFromDate)} – {formatDateIST(data.period.currentToDate)}</p>
        <p className="mt-2 font-display text-[22px] font-semibold tabular-nums">{formatINRCompact(data.collections.totalPaise)}</p>
        <p className="text-[12px] text-ink-3">{data.collections.paymentCount} {data.collections.paymentCount === 1 ? "payment" : "payments"} recorded</p>
        {data.collections.paymentCount === 0 ? <p className="mt-3 text-[13px] text-ink-2">No payments recorded in this period.</p> : null}
        {points.length > 0 ? <svg role="img" aria-label="Collections trend" viewBox="0 0 280 100" className="mt-3 h-[115px] w-full overflow-visible text-[var(--accent-ink)]">
          <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points.map(({ x, y }) => `${x},${y}`).join(" ")} />
          {points.map(({ x, y }, index) => <circle key={buckets[index]!.key} cx={x} cy={y} r="3" fill="currentColor" />)}
        </svg> : null}
        {buckets.length > 0 ? <details className="mt-2 text-[12px] text-ink-2"><summary className="flex min-h-11 cursor-pointer items-center font-medium">Exact values</summary>
          <table className="w-full text-left"><caption className="sr-only">Collections by period</caption><thead><tr><th scope="col">Period</th><th scope="col" className="text-right">Collected</th></tr></thead><tbody>{buckets.map((bucket) => <tr key={bucket.key}><th scope="row" className="py-1 font-normal">{bucket.fullLabel}</th><td className="py-1 text-right tabular-nums">{formatINRCompact(bucket.totalPaise)}</td></tr>)}</tbody></table>
        </details> : null}
      </>}
    </section>
  );
}
