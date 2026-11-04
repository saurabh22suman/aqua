// @vitest-environment jsdom
//
// Owner Programs — the main program-create trigger is the SHARED create
// action (3 November 2026, PROGRAMS lane).
//
// The actual 390px phone screenshot of Programs still shows the boxed
// "Add program" trigger at the top of the board, while every other owner
// create affordance is the approved mock's 56px round floating action on a
// phone and the labelled inline primary action on a desktop
// (components/owner-ui/owner-create-action.tsx, reviewed by the Root).
//
// The requirement is narrow and is NOT a redesign:
//
//   - the EXISTING main program-create trigger is REPLACED by
//     OwnerCreateAction kind="button" with the board's own callback and
//     the tenant's own program terminology in the label;
//   - ONE affordance: a phone FAB / a labelled desktop action — never two;
//   - opening it changes no data (no server action runs on open);
//   - it is HIDDEN while the program editor, the batch create form, the
//     program rename editor or the batch edit form is open, so it can
//     never cover a form;
//   - the empty board keeps its honest first program editor and shows NO
//     second create affordance;
//   - the explicit "Add batch" contextual actions, the batch catalogue,
//     the program validation, the server actions and every status and
//     datum stay exactly as they were.
//
// This file renders the REAL board and the REAL shared create action. The
// shared component is never mocked away: only the server actions are
// mocked, because they are the boundary this case stops at.
//
// The lane path is fixed:
// tests/owner-light-20261102/home/programs-create-action.test.tsx

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

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

// The server actions are the boundary: mocked, never called on open.
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

// The tenant renamed its programme: the label must follow the tenant's
// own vocabulary, not a hardcoded word.
const TERMINOLOGY_COURSE: TerminologyState = {
  locale: "en",
  overrides: { program: { en: { one: "course", other: "courses" } } },
};

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
  terminology = TERMINOLOGY,
}: {
  programs?: Program[];
  batches?: BatchWithProgramName[];
  terminology?: TerminologyState;
} = {}) {
  return render(
    <ProgramsBatchesBoard
      initialPrograms={programs}
      initialBatches={batches}
      coaches={[]}
      locations={[]}
      terminology={terminology}
    />,
  );
}

/** The one program-create control, found by its accessible name. */
function createControl(name = "Add program") {
  return screen.queryByRole("button", { name });
}

/** The desktop batch row's edit control (the board mounts two copies). */
function desktopBatchEdit(container: HTMLElement): HTMLElement {
  const table = container.querySelector('[data-testid="batches-list"]');
  const edit = table?.querySelector('button[aria-label^="Edit "]');
  if (!edit) throw new Error("the batch row has no edit control");
  return edit as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Owner Programs — the main create trigger is the shared create action", () => {
  // INTENDED RED: the board still renders the boxed secondary Button, so
  // the control carries no create-action marker and none of the shared
  // phone/desktop geometry.
  it("marks exactly one create action and gives it the shared geometry", () => {
    const { container } = renderBoard();

    const action = screen.getByRole("button", { name: "Add program" });
    expect(action.getAttribute("data-owner-create-action")).not.toBeNull();

    // The SAME control is a real, non-submitting button.
    expect(action.tagName).toBe("BUTTON");
    expect(action.getAttribute("type")).toBe("button");

    // The shared phone geometry: one round 56px floating action.
    expect(action.className).toContain("fixed");
    expect(action.className).toContain("h-14");
    expect(action.className).toContain("w-14");
    expect(action.className).toContain("rounded-full");

    // The shared desktop geometry: the labelled inline primary action.
    expect(action.className).toContain("lg:static");

    // ONE affordance — the marked control IS the "Add program" control and
    // there is no second program-create trigger anywhere on the board.
    expect(container.querySelectorAll("[data-owner-create-action]")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Add program" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Add program" })[0]).toBe(action);
  });

  // INTENDED RED: the boxed trigger ignores the tenant's own vocabulary.
  it("labels the create action with the tenant's program terminology", () => {
    renderBoard({ terminology: TERMINOLOGY_COURSE });

    expect(screen.getByRole("button", { name: "Add course" })).toBeTruthy();
    expect(createControl("Add program")).toBeNull();
  });

  // INTENDED RED: the boxed trigger stays on screen while the batch form
  // is open, so it can cover a form.
  it("hides the create action while the batch create form is open", () => {
    const { container } = renderBoard();

    expect(createControl()).toBeTruthy();
    fireEvent.click(screen.getByTestId("add-batch"));

    // The batch form is really open …
    expect(screen.getByLabelText("Program")).toBeTruthy();
    // … and no create affordance is left floating over it.
    expect(createControl()).toBeNull();
    expect(container.querySelectorAll("[data-owner-create-action]")).toHaveLength(0);
  });

  // INTENDED RED: the same, for the batch EDIT form.
  it("hides the create action while a batch is being edited", () => {
    const { container } = renderBoard();

    fireEvent.click(desktopBatchEdit(container));

    expect(container.querySelector('[data-testid="edit-batch-name-b-1"]')).toBeTruthy();
    expect(createControl()).toBeNull();
    expect(container.querySelectorAll("[data-owner-create-action]")).toHaveLength(0);
  });

  // INTENDED RED: the same, for the program rename editor.
  it("hides the create action while a program row is being renamed", () => {
    const { container } = renderBoard();

    fireEvent.click(screen.getByLabelText("Edit Learn to swim"));

    expect(screen.getByTestId("edit-program-input-p-1")).toBeTruthy();
    expect(createControl()).toBeNull();
    expect(container.querySelectorAll("[data-owner-create-action]")).toHaveLength(0);
  });
});

