import { Skeleton, SkeletonCard, SkeletonLine } from "@/components/skeleton";

// Owner light · People lane (3 November 2026) — the member PROFILE and EDIT
// fallbacks.
//
// These are the in-page loading states for the member detail segment after the
// nearest segment boundary (`members/loading.tsx`) was relocated into the
// pages (one boundary variable; see MEMBERS-BOUNDARY-CANDIDATE.md).
//
// Honesty rules:
//   - the page's real header (and the edit page's Back link) is already
//     rendered above this fallback, so this component NEVER draws a header;
//   - it never shows directory rows — a member profile or a member form must
//     not look like the members list;
//   - it announces itself (`role="status"`, `aria-busy`) with real copy for a
//     screen reader, and the placeholder blocks stay `aria-hidden` inside the
//     shared Skeleton primitive.
//
// Shapes:
//   - `profile` — the three streamed overview sections, as a fragment so they
//     flow into the page's own two-column grid exactly like the real sections;
//   - `section` — one card, for the "Other tools" disclosure;
//   - `edit`    — the edit form's labelled field stack inside one card.

export function MemberPageLoading({
  variant,
}: {
  variant: "profile" | "section" | "edit";
}) {
  const label =
    variant === "edit" ? "Loading the member form…" : "Loading member details…";

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={variant === "profile" ? "contents" : variant === "section" ? "mt-3" : "mt-4"}
    >
      <span className="sr-only">{label}</span>
      {variant === "edit" ? (
        <EditFormSkeleton />
      ) : variant === "section" ? (
        <SkeletonCard>
          <SkeletonLine count={3} />
        </SkeletonCard>
      ) : (
        <ProfileSectionsSkeleton />
      )}
    </div>
  );
}

// The three streamed overview sections, shaped like the surfaces that arrive:
// participation & enrolment, contacts & consent, attendance evidence.
function ProfileSectionsSkeleton() {
  return (
    <>
      <div>
        <Skeleton w={26} h={3} />
        <SkeletonCard className="mt-3">
          <Skeleton w={30} h={3} />
          <Skeleton w={22} h={5} className="mt-2" />
          <SkeletonLine count={2} className="mt-3" />
        </SkeletonCard>
        <SkeletonCard className="mt-3">
          <Skeleton w={24} h={3} />
          <SkeletonLine count={3} className="mt-3" />
        </SkeletonCard>
      </div>
      <div>
        <Skeleton w={30} h={3} />
        <SkeletonCard className="mt-3">
          <SkeletonLine count={4} />
        </SkeletonCard>
        <Skeleton w={24} h={3} className="mt-5" />
        <SkeletonCard className="mt-2">
          <SkeletonLine count={4} />
        </SkeletonCard>
      </div>
      <div>
        <Skeleton w={28} h={3} />
        <SkeletonCard className="mt-3">
          <SkeletonLine count={3} />
        </SkeletonCard>
      </div>
    </>
  );
}

function EditFormSkeleton() {
  return (
    <div className="rounded-card border border-line bg-paper p-4">
      <Skeleton w={26} h={4} />
      <div className="mt-4 space-y-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i}>
            <Skeleton w={i % 2 === 0 ? 22 : 16} h={3} />
            <Skeleton
              w={i % 2 === 0 ? 60 : 40}
              h={12}
              rounded="rounded-ctl"
              className="mt-1.5"
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton w={24} h={11} rounded="rounded-ctl" />
        <Skeleton w={44} h={11} rounded="rounded-ctl" />
      </div>
    </div>
  );
}
