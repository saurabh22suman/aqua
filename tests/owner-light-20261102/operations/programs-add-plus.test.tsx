// @vitest-environment jsdom
//
// Owner light · Operations lane — Programs: the create affordance (3 November 2026).
//
// RECONCILED FILE (3 November 2026). This file used to describe a
// SUPERSEDED programme-create affordance: a boxed "Add program" toggle that
// carried its own 16px outline plus, plus an explicit case asserting that NO
// shared create action existed anywhere on the board. The approved direction
// is the opposite — the programme-create affordance IS the ONE shared create
// action (components/owner-ui/owner-create-action.tsx), and that shared
// control is what carries the plus.
//
// The inherited run of this file, before the reconciliation, produced 3
// failures out of 4 cases. Those failures were BASELINE CHARACTERISATION of
// a stale description against the ALREADY INTEGRATED production code — not
// an intended RED for a new product change. Both runs are recorded in the
// lane handoff (PROGRAMS-TEST-RECONCILE-20261103.md).
//
// What this file holds now:
//   - the exact outline geometry of the shared plus (the OwnerIcon contract);
//   - the responsive size of that glyph: the 24px box, shrunk on a desktop;
//   - ONE real shared control — the shared component is really rendered,
//     never mocked away, and never duplicated;
//   - the shared control HIDDEN while an editor is open, with no duplicate
//     form and a plain Cancel;
//   - the real name field's focus and the browser scroll request that brings
//     it into the readable band of the viewport;
//   - the form's own gates (disabled while empty, enabled by a valid name);
//   - the panel's own count line.
//
// The board's server actions are mocked because they are the boundary this
// file stops at. Nothing about the shared create action is mocked: the real
// component is rendered and asserted.
//
// jsdom implements no `scrollIntoView`, so the test supplies the browser's
// method and records the request — the same stub as
// tests/owner-light-20261102/home/programs-create-focus.test.tsx.

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

// The server actions are the boundary: mocked, and never called by anything
// this file asserts (opening an editor runs no action).
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

const BATCH = {
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

/**
 * A board with a programme AND a batch.
 *
 * The batch matters: with no batch at all the board opens its own honest
 * first batch editor, and the approved contract hides the shared create
 * action while ANY editor is open. So the shared create action only exists
 * on a board that is showing its catalogue — which is the state this file
 * is about.
 */
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

/** The one programme-create control: the shared create action. */
function createAction(): HTMLElement {
  return screen.getByTestId("add-program");
}

/** The real programme name input inside the board's inline editor. */
function programNameInput(): HTMLInputElement {
  return screen.getByLabelText("New program") as HTMLInputElement;
}

/**
 * The shared OwnerIcon's own drawing contract, as rendered inside the
 * shared create action: one outline box, one stroke, the mock's plus.
 *
 * The phone glyph is the mock's 24px FAB plus; the SAME box is shrunk on a
 * desktop by the responsive classes, so the glyph is one responsive icon
 * and not two icons.
 */
function assertApprovedPlus(svg: Element | null) {
  expect(svg).toBeTruthy();
  expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(svg!.getAttribute("fill")).toBe("none");
  expect(svg!.getAttribute("stroke")).toBe("currentColor");
  expect(svg!.getAttribute("stroke-width")).toBe("1.8");
  expect(svg!.getAttribute("stroke-linecap")).toBe("round");
  expect(svg!.getAttribute("stroke-linejoin")).toBe("round");
  // The phone glyph: the mock's 24px FAB plus.
  expect(svg!.getAttribute("width")).toBe("24");
  expect(svg!.getAttribute("height")).toBe("24");
  // The desktop shrinks that SAME box responsively.
  expect(svg!.getAttribute("class")).toContain("lg:h-5");
  expect(svg!.getAttribute("class")).toContain("lg:w-5");
  // The mock's own plus geometry — not a text "+", not another glyph.
  expect(svg!.querySelector("path")?.getAttribute("d")).toBe(
    "M12 5v14M5 12h14",
  );
}

// jsdom has no `scrollIntoView`. The board asks the browser for it once,
// when the owner opens the editor with the create action, so the test
// supplies the method and records what the board asked for.
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

describe("Owner Programs — the create affordance", () => {
  it("carries the approved outline plus inside the shared create action", () => {
    renderBoard();

    const action = createAction();

    // The glyph is the shared OwnerIcon's plus, drawn by the shared
    // control — the same component every owner page uses.
    assertApprovedPlus(action.querySelector("svg"));

    // The glyph is decorative: the control's label is its accessible name.
    expect(action.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button", { name: "Add program" })).toBe(action);
  });

  it("is ONE real shared control, not a second affordance and not a mock", () => {
    const { container } = renderBoard();

    // The shared marker is on exactly ONE element on the whole board.
    const marked = container.querySelectorAll("[data-owner-create-action]");
    expect(marked).toHaveLength(1);

    // It IS the programme-create control, by its own accessible name.
    const action = screen.getByRole("button", { name: "Add program" });
    expect(marked[0]).toBe(action);

    // The real control: a non-submitting button that opens the editor and
    // navigates nowhere.
    expect(action.tagName).toBe("BUTTON");
    expect(action.getAttribute("type")).toBe("button");
    expect(action.getAttribute("href")).toBeNull();

    // The plus is DRAWN, never typed.
    expect(action.textContent).not.toContain("+");

    // The count line the panel already owns is unchanged.
    expect(screen.getByText("1 program")).toBeTruthy();
  });

  it("hides the shared control while the editor is open, with one form and a plain Cancel", () => {
    const { container } = renderBoard();

    fireEvent.click(createAction());

    // The shared control is gone while an editor is open: it can never
    // float over the form the owner is filling in.
    expect(screen.queryByTestId("add-program")).toBeNull();
    expect(container.querySelectorAll("[data-owner-create-action]")).toHaveLength(
      0,
    );

    // Exactly one programme editor — no duplicate form.
    expect(screen.getAllByLabelText(/new program/i)).toHaveLength(1);

    // The expanded state's Cancel is plain: no glyph of any kind.
    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    expect(cancel.querySelector("svg")).toBeNull();
  });

  it("takes the focus to the real name field and brings it into view", () => {
    renderBoard();

    fireEvent.click(createAction());

    // The owner who tapped the action is IN the editor, not looking at a
    // field they cannot type into.
    expect(document.activeElement).toBe(programNameInput());

    // And the browser was asked to bring that field into the readable band
    // of the viewport ("center" clears the sticky header and the bottom
    // navigation).
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.calls[0]?.[0]).toMatchObject({ block: "center" });
  });

  it("keeps the form's own gates", () => {
    renderBoard();
    fireEvent.click(createAction());

    const add = screen.getByRole("button", { name: /^add$/i }) as HTMLButtonElement;
    // No jest-dom matchers in this repo: read the DOM property.
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/new program/i), {
      target: { value: "Junior squad" },
    });
    expect(add.disabled).toBe(false);
  });
});
