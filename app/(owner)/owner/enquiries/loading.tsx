import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton, SkeletonList, SkeletonStatus } from "@/components/skeleton";

export default function Loading() {
  return (
    <OwnerPage workflow="directory">
      <SkeletonStatus>Loading enquiries…</SkeletonStatus>
      <Skeleton w={34} h={7} />
      <Skeleton w={62} h={3} className="mt-2" />
      <div className="owner-work-panel mt-4 flex gap-2">
        <Skeleton w="full" h={11} rounded="rounded-ctl" className="flex-1" />
        <Skeleton w={23} h={11} rounded="rounded-ctl" />
      </div>
      <SkeletonList className="mt-4" />
    </OwnerPage>
  );
}
