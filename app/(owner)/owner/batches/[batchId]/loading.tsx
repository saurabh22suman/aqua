import { SkeletonCard } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8">
      <SkeletonCard className="mb-3" />
      <SkeletonCard />
    </main>
  );
}
