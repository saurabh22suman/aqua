import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="px-5 pt-10 pb-8">
      <Skeleton w={18} h={4} />
      <Skeleton w={40} h={6} className="mt-3" />
      <Skeleton w={72} h={3} className="mt-3" />
      <div className="mt-6 rounded-card border border-line bg-paper p-4">
        <Skeleton w={24} h={4} />
        <Skeleton w={64} h={10} className="mt-3" />
        <Skeleton w={56} h={10} className="mt-3" />
      </div>
      <div className="mt-4 rounded-card border border-line bg-paper p-4">
        <Skeleton w={20} h={4} />
        <Skeleton w={48} h={3} className="mt-3" />
        <Skeleton w={40} h={3} className="mt-2" />
      </div>
    </main>
  );
}
