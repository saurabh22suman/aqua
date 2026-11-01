import { Skeleton } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

// Members list cold-load. The shape mirrors the OpenPen directory:
// heading + actions  →  search/filter toolbar  →  one bounded surface with a
// section heading, comparable column row and member rows.

export default function Loading() {
  return (
    <OwnerPage>
      <div className="flex items-center justify-between gap-3">
        <div>
          <Skeleton w={26} h={6} />
          <Skeleton w={48} h={3} className="mt-2" />
        </div>
        <div className="flex gap-2">
          <Skeleton w={20} h={12} rounded="rounded-ctl" />
          <Skeleton w={16} h={12} rounded="rounded-ctl" />
        </div>
      </div>

      <div className="mt-4 flex gap-2.5">
        <Skeleton w={80} h={12} rounded="rounded-ctl" />
        <Skeleton w={32} h={12} rounded="rounded-ctl" />
      </div>

      <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
        <div className="flex items-center justify-between">
          <Skeleton w={32} h={4} />
          <Skeleton w={16} h={3} />
        </div>
        <div className="mt-3 hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_auto_auto_auto] gap-3 border-b border-line pb-2 md:grid">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} w={i === 0 ? 24 : 12} h={3} />
          ))}
        </div>
        <ul className="md:mt-1">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <li key={i} className="border-b border-line py-3 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Skeleton w={38} h={4} className="mb-1.5" />
                  <Skeleton w={52} h={3} />
                </div>
                <Skeleton w={14} h={5} rounded="rounded-pill" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </OwnerPage>
  );
}
