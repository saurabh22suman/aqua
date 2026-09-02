import { Skeleton } from "@/components/skeleton";

// Phase 1.7 — loading state for the new-tenant form.

export default function NewTenantLoading() {
  return (
    <div className="max-w-3xl">
      <Skeleton w={16} h={3} className="mb-2" />
      <Skeleton w={40} h={8} className="mb-2" />
      <Skeleton w={72} h={4} />

      {[1, 2, 3].map((s) => (
        <div
          key={s}
          className="mt-6 rounded-card bg-paper border border-line p-5 space-y-4"
        >
          <div>
            <Skeleton w={32} h={5} className="mb-1" />
            <Skeleton w={56} h={3} />
          </div>
          <div className="space-y-4">
            <div>
              <Skeleton w={20} h={3} className="mb-1" />
              <Skeleton w={96} h={10} rounded="rounded-ctl" />
            </div>
            <div>
              <Skeleton w={20} h={3} className="mb-1" />
              <Skeleton w={96} h={10} rounded="rounded-ctl" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
