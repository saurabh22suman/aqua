import type { FeesOverview } from "@/lib/services/fees-hub";
import { Donut } from "@/components/charts/report-donut";
import { formatINR } from "@/lib/money/format";
import { methodLabel } from "@/lib/services/payments";
import { formatDateIST } from "@/lib/time/tz";

const tones = ["stroke-[var(--chart-1)]", "stroke-[var(--chart-2)]", "stroke-[var(--chart-3)]", "stroke-[var(--chart-4)]", "stroke-[var(--chart-5)]"];
const dots = ["bg-[var(--chart-1)]", "bg-[var(--chart-2)]", "bg-[var(--chart-3)]", "bg-[var(--chart-4)]", "bg-[var(--chart-5)]"];

export function FeesOverviewCards({ overview, facility, from, to }: { overview: FeesOverview; facility: string; from: string; to: string }) {
  const query = new URLSearchParams({ tab: "invoices", facility, from, to });
  const methods = overview.methodTotals;
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(230px,1fr)]">
    {overview.followUps !== undefined ? <section className="rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="font-display text-[18px] font-semibold">Payment follow-ups</h2><a className="inline-flex min-h-11 items-center text-[13px] text-[var(--accent-ink)]" href={`/owner/fees?${new URLSearchParams({ tab: "dues", facility, from, to })}`}>All dues</a></div>
      {overview.followUps.length === 0 ? <p className="text-[13px] text-ink-3">No outstanding invoices.</p> : <ul className="divide-y divide-line">{overview.followUps.map((row) => {
        const invoiceQuery = new URLSearchParams(query); invoiceQuery.set("invoice", row.id);
        return <li key={row.id}><a className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3" href={`/owner/fees?${invoiceQuery}`}><span className="min-w-0"><strong className="block break-all text-[14px]">{row.payerName || "Payer unavailable"}</strong><span className="block break-all text-[12px] text-ink-3">{row.invoiceNumber} · Due {formatDateIST(row.dueOn)}</span></span><strong className="whitespace-nowrap text-[14px] tabular-nums">{formatINR(row.outstandingPaise)}</strong></a></li>;
      })}</ul>}
    </section> : null}
    <section className="rounded-[18px] border border-line bg-paper p-[18px] lg:p-5"><h2 className="font-display text-[18px] font-semibold">Payment methods</h2><p className="mt-1 text-[12px] text-ink-3">Gross recorded payments in the applied period; reversals are separate.</p>
      {methods === undefined ? <p className="mt-4 text-[13px] text-ink-3">Payment methods unavailable.</p> : methods.length === 0 ? <p className="mt-4 text-[13px] text-ink-3">No payments in this period.</p> : <div className="mt-4 flex flex-wrap items-center gap-4"><Donut ariaLabel="Gross recorded payments by method; exact amounts follow" slices={methods.map((row, index) => ({ label: methodLabel(row.method), value: row.paise, valueLabel: formatINR(row.paise), tone: tones[index % tones.length]! }))} /><ul className="min-w-0 flex-1 space-y-2">{methods.map((row, index) => <li key={row.method} className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[13px]"><span className="flex items-center gap-2"><span aria-hidden="true" className={`h-2.5 w-2.5 flex-none rounded-full ${dots[index % dots.length]}`} />{methodLabel(row.method)}</span><strong className="whitespace-nowrap tabular-nums">{formatINR(row.paise)}</strong></li>)}</ul></div>}
    </section>
  </div>;
}
