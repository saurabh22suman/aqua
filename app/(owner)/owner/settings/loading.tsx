import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton, SkeletonStatus } from "@/components/skeleton";

export default function Loading() {
  return (
    <OwnerPage workflow="settings">
      <SkeletonStatus>Loading settings…</SkeletonStatus>
      <Skeleton w={30} h={7} />
      <Skeleton w={58} h={3} className="mt-2" />
      <div className="owner-work-panel mt-4">
        <Skeleton w={26} h={3} />
        <Skeleton w="full" h={11} rounded="rounded-ctl" className="mt-2" />
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-card border border-line bg-paper p-4">
        <Skeleton w={11} h={11} rounded="rounded-xl" className="shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton w={24} h={3} />
          <Skeleton w={45} h={4} />
          <Skeleton w={16} h={3} />
        </div>
      </div>
      <Skeleton w={26} h={4} className="mb-3 mt-5" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton w="full" h={16} rounded="rounded-card" />
        <Skeleton w="full" h={16} rounded="rounded-card" />
      </div>
    </OwnerPage>
  );
}
