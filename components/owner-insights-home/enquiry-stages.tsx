import type { EnquiryStageInsight } from "@/lib/services/owner-insights";

// The enquiries-by-current-stage rows of the expanded detail.
//
// A SNAPSHOT of a cohort, not a funnel: every enquiry created in the
// window is counted ONCE, at the stage it sits in right now. The
// sentence under the heading says so, because "4 converted" beside
// "8 new" is exactly the shape a reader mistakes for a conversion
// rate.
//
// Stages with no enquiries are left out — the cohort total is on
// screen, and a row of zeroes is noise, not evidence. One series, one
// colour: the bar repeats a number that is written beside it.

export function EnquiryStages({ insight }: { insight: EnquiryStageInsight }) {
  if (insight.total === 0) {
    return (
      <p className="text-[13px] text-ink-3">
        No enquiries were created in this window, so there is nothing to show.
      </p>
    );
  }

  const stages = insight.rows.filter((row) => row.count > 0);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-display text-[14px] font-semibold">
          Enquiries by current stage
        </h3>
        <p className="text-[12px] text-ink-3">
          {insight.total} created in this window
        </p>
      </div>
      <p className="mt-1 text-[11.5px] text-ink-3">
        Each enquiry is counted once, at the stage it is in now — this is not a
        conversion rate.
      </p>

      <ul className="mt-2">
        {stages.map((row) => (
          <li key={row.stage} className="flex items-center gap-3 py-1.5">
            <span className="w-[8.5rem] flex-none truncate text-[13px]">
              {row.label}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block h-1.5 overflow-hidden rounded-pill bg-deck"
                aria-hidden="true"
              >
                <span
                  className="block h-full rounded-pill bg-[var(--chart-1)]"
                  style={{ width: `${row.share ?? 0}%` }}
                />
              </span>
            </span>
            <span className="w-[4.5rem] flex-none text-right text-[12px] tabular-nums text-ink-2">
              {row.count} · {row.share === null ? "—" : `${row.share}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
