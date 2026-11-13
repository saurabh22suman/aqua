import { Skeleton, SkeletonCard, SkeletonLine } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

// Owner light · People lane (4 November 2026) — the member segment's transition
// fallback (the profile and its edit form).
//
// The profile resolves its authorized overview data BEFORE it returns its JSX,
// so this route-level fallback is the only surface a normal directory → profile
// transition paints while the page is in flight. It must therefore be a member
// shape: never the HOME composition from `owner/loading.tsx`, never directory
// rows, and it announces itself rather than showing an unexplained blank.
export default function Loading() {
  return (
    <OwnerPage>
      <div role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading details…</span>
        <Skeleton w={20} h={4} />
        <div className="mt-2 rounded-card border border-line bg-paper p-4">
          <Skeleton w={38} h={6} />
          <Skeleton w={52} h={3} className="mt-2" />
          <Skeleton w={64} h={9} rounded="rounded-ctl" className="mt-4" />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-x-5 gap-y-6 lg:grid-cols-2 lg:items-start">
          {[0, 1].map((card) => (
            <div key={card}>
              <Skeleton w={28} h={3} />
              <SkeletonCard className="mt-3">
                <SkeletonLine count={3} />
              </SkeletonCard>
            </div>
          ))}
        </div>
      </div>
    </OwnerPage>
  );
}
