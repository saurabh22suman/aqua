import type { EnquiryFunnelRow } from "@/lib/services/owner-reports";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";

// Phase 4.4 — enquiry funnel per source. Owner reads counts
// and conversion rate. Stages show breakdown so the owner
// spots where enquiries stall; not a coaching surface — the
// receptionist works the day-to-day enquiries, the owner
// reads the funnel.
const SOURCE_LABEL: Record<string, string> = {
  walk_in: "Walk-in",
  phone: "Phone",
  referral: "Referral",
  online: "Online",
  other: "Other",
};

export async function EnquiryFunnelCard({ rows }: { rows: EnquiryFunnelRow[] }) {
  // L3 audit — the title routes the closed-key `enquiry` plural
  // form through resolveTerm so the heading matches whatever
  // the tenant's vocabulary preset defines (currently every
  // preset keeps "enquiry", but the contract is uniform).
  const terminology = await getTerminologyAction();
  const totalAll = rows.reduce((s, r) => s + r.total, 0);
  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">
          {titleCase(resolveTerm(terminology, "enquiry", "other"))} funnel
        </h2>
        <span className="text-[12px] text-ink-3">{totalAll} in period</span>
      </header>
      {totalAll === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">No enquiries captured in this period.</p>
      ) : (
        <table className="mt-3 w-full text-[13px]">
          <thead className="text-[11px] uppercase tracking-wide text-ink-3">
            <tr className="text-left">
              <th className="py-1">Source</th>
              <th className="py-1 text-right">Total</th>
              <th className="py-1 text-right">New → Converted</th>
              <th className="py-1 text-right">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((r) => r.total > 0)
              .map((r) => (
                <tr key={r.source} className="border-t border-line">
                  <td className="py-2 font-medium">{SOURCE_LABEL[r.source] ?? r.source}</td>
                  <td className="py-2 text-right tabular-nums">{r.total}</td>
                  <td className="py-2 text-right tabular-nums">
                    {r.byStage.new} → {r.converted}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {r.conversionPct === null ? "—" : `${r.conversionPct}%`}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
