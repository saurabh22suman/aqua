import { Skeleton } from "@/components/skeleton";

// Skills editor cold-load. Shape mirrors /owner/settings/skills: the
// breadcrumb, heading, intro line, then one framework block (level
// card + three skill cards) so the owner sees where the ladder will
// land while the framework query resolves.
export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8 max-w-2xl">
      <Skeleton w={32} h={3} />
      <Skeleton w={36} h={5} className="mt-2" />
      <Skeleton w={72} h={3} className="mt-2" />

      <div className="mt-5">
        <Skeleton w={40} h={4} />
        <Skeleton w={24} h={3} className="mt-1" />
        <div className="mt-3 rounded-card border border-line bg-paper p-3.5">
          <Skeleton w={16} h={3} />
          <Skeleton w={64} h={11} rounded="rounded-ctl" className="mt-1.5" />
          <Skeleton w={20} h={11} rounded="rounded-pill" className="mt-2" />
        </div>
        <div className="mt-1 rounded-card border border-line bg-paper px-3.5 py-3">
          <Skeleton w={12} h={3} />
          <Skeleton w={64} h={11} rounded="rounded-ctl" className="mt-1.5" />
          <Skeleton w={32} h={3} className="mt-2" />
        </div>
      </div>
    </main>
  );
}
