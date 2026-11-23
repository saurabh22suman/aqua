import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton, SkeletonStatus } from "@/components/skeleton";

export default function Loading() {
  return (
    <OwnerPage workflow="planner">
      <SkeletonStatus>Loading sessions…</SkeletonStatus>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <Skeleton w={36} h={7} />
          <Skeleton w={62} h={3} className="mt-2" />
        </div>
        <Skeleton w={35} h={11} rounded="rounded-pill" />
      </div>
      <div className="mt-5 flex gap-2">
        <Skeleton w="full" h={11} rounded="rounded-ctl" className="flex-1" />
        <Skeleton w={30} h={11} rounded="rounded-ctl" />
      </div>
      <Skeleton w={34} h={4} className="mb-2 mt-5" />
      <ul aria-hidden="true" className="space-y-2">
        {[0, 1, 2].map((row) => (
          <li key={row} className="rounded-card border border-line bg-paper px-4 py-3">
            <Skeleton w={27} h={5} rounded="rounded-pill" />
            <Skeleton w={40} h={4} className="mt-2" />
            <Skeleton w={32} h={3} className="mt-2" />
          </li>
        ))}
      </ul>
    </OwnerPage>
  );
}
