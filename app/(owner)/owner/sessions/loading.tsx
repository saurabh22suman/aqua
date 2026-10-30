import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton } from "@/components/skeleton";

// Session exceptions cold-load: heading, range control, management
// table.
export default function Loading() {
  return (
    <OwnerPage>
      <Skeleton w={64} h={6} />
      <Skeleton w={80} h={3} className="mt-3" />
      <div className="mt-5 flex gap-2">
        <Skeleton w={16} h={11} className="rounded-ctl" />
        <Skeleton w={20} h={11} className="rounded-ctl" />
        <Skeleton w={20} h={11} className="rounded-ctl" />
      </div>
      <div className="mt-4 rounded-card border border-line bg-paper p-5">
        <Skeleton w={52} h={4} />
        <Skeleton w={96} h={3} className="mt-2" />
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="mt-4 border-t border-line pt-3">
            <Skeleton w={64} h={4} />
            <Skeleton w={40} h={3} className="mt-2" />
          </div>
        ))}
      </div>
    </OwnerPage>
  );
}