describe("Owner Programs — the create action opens the real editor and changes nothing", () => {
  it("opens the real program editor and runs no server action", () => {
    const { container } = renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Add program" }));

    // The board's own program editor is open — not a new route, not a
    // dialog, not a second form.
    expect(screen.getByLabelText("New program")).toBeTruthy();
    expect(container.querySelector("#new-program-name")).toBeTruthy();

    // Opening is not a mutation.
    expect(createProgramAction).not.toHaveBeenCalled();

    // While the editor is open there is no create affordance above it.
    expect(createControl()).toBeNull();
  });

  it("keeps the empty board honest: the first editor, and no second create affordance", () => {
    const { container } = renderBoard({ programs: [], batches: [] });

    // The honest first editor is already open …
    expect(screen.getByLabelText("New program")).toBeTruthy();
    expect(screen.getByText("0 programs")).toBeTruthy();
    // … and there is no second (duplicate) create affordance.
    expect(createControl()).toBeNull();
    expect(container.querySelectorAll("[data-owner-create-action]")).toHaveLength(0);
  });

  it("cancelling the program editor restores the create action and drops the draft", () => {
    renderBoard();

    fireEvent.click(screen.getByRole("button", { name: "Add program" }));
    const input = screen.getByLabelText("New program") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Half marathon" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // The editor is closed and the create action is back …
    expect(screen.queryByLabelText("New program")).toBeNull();
    expect(createControl()).toBeTruthy();

    // … with no half-typed draft left behind.
    fireEvent.click(screen.getByRole("button", { name: "Add program" }));
    expect((screen.getByLabelText("New program") as HTMLInputElement).value).toBe("");
    expect(createProgramAction).not.toHaveBeenCalled();
  });
});

describe("Owner Programs — the contextual batch actions are untouched", () => {
  it("keeps the explicit Add batch actions opening the batch form", () => {
    renderBoard();

    // The phone copy's explicit Add batch action, with the grouped
    // batches, is still there and still opens the batch form.
    const programs = screen.getByRole("heading", { name: "Programs" }).closest("section")!;
    const recurring = screen.getByRole("heading", { name: "Recurring batches" }).closest("section")!;

    fireEvent.click(within(programs).getByRole("button", { name: "Add batch" }));

    expect(recurring.className).not.toMatch(/\bhidden\b/);
    expect(within(recurring).getByLabelText("Program")).toBeTruthy();

    fireEvent.click(within(recurring).getByRole("button", { name: "Cancel" }));
    expect(recurring.className).toContain("md:block");
  });

  it("keeps one shared batch edit draft across the two mounted copies", () => {
    const { container } = renderBoard();

    fireEvent.click(desktopBatchEdit(container));

    const desktop = container.querySelector(
      '[data-testid="batches-list"] [data-testid="edit-batch-name-b-1"]',
    ) as HTMLInputElement;
    const phone = container.querySelector(
      '[data-testid="batches-list-mobile"] [data-testid="edit-batch-name-b-1"]',
    ) as HTMLInputElement;
    fireEvent.change(desktop, { target: { value: "Evening Squad" } });

    expect(phone.value).toBe("Evening Squad");
  });
});
