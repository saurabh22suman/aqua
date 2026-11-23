import { Skeleton, SkeletonStatus } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

// The workspace boundary also wraps child routes without their own loader.
export default function Loading() {
  return (
    <OwnerPage data-testid="owner-home-loading">
      <SkeletonStatus>Loading the club workspace…</SkeletonStatus>
      <Skeleton w={34} h={7} />
      <Skeleton w={52} h={3} className="mt-2" />
      <div className="mt-5 rounded-card border border-line bg-paper p-4">
        <Skeleton w={26} h={4} />
        <Skeleton w="full" h={3} className="mt-3" />
        <Skeleton w={52} h={3} className="mt-2" />
      </div>
    </OwnerPage>
  );
}
