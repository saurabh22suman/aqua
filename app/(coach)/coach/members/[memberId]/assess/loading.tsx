import { Skeleton } from "@/components/skeleton";

// Assess cold-load. The page fetches the member's progress (frameworks
// + nodes + history) before it can render the band buttons; without
// this file the coach sees a blank document and may back out mid-
// assessment. Shape mirrors the AssessmentBoard: back link, heading,
// level card, then three skill rows with four band buttons each.
export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8">
      <Skeleton w={16} h={4} className="mb-4" />
      <Skeleton w={44} h={5} />
      <Skeleton w={60} h={3} className="mt-2" />

      <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
        <Skeleton w={24} h={3} />
        <div className="mt-3 space-y-3">
          {[0, 1, 2].map((row) => (
            <div key={row}>
              <Skeleton w={32} h={4} />
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {[0, 1, 2, 3].map((band) => (
                  <Skeleton key={band} w={10} h={11} rounded="rounded-ctl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
