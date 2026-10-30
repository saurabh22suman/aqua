import { OwnerPage } from "@/components/owner-ui/owner-page";
import { Skeleton } from "@/components/skeleton";

// Onboarding cold-load: heading plus the check-count surface.
export default function Loading() {
  return (
    <OwnerPage>
      <Skeleton w={64} h={6} />
      <Skeleton w={80} h={3} className="mt-3" />
      <div className="mt-5 max-w-2xl rounded-card border border-line bg-paper p-5">
        <Skeleton w={40} h={4} />
        <Skeleton w={56} h={3} className="mt-2" />
        <Skeleton w={96} h={12} className="mt-4" />
        <Skeleton w={96} h={12} className="mt-3" />
        <Skeleton w={96} h={12} className="mt-3" />
      </div>
    </OwnerPage>
  );
}
