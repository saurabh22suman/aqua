import { Skeleton, SkeletonTable } from "@/components/skeleton";

// Phase 1.7 — loading state for the tenant list. Renders the
// surrounding chrome (header, action button placeholder, search
// bar placeholder) and a table skeleton so the layout stays
// stable while the DB read completes.
//
// Per DESIGN.md §3: skeletons, never spinners. The poolside 4G
// user sees a stable block, not a spinning circle that reads as
// broken.

export default function PlatformTenantsLoading() {
  return (
    <div className="max-w-6xl">
      <Skeleton w={16} h={3} className="mb-2" />
      <Skeleton w={48} h={8} className="mb-2" />
      <Skeleton w={64} h={4} />

      <div className="mt-6 flex items-center justify-between">
        <Skeleton w={24} h={4} />
        <Skeleton w={28} h={9} rounded="rounded-pill" />
      </div>

      <div className="mt-4 flex items-end gap-3">
        <Skeleton w={64} h={10} rounded="rounded-ctl" />
        <Skeleton w={32} h={10} rounded="rounded-ctl" />
        <Skeleton w={16} h={10} rounded="rounded-pill" />
      </div>

      <div className="mt-6">
        <SkeletonTable rows={6} columns={6} />
      </div>
    </div>
  );
}
