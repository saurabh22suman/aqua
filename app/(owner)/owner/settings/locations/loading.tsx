import { Skeleton } from "@/components/skeleton";

// U-07 — locations settings cold-load: heading, then one card per
// location with fields and the hours editor.

export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8">
      <Skeleton w={16} h={4} />
      <Skeleton w={32} h={5} className="mt-2" />
      <Skeleton w={56} h={4} className="mt-2" />

      {[0, 1].map((c) => (
        <div
          key={c}
          className="mt-4 rounded-card bg-paper border border-line px-5 py-5"
        >
          <Skeleton w={28} h={4} className="mb-3" />
          <Skeleton w={48} h={9} className="rounded-ctl" />
          <Skeleton w={56} h={9} className="mt-2 rounded-ctl" />
          <Skeleton w={36} h={9} className="mt-3 rounded-pill" />
        </div>
      ))}
    </main>
  );
}
