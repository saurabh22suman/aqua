import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton, SkeletonTable } from "@/components/skeleton";

// Programs cold-load: heading, program catalogue, batch table.
export default function Loading() {
  return (
    <OwnerPage>
      <Skeleton w={64} h={6} />
      <Skeleton w={96} h={3} className="mt-3" />
      <div className="mt-5 space-y-5">
        <div className="rounded-card border border-line bg-paper p-5">
          <Skeleton w={40} h={4} />
          <Skeleton w={72} h={4} className="mt-3" />
        </div>
        <div className="rounded-card border border-line bg-paper p-5">
          <Skeleton w={48} h={4} />
          <SkeletonTable rows={3} columns={5} className="mt-4 border-0" />
        </div>
      </div>
    </OwnerPage>
  );
}
