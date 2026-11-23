import { Skeleton, SkeletonStatus } from "@/components/skeleton";
import { StaffPage } from "@/components/staff-ui/staff-page";

// Coach home cold-load. Shape mirrors the operational brief: page
// header, the next register card, then today's register rows.
export default function Loading() {
  return (
    <StaffPage>
      <SkeletonStatus>Loading your coaching workspace…</SkeletonStatus>
      <div className="flex items-start justify-between gap-3">
        <div>
          <Skeleton w={14} h={7} />
          <Skeleton w={26} h={3} className="mt-2" />
        </div>
        <Skeleton w={20} h={7} rounded="rounded-pill" />
      </div>

      <div className="mt-5 rounded-2xl border border-line bg-paper p-4">
        <Skeleton w={18} h={3} />
        <Skeleton w={56} h={6} className="mt-2" />
        <Skeleton w={32} h={3} className="mt-2" />
        <Skeleton w={80} h={1.5} rounded="rounded-pill" className="mt-4" />
        <Skeleton w={28} h={3} className="mt-2" />
        <Skeleton w={80} h={12} rounded="rounded-ctl" className="mt-3" />
      </div>

      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <Skeleton w={30} h={4} />
          <Skeleton w={24} h={3} />
        </div>
        <div className="mt-2 overflow-hidden rounded-2xl border border-line bg-paper">
          {[0, 1].map((i) => (
            <div
              key={i}
              className={`px-4 py-3.5 ${i > 0 ? "border-t border-line" : ""}`}
            >
              <div className="mb-2 flex items-baseline justify-between gap-2.5">
                <Skeleton w={40} h={4} />
                <Skeleton w={10} h={3} />
              </div>
              <Skeleton w={80} h={1.5} rounded="rounded-pill" />
              <div className="mt-2.5 flex justify-between">
                <Skeleton w={16} h={3} />
                <Skeleton w={12} h={3} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </StaffPage>
  );
}
