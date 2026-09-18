import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="px-5 pt-10 pb-8 max-w-lg">
      <Skeleton w={22} h={7} />
      <Skeleton w={60} h={4} className="mt-3" />
      <div className="mt-6 rounded-card bg-paper border border-line p-4">
        <Skeleton w={20} h={4} />
        <Skeleton w={48} h={10} className="mt-3" />
        <Skeleton w={36} h={10} className="mt-3" />
        <Skeleton w={24} h={4} className="mt-4" />
      </div>
      <div className="mt-6 rounded-card bg-paper border border-line p-4">
        <Skeleton w={16} h={4} />
        <Skeleton w={44} h={3} className="mt-3" />
        <Skeleton w={40} h={3} className="mt-2" />
        <Skeleton w={32} h={3} className="mt-2" />
      </div>
    </main>
  );
}
