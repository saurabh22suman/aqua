import { Skeleton } from "@/components/skeleton";

// Owner home cold-load. The real page is a Promise.all over six actions
// (dashboard / branding / terminology / onboarding / charts / timezone)
// and takes 2–7s on a cold dev compile per the audit. Without this file
// the user sees a blank document for that whole window — no header, no
// hero, nothing. With it, Next.js streams this skeleton immediately
// while the page's data fetches resolve.
//
// Owner redesign (27 October 2026) — the skeleton mirrors the APPROVED
// Home composition (DESIGN.md §7 and the Lavender Option B amendment):
//
//   1. the day, the club and the scope the figures cover;
//   2. the summary figures;
//   3. the one dominant action and its quiet secondaries;
//   4. the day's classes BESIDE the attention queue;
//   5. the money band (the trends panel beside the payment mix).
//
// It used to mirror the pre-Lavender composition (a money hero, an
// attention list, a registers card, stat chips and lane strips), so the
// page visibly rearranged itself when the data arrived.
//
// The placeholders wear the approved control radius (10px) where they
// stand for a CONTROL, and the card radius where they stand for a
// panel. Nothing here is a spinner: DESIGN.md §3 says "skeletons, never
// spinners", because a coach on poolside 4G reads a spinner as broken.

export default function Loading() {
  return (
    <main
      data-testid="owner-home-loading"
      aria-busy="true"
      aria-label="Loading the owner overview"
      className="px-5 pt-5 pb-8"
    >
      {/* 1 — the day, the club and the scope. */}
      <div
        data-testid="owner-home-loading-header"
        className="flex items-start justify-between gap-4"
      >
        <div className="min-w-0 flex-1">
          <Skeleton w={40} h={6} className="mb-2" />
          <Skeleton w={28} h={3} />
        </div>
        <Skeleton w={14} h={14} rounded="rounded-card" className="flex-none" />
      </div>

      {/* 2 — the summary. It mirrors the REAL Home's responsive
          branches, not a node count: two money figures as cards and one
          compact line below the shell breakpoint, a 2×2 block from 1024
          to 1179px, and four across at the `wide` breakpoint. A
          skeleton that used a different grid made the page rearrange
          itself when the data arrived — the opposite of its purpose. */}
      <div
        data-testid="owner-home-loading-summary"
        className="mt-5 grid grid-cols-2 gap-2.5 wide:grid-cols-4"
      >
        {[0, 1].map((index) => (
          <div
            key={index}
            data-skeleton-figure
            className="rounded-card border border-line bg-paper px-4 py-3.5"
          >
            <Skeleton w={16} h={3} className="mb-2.5" />
            <Skeleton w={22} h={7} />
          </div>
        ))}
        {/* The member and session counts: hidden from the phone
            layout, a grid item of their own from the shell breakpoint
            up — exactly like the real summary's compact-only cards. */}
        {[0, 1].map((index) => (
          <div key={`compact-${index}`} className="hidden lg:contents">
            <div
              data-skeleton-figure
              className="rounded-card border border-line bg-paper px-4 py-3.5"
            >
              <Skeleton w={16} h={3} className="mb-2.5" />
              <Skeleton w={22} h={7} />
            </div>
          </div>
        ))}
      </div>
      <p
        data-testid="owner-home-loading-compact-summary"
        className="mt-2.5 text-[12px] text-ink-3 lg:hidden"
      >
        <Skeleton w={40} h={3} />
      </p>

      {/* 3 — one dominant action and two quiet ones. */}
      <div
        data-testid="owner-home-loading-actions"
        className="mt-4 flex flex-wrap items-center gap-2"
      >
        <Skeleton w={30} h={12} rounded="rounded-ctl" />
        <Skeleton w={24} h={12} rounded="rounded-ctl" />
        <Skeleton w={22} h={12} rounded="rounded-ctl" />
      </div>

      {/* 4 — the day's classes beside the attention queue. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-5 lg:items-start">
        <div
          data-testid="owner-home-loading-timeline"
          className="order-2 min-w-0 lg:order-1 lg:col-span-3"
        >
          <div className="rounded-card border border-line bg-paper px-4 py-4">
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
          className="order-1 min-w-0 lg:order-2 lg:col-span-2"
        >
          <div className="rounded-card border border-line bg-paper px-4 py-4">
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
      </div>

      {/* 5 — the money band: the trends panel beside the payment mix.
          The grid mirrors the REAL band exactly (5 columns, the trends
          over three and the mix over two) — the independent review
          found the skeleton still on the old 3-column split, so the
          band rearranged itself when the data arrived. */}
      <div data-testid="owner-home-loading-money" className="mt-5">
        <Skeleton w={28} h={5} className="mb-3" />
        <div
          data-testid="owner-home-loading-money-band"
          className="grid gap-3 lg:grid-cols-5 lg:items-start"
        >
          <div
            data-testid="owner-home-loading-money-trends"
            className="rounded-card border border-line bg-paper p-4 lg:col-span-3"
          >
            <Skeleton w={32} h={4} className="mb-4" />
            <Skeleton w={64} h={32} className="rounded-ctl" />
          </div>
          <div
            data-testid="owner-home-loading-money-mix"
            className="rounded-card border border-line bg-paper p-4 lg:col-span-2"
          >
            <Skeleton w={24} h={4} className="mb-4" />
            <Skeleton w={40} h={24} rounded="rounded-ctl" />
          </div>
        </div>
      </div>
    </main>
  );
}
