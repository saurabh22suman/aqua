import { Skeleton } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";

// Owner light · People lane (3 November 2026) — the import route's own fallback
// (independent review F1).
//
// Same correction as `members/new/loading.tsx`: without a sibling boundary this
// route fell back to `owner/loading.tsx`, the HOME composition, painted under a
// file-import screen. This skeleton is the import task's own small shape — the
// page frame, the file-check card and the action row — announced as busy. It
// does not wrap the profile or the edit page.
//
// No Home collections or timeline, no directory rows, and no invented counts or
// row values: every block is a placeholder, not a number.
export default function Loading() {
  return (
    <OwnerPage className="max-w-3xl" aria-busy="true">
      <div role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading the import…</span>
        <div aria-hidden="true">
          <Skeleton w={18} h={4} />
          <Skeleton w={40} h={6} className="mt-4" />
          <Skeleton w={64} h={3} className="mt-2" />

          <div className="mt-4 rounded-card border border-line bg-paper p-4">
            <Skeleton w={28} h={4} />
            <div className="mt-3 rounded-ctl border border-dashed border-line p-6">
              <Skeleton w={24} h={4} className="mx-auto" />
              <Skeleton w={40} h={3} className="mx-auto mt-2" />
            </div>
            <div className="mt-4 flex gap-2">
              <Skeleton w={28} h={11} rounded="rounded-ctl" />
              <Skeleton w={20} h={11} rounded="rounded-ctl" />
            </div>
          </div>
        </div>
      </div>
    </OwnerPage>
  );
}
