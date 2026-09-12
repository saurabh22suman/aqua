// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Phase 1b (mobile UX plan v2) — EmptyState wired into the four
// high-signal empties, and Tap wired onto the icon-only controls that
// the audit measured under 44×44.
//
// The two behaviour additions proven here (register zero-enrolled copy,
// ≥44px icon buttons) were red before the wiring; the members/reception
// assertions are characterization for a structural refactor.

const listMembersAction = vi.fn();
vi.mock("@/lib/actions/people", () => ({
  listMembersAction: (...a: unknown[]) => listMembersAction(...a),
}));

const createProgramAction = vi.fn();
const updateProgramAction = vi.fn();
const deleteProgramAction = vi.fn();
const deleteBatchAction = vi.fn();
const createBatchAction = vi.fn();
const updateBatchAction = vi.fn();
vi.mock("@/lib/actions/programs", () => ({
  createProgramAction: (...a: unknown[]) => createProgramAction(...a),
  updateProgramAction: (...a: unknown[]) => updateProgramAction(...a),
  deleteProgramAction: (...a: unknown[]) => deleteProgramAction(...a),
  deleteBatchAction: (...a: unknown[]) => deleteBatchAction(...a),
  createBatchAction: (...a: unknown[]) => createBatchAction(...a),
  updateBatchAction: (...a: unknown[]) => updateBatchAction(...a),
}));
vi.mock("@/lib/actions/coach-conflicts", () => ({
  checkCoachConflictsAction: async () => ({ conflicts: [] }),
}));
const substituteCoachAction = vi.fn();
vi.mock("@/lib/actions/coach-substitution", () => ({
  substituteCoachAction: (...a: unknown[]) => substituteCoachAction(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-offline-register", () => ({
  useOfflineRegister: () => ({
    marks: {},
    mark: vi.fn(),
    markedCount: 0,
    pending: 0,
    online: true,
    syncedLabel: "—",
    hasActiveFailure: false,
    saving: 0,
    retrySync: vi.fn(),
  }),
}));

import { MembersBoard } from "@/components/members-board";
import { RegisterBoard } from "@/components/register-board";
import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
import { SessionSubstituteControl } from "@/components/session-substitute-control";
import type { Program } from "@/db/schema/programs";
import type { TerminologyState } from "@/lib/terminology/keys";

const TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };
const PROGRAM = { id: "p1", name: "Junior Programme" } as unknown as Program;

afterEach(cleanup);

describe("EmptyState wiring", () => {
  it("members board with no members shows the designed empty state", () => {
    render(<MembersBoard initialMembers={[]} />);
    expect(screen.getByText("No members yet.")).toBeTruthy();
    expect(screen.getByText("Add your first member").closest("a")).not.toBeNull();
  });

  it("register with zero enrolled shows the empty state and a route back", () => {
    render(
      <RegisterBoard
        sessionId="s1"
        rows={[]}
        offlineSyncEnabled={false}
        terminology={TERMINOLOGY}
      />,
    );
    expect(screen.getByText("No members enrolled in this batch.")).toBeTruthy();
    expect(screen.getByText("Back to schedule").closest("a")).not.toBeNull();
  });
});

describe("Tap wiring on icon-only controls", () => {
  it("program edit/delete buttons get a 44px hit area", () => {
    render(
      <ProgramsBatchesBoard
        initialPrograms={[PROGRAM]}
        initialBatches={[]}
        coaches={[]}
        locations={[]}
        terminology={TERMINOLOGY}
      />,
    );

    const edit = screen.getByLabelText("Edit Junior Programme");
    const del = screen.getByLabelText("Delete Junior Programme");
    for (const button of [edit, del]) {
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("min-w-11");
    }
  });

  it("session Substitute trigger gets a 44px hit area", () => {
    render(
      <SessionSubstituteControl
        sessionId="s1"
        sessionDate="2026-09-12"
        startsAt="05:00 pm"
        endsAt="06:00 pm"
        currentCoachName="Coach A"
        coaches={[]}
        onSubstituted={vi.fn()}
        terminology={TERMINOLOGY}
      />,
    );

    const trigger = screen.getByTestId("substitute-open-s1");
    expect(trigger.className).toContain("min-h-11");
    expect(trigger.className).toContain("min-w-11");
  });
});
