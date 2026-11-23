import { Skeleton, SkeletonStatus } from "@/components/skeleton";
import { StaffPage } from "@/components/staff-ui/staff-page";

export default function Loading() {
  return (
    <StaffPage className="max-w-xl">
      <SkeletonStatus>Loading payment lookup…</SkeletonStatus>
      <Skeleton w={43} h={6} />
      <Skeleton w={57} h={3} className="mt-2" />
      <div className="mt-6 rounded-card border border-line bg-paper p-4">
        <Skeleton w={26} h={4} />
        <Skeleton w={42} h={3} className="mt-2" />
        <div className="mt-3 flex gap-2">
          <Skeleton w="full" h={12} rounded="rounded-ctl" className="flex-1" />
          <Skeleton w={22} h={12} rounded="rounded-ctl" className="shrink-0" />
        </div>
      </div>
    </StaffPage>
  );
}
