// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName } from "@/lib/services/programs";
vi.mock("@/lib/actions/programs", () => ({ createProgramAction: vi.fn(), updateProgramAction: vi.fn(), deleteProgramAction: vi.fn(), deleteBatchAction: vi.fn(), createBatchAction: vi.fn(), updateBatchAction: vi.fn() }));
vi.mock("@/lib/actions/coach-conflicts", () => ({ checkCoachConflictsAction: async () => ({ conflicts: [] }) }));
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
afterEach(cleanup);
it("groups the program editor actions in order and keeps create beside the live count", () => {
  render(<ProgramsBatchesBoard canManage initialPrograms={[{ id: "p", name: "Training" } as Program]} initialBatches={[]} coaches={[]} locations={[]} terminology={{ overrides: {}, locale: "en" }} />);
  const heading = screen.getByRole("heading", { name: "Programs & batches" });
  expect(heading.parentElement?.parentElement?.textContent).toContain("1 program · 0 batches");
  expect(within(heading.parentElement!.parentElement!).getByRole("button", { name: /add program/i })).toBeTruthy();
  const group = within(screen.getByRole("group", { name: "Training" })).getByRole("group", { name: "Training program actions" });
  const edit = within(group).getByRole("button", { name: "Edit Training" });
  const add = within(group).getByRole("button", { name: "Add batch to Training" });
  expect(edit.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("puts visible named actions and real batch context with their program", () => {
  render(<ProgramsBatchesBoard canManage initialPrograms={[{ id: "p", name: "Badminton" } as Program]} initialBatches={[{ id: "b", programId: "p", programName: "Badminton", name: "Morning", daysOfWeek: [1], startTime: "07:00", endTime: "08:00", capacity: 12, locationId: "l", locationName: "MP18", coachId: null, coachName: "Anita" } as BatchWithProgramName]} coaches={[]} locations={[{ id: "l", name: "MP18" }]} terminology={{ overrides: {}, locale: "en" }} />);
  const card = screen.getByRole("group", { name: "Badminton" });
  expect(within(card).getByRole("button", { name: "Edit Badminton" }).textContent).toContain("Edit program");
  expect(within(card).getByRole("button", { name: "Add batch to Badminton" }).textContent).toContain("Add batch");
  expect(card.textContent).toContain("MP18");
  expect(card.textContent).toContain("Anita");
  expect(card.textContent).toContain("12 places");
  expect(card.textContent).toContain("Mon");
  expect(within(card).getByRole("link", { name: "View batch Morning" }).getAttribute("href")).toContain("/owner/batches/b");
  expect(within(card).getByRole("button", { name: "Edit Morning" }).textContent).toContain("Edit batch");
  const details = within(card).getByRole("group", { name: "Morning details" });
  const actions = within(card).getByRole("group", { name: "Morning actions" });
  expect(details.textContent).toContain("MP18");
  expect(within(actions).getByRole("link", { name: "View batch Morning" })).toBeTruthy();
  expect(within(actions).getByRole("button", { name: "Edit Morning" })).toBeTruthy();
  expect(details.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("focuses the program edit and returns focus to its initiating button on cancel", () => {
  render(<ProgramsBatchesBoard canManage initialPrograms={[{ id: "p", name: "Badminton" } as Program]} initialBatches={[]} coaches={[]} locations={[]} terminology={{ overrides: {}, locale: "en" }} />);
  const card = screen.getByRole("group", { name: "Badminton" });
  const edit = within(card).getByRole("button", { name: "Edit Badminton" });
  fireEvent.click(edit);
  expect(document.activeElement).toBe(within(card).getByRole("textbox"));
  fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(within(card).getByRole("button", { name: "Edit Badminton" }));
});
