// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Program } from "@/db/schema/programs";
const save = vi.hoisted(() => vi.fn(async () => { throw new Error("network"); }));
vi.mock("@/lib/actions/programs", () => ({ createProgramAction: vi.fn(), updateProgramAction: save, deleteProgramAction: vi.fn(), deleteBatchAction: vi.fn(), createBatchAction: vi.fn(), updateBatchAction: vi.fn() }));
vi.mock("@/lib/actions/coach-conflicts", () => ({ checkCoachConflictsAction: async () => ({ conflicts: [] }) }));
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
afterEach(cleanup);
it("keeps a program edit and announces an uncertain save when transport rejects", async () => {
  render(<ProgramsBatchesBoard canManage initialPrograms={[{ id: "p", name: "Swimming" } as Program]} initialBatches={[]} coaches={[]} locations={[]} terminology={{ overrides: {}, locale: "en" }} />);
  const group = screen.getByRole("group", { name: "Swimming" });
  fireEvent.click(within(group).getByRole("button", { name: "Edit Swimming" }));
  fireEvent.change(within(group).getByRole("textbox"), { target: { value: "Draft swimming" } });
  fireEvent.click(within(group).getByRole("button", { name: "Save program" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/check.*before retry/i);
  expect(within(group).getByRole("textbox")).toHaveProperty("value", "Draft swimming");
});
