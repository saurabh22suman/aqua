// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// F6 + F7 (mobile UX plan v2, Phase 0) — horizontal overflow at
// 360×800 on the member-detail enrolment row and the batch add/edit
// capacity+time row.
//
// jsdom cannot lay out, so these assertions pin the class contract the
// fix is made of: the select must be allowed to shrink and wrap
// (w-full min-w-0), the batch rows must wrap (flex-wrap), and the time
// inputs must be allowed to shrink below their intrinsic width
// (min-w-0). Mutation proof: remove any one class and the matching
// assertion goes red.

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

function expectTimeInputsShrinkable(container: HTMLElement): void {
  const timeInputs = container.querySelectorAll<HTMLInputElement>(
    'input[type="time"]',
  );
  expect(timeInputs.length).toBe(2);
  for (const input of timeInputs) {
    expect(input.className).toContain("min-w-0");
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

    render(<MemberEnrolmentPanel memberId="m1" terminology={TERMINOLOGY} />);
    const select = await screen.findByTestId("enrolment-batch-select");

    expect(select.className).toContain("w-full");
    expect(select.className).toContain("min-w-0");
  });
});

describe("batch create capacity+time row wraps (F7)", () => {
  it("row has flex-wrap and both time inputs have min-w-0", () => {
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
    expect(capacity.parentElement?.className).toContain("flex-wrap");
    expectTimeInputsShrinkable(container);
  });
});

describe("batch edit capacity+time row wraps (F7)", () => {
  it("row has flex-wrap and both time inputs have min-w-0", () => {
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
    expect(capacity.parentElement?.className).toContain("flex-wrap");
    expectTimeInputsShrinkable(container);
  });
});
