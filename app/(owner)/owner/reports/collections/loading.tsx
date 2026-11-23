import { OwnerPage } from "@/components/owner-ui/owner-page";
import { CollectionsEvidenceSkeleton } from "@/components/reports/collections-evidence-skeleton";
import { Skeleton, SkeletonStatus } from "@/components/skeleton";

export default function Loading() {
  return (
    <OwnerPage workflow="ledger">
      <SkeletonStatus>Loading daily collections…</SkeletonStatus>
      <Skeleton w={54} h={7} />
      <Skeleton w={64} h={3} className="mt-2" />
      <Skeleton w={31} h={4} className="mt-4" />
      <div className="mt-6 space-y-4">
        <div className="flex gap-2">
          <Skeleton w={24} h={11} rounded="rounded-pill" />
          <Skeleton w={17} h={11} rounded="rounded-pill" />
          <Skeleton w={24} h={11} rounded="rounded-pill" />
        </div>
        <Skeleton w="full" h={11} rounded="rounded-ctl" className="lg:max-w-md" />
        <CollectionsEvidenceSkeleton />
      </div>
    </OwnerPage>
  );
}
