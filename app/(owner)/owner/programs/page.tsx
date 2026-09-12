import Link from "next/link";
import { Calendar } from "lucide-react";
import { listBatchesAction, listCoachesAction, listProgramsAction } from "@/lib/actions/programs";
import { listLocationsAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
import { requireOwner } from "@/lib/auth/surface-guard";

export default async function ProgramsPage() {
  await requireOwner();
  const [programs, batches, coaches, locations, terminology] = await Promise.all([
    listProgramsAction(),
    listBatchesAction(),
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
        <Link
          href="/owner/sessions"
          className="inline-flex items-center gap-1.5 rounded-ctl border border-line bg-paper px-3 py-1.5 text-[12.5px] font-medium text-ink-2"
          data-testid="link-sessions"
        >
          <Calendar size={14} className="text-ink-3" />
          Sessions
        </Link>
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
