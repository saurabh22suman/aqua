import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton } from "@/components/skeleton";

// Batch detail cold-load: identity, then attendance evidence beside
// the waitlist queue.
export default function Loading() {
  return (
    <OwnerPage>
      <Skeleton w={24} h={4} />
      <Skeleton w={48} h={6} className="mt-3" />
      <Skeleton w={56} h={3} className="mt-2" />

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="rounded-card border border-line bg-paper p-5">
          <Skeleton w={48} h={4} />
          <Skeleton w={24} h={8} className="mt-3" />
          <Skeleton w={72} h={3} className="mt-3" />
        </div>
        <div className="rounded-card border border-line bg-paper p-5">
          <Skeleton w={44} h={4} />
          <Skeleton w={64} h={4} className="mt-3" />
          <Skeleton w={64} h={4} className="mt-3" />
        </div>
      </div>
    </OwnerPage>
  );
}
