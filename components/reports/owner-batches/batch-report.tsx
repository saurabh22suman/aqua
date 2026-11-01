import type { OwnerBatchRow } from "@/lib/services/owner-batch-report";
import Link from "next/link";

export function BatchReport({ rows, canViewFinancial, collectionsHref = "/owner/reports/collections", batchOne = "batch", batchMany = "batches" }: { rows: OwnerBatchRow[]; canViewFinancial: boolean; collectionsHref?: string; batchOne?: string; batchMany?: string }) {
  return <div className="mt-4 space-y-4">
    <section className="rounded-card border border-line bg-paper p-4 sm:p-5">
      <h2 className="font-display text-[16px] font-semibold">{`Places by ${batchOne}`}</h2>
      <p className="mt-1 text-[13px] text-ink-3">Current reserved places and capacity</p>
      {rows.length === 0 ? <p className="py-5 text-[13px] text-ink-3">{`No ${batchMany} in this selection.`}</p> :
        <ul className="mt-3 divide-y divide-line">{rows.map(row => {
          const pct = Math.min(100, Math.round(row.reservedPlaces / row.capacity * 100));
          return <li key={row.batchId} className="py-3 first:pt-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <div className="min-w-0"><p className="text-[14px] font-medium">{row.batchName}</p>
                <p className="text-[12px] text-ink-3">{row.programName}{row.locationName ? ` · ${row.locationName}` : ""}</p></div>
              <p className="text-[13px] font-medium tabular-nums">{row.reservedPlaces} of {row.capacity}</p>
            </div>
            <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-pill bg-deck"><div className="h-full rounded-pill bg-[var(--accent-strong)]" style={{width:`${pct}%`}} /></div>
            {row.reservedPlaces > row.capacity ? <p className="mt-1 text-[12px] text-ink-2">Over capacity</p> : null}
          </li>;
        })}</ul>}
      <details className="mt-2 text-[12.5px] text-ink-3">
        <summary className="min-h-11 cursor-pointer content-center text-ink-2">How places are counted</summary>
        <p>{`Current distinct enrolments, using the same count as ${batchOne} capacity checks. This is not attendance or historical occupancy.`}</p>
      </details>
    </section>
    {canViewFinancial ? <section className="rounded-card border border-line bg-paper p-4 sm:p-5">
      <h2 className="font-display text-[16px] font-semibold">{`Collections by ${batchOne}`}</h2>
      <p className="mt-1 text-[13px] text-ink-3">{`Collections by ${batchOne} are unavailable because payments are not linked to ${batchMany}.`}</p>
      <Link href={collectionsHref} className="mt-2 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">Daily collections</Link>
    </section> : null}
  </div>;
}
