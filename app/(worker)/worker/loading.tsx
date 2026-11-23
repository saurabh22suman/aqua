import { Skeleton } from "@/components/skeleton";
import { StaffPage } from "@/components/staff-ui/staff-page";

// Worker cold-load mirrors Today: heading, shift and attendance.
export default function Loading() {
  return (
    <StaffPage>
      <Skeleton w={22} h={7} />
      <Skeleton w={26} h={3} className="mt-2" />

      <div className="mt-5 rounded-2xl border border-line bg-paper p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Skeleton w={22} h={3} />
            <Skeleton w={48} h={6} className="mt-2" />
            <Skeleton w={32} h={3} className="mt-2" />
          </div>
          <Skeleton w={24} h={6} rounded="rounded-pill" />
        </div>
        <Skeleton w={64} h={3} className="mt-4" />
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-paper p-4">
        <Skeleton w={44} h={4} />
        <Skeleton w={28} h={3} className="mt-2" />
        <Skeleton w={24} h={10} rounded="rounded-ctl" className="mt-3" />
      </div>
    </StaffPage>
  );
}
