import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton } from "@/components/skeleton";

// Owner bookings cold-load. Mirrors the composed page: heading, the
// price notice line, then the day board beside the selected slot.

export default function Loading() {
  return (
    <OwnerPage>
      <Skeleton w={32} h={6} />
      <Skeleton w={96} h={3} className="mt-3" />

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <div className="rounded-card border border-line bg-paper p-5 lg:col-span-3">
          <Skeleton w={36} h={4} />
          <Skeleton w={56} h={3} className="mt-2" />
          <div className="mt-4 flex gap-2">
            <Skeleton w={18} h={9} className="rounded-ctl" />
            <Skeleton w={14} h={9} className="rounded-ctl" />
          </div>
          <Skeleton w={72} h={52} className="mt-4 rounded-card" />
        </div>
        <div className="lg:col-span-2">
          <Skeleton w={36} h={4} />
          <Skeleton w={56} h={3} className="mt-2" />
          <div className="mt-3 rounded-card border border-line bg-paper p-4">
            <Skeleton w={64} h={4} />
            <Skeleton w={48} h={11} className="mt-3" />
            <Skeleton w={40} h={4} className="mt-3" />
            <Skeleton w={48} h={11} className="mt-3" />
            <Skeleton w={56} h={11} className="mt-3" />
          </div>
        </div>
      </div>
    </OwnerPage>
  );
}
