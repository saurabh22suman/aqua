import { Skeleton } from "@/components/skeleton";
import { StaffPage } from "@/components/staff-ui/staff-page";

export default function Loading() {
  return (
    <StaffPage className="max-w-xl">
      <Skeleton w={24} h={7} />
      <Skeleton w={56} h={4} className="mt-3" />
      <div className="mt-7 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-line bg-paper p-3">
          <Skeleton w={28} h={4} />
          <Skeleton w={16} h={3} className="mt-2" />
          <Skeleton w={20} h={4} className="mt-4" />
        </div>
        <div className="rounded-2xl border border-line bg-paper p-3">
          <Skeleton w={24} h={4} />
          <Skeleton w={16} h={3} className="mt-2" />
          <Skeleton w={20} h={4} className="mt-4" />
        </div>
      </div>
      <div className="mt-6 rounded-2xl border border-line bg-paper p-4">
        <Skeleton w={16} h={4} />
        <Skeleton w={40} h={3} className="mt-3" />
        <Skeleton w={32} h={3} className="mt-2" />
        <Skeleton w={24} h={4} className="mt-4" />
      </div>
    </StaffPage>
  );
}
