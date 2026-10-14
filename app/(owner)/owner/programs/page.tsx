import Link from "next/link";
import { cookies } from "next/headers";
import { Calendar, CalendarDays } from "lucide-react";
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
    <main className="px-5 pt-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-[19px] font-semibold">Programs</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/owner/schedule"
            className="inline-flex items-center gap-1.5 rounded-ctl border border-line bg-paper px-3 py-1.5 text-[12.5px] font-medium text-ink-2"
            data-testid="link-schedule"
          >
            <CalendarDays size={14} className="text-ink-3" />
            Schedule
          </Link>
          <Link
            href="/owner/sessions"
            className="inline-flex items-center gap-1.5 rounded-ctl border border-line bg-paper px-3 py-1.5 text-[12.5px] font-medium text-ink-2"
            data-testid="link-sessions"
          >
            <Calendar size={14} className="text-ink-3" />
            Sessions
          </Link>
        </div>
      </div>
      <div className="mt-4">
        <ProgramsBatchesBoard
          initialPrograms={programs}
          initialBatches={batches}
          coaches={coaches}
          locations={locations}
          terminology={terminology}
        />
      </div>
    </main>
  );
}
