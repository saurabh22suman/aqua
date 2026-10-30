import { Skeleton } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

// Fees hub cold-load: heading + tab strip, four period/current figures, then
// the collection/evidence pair the page fetches through actions.

export default function Loading() {
  return (
    <OwnerPage>
      <Skeleton w={32} h={6} />
      <Skeleton w={72} h={3} className="mt-2" />

      <div className="mt-4 flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4].map((t) => (
          <Skeleton key={t} w={16} h={10} className="rounded-pill" />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((c) => (
          <div key={c} className="rounded-card border border-line bg-paper px-5 py-5">
            <Skeleton w={24} h={3} className="mb-3" />
            <Skeleton w={32} h={7} />
            <Skeleton w={40} h={3} className="mt-2" />
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {[0, 1].map((c) => (
          <div key={c} className="rounded-card border border-line bg-paper p-4">
            <Skeleton w={32} h={4} className="mb-2" />
            <Skeleton w={56} h={3} />
            <Skeleton w={24} h={9} className="mt-3" rounded="rounded-ctl" />
          </div>
        ))}
      </div>
    </OwnerPage>
  );
}
