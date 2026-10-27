import { Skeleton } from "@/components/skeleton";

// Owner bookings cold-load. The page resolves the tenant timezone, the
// terminology and the facility list before it can render anything, and
// the facility list is a join across facilities, locations and
// sub-units. Without this file the owner sees a blank document for
// that window.
//
// The shape mirrors the real page: breadcrumb + heading, the price
// prerequisite card, then the booking form and the day board.

export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8 max-w-2xl">
      <div className="flex items-center gap-2">
        <Skeleton w={10} h={3} />
        <Skeleton w={16} h={3} />
      </div>
      <Skeleton w={28} h={6} className="mt-3" />

      <Skeleton w={80} h={10} rounded="rounded-card" className="mt-5" />

      <div className="mt-4 rounded-card border border-line p-4">
        <Skeleton w={32} h={5} />
        <Skeleton w={64} h={11} className="mt-3" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Skeleton w={38} h={11} />
          <Skeleton w={38} h={11} />
        </div>
        <Skeleton w={48} h={11} className="mt-3" />
      </div>

      <div className="mt-4 rounded-card border border-line p-4">
        <Skeleton w={40} h={5} />
        <Skeleton w={72} h={4} className="mt-3" />
        <Skeleton w={64} h={4} className="mt-2" />
      </div>
    </main>
  );
}
