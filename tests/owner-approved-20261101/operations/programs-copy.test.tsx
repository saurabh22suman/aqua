// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Program } from "@/db/schema/programs";
vi.mock("@/lib/actions/programs", () => ({ createProgramAction: vi.fn(), updateProgramAction: vi.fn(), deleteProgramAction: vi.fn(), deleteBatchAction: vi.fn(), createBatchAction: vi.fn(), updateBatchAction: vi.fn() }));
vi.mock("@/lib/actions/coach-conflicts", () => ({ checkCoachConflictsAction: vi.fn() }));
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
afterEach(cleanup);
const program = { id: "p1", tenantId: "t1", name: "Swimming", createdAt: new Date(), updatedAt: new Date() } as Program;
function board(initialPrograms: Program[]) { return render(<ProgramsBatchesBoard initialPrograms={initialPrograms} initialBatches={[]} coaches={[]} locations={[]} terminology={{ locale: "en", overrides: {} }} />); }
it("does not ask the owner to add a program when one already exists", () => {
  board([program]);
  expect(screen.queryByText(/add one before creating a batch/i)).toBeNull();
  expect(screen.getByText("1 program")).toBeTruthy();
});
it("gives a creation instruction when the program list is empty", () => {
  board([]);
  expect(screen.getByText(/0 programs/i)).toBeTruthy();
  expect(screen.getAllByText(/add.*program.*first|add the first one/i).length).toBeGreaterThan(0);
});
