// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The batch edit form is mounted TWICE for the same batch — the desktop
// table (hidden on a phone) and the phone list — and both copies used to
// build their control ids from the batch id alone. Two elements then
// shared one id, and a <label for> names the FIRST element carrying that
// id: the phone copy's visible time controls were labelled by the HIDDEN
// desktop copy and carried no label association of their own.
//
// The mobile QA oracle reports exactly that as a real labels-and-
// association failure (every time select must have at least one
// associated label), and the fix is a per-instance id namespace inside
// BatchEditForm.
//
// These tests mount both copies with the SAME batch id and hold the
// invariant: every generated id has a single owner, and each copy's
// visible controls are labelled by their OWN copy.
//
// No server, no database, no credentials: the two server actions the
// form calls are mocked, and nothing is saved.

const mocks = vi.hoisted(() => ({
  // The mocks take the same one-argument shape as the server actions
  // they stand in for, so the wrappers below can hand the input on.
  // The input is echoed back so the argument is a used one.
  updateBatch: vi.fn<
    (input: unknown) => Promise<{ ok: boolean; input: unknown }>
  >(async (_input: unknown) => ({ ok: true, input: _input })),
  checkConflicts: vi.fn<
    (input: unknown) => Promise<{ conflicts: unknown[]; input: unknown }>
  >(async (_input: unknown) => ({ conflicts: [], input: _input })),
}));

vi.mock("@/lib/actions/programs", () => ({
  updateBatchAction: (input: unknown) => mocks.updateBatch(input),
}));

vi.mock("@/lib/actions/coach-conflicts", () => ({
  checkCoachConflictsAction: (input: unknown) => mocks.checkConflicts(input),
}));

import {
  BatchEditForm,
  type BatchEditFormState,
} from "@/components/batch-edit-form";
import type { TerminologyState } from "@/lib/terminology/keys";

const BATCH_ID = "batch-1";

const INITIAL: BatchEditFormState = {
  programId: "program-1",
  name: "Morning batch",
  capacity: "12",
  days: [1, 3],
  startTime: "06:00",
  endTime: "10:00",
  coachId: "",
  locationId: "",
};

const TERMINOLOGY: TerminologyState = { overrides: {}, locale: "en" };

const TIME_SELECT_LABELS = ["Hour", "Minutes", "AM/PM"];

function renderPair() {
  const props = {
    batchId: BATCH_ID,
    initial: INITIAL,
    programs: [],
    coaches: [],
    locations: [],
    error: null,
    onCancel: () => {},
    onSaved: () => {},
    onError: () => {},
    terminology: TERMINOLOGY,
  };
  return render(
    <>
      {/* The desktop table copy — hidden on a phone, but present in the
          document, exactly as the board renders it. */}
      <div data-testid="copy-desktop">
        <BatchEditForm {...props} />
      </div>
      {/* The phone list copy — the one the owner sees and uses. */}
      <div data-testid="copy-phone">
        <BatchEditForm {...props} />
      </div>
    </>,
  );
}

function timeSelects(root: HTMLElement): HTMLSelectElement[] {
  return Array.from(
    root.querySelectorAll<HTMLSelectElement>(
      'select[aria-label="Hour"], select[aria-label="Minutes"], select[aria-label="AM/PM"]',
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("batch edit form — two mounted copies of the same batch", () => {
  it("gives every generated id a single owner", () => {
    renderPair();

    const ids = Array.from(
      document.querySelectorAll<HTMLElement>("[id]"),
    ).map((element) => element.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

    expect(duplicates).toEqual([]);
  });

  it("labels each copy's visible time controls with its OWN label", () => {
    renderPair();

    for (const copy of ["copy-desktop", "copy-phone"]) {
      const root = screen.getByTestId(copy);
      const selects = timeSelects(root);
      // Each copy carries TWO time fields (start and end), each with the
      // hour, minutes and AM/PM controls.
      expect(selects).toHaveLength(6);

      for (const select of selects) {
        // A native label must exist for this control — not for the
        // other copy's control with the same id.
        const labels = select.labels;
        expect(labels.length).toBeGreaterThanOrEqual(1);

        const label = labels[0];
        expect(root.contains(label)).toBe(true);
        expect(label.getAttribute("for")).toBe(select.id);
        // The id must resolve to THIS control. Before the fix it
        // resolved to the first element with that id — the other copy's.
        expect(document.getElementById(select.id)).toBe(select);
      }
    }
  });

  it("points each copy's help reference at its own help text", () => {
    renderPair();

    for (const copy of ["copy-desktop", "copy-phone"]) {
      const root = screen.getByTestId(copy);
      const fieldsets = Array.from(root.querySelectorAll("fieldset"));
      expect(fieldsets).toHaveLength(2);

      for (const fieldset of fieldsets) {
        const describedBy = (fieldset.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter(Boolean);
        expect(describedBy.length).toBeGreaterThan(0);

        for (const id of describedBy) {
          const target = document.getElementById(id);
          expect(target).not.toBeNull();
          expect(root.contains(target)).toBe(true);
        }
      }
    }
  });

  it("keeps the data test ids stable for both copies", () => {
    renderPair();

    // The test ids address the batch, not the mounted copy: they stay
    // exactly as they were.
    expect(
      document.querySelectorAll(
        `[data-testid="edit-batch-start-${BATCH_ID}"]`,
      ),
    ).toHaveLength(2);
    expect(
      document.querySelectorAll(`[data-testid="edit-batch-end-${BATCH_ID}"]`),
    ).toHaveLength(2);
  });

  it("names the time controls of both time fields in each copy", () => {
    renderPair();

    for (const copy of ["copy-desktop", "copy-phone"]) {
      const root = screen.getByTestId(copy);
      const names = timeSelects(root).map(
        (select) => select.getAttribute("aria-label"),
      );
      // Two groups of three: the start field, then the end field.
      expect(names.slice(0, 3)).toEqual(TIME_SELECT_LABELS);
      expect(names.slice(3)).toEqual(TIME_SELECT_LABELS);
    }
  });
});
