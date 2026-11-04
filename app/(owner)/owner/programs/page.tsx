import { buttonClasses } from "@/components/ui/Button";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { cookies } from "next/headers";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { listBatchesAction, listCoachesAction, listProgramsAction } from "@/lib/actions/programs";
import { listLocationsAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";

export default async function ProgramsPage({
  searchParams,
}: {
  searchParams?: Promise<{ facility?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "programs.read");
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const facility = resolveFacilityValue(
    params.facility,
    cookieStore.get(FACILITY_COOKIE)?.value,
  );
  const [programs, batches, coaches, locations, terminology] = await Promise.all([
    listProgramsAction(),
    listBatchesAction(facility ? { locationId: facility } : undefined),
    listCoachesAction(),
    // Wave 2 — facility picker for batch create/edit.
    listLocationsAction(),
    // ProgramsBatchesBoard → BatchCreateForm / BatchEditForm use
    // closed-key `coach` and "Add a program first" copy (L3 audit).
    getTerminologyAction(),
  ]);

  return (
    <OwnerPage>
      <PageHeader
        title="Programs & batches"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {ctx.permissions.has("attendance.read") ? <Link
              href="/owner/schedule"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              data-testid="link-schedule"
            >
              <OwnerIcon name="calendar" size={15} className="text-ink-3" />
              Schedule
            </Link> : null}
            {ctx.permissions.has("programs.write") ? <Link
              href="/owner/sessions"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
              data-testid="link-sessions"
            >
              <OwnerIcon name="calendar" size={15} className="text-ink-3" />
              Sessions
            </Link> : null}
          </div>
        }
      />
      <div className="mt-5">
        <ProgramsBatchesBoard
          initialPrograms={programs}
          initialBatches={batches}
          coaches={coaches}
          locations={locations}
          terminology={terminology}
        />
      </div>
    </OwnerPage>
  );
}
