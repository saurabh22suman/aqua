import Link from "next/link";
import { Calendar } from "lucide-react";
import { listBatchesAction, listCoachesAction, listProgramsAction } from "@/lib/actions/programs";
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";

export default async function ProgramsPage() {
  const [programs, batches, coaches] = await Promise.all([
    listProgramsAction(),
    listBatchesAction(),
    listCoachesAction(),
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
        <ProgramsBatchesBoard initialPrograms={programs} initialBatches={batches} coaches={coaches} />
      </div>
    </main>
  );
}
