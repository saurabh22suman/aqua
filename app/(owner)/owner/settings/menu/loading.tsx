import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="px-5 pt-6 pb-8 max-w-2xl">
      <Skeleton w={20} h={3} />
      <Skeleton w={28} h={7} className="mt-3" />
      <Skeleton w={64} h={3} className="mt-3" />
      <div className="mt-5 rounded-card bg-paper border border-line p-4">
        <Skeleton w={32} h={4} />
        <Skeleton w={56} h={4} className="mt-4" />
        <Skeleton w={24} h={4} className="mt-3" />
      </div>
      <div className="mt-4 rounded-card bg-paper border border-line p-4">
        <Skeleton w={40} h={4} />
        <Skeleton w={56} h={3} className="mt-3" />
        <Skeleton w={32} h={3} className="mt-2" />
      </div>
    </main>
  );
}
