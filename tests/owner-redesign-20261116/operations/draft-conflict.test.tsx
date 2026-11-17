// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName } from "@/lib/services/programs";
vi.mock("@/lib/actions/programs", () => ({ createProgramAction: vi.fn(), updateProgramAction: vi.fn(), deleteProgramAction: vi.fn(), deleteBatchAction: vi.fn(), createBatchAction: vi.fn(), updateBatchAction: vi.fn() }));
vi.mock("@/lib/actions/coach-conflicts", () => ({ checkCoachConflictsAction: async () => ({ conflicts: [] }) }));
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
afterEach(cleanup);
it("prevents batch row editing and deletion while a new batch draft is open", async () => {
  render(<ProgramsBatchesBoard canManage initialPrograms={[{ id: "p", name: "Swimming" } as Program]} initialBatches={[{ id: "b", programId: "p", programName: "Swimming", name: "Morning", daysOfWeek: [1], startTime: "07:00", endTime: "08:00", capacity: 12, locationId: "l", locationName: "Pool", coachId: null, coachName: null } as BatchWithProgramName]} coaches={[]} locations={[{ id: "l", name: "Pool" }]} terminology={{ overrides: {}, locale: "en" }} />);
  const group = screen.getByRole("group", { name: "Swimming" });
  fireEvent.click(within(group).getByRole("button", { name: "Add batch to Swimming" }));
  fireEvent.change(await screen.findByLabelText("Batch name"), { target: { value: "New draft" } });
  expect(within(group).getByRole("button", { name: "Edit Morning" })).toHaveProperty("disabled", true);
  expect(within(group).getByRole("button", { name: "Delete Morning" })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Batch name")).toHaveProperty("value", "New draft");
});
it("prevents creation while a batch edit is open and keeps the edit draft", async () => {
  render(<ProgramsBatchesBoard canManage initialPrograms={[{ id: "p", name: "Swimming" } as Program]} initialBatches={[{ id: "b", programId: "p", programName: "Swimming", name: "Morning", daysOfWeek: [1], startTime: "07:00", endTime: "08:00", capacity: 12, locationId: "l", locationName: "Pool", coachId: null, coachName: null } as BatchWithProgramName]} coaches={[]} locations={[{ id: "l", name: "Pool" }]} terminology={{ overrides: {}, locale: "en" }} />);
  const group = screen.getByRole("group", { name: "Swimming" });
  fireEvent.click(within(group).getByRole("button", { name: "Edit Morning" }));
  const draft = await within(group).findByPlaceholderText("Batch name");
  fireEvent.change(draft, { target: { value: "Edited draft" } });
  expect(within(group).getByRole("button", { name: "Add batch to Swimming" })).toHaveProperty("disabled", true);
  expect(screen.queryByTestId("add-program")).toBeNull();
  expect(draft).toHaveProperty("value", "Edited draft");
});

it("keeps program editing available while batch options are not authorized", () => {
  render(<ProgramsBatchesBoard canManage canManageBatches={false} initialPrograms={[{id:"p",name:"Swimming"} as Program]} initialBatches={[]} coaches={[]} locations={[]} terminology={{overrides:{},locale:"en"}} />);
  const group=screen.getByRole("group",{name:"Swimming"});
  expect(within(group).queryByRole("button",{name:"Add batch to Swimming"})).toBeNull();
  fireEvent.click(within(group).getByRole("button",{name:"Edit Swimming"}));
  expect(within(group).getByRole("textbox",{name:"Program name"})).toHaveProperty("value","Swimming");
  expect(within(group).getByRole("button",{name:"Save program"})).toBeTruthy();
});
