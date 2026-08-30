import { listBatchesAction, listProgramsAction } from "@/lib/actions/programs";
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";

export default async function ProgramsPage() {
  const [programs, batches] = await Promise.all([listProgramsAction(), listBatchesAction()]);

  return (
    <main className="px-5 pt-10">
      <h1 className="font-display text-[19px] font-semibold">Programs</h1>
      <div className="mt-4">
        <ProgramsBatchesBoard initialPrograms={programs} initialBatches={batches} />
      </div>
    </main>
  );
}
