// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The batch edit draft is ONE draft, shared by the two mounted copies.
//
// The programs board mounts the batch editor TWICE for the same batch — the
// desktop table (hidden on a phone) and the phone list — and each copy kept
// the draft in its own local state. A name and a capacity typed into the
// copy the owner could see were not in the other copy, so changing the
// viewport showed the other copy's values and the edit vanished from the
// screen.
//
// These cases go through the board's own public props (no internal API): the
// draft lives in the parent, both mounted copies render it, and an edit in
// one copy is the other copy's edit.
//
// The earlier per-instance id fix is held too: both copies keep unique ids
// and their own labels, the batch test ids stay one per mounted copy, and
// cancelling still discards the draft.
//
// No server, no database, no credentials: the board's server actions are
// mocked and nothing is saved.

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
  checkCoachConflictsAction: async () => ({ conflicts: [] }),
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

/** The desktop table copy and the phone list copy of the mounted editor. */
function copies(container: HTMLElement) {
  const desktop = container.querySelector('[data-testid="batches-list"]');
  const phone = container.querySelector('[data-testid="batches-list-mobile"]');
  if (!desktop || !phone) throw new Error("the board did not mount both copies");
  return { desktop, phone };
}

function field(root: Element, selector: string): HTMLInputElement {
  const input = root.querySelector(selector);
  if (!input) throw new Error(`missing ${selector}`);
  return input as HTMLInputElement;
}

function renderBoard() {
  return render(
    <ProgramsBatchesBoard
      initialPrograms={[PROGRAM]}
      initialBatches={[BATCH]}
      coaches={[]}
      locations={[]}
      terminology={TERMINOLOGY}
    />,
  );
}

/** Open the batch editor in both mounted copies. */
function openEditor(container: HTMLElement) {
  const { desktop } = copies(container);
  const edit = desktop.querySelector('button[aria-label^="Edit "]');
  if (!edit) throw new Error("the batch row has no edit control");
  fireEvent.click(edit);
}

afterEach(() => {
  cleanup();
});

describe("batch edit draft across the two mounted copies", () => {
  it("shows the edited name in both copies", () => {
    const { container } = renderBoard();
    openEditor(container);
    const { desktop, phone } = copies(container);

    const desktopName = field(
      desktop,
      '[data-testid="edit-batch-name-b-1"]',
    );
    const phoneName = field(phone, '[data-testid="edit-batch-name-b-1"]');

    fireEvent.change(desktopName, { target: { value: "QA draft" } });

    expect(desktopName.value).toBe("QA draft");
    expect(phoneName.value).toBe("QA draft");
  });

  it("shows the edited capacity in both copies", () => {
    const { container } = renderBoard();
    openEditor(container);
    const { desktop, phone } = copies(container);

    const desktopCapacity = field(
      desktop,
      'input[aria-label="Capacity"]',
    );
    const phoneCapacity = field(phone, 'input[aria-label="Capacity"]');

    fireEvent.change(desktopCapacity, { target: { value: "37" } });

    expect(desktopCapacity.value).toBe("37");
    expect(phoneCapacity.value).toBe("37");
  });

  it("keeps both copies' ids unique and the batch test ids stable", () => {
    const { container } = renderBoard();
    openEditor(container);

    const ids = Array.from(
      container.querySelectorAll<HTMLElement>("[id]"),
    ).map((element) => element.id);
    const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicated).toEqual([]);

    expect(
      container.querySelectorAll('[data-testid="edit-batch-name-b-1"]'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('[data-testid="edit-batch-start-b-1"]'),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll('[data-testid="edit-batch-end-b-1"]'),
    ).toHaveLength(2);
  });

  it("discards the draft when the owner cancels", () => {
    const { container } = renderBoard();
    openEditor(container);
    const { desktop } = copies(container);

    const name = field(desktop, '[data-testid="edit-batch-name-b-1"]');
    fireEvent.change(name, { target: { value: "QA draft" } });

    const save = desktop.querySelector('[data-testid="save-batch-b-1"]');
    const cancel = save?.nextElementSibling;
    if (!cancel) throw new Error("the editor has no cancel control");
    fireEvent.click(cancel);

    expect(
      container.querySelectorAll('[data-testid="edit-batch-name-b-1"]'),
    ).toHaveLength(0);
  });
});
