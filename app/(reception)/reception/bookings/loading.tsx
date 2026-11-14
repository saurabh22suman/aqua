import { Skeleton } from "@/components/skeleton";
import { StaffPage } from "@/components/staff-ui/staff-page";

export default function Loading() {
  return (
    <StaffPage className="max-w-xl">
      <Skeleton w={22} h={7} />
      <Skeleton w={60} h={4} className="mt-3" />
      <div className="mt-6 rounded-2xl border border-line bg-paper p-4">
        <Skeleton w={20} h={4} />
        <Skeleton w={48} h={10} className="mt-3" />
        <Skeleton w={36} h={10} className="mt-3" />
        <Skeleton w={24} h={4} className="mt-4" />
      </div>
      <div className="mt-6 rounded-2xl border border-line bg-paper p-4">
        <Skeleton w={16} h={4} />
        <Skeleton w={44} h={3} className="mt-3" />
        <Skeleton w={40} h={3} className="mt-2" />
        <Skeleton w={32} h={3} className="mt-2" />
      </div>
    </StaffPage>
  );
}
