// @vitest-environment jsdom
//
// Owner Programs — the create action moves the OWNER'S attention to the
// editor it opened (3 November 2026, Root review of PROGRAMS-CREATE §9.2).
//
// The Root's decision, which this file holds to:
//
//   - the inline program editor STAYS (no sheet, no route, no mutation);
//   - on an EXPLICIT create action the REAL name input takes the focus and
//     is brought into the readable band of the viewport, so a phone owner
//     who taps the floating action at the bottom of a long list is not
//     left looking at an editor that opened above the fold;
//   - on an explicit Cancel the focus returns to the SAME create action;
//   - the initially-empty board's honest first editor NEVER takes the
//     focus on arrival (an unsolicited mobile keyboard is worse than a
//     visible field).
//
// The focus assertions use `document.activeElement` because the project
// deliberately does not pull in @testing-library/jest-dom (see
// tests/tier1/inline-member-edit.test.tsx) — `toHaveFocus` is exactly
// `document.activeElement === element`, asserted here without a new
// dependency.
//
// jsdom does not implement `scrollIntoView`, so the test supplies the
// browser's method and records the request. That is a UNIT-LAYER GUARD
// only: the actual painted position from a long page state is the Root's
// Chrome verification, not this file's claim.
//
// The lane path is fixed:
// tests/owner-light-20261102/home/programs-create-focus.test.tsx

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

// The server actions are the boundary: mocked, and never called by a
// focus move.
vi.mock("@/lib/actions/programs", () => ({
  createProgramAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  updateProgramAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  deleteProgramAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  deleteBatchAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  createBatchAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  updateBatchAction: vi.fn(async () => ({ ok: false as const, error: "no" })),
  listBatchesAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/coach-conflicts", () => ({
  checkCoachConflictsAction: vi.fn(async () => ({ conflicts: [] })),
}));

import { ProgramsBatchesBoard } from "@/components/programs-batches-board";
import { createProgramAction } from "@/lib/actions/programs";
import type { Program } from "@/db/schema/programs";
import type { BatchWithProgramName } from "@/lib/services/programs";
import type { TerminologyState } from "@/lib/terminology/keys";

const TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

const PROGRAM = {
  id: "p-1",
  tenantId: "t-1",
  name: "Learn to swim",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
} as unknown as Program;

const BATCH: BatchWithProgramName = {
  id: "b-1",
  tenantId: "t-1",
  programId: "p-1",
  name: "Morning Squad",
  capacity: 12,
  daysOfWeek: [1, 3, 5],
  startTime: "06:00:00",
  endTime: "07:00:00",
  coachId: null,
  locationId: "loc-1",
  programName: "Learn to swim",
  coachName: "Aanya Rao",
  locationName: "Worli Main",
} as unknown as BatchWithProgramName;

function renderBoard({
  programs = [PROGRAM],
  batches = [BATCH],
}: {
  programs?: Program[];
  batches?: BatchWithProgramName[];
} = {}) {
  return render(
    <ProgramsBatchesBoard
      initialPrograms={programs}
      initialBatches={batches}
      coaches={[]}
      locations={[]}
      terminology={TERMINOLOGY}
    />,
  );
}

/** The one programme-create control. */
function createAction(): HTMLElement {
  return screen.getByRole("button", { name: "Add program" });
}

/** The real programme name input inside the board's inline editor. */
function programNameInput(): HTMLInputElement {
  return screen.getByLabelText("New program") as HTMLInputElement;
}

// jsdom has no `scrollIntoView`. The board guards the call, so the test
// supplies the browser's method and records what the board asked for.
const scrollIntoView = vi.fn();
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  if (originalScrollIntoView) {
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  } else {
    delete (Element.prototype as unknown as { scrollIntoView?: unknown })
      .scrollIntoView;
  }
});

describe("Owner Programs — the create action takes the owner to the editor", () => {
  // INTENDED RED: the create action opens the editor and leaves the focus
  // on the document, so the owner is left looking at a field they cannot
  // type into.
  it("focuses the real program name input when the create action is used", () => {
    renderBoard();

    fireEvent.click(createAction());

    const input = programNameInput();
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  // INTENDED RED: nothing asked the browser to bring the field into view.
  it("brings the input into the readable band of the viewport", () => {
    renderBoard();

    fireEvent.click(createAction());

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // "center" puts the field between the sticky header and the bottom
    // navigation, in the readable middle of the screen.
    expect(scrollIntoView.mock.calls[0]?.[0]).toMatchObject({ block: "center" });
  });

  // INTENDED RED: cancelling dropped the focus on the document.
  it("returns the focus to the create action when the editor is cancelled", () => {
    renderBoard();

    fireEvent.click(createAction());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // The create action is re-created when the editor closes, so it is
    // re-queried here rather than reusing the earlier node.
    expect(document.activeElement).toBe(createAction());
  });
});

describe("Owner Programs — the focus move changes nothing else", () => {
  it("does not steal the focus when the empty board's first editor arrives", () => {
    renderBoard({ programs: [], batches: [] });

    // The honest first editor is on screen …
    expect(screen.getByLabelText("New program")).toBeTruthy();
    // … but nothing took the focus: an unsolicited phone keyboard is
    // worse than a visible field.
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps the draft and the validation when the focus moves", () => {
    renderBoard();

    fireEvent.click(createAction());

    const submit = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    const input = programNameInput();
    fireEvent.change(input, { target: { value: "Half marathon" } });

    expect(input.value).toBe("Half marathon");
    expect(submit.disabled).toBe(false);
    // A focus move is not a write.
    expect(createProgramAction).not.toHaveBeenCalled();
  });

  it("leaves the batch create form to its own contextual action", () => {
    renderBoard();

    fireEvent.click(screen.getByTestId("add-batch"));

    expect(screen.getByLabelText("Program")).toBeTruthy();
    // The programme create rule must not reach into the batch form.
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves the program rename editor to its own control", () => {
    renderBoard();

    fireEvent.click(screen.getByLabelText("Edit Learn to swim"));

    expect(screen.getByTestId("edit-program-input-p-1")).toBeTruthy();
    // Only the explicit create action takes the focus.
    expect(document.activeElement).toBe(document.body);
  });
});
