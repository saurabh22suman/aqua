import { Skeleton } from "@/components/skeleton";

// Owner booking-prices cold-load. The page resolves the facility
// catalogue and the price rules before it can render, so without this
// file the owner sees a blank document for that window.
//
// The shape mirrors the real page: breadcrumb + heading, then the
// price form, then the configured-price list.

export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8 max-w-2xl">
      <div className="flex items-center gap-2">
        <Skeleton w={14} h={3} />
        <Skeleton w={18} h={3} />
      </div>
      <Skeleton w={32} h={6} className="mt-3" />

      <div className="mt-5 rounded-card border border-line p-4">
        <Skeleton w={24} h={5} />
        <Skeleton w={72} h={8} className="mt-3" />
        <Skeleton w={48} h={11} className="mt-4" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Skeleton w={38} h={11} />
          <Skeleton w={38} h={11} />
        </div>
        <Skeleton w={56} h={11} className="mt-3" />
      </div>

      <div className="mt-4 rounded-card border border-line p-4">
        <Skeleton w={28} h={5} />
        <Skeleton w={64} h={4} className="mt-3" />
        <Skeleton w={56} h={4} className="mt-2" />
      </div>
    </main>
  );
}
