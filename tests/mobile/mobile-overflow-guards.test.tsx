// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// F6 + F7 (mobile UX plan v2, Phase 0) — horizontal overflow at
// 360×800 on the member-detail enrolment row and the batch add/edit
// capacity+time row.
//
// jsdom cannot lay out, so these assertions pin the class contract the
// fix is made of: the select must be allowed to shrink and wrap
// (w-full min-w-0), the batch rows must wrap, and the time CONTROLS
// must be allowed to shrink below their intrinsic width (min-w-0).
// Mutation proof: remove any one class and the matching assertion goes
// red.

const listBatchesAction = vi.fn();
const listMemberEnrolmentsAction = vi.fn();
const enrolMemberAction = vi.fn();
const createBatchAction = vi.fn();
const updateBatchAction = vi.fn();
const checkCoachConflictsAction = vi.fn();

vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: (...a: unknown[]) => listBatchesAction(...a),
  createBatchAction: (...a: unknown[]) => createBatchAction(...a),
  updateBatchAction: (...a: unknown[]) => updateBatchAction(...a),
}));
vi.mock("@/lib/actions/enrolment", () => ({
  listMemberEnrolmentsAction: (...a: unknown[]) => listMemberEnrolmentsAction(...a),
  enrolMemberAction: (...a: unknown[]) => enrolMemberAction(...a),
}));
vi.mock("@/lib/actions/coach-conflicts", () => ({
  checkCoachConflictsAction: (...a: unknown[]) => checkCoachConflictsAction(...a),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";
import { BatchCreateForm } from "@/components/batch-create-form";
import { BatchEditForm } from "@/components/batch-edit-form";
import type { Program } from "@/db/schema/programs";
import type { TerminologyState } from "@/lib/terminology/keys";

const TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };
const PROGRAM = { id: "p1", name: "Junior Programme" } as unknown as Program;

afterEach(() => {
  cleanup();
  listBatchesAction.mockReset();
  listMemberEnrolmentsAction.mockReset();
  enrolMemberAction.mockReset();
  createBatchAction.mockReset();
  updateBatchAction.mockReset();
  checkCoachConflictsAction.mockReset();
});

// The shared time control (components/ui/TimeField.tsx) is a labelled
// group of three selects, not a native <input type="time"> — so the
// guard reads the group. The two facts it pins are the ones the native
// inputs were checked for: the row WRAPS on a phone (one column until
// the sm breakpoint) and every time control may SHRINK below its
// intrinsic width, so a long option cannot push the layout wider than
// the screen. Mutation proof: remove any one of these classes and the
// matching assertion goes red.
function expectTimeControlsShrinkable(container: HTMLElement): void {
  const groups = Array.from(container.querySelectorAll("fieldset")).filter(
    (node) => node.querySelector("legend") !== null,
  );
  expect(groups.length).toBe(2);

  // Both groups share one row: a single column on a phone, two columns
  // from the sm breakpoint.
  const row = groups[0]?.parentElement;
  expect(row?.className ?? "").toContain("grid-cols-1");
  expect(row?.className ?? "").toContain("sm:grid-cols-2");

  for (const group of groups) {
    // The group itself may shrink below the width of its three controls.
    expect(group.className).toContain("min-w-0");
    // Each control sits in a min-w-0 cell, and the tracks are
    // minmax(0,…) so a grid item may shrink below its intrinsic width.
    const cells = group.querySelectorAll("label.min-w-0");
    expect(cells.length).toBe(3);
    const tracks = group.querySelector("div.grid");
    expect(tracks?.className ?? "").toContain("minmax(0,");
    for (const cell of cells) {
      expect(cell.className).toContain("min-w-0");
    }
  }
}

describe("member detail enrolment select can wrap and shrink (F6)", () => {
  it("renders the batch select with w-full and min-w-0", async () => {
    listMemberEnrolmentsAction.mockResolvedValue([]);
    listBatchesAction.mockResolvedValue([
      {
        id: "b1",
        name: "Advanced Junior Squad — evening",
        programName: "Competitive Swimming",
      },
    ]);

    render(<MemberEnrolmentPanel memberId="m1" terminology={TERMINOLOGY} canEnrol canWaitlist />);
    const select = await screen.findByTestId("enrolment-batch-select");

    expect(select.className).toContain("w-full");
    expect(select.className).toContain("min-w-0");
  });
});

describe("batch create capacity+time row wraps (F7)", () => {
  // Capacity sits on its own full-width row. The two time fields share
  // a row that is ONE column on a phone (two from the sm breakpoint),
  // so the row wraps by definition; the time controls still have to be
  // shrinkable so they cannot push the row wider than the screen.
  it("row wraps and both time controls can shrink", () => {
    checkCoachConflictsAction.mockResolvedValue({ conflicts: [] });

    const { container } = render(
      <BatchCreateForm
        programs={[PROGRAM]}
        coaches={[]}
        locations={[]}
        onCreated={vi.fn()}
        terminology={TERMINOLOGY}
      />,
    );

    const capacity = screen.getByLabelText("Capacity");
    // Capacity is a full-width control on its own row, so it cannot
    // widen the row it sits in.
    expect(capacity.className).toContain("w-full");
    expectTimeControlsShrinkable(container);
  });
});

describe("batch edit capacity+time row wraps (F7)", () => {
  it("row wraps and both time controls can shrink", () => {
    checkCoachConflictsAction.mockResolvedValue({ conflicts: [] });

    const { container } = render(
      <BatchEditForm
        batchId="b1"
        initial={{
          programId: "p1",
          name: "Junior TTS",
          capacity: "20",
          days: [1, 3, 5],
          startTime: "07:00",
          endTime: "08:00",
          coachId: "",
          locationId: "",
        }}
        programs={[PROGRAM]}
        coaches={[]}
        locations={[]}
        error={null}
        onCancel={vi.fn()}
        onSaved={vi.fn()}
        onError={vi.fn()}
        terminology={TERMINOLOGY}
      />,
    );

    const capacity = screen.getByLabelText("Capacity");
    // Capacity is a full-width control on its own row, so it cannot
    // widen the row it sits in.
    expect(capacity.className).toContain("w-full");
    expectTimeControlsShrinkable(container);
  });
});
