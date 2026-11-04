import { Skeleton } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

// U-06 — announcements cold-load: heading, composer, inbox, sent list.

export default function Loading() {
  return (
    <OwnerPage>
      <Skeleton w={12} h={4} />
      <Skeleton w={32} h={5} className="mt-2" />
      <Skeleton w={64} h={4} className="mt-2" />

      <div className="mt-4 space-y-4">
        {[0, 1, 2].map((c) => (
          <div
            key={c}
            className="rounded-card bg-paper border border-line px-5 py-5"
          >
            <Skeleton w={24} h={4} className="mb-3" />
            <Skeleton w={56} h={4} />
            <Skeleton w={48} h={4} className="mt-2" />
            <Skeleton w={36} h={9} className="mt-3 rounded-pill" />
          </div>
        ))}
      </div>
    </OwnerPage>
  );
}
