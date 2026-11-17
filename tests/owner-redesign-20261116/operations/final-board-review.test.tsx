// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName } from "@/lib/services/programs";

const remove = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/programs", () => ({ createProgramAction: vi.fn(), updateProgramAction: vi.fn(), deleteProgramAction: vi.fn(), deleteBatchAction: remove, createBatchAction: vi.fn(), updateBatchAction: vi.fn() }));
vi.mock("@/lib/actions/coach-conflicts", () => ({ checkCoachConflictsAction: async () => ({ conflicts: [] }) }));
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";

const props = {
  initialPrograms: [{ id: "p", name: "Swimming" } as Program],
  initialBatches: [{ id: "b", programId: "p", programName: "Swimming", name: "Morning", daysOfWeek: [1], startTime: "07:00", endTime: "08:00", capacity: 12, locationId: "l", locationName: "Pool", coachId: null, coachName: null } as BatchWithProgramName],
  coaches: [], locations: [{ id: "l", name: "Pool" }], terminology: { overrides: {}, locale: "en" as const }, canManage: true,
};
afterEach(() => { cleanup(); remove.mockReset(); });

it.each([
  ["rejected", "Delete denied. Check access before retrying."],
  ["uncertain", "We could not confirm whether the batch was deleted. Check the batch list before retrying."],
])("shows an accessible %s deletion failure outside hidden containers", async (kind, message) => {
  if (kind === "rejected") remove.mockResolvedValueOnce({ ok: false, error: message });
  else remove.mockRejectedValueOnce(new Error("network"));
  render(<ProgramsBatchesBoard {...props} />);
  const group = screen.getByRole("group", { name: "Swimming" });
  fireEvent.click(within(group).getByRole("button", { name: "Delete Morning" }));
  fireEvent.click(within(group).getByRole("button", { name: "Confirm" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(message);
  expect(alert.closest(".hidden, [hidden], [aria-hidden='true']")).toBeNull();
  expect(within(group).getByRole("link", { name: "Morning" })).toBeTruthy();
});

it("permits batch-only users to open and cancel a contextual draft without program controls", async () => {
  render(<ProgramsBatchesBoard {...props} canManage={false} canManageBatches />);
  const group = screen.getByRole("group", { name: "Swimming" });
  expect(within(group).queryByRole("button", { name: "Edit Swimming" })).toBeNull();
  expect(within(group).queryByRole("button", { name: "Delete Swimming" })).toBeNull();
  fireEvent.click(within(group).getByRole("button", { name: "Add batch to Swimming" }));
  expect(await screen.findByRole("combobox", { name: "Program" })).toHaveProperty("value", "p");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByLabelText("Batch name")).toBeNull();
});

it.each(["contextual", "general"])("restores focus to the %s batch creation trigger on cancel", async (kind) => {
  render(<ProgramsBatchesBoard {...props} initialBatches={kind === "general" ? [] : props.initialBatches} />);
  const trigger = kind === "general" ? screen.getByTestId("add-batch") : within(screen.getByRole("group", { name: "Swimming" })).getByRole("button", { name: "Add batch to Swimming" });
  trigger.focus();
  fireEvent.click(trigger);
  const program = await screen.findByRole("combobox", { name: "Program" });
  await waitFor(() => expect(document.activeElement).toBe(program));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(document.activeElement).toBe(kind === "general" ? screen.getByTestId("add-batch") : trigger));
});
