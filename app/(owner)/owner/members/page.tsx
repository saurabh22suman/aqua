import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { Suspense } from "react";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { cookies } from "next/headers";
import { Upload } from "lucide-react";
import { listMembersAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { MembersBoard } from "@/components/members-board";
import MembersListLoading from "./loading";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerDesignHeading } from "@/components/owner-approved/owner-design-heading";
import { buttonClasses } from "@/components/ui/Button";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";

// The directory owns its loading state now. The nearest segment boundary
// (`members/loading.tsx`) was relocated into this page behind an in-page
// Suspense boundary (one boundary variable; see
// MEMBERS-BOUNDARY-CANDIDATE.md). The guard runs BEFORE the boundary, so a
// caller without `members.read` is refused instead of shown a skeleton, and
// the directory read happens inside the streamed section.
export default async function MembersPage({
  searchParams,
}: {
  searchParams?: Promise<{ facility?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "members.read");
  const canWriteMembers = hasPermission(ctx, "members.write");
  const canViewProfile = canWriteMembers || hasPermission(ctx, "attendance.read") || hasPermission(ctx, "invoices.read");
  const params = searchParams ? await searchParams : {};
  // W1-6 — the owner layout's facility switcher persists the choice in
  // `?facility=` and a cookie. The URL wins; the cookie carries the
  // choice to pages opened from the sidebar. "all" (or a malformed
  // value) means the consolidated list.
  const cookieStore = await cookies();
  const initialLocationId = resolveFacilityValue(
    params.facility,
    cookieStore.get(FACILITY_COOKIE)?.value,
  );

  return (
    <Suspense fallback={<MembersListLoading />}>
      <MembersDirectory
        compactFilters={ctx.roleKey === "owner"}
        canWriteMembers={canWriteMembers}
        canViewProfile={canViewProfile}
        initialLocationId={initialLocationId}
        navigationNamespace={`${ctx.tenantId}:${ctx.userId}`}
      />
    </Suspense>
  );
}

async function MembersDirectory({
  compactFilters,
  canWriteMembers,
  canViewProfile,
  initialLocationId,
  navigationNamespace,
}: {
  compactFilters: boolean;
  canWriteMembers: boolean;
  canViewProfile: boolean;
  initialLocationId: string | undefined;
  navigationNamespace: string;
}) {
  const [members, terminology] = await Promise.all([
    listMembersAction({ locationId: initialLocationId }).catch(() => null),
    getTerminologyAction().then(ownerTerminology),
  ]);

  // Keep the explicit all-facilities scope when navigating to creation.
  const addMemberLabel = `Add ${resolveTerm(terminology, "member", 1)}`;
  const addMemberHref = `/owner/members/new?facility=${initialLocationId ?? "all"}`;

  return (
    <OwnerPage workflow="directory">
      <OwnerDesignHeading
        title={titleCase(resolveTerm(terminology, "member", "other"))}
        purpose={canViewProfile ? "Find a member and open their profile to review their plan, fees or progress." : "Search the directory by name, phone or member code."}
        className="flex-col items-stretch sm:flex-row sm:items-center"
        action={
          canWriteMembers ? (
            <div className="flex max-w-full flex-wrap items-center gap-2">
              <Link href={addMemberHref} className={buttonClasses({ variant: "primary", size: "sm" })} data-testid="members-create-action">
                <OwnerIcon name="plus" size={16} />
                {addMemberLabel}
              </Link>
              <Link
                href="/owner/members/import"
                className={buttonClasses({ variant: "ghost", size: "sm" })}
                data-testid="members-import-link"
              >
                {/* No upload glyph exists in the approved mock; the thin
                    Lucide outline stays, documented in the lane handoff. */}
                <Upload size={15} strokeWidth={2.2} aria-hidden="true" />
                Import
              </Link>
            </div>
          ) : null
        }
      />
      {/* The empty message has ONE owner: the BOARD, inside the list it
          belongs to. This page used to render its own paragraph as
          well — "No members yet — add the first one, or import your
          existing register" — so the owner read the same news twice, in
          two different sentences. The page keeps its heading and its one
          create action; the import action stays in the header beside
          it. */}
      <div>
        <MembersBoard
          compactFilters={compactFilters}
          initialMembers={members ?? []}
          initialReadFailed={members === null}
          terminology={terminology}
          initialLocationId={initialLocationId}
          navigationNamespace={navigationNamespace}
          canWrite={canWriteMembers}
          canViewProfile={canViewProfile}
        />
      </div>
    </OwnerPage>
  );
}
