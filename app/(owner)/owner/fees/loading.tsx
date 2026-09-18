import { Skeleton } from "@/components/skeleton";

// U-02 — Fees hub cold-load. Heading + tab strip + the overview
// cards / list rows the page fetches through actions.

export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8">
      <Skeleton w={16} h={4} />
      <Skeleton w={28} h={5} className="mt-2" />
      <Skeleton w={64} h={4} className="mt-2" />

      <div className="mt-4 flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4].map((t) => (
          <Skeleton key={t} w={16} h={9} className="rounded-pill" />
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {[0, 1].map((c) => (
          <div
            key={c}
            className="rounded-card bg-paper border border-line px-5 py-5"
          >
            <Skeleton w={24} h={4} className="mb-3" />
            <Skeleton w={32} h={7} />
            <Skeleton w={40} h={4} className="mt-2" />
          </div>
        ))}
      </div>
    </main>
  );
}
