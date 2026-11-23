import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton, SkeletonStatus } from "@/components/skeleton";

export default function Loading() {
  return (
    <OwnerPage workflow="directory" data-testid="members-list-loading">
      <SkeletonStatus>Loading members…</SkeletonStatus>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Skeleton w={30} h={7} />
          <Skeleton w={62} h={3} className="mt-2" />
        </div>
        <div className="flex gap-2">
          <Skeleton w={22} h={11} rounded="rounded-ctl" />
          <Skeleton w={16} h={11} rounded="rounded-ctl" />
        </div>
      </div>

      <div className="owner-work-panel mt-4">
        <Skeleton w={26} h={3} />
        <div className="mt-2 flex gap-2">
          <Skeleton w="full" h={11} rounded="rounded-ctl" className="flex-1" />
          <Skeleton w={26} h={11} rounded="rounded-ctl" className="shrink-0" />
        </div>
        <Skeleton w={40} h={3} className="mt-3" />
      </div>

      <ul aria-hidden="true" className="mt-3 divide-y divide-line rounded-card border border-line bg-paper px-3.5">
        {[0, 1, 2, 3, 4].map((row) => (
          <li key={row} className="flex items-center gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <Skeleton w={36} h={4} />
              <Skeleton w={48} h={3} className="mt-1.5" />
            </div>
            <Skeleton w={14} h={5} rounded="rounded-pill" className="shrink-0" />
          </li>
        ))}
      </ul>
    </OwnerPage>
  );
}
