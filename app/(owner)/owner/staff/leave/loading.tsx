import { Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <main className="px-5 pt-10 pb-8">
      <Skeleton w={18} h={4} />
      <Skeleton w={28} h={6} className="mt-3" />
      <Skeleton w={56} h={3} className="mt-3" />
      <div className="mt-6 rounded-card border border-line bg-paper p-4">
        <Skeleton w={22} h={4} />
        <Skeleton w={60} h={3} className="mt-3" />
        <Skeleton w={52} h={3} className="mt-2" />
      </div>
    </main>
  );
}
