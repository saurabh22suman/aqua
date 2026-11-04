// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName } from "@/lib/services/programs";
vi.mock("@/lib/actions/programs", () => ({ createProgramAction: vi.fn(), updateProgramAction: vi.fn(), deleteProgramAction: vi.fn(), deleteBatchAction: vi.fn(), createBatchAction: vi.fn(), updateBatchAction: vi.fn() }));
vi.mock("@/lib/actions/coach-conflicts", () => ({ checkCoachConflictsAction: vi.fn() }));
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
afterEach(cleanup);
it("groups real batches under their program and describes invalid weekdays without guessing", () => {
  const p = {id:"p",name:"Swimming"} as Program;
  const b = {id:"b",programId:"p",programName:"Swimming",name:"Morning",daysOfWeek:[1,3,7],startTime:"06:00",endTime:"07:00",capacity:12,coachName:null,locationName:"Main"} as BatchWithProgramName;
  render(<ProgramsBatchesBoard initialPrograms={[p]} initialBatches={[b]} coaches={[]} locations={[]} terminology={{locale:"en",overrides:{}}} />);
  const group = screen.getByRole("group", {name:"Swimming"});
  expect(within(group).getByRole("link", {name:"Morning"}).getAttribute("href")).toBe("/owner/batches/b");
  expect(within(group).getByText(/Mon.*Wed.*day not recognised/i)).toBeTruthy();
  expect(within(group).getByRole("button", {name:"Edit Swimming"})).toBeTruthy();
  expect(within(group).getByRole("button", {name:"Delete Swimming"})).toBeTruthy();
});
it("puts the mobile add action with the grouped batches rather than an empty card", () => {
  const p = {id:"p",name:"Swimming"} as Program;
  const b = {id:"b",programId:"p",programName:"Swimming",name:"Morning",daysOfWeek:[1],startTime:"06:00",endTime:"07:00",capacity:12,coachName:null,locationName:"Main"} as BatchWithProgramName;
  render(<ProgramsBatchesBoard initialPrograms={[p]} initialBatches={[b]} coaches={[]} locations={[]} terminology={{locale:"en",overrides:{}}} />);
  const programs = screen.getByRole("heading", {name:"Programs"}).closest("section")!;
  const recurring = screen.getByRole("heading", {name:"Recurring batches"}).closest("section")!;
  expect(recurring.className).toMatch(/\bhidden\b/);
  expect(recurring.className).toContain("md:block");
  expect(within(programs).getByRole("link", {name:"Morning"}).closest("ul")?.className).toContain("md:hidden");
  fireEvent.click(within(programs).getByRole("button", {name:"Add batch"}));
  expect(recurring.className).not.toMatch(/\bhidden\b/);
  expect(within(recurring).getByLabelText("Program")).toBeTruthy();
  fireEvent.click(within(recurring).getByRole("button", {name:"Cancel"}));
  expect(recurring.className).toContain("md:block");
});
