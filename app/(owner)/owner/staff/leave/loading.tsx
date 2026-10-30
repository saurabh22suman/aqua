import { Skeleton } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

export default function Loading() {
  return (
    <OwnerPage>
      <Skeleton w={18} h={4} />
      <Skeleton w={28} h={6} className="mt-3" />
      <Skeleton w={56} h={3} className="mt-3" />
      <div className="mt-6 rounded-card border border-line bg-paper p-4">
        <Skeleton w={22} h={4} />
        <Skeleton w={60} h={3} className="mt-3" />
        <Skeleton w={52} h={3} className="mt-2" />
      </div>
    </OwnerPage>
  );
}
