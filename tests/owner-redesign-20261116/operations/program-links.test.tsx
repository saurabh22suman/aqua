// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName } from "@/lib/services/programs";
vi.mock("@/lib/actions/programs", () => ({ createProgramAction: vi.fn(), updateProgramAction: vi.fn(), deleteProgramAction: vi.fn(), deleteBatchAction: vi.fn(), createBatchAction: vi.fn(), updateBatchAction: vi.fn() }));
vi.mock("@/lib/actions/coach-conflicts", () => ({ checkCoachConflictsAction: async () => ({ conflicts: [] }) }));
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
afterEach(cleanup);
it("keeps explicit all on a batch link so a stale cookie cannot narrow it", () => {
  render(<ProgramsBatchesBoard canManage={false} initialPrograms={[{ id: "p", name: "Swimming" } as Program]} initialBatches={[{ id: "b", programId: "p", programName: "Swimming", name: "Morning", daysOfWeek: [1], startTime: "07:00", endTime: "08:00", capacity: 12, locationId: "l", locationName: "Pool", coachId: null, coachName: null } as BatchWithProgramName]} coaches={[]} locations={[]} terminology={{ overrides: {}, locale: "en" }} />);
  expect(within(screen.getByRole("group", { name: "Swimming" })).getByRole("link", { name: "Morning" }).getAttribute("href")).toBe("/owner/batches/b?facility=all");
});
