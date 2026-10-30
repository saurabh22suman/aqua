import { ProgressBar } from "@/components/ui/ProgressBar";
import { SectionHeading } from "@/components/ui/PageHeader";
import { occupancy } from "@/components/owner-home/session-state";
import type { TodaysLane } from "@/lib/services/dashboard";

// Owner Home — the reference batch-capacity panel.
//
// It reads the SAME today's-lane data the session timeline uses, so the
// panel cannot disagree with the session rows and no extra service call
// is introduced. Occupancy is places taken, never attendance; an
// over-capacity batch says so explicitly in words and uses a neutral
// capacity fill; it is not an overdue-money or attendance state.
export function OwnerHomeCapacity({ lanes }: { lanes: readonly TodaysLane[] }) {
  return (
    <section data-testid="owner-home-capacity" aria-label="Batch capacity">
      <SectionHeading
        className="mb-3"
        title="Batch capacity"
        subtitle="Places filled in today's batches"
      />
      <div className="rounded-card border border-line bg-paper px-5 py-1">
        {lanes.length === 0 ? (
          <p className="py-5 text-[13px] text-ink-3">
            No sessions are scheduled today, so there is no capacity to show.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {lanes.map((lane) => {
              const fill = occupancy(lane);
              const over = fill.overBy > 0;
              return (
                <li key={lane.sessionId} className="py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-[13.5px] font-medium">
                      {lane.batchName}
                    </p>
                    <p className="flex-none text-[12.5px] tabular-nums text-ink-2">
                      {fill.enrolled} of {fill.capacity}
                    </p>
                  </div>
                  <ProgressBar
                    className="mt-2"
                    value={fill.enrolled}
                    max={Math.max(fill.capacity, fill.enrolled, 1)}
                    tone="water"
                    label={`${lane.batchName} capacity`}
                  />
                  <p
                    className={`mt-1.5 text-[11.5px] ${
                      over ? "font-medium text-ink-2" : "text-ink-3"
                    }`}
                  >
                    {over
                      ? `Over capacity by ${fill.overBy} ${fill.overBy === 1 ? "place" : "places"}`
                      : `${fill.capacity - fill.enrolled} ${
                          fill.capacity - fill.enrolled === 1 ? "place" : "places"
                        } available`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
