import type { RetentionRow } from "@/lib/services/owner-reports";

// Phase 4.5 — retention view. Aggregate-only by design.
// Per scope § 7.1 (DPDP profiling restriction), risk-scoring an
// individual minor is out of scope; the headline is "X members
// at risk" — a number, not a list. Coach/owner reads it as a
// pulse: is the at-risk cohort growing, holding, shrinking.
//
// "At risk" definition: an active member whose attendance over
// the last 30 days is zero (or absent entirely). The threshold
// is the service's choice; the UI exposes only the resulting
// count.

export function RetentionCard({ row }: { row: RetentionRow }) {
  const pct = row.totalActiveMembers > 0
    ? Math.round((row.memberCountAtRisk / row.totalActiveMembers) * 100)
    : null;
  return (
    <article className="bg-paper border border-line rounded-card p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">Retention</h2>
        <span className="text-[12px] text-ink-3">last 30 days</span>
      </header>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <div className="rounded-ctl bg-deck px-3 py-3">
          <p className="font-display text-[22px] font-semibold tracking-tight">
            {row.memberCountAtRisk}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">Members at risk</p>
        </div>
        <div className="rounded-ctl bg-deck px-3 py-3">
          <p className="font-display text-[22px] font-semibold tracking-tight">
            {pct === null ? "—" : `${pct}%`}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">Of active members</p>
        </div>
        <div className="rounded-ctl bg-deck px-3 py-3">
          <p className="font-display text-[22px] font-semibold tracking-tight">
            {row.totalActiveMembers}
          </p>
          <p className="mt-1 text-[11px] text-ink-3">Active members</p>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-ink-3 leading-snug">
        Aggregate only. No per-member risk score — minors cannot be profiled under DPDP. Open the cohort manually if you want a name list.
      </p>
    </article>
  );
}
