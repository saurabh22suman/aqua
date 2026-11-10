import { Suspense } from "react";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { cookies } from "next/headers";
import { Upload } from "lucide-react";
import { listMembersAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { MembersBoard } from "@/components/members-board";
import { MembersListLoading } from "@/components/members-list-loading";
import { OwnerCreateAction } from "@/components/owner-ui/owner-create-action";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { buttonClasses } from "@/components/ui/Button";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { DEFAULT_TERMS, titleCase } from "@/lib/terminology/keys";
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
        canWriteMembers={canWriteMembers}
        initialLocationId={initialLocationId}
        navigationNamespace={`${ctx.tenantId}:${ctx.userId}`}
      />
    </Suspense>
  );
}

async function MembersDirectory({
  canWriteMembers,
  initialLocationId,
  navigationNamespace,
}: {
  canWriteMembers: boolean;
  initialLocationId: string | undefined;
  navigationNamespace: string;
}) {
  const [members, terminology] = await Promise.all([
    listMembersAction({ locationId: initialLocationId }),
    getTerminologyAction(),
  ]);

  // The ONE create affordance for the directory. The shared
  // OwnerCreateAction is the round floating action above the phone
  // navigation and the inline labelled primary action on a desktop, so
  // the same job never appears twice at one viewport. Import stays a
  // SECONDARY action beside it — it is a different job, not a second
  // primary.
  //
  // A club-wide member can join more than one sport.
  // Use the locale default, including for legacy sport-specific presets.
  const addMemberLabel = `Add ${DEFAULT_TERMS[terminology.locale].member.one}`;
  const addMemberHref = initialLocationId
    ? `/owner/members/new?facility=${initialLocationId}`
    : "/owner/members/new";

  return (
    <OwnerPage>
      <PageHeader
        title={titleCase(DEFAULT_TERMS[terminology.locale].member.other)}
        action={
          canWriteMembers ? (
            <div className="flex flex-none items-center gap-2">
              <Link
                href="/owner/members/import"
                className={buttonClasses({ variant: "secondary", size: "md" })}
                data-testid="members-import-link"
              >
                {/* No upload glyph exists in the approved mock; the thin
                    Lucide outline stays, documented in the lane handoff. */}
                <Upload size={15} strokeWidth={2.2} aria-hidden="true" />
                Import
              </Link>
              <OwnerCreateAction
                href={addMemberHref}
                label={addMemberLabel}
                testId="members-create-action"
              />
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
      <div className="mt-4">
        <MembersBoard
          initialMembers={members}
          terminology={terminology}
          initialLocationId={initialLocationId}
          navigationNamespace={navigationNamespace}
          canWrite={canWriteMembers}
        />
      </div>
    </OwnerPage>
  );
}
