import { Skeleton } from "@/components/skeleton";
import { StaffPage } from "@/components/staff-ui/staff-page";

// Coach home cold-load. Shape mirrors the staff Today page: a bounded
// heading, the day's completion line, then two register rows.
export default function Loading() {
  return (
    <StaffPage>
      <Skeleton w={14} h={7} />
      <Skeleton w={26} h={3} className="mt-2" />
      <Skeleton w={30} h={3} className="mt-5" />

      <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-paper">
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
    </StaffPage>
  );
}
