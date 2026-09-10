import { Skeleton } from "@/components/skeleton";

// Register cold-load. The page calls getRosterAction + the
// terminology resolver (both reads against the tenant DB). Without
// this file the coach sees a blank document for the entire cold
// window — the worst moment of all because they came here to mark
// attendance and the screen looks broken. Next.js streams this
// immediately so the coach sees the sticky mark-count header and
// the row layout while the data resolves.
//
// Shape mirrors app/(coach)/coach/register/[sessionId]/page.tsx + the
// RegisterBoard it renders: back link + page heading  →  sticky
// header card (mark count + lane strip)  →  8 register rows
// (name + pct line + two present/absent tap targets).

export default function Loading() {
  return (
    <main className="px-5 pt-6">
      {/* Back link */}
      <Skeleton w={16} h={4} />
      {/* Page heading (time · batch) */}
      <Skeleton w={36} h={5} className="mt-2" />

      {/* Sticky header card: mark count + lane strip */}
      <div className="-mx-5 px-5 pt-3 pb-3 bg-deck/95 sticky top-0 z-10 mt-4">
        <div className="rounded-card bg-water-soft px-4 py-3">
          <div className="flex items-baseline justify-between">
            <Skeleton w={24} h={4} />
            <Skeleton w={14} h={3} />
          </div>
          <Skeleton w={80} h={1.5} rounded="rounded-pill" className="mt-2" />
        </div>
      </div>

      {/* 8 register rows */}
      <ul className="mt-2 pb-8">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <li key={i} className="border-b border-line py-2 last:border-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <Skeleton w={32} h={4} className="mb-1.5" />
                <Skeleton w={20} h={3} />
              </div>
              <div className="flex gap-1.5 flex-none">
                <Skeleton w={11} h={11} rounded="rounded-ctl" />
                <Skeleton w={11} h={11} rounded="rounded-ctl" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
