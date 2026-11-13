import { Skeleton } from "@/components/skeleton";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { MemberPageLoading } from "@/components/member-detail/member-page-loading";

// Owner light · People lane (3 November 2026) — the add-member route's own
// fallback (independent review F1).
//
// The nearest `members/loading.tsx` was removed with the in-page boundary
// experiment, which left this route falling back to `owner/loading.tsx` — the
// HOME composition (hero card + timeline) painted under an add-member form.
// This sibling boundary restores the right shape for THIS route only: the page
// frame plus the existing member form skeleton. It does not wrap the profile or
// the edit page, so the experiment stays one nearest-boundary change.
//
// The status announcement comes from the shared form skeleton
// (`role="status"`, `aria-busy`, "Loading the member form…"); the back/header
// placeholders are decorative. No directory rows, no Home collections or
// timeline, no invented counts.
export default function Loading() {
  return (
    <OwnerPage className="max-w-3xl" aria-busy="true">
      <div aria-hidden="true">
        <Skeleton w={18} h={4} />
        <Skeleton w={40} h={6} className="mt-4" />
      </div>
      <MemberPageLoading variant="edit" />
    </OwnerPage>
  );
}
