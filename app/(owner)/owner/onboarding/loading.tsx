import { SkeletonCard } from "@/components/skeleton";

// Skeleton rather than spinner — DESIGN.md §3 (users are on flaky
// poolside 4G where a spinner reads as broken). Matches the
// hero-plus-list composition of the live view.
export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8">
      <div className="pb-4">
        <SkeletonCard className="!rounded-card" />
      </div>
      <SkeletonCard />
    </main>
  );
}
