import { Skeleton } from "@/components/skeleton";
import { StaffPage } from "@/components/staff-ui/staff-page";

// Register cold-load. Shape mirrors the register: back link, page
// heading, the sticky mark-count card, then eight rows.
export default function Loading() {
  return (
    <StaffPage>
      <Skeleton w={16} h={4} />
      <Skeleton w={36} h={5} className="mt-2" />

      <div className="sticky top-0 z-10 -mx-4 mt-4 bg-deck/95 px-4 pb-3 pt-3">
        <div className="rounded-2xl bg-water-soft px-4 py-3">
          <div className="flex items-baseline justify-between">
            <Skeleton w={24} h={4} />
            <Skeleton w={14} h={3} />
          </div>
          <Skeleton w={80} h={1.5} rounded="rounded-pill" className="mt-2" />
        </div>
      </div>

      <ul className="mt-2 pb-8">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <li key={i} className="border-b border-line py-2 last:border-0">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Skeleton w={32} h={4} className="mb-1.5" />
                <Skeleton w={20} h={3} />
              </div>
              <div className="flex flex-none gap-1.5">
                <Skeleton w={11} h={11} rounded="rounded-ctl" />
                <Skeleton w={11} h={11} rounded="rounded-ctl" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </StaffPage>
  );
}
