import { Skeleton, SkeletonStat, SkeletonCard } from "@/components/skeleton";

// Phase 1.7 — loading state for the tenant detail page.

export default function PlatformTenantDetailLoading() {
  return (
    <div className="max-w-5xl">
      <Skeleton w={20} h={4} className="mb-4" />
      <div className="flex items-baseline gap-4">
        <Skeleton w={56} h={8} />
        <Skeleton w={20} h={6} rounded="rounded-pill" />
      </div>
      <Skeleton w={32} h={4} className="mt-1" />

      <section className="mt-6">
        <Skeleton w={16} h={3} className="mb-2" />
        <SkeletonCard>
          <Skeleton w={48} h={4} className="mb-3" />
          <Skeleton w={64} h={3} />
          <Skeleton w={56} h={3} className="mt-2" />
        </SkeletonCard>
      </section>

      <section className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
        <SkeletonStat value={16} />
        <SkeletonStat value={16} />
        <SkeletonStat value={20} />
      </section>

      <section className="mt-8">
        <Skeleton w={16} h={3} className="mb-2" />
        <SkeletonCard>
          <Skeleton w={48} h={4} className="mb-2" />
          <Skeleton w={32} h={4} />
        </SkeletonCard>
      </section>
    </div>
  );
}
