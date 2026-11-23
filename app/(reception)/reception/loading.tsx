import { Skeleton, SkeletonStatus } from "@/components/skeleton";
import { StaffPage } from "@/components/staff-ui/staff-page";

export default function Loading() {
  return (
    <StaffPage>
      <SkeletonStatus>Loading the front desk…</SkeletonStatus>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Skeleton w={18} h={6} />
          <Skeleton w={32} h={3} className="mt-2" />
        </div>
        <Skeleton w={20} h={7} rounded="rounded-pill" />
      </div>

      <div className="mt-5 rounded-2xl border border-line bg-paper">
        <div className="p-4">
          <Skeleton w={37} h={5} />
          <div className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,7.5rem),1fr))]">
            {[0, 1, 2].map((shortcut) => (
              <Skeleton key={shortcut} w="full" h={11} rounded="rounded-ctl" />
            ))}
          </div>
        </div>
        <div className="border-t border-line px-4 py-2.5">
          <Skeleton w={50} h={3} />
        </div>
      </div>

      <Skeleton w={32} h={4} className="mb-2 mt-6" />
      <ul aria-hidden="true" className="divide-y divide-line rounded-2xl border border-line bg-paper px-4">
        {[0, 1].map((row) => (
          <li key={row} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <Skeleton w={36} h={4} />
              <Skeleton w={27} h={3} className="mt-2" />
            </div>
            <Skeleton w={16} h={5} rounded="rounded-pill" />
          </li>
        ))}
      </ul>
    </StaffPage>
  );
}
