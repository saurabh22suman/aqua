import { Skeleton } from "@/components/skeleton";
import { StaffPage } from "@/components/staff-ui/staff-page";

// Reception cold-load. Shape mirrors the operational brief: page
// header, the find-a-member card, then the check-in list.
export default function Loading() {
  return (
    <StaffPage>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Skeleton w={14} h={7} />
          <Skeleton w={26} h={3} className="mt-2" />
        </div>
        <Skeleton w={20} h={7} rounded="rounded-pill" />
      </div>

      <div className="mt-5 rounded-2xl border border-line bg-paper p-4">
        <Skeleton w={16} h={3} />
        <Skeleton w={44} h={6} className="mt-2" />
        <Skeleton w={64} h={3} className="mt-2" />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Skeleton w={80} h={12} rounded="rounded-ctl" />
          <Skeleton w={80} h={12} rounded="rounded-ctl" />
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <Skeleton w={28} h={4} />
          <Skeleton w={14} h={3} />
        </div>
        <div className="mt-3 space-y-4">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-line bg-paper px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <Skeleton w={40} h={4} />
                <Skeleton w={18} h={3} />
              </div>
              <Skeleton w={80} h={1.5} rounded="rounded-pill" className="mt-2" />
            </div>
          ))}
        </div>
      </div>
    </StaffPage>
  );
}
