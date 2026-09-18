import { Skeleton } from "@/components/skeleton";

// U-04 — schedule grid cold-load: heading, view controls, then day
// sections with session rows.

export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8">
      <Skeleton w={16} h={4} />
      <Skeleton w={24} h={5} className="mt-2" />
      <Skeleton w={56} h={4} className="mt-2" />

      <div className="mt-4 flex flex-wrap gap-2">
        <Skeleton w={14} h={9} className="rounded-ctl" />
        <Skeleton w={14} h={9} className="rounded-ctl" />
        <Skeleton w={14} h={9} className="rounded-ctl" />
      </div>

      <div className="mt-4 space-y-4">
        {[0, 1, 2].map((d) => (
          <div key={d}>
            <Skeleton w={24} h={4} />
            <div className="mt-2 rounded-card border border-line bg-paper px-3.5 py-3">
              <Skeleton w={40} h={4} />
              <Skeleton w={56} h={1.5} className="mt-2" />
              <Skeleton w={32} h={3} className="mt-2" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
