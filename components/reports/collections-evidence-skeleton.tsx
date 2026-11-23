import { Skeleton } from "@/components/skeleton";

export function CollectionsEvidenceSkeleton() {
  return (
    <div aria-hidden="true" className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 rounded-card border border-line bg-paper p-5">
        <Skeleton w={34} h={4} />
        <Skeleton w={56} h={3} className="mt-2" />
        <Skeleton w={28} h={6} className="mt-2" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="grid grid-cols-3 gap-3">
              <Skeleton w={22} h={3} />
              <Skeleton w={8} h={3} className="ml-auto" />
              <Skeleton w={15} h={3} className="ml-auto" />
            </div>
          ))}
        </div>
      </div>
      <div className="min-w-0 rounded-card border border-line bg-paper p-5">
        <Skeleton w={27} h={4} />
        <Skeleton w={48} h={3} className="mt-2" />
        <Skeleton w="full" h={11} rounded="rounded-ctl" className="mt-4" />
      </div>
    </div>
  );
}
