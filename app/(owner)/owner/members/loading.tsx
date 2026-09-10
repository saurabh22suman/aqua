import { Skeleton } from "@/components/skeleton";

// Members list cold-load. The page is a Promise.all over listMembers
// and listLocations (both reads against the tenant DB). Without this
// loading file, the user sees a blank document for the 2–7s cold-load
// window. Next.js streams this immediately so the search box, filter,
// and row layout are stable while the data fetches resolve.
//
// Shape mirrors app/(owner)/owner/members/page.tsx + the MembersBoard
// it renders: heading + Add button  →  search input  →  status filter
// chip  →  8 list rows (avatar circle + 2 lines of meta).

export default function Loading() {
  return (
    <main className="px-5 pt-10 pb-8">
      {/* Heading + Add button */}
      <div className="flex items-center justify-between">
        <Skeleton w={24} h={5} />
        <Skeleton w={14} h={8} rounded="rounded-ctl" />
      </div>

      {/* Search box */}
      <div className="mt-4">
        <Skeleton w={80} h={10} rounded="rounded-ctl" />
      </div>

      {/* Status filter chip */}
      <div className="mt-2.5 flex gap-2">
        <Skeleton w={28} h={10} rounded="rounded-ctl" />
        <Skeleton w={28} h={8} rounded="rounded-pill" />
      </div>

      {/* 8 list rows: avatar circle + 2 lines of meta */}
      <ul className="mt-3">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <li key={i} className="border-b border-line last:border-0">
            <div className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <Skeleton w={32} h={4} className="mb-1.5" />
                <Skeleton w={48} h={3} />
              </div>
              <Skeleton w={14} h={5} rounded="rounded-pill" />
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
