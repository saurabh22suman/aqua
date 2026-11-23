import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton, SkeletonStatus } from "@/components/skeleton";

export default function Loading() {
  return (
    <OwnerPage workflow="planner">
      <SkeletonStatus>Loading the schedule…</SkeletonStatus>
      <div className="flex min-h-11 items-center justify-between gap-3">
        <Skeleton w={37} h={7} />
        <Skeleton w={32} h={11} rounded="rounded-pill" />
      </div>

      <div aria-hidden="true" className="mt-5 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-1.5 sm:gap-2">
        <Skeleton w={11} h={12} rounded="rounded-ctl" />
        <Skeleton w="full" h={12} rounded="rounded-ctl" />
        <Skeleton w={11} h={12} rounded="rounded-ctl" />
        <Skeleton w={11} h={12} rounded="rounded-ctl" />
      </div>

      <div aria-hidden="true" className="mt-4 grid grid-cols-7 gap-1.5">
        {[0, 1, 2, 3, 4, 5, 6].map((day) => (
          <Skeleton key={day} w="full" h={14} rounded="rounded-ctl" />
        ))}
      </div>

      <div aria-hidden="true" className="mt-4 rounded-card border border-line bg-paper p-4">
        <div className="flex items-center gap-3">
          <Skeleton w={14} h={8} rounded="rounded-pill" />
          <div className="min-w-0 flex-1">
            <Skeleton w={36} h={4} />
            <Skeleton w={24} h={3} className="mt-2" />
          </div>
        </div>
      </div>
    </OwnerPage>
  );
}
