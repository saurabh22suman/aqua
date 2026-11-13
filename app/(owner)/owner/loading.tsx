import { Skeleton } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

// Owner Home — the loading skeleton follows the APPROVED composition:
// greeting/date → the Collections card (two figures and its two actions) →
// the day's sessions. The old shortcut box and quick-actions box no longer
// exist on the page, so the skeleton must not paint them.
export default function Loading() {
  return (
    <OwnerPage
      data-testid="owner-home-loading"
      aria-busy="true"
      aria-label="Loading the owner overview"
    >
      <div data-testid="owner-home-loading-header">
        <Skeleton w={40} h={6} />
        <Skeleton w={28} h={3} className="mt-2" />
      </div>
      <div
        data-testid="owner-home-loading-summary"
        className="mt-4 rounded-card bg-[var(--owner-hero)] p-5"
      >
        <Skeleton w={24} h={4} />
        <div className="mt-4 grid grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              data-skeleton-figure
              className={i === 1 ? "border-l border-white/25 pl-3" : "pr-3"}
            >
              <Skeleton w={16} h={3} />
              <Skeleton w={24} h={7} className="mt-2 max-w-full" />
            </div>
          ))}
        </div>
        {/* The card's own two actions (Record payment / View trend). */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} w={24} h={10} rounded="rounded-pill" />
          ))}
        </div>
      </div>
      <div
        data-testid="owner-home-loading-timeline"
        className="mt-5 rounded-card border border-line bg-paper p-4"
      >
        <Skeleton w={28} h={4} />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} w={52} h={4} className="mt-4 max-w-full" />
        ))}
      </div>
    </OwnerPage>
  );
}
