import { SkeletonCard } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

export default function Loading() {
  return (
    <OwnerPage>
      <SkeletonCard className="mb-3" />
      <SkeletonCard className="mb-3" />
      <SkeletonCard />
    </OwnerPage>
  );
}
