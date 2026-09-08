import { Skeleton, SkeletonCard } from "@/components/skeleton";

// Phase 1.7 — loading state for the feature catalogue.

export default function PlatformFeaturesLoading() {
  return (
    <div className="max-w-4xl">
      <Skeleton w={20} h={3} className="mb-2" />
      <Skeleton w={56} h={8} className="mb-2" />
      <Skeleton w={72} h={4} />

      {[1, 2, 3].map((g) => (
        <div key={g} className="mt-6">
          <Skeleton w={16} h={3} className="mb-2" />
          <SkeletonCard>
            <Skeleton w={48} h={4} className="mb-3" />
            <Skeleton w={32} h={3} />
          </SkeletonCard>
        </div>
      ))}
    </div>
  );
}
