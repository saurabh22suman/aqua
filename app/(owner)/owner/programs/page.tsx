import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { buttonClasses } from "@/components/ui/Button";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerDesignHeading } from "@/components/owner-approved/owner-design-heading";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { cookies } from "next/headers";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { listBatchesAction, listCoachesAction, listProgramsAction } from "@/lib/actions/programs";
import { listLocationsAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { FACILITY_COOKIE, parseFacilityValue, resolveFacilityValue } from "@/lib/facility";
import { canSelectFacility } from "@/lib/services/selected-facility-access";
import { ownerFacilityHref } from "@/lib/owner-scope/facility";

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams?: Promise<{ facility?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "programs.read");
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const requestedFacility = params.facility ?? cookieStore.get(FACILITY_COOKIE)?.value;
  const facility = resolveFacilityValue(
    params.facility,
    cookieStore.get(FACILITY_COOKIE)?.value,
  );
  if ((requestedFacility !== undefined && requestedFacility !== "all" && !parseFacilityValue(requestedFacility)) ||
      (facility && !(await canSelectFacility(ctx, facility)))) {
    return <OwnerPage><OwnerDesignHeading title="Club unavailable" purpose="This club is unavailable for your account." /><Link href="/owner/programs?facility=all" className={buttonClasses({variant:"secondary",size:"md"})}>View available clubs</Link></OwnerPage>;
  }
  // These options come from existing staff/member reads. Do not invoke an
  // editor-only action a read-only catalogue viewer is not allowed to call.
  const canManage = ctx.permissions.has("programs.write");
  const canManageBatches = canManage && ctx.permissions.has("staff.read") && ctx.permissions.has("members.read");
  const [programs, batches, coaches, locations, terminology] = await Promise.all([
    listProgramsAction(),
    listBatchesAction(facility ? { locationId: facility } : undefined),
    canManageBatches ? listCoachesAction() : Promise.resolve([]),
    // Wave 2 — facility picker for batch create/edit.
    canManageBatches ? listLocationsAction() : Promise.resolve([]),
    // ProgramsBatchesBoard → BatchCreateForm / BatchEditForm use
    // closed-key `coach` and "Add a program first" copy (L3 audit).
    getTerminologyAction().then(ownerTerminology),
  ]);

  return (
    <OwnerPage>
      <ProgramsBatchesBoard
          scopeLabel={facility ? batches.find((batch) => batch.locationId === facility)?.locationName ?? locations.find((location) => location.id === facility)?.name ?? "selected club" : "all available clubs"}
          toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {ctx.permissions.has("attendance.read") ? <Link
              href={ownerFacilityHref("/owner/schedule", facility)}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              data-testid="link-schedule"
            >
              <OwnerIcon name="calendar" size={15} className="text-ink-3" />
              Schedule
            </Link> : null}
            {ctx.permissions.has("programs.write") ? <Link
              href={ownerFacilityHref("/owner/sessions", facility)}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              data-testid="link-sessions"
            >
              <OwnerIcon name="calendar" size={15} className="text-ink-3" />
              Sessions
            </Link> : null}
          </div>
          }
          initialPrograms={programs}
          initialBatches={batches}
          coaches={coaches}
          locations={locations}
          terminology={terminology}
          selectedFacilityId={facility ?? undefined}
          canManage={canManage}
          canManageBatches={canManageBatches}
        />
    </OwnerPage>
  );
}
