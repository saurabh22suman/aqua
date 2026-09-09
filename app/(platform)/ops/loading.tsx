import { Skeleton } from "@/components/skeleton";

// Phase 1.7 — loading state for the operator landing screen.

export default function PlatformHomeLoading() {
  return (
    <div className="max-w-2xl">
      <Skeleton w={16} h={3} className="mb-2" />
      <Skeleton w={56} h={8} className="mb-2" />
      <Skeleton w={40} h={4} />

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-card bg-paper border border-line p-4">
          <Skeleton w={20} h={4} className="mb-2" />
          <Skeleton w={56} h={3} />
        </div>
        <div className="rounded-card bg-paper border border-line p-4">
          <Skeleton w={28} h={4} className="mb-2" />
          <Skeleton w={56} h={3} />
        </div>
      </div>
    </div>
  );
}
