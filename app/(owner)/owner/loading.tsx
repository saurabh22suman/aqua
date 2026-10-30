import { Skeleton } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

// Owner home cold-load. The real page is a Promise.all over several
// actions, so this skeleton streams while the data resolves.
//
// Owner OpenPen (29 October 2026) — the skeleton mirrors the reference
// geometry: context heading, money/decision lead, actions, sessions and
// capacity, then the money band. The DOM order stays the test-pinned
// order (header → summary → actions → timeline → attention → money); CSS
// grid placement gives it the reference's visual 60/40 bands at lg.
export default function Loading() {
  return (
    <OwnerPage
      data-testid="owner-home-loading"
      aria-busy="true"
      aria-label="Loading the owner overview"
    >
      {/* 1 — the day, the club and the scope. */}
      <div
        data-testid="owner-home-loading-header"
        className="flex items-start justify-between gap-4"
      >
        <div className="min-w-0 flex-1">
          <Skeleton w={40} h={6} className="mb-2" />
          <Skeleton w={28} h={3} className="mb-2" />
          <Skeleton w={52} h={2.5} />
        </div>
        <Skeleton w={14} h={14} rounded="rounded-card" className="flex-none" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5 lg:items-start">
        {/* The money/action lead, visually the left 60%. The grid class
            mirrors the real summary contract while the surface itself is
            the unified tinted money block. */}
        <div className="order-1 min-w-0 lg:col-span-3 lg:col-start-1 lg:row-start-1">
          <div
            data-testid="owner-home-loading-summary"
            className="grid grid-cols-2 gap-2.5 rounded-card bg-[var(--surface-owner-money)] p-5 wide:grid-cols-4"
          >
            <div data-skeleton-figure className="col-span-2">
              <Skeleton w={16} h={3} className="mb-2.5" />
              <Skeleton w={24} h={9} />
            </div>
            <div data-skeleton-figure>
              <Skeleton w={18} h={3} className="mb-2" />
              <Skeleton w={20} h={4} />
              <Skeleton w={14} h={2.5} className="mt-1.5" />
            </div>
            <div data-skeleton-figure>
              <Skeleton w={16} h={3} className="mb-2" />
              <Skeleton w={20} h={4} />
              <Skeleton w={14} h={2.5} className="mt-1.5" />
            </div>
            <div className="hidden lg:contents">
              <div data-skeleton-figure className="col-span-2">
                <Skeleton w={44} h={3} />
              </div>
            </div>
            <div
              data-testid="owner-home-loading-compact-summary"
              className="col-span-2 mt-2.5 text-[12px] text-ink-3 lg:hidden"
            >
              <Skeleton w={40} h={3} />
            </div>
            <div
              data-testid="owner-home-loading-actions"
              className="col-span-2 mt-4 flex flex-wrap items-center gap-2.5"
            >
              <Skeleton w={36} h={12} rounded="rounded-ctl" />
              <Skeleton w={28} h={12} rounded="rounded-ctl" />
              <Skeleton w={26} h={12} rounded="rounded-ctl" />
            </div>
            <div className="col-span-2 mt-4 border-t border-line pt-3">
              <Skeleton w={52} h={2.5} />
            </div>
          </div>
        </div>

        <div
          data-testid="owner-home-loading-timeline"
          className="order-3 min-w-0 lg:col-span-3 lg:col-start-1 lg:row-start-2"
        >
          <div className="rounded-card border border-line bg-paper px-5 py-4">
            <Skeleton w={28} h={4} className="mb-4" />
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
              >
                <Skeleton w={8} h={3} />
                <Skeleton w={24} h={4} />
                <Skeleton w={12} h={3} className="ml-auto" />
              </div>
            ))}
          </div>
        </div>

        <div
          data-testid="owner-home-loading-attention"
          className="order-2 min-w-0 lg:col-span-2 lg:col-start-4 lg:row-start-1"
        >
          <div className="rounded-card border border-line bg-paper px-5 py-4">
            <Skeleton w={24} h={4} className="mb-4" />
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex items-center gap-3 py-3">
                <Skeleton w={8} h={8} rounded="rounded-ctl" />
                <div className="min-w-0 flex-1">
                  <Skeleton w={32} h={4} className="mb-1.5" />
                  <Skeleton w={24} h={3} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          data-testid="owner-home-loading-capacity"
          className="order-4 min-w-0 lg:col-span-2 lg:col-start-4 lg:row-start-2"
        >
          <div className="rounded-card border border-line bg-paper px-5 py-4">
            <Skeleton w={22} h={4} className="mb-4" />
            {[0, 1, 2].map((index) => (
              <div key={index} className="py-3">
                <div className="flex items-center gap-3">
                  <Skeleton w={24} h={4} />
                  <Skeleton w={10} h={3} className="ml-auto" />
                </div>
                <Skeleton w={40} h={1.5} className="mt-2" />
              </div>
            ))}
          </div>
        </div>

        <div
          data-testid="owner-home-loading-money"
          className="order-5 min-w-0 lg:col-span-5 lg:col-start-1 lg:row-start-3"
        >
          <Skeleton w={28} h={5} className="mb-3" />
          <div
            data-testid="owner-home-loading-money-band"
            className="grid gap-3 lg:grid-cols-5 lg:items-start"
          >
            <div className="rounded-card border border-line bg-paper p-5 lg:col-span-3">
              <Skeleton w={32} h={4} className="mb-4" />
              <Skeleton w={64} h={32} className="rounded-ctl" />
            </div>
            <div className="rounded-card border border-line bg-paper p-5 lg:col-span-2">
              <Skeleton w={24} h={4} className="mb-4" />
              <Skeleton w={40} h={24} rounded="rounded-ctl" />
            </div>
          </div>
        </div>
      </div>
    </OwnerPage>
  );
}
