import { SkeletonCard, SkeletonStatus } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

export default function Loading() {
  return (
    <OwnerPage>
      <SkeletonStatus>Loading staff details…</SkeletonStatus>
      <SkeletonCard className="mb-3" />
      <SkeletonCard />
    </OwnerPage>
  );
}
