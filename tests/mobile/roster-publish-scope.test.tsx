// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — roster publication scope is its
// own, visible state. Editing the add-shift draft (or applying a
// template) must not silently change which week/facility Publish
// targets, and the publish result names the scope it affected.

const publishRosterAction = vi.hoisted(() => vi.fn());
const createShiftAction = vi.hoisted(() => vi.fn());
const deleteShiftAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/shifts", () => ({
  publishRosterAction,
  createShiftAction,
  deleteShiftAction,
}));
vi.mock("@/components/shift-template-editor", () => ({
  ShiftTemplateEditor: () => null,
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { StaffRosterBoard } from "@/components/staff-roster-board";

const LOC_A = { id: "11111111-1111-4111-8111-111111111111", name: "Worli" };
const LOC_B = { id: "22222222-2222-4222-8222-222222222222", name: "Andheri" };

const STAFF = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    fullName: "Aanya Rao",
    staffType: "coach",
  },
] as never[];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StaffRosterBoard publication scope (P1)", () => {
  it("publishes the displayed week/location, not the add-shift form's location", async () => {
    publishRosterAction.mockResolvedValue({ ok: true, count: 3 });
    render(
      <StaffRosterBoard
        weekStart="2026-10-12"
        shifts={[]}
        templates={[]}
        staff={STAFF}
        locations={[LOC_A, LOC_B]}
        weekLocationId={LOC_A.id}
      />,
    );

    expect(screen.getByText(/Scope: Worli/)).toBeTruthy();

    // Change only the add-shift location to B…
    fireEvent.change(screen.getByLabelText("Location of this shift"), {
      target: { value: LOC_B.id },
    });
    // …and publish: the target must stay the board's scope (A).
    fireEvent.click(screen.getByTestId("roster-publish"));

    await waitFor(() =>
      expect(publishRosterAction).toHaveBeenCalledWith({
        weekStart: "2026-10-12",
        locationId: LOC_A.id,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Worli/),
    );
  });

  it("uses the explicitly selected publication scope", async () => {
    publishRosterAction.mockResolvedValue({ ok: true, count: 0 });
    render(
      <StaffRosterBoard
        weekStart="2026-10-12"
        shifts={[]}
        templates={[]}
        staff={STAFF}
        locations={[LOC_A, LOC_B]}
        weekLocationId={LOC_A.id}
      />,
    );

    fireEvent.change(screen.getByTestId("roster-publish-scope"), {
      target: { value: LOC_B.id },
    });
    fireEvent.click(screen.getByTestId("roster-publish"));

    await waitFor(() =>
      expect(publishRosterAction).toHaveBeenCalledWith({
        weekStart: "2026-10-12",
        locationId: LOC_B.id,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/Andheri/),
    );
  });

  it("resets the add-shift date when the displayed week changes", () => {
    const { rerender } = render(
      <StaffRosterBoard
        weekStart="2026-10-12"
        shifts={[]}
        templates={[]}
        staff={STAFF}
        locations={[LOC_A]}
        weekLocationId={null}
      />,
    );
    expect(screen.getByDisplayValue("12/10/2026")).toBeTruthy();

    rerender(
      <StaffRosterBoard
        weekStart="2026-10-19"
        shifts={[]}
        templates={[]}
        staff={STAFF}
        locations={[LOC_A]}
        weekLocationId={null}
      />,
    );
    expect(screen.getByDisplayValue("19/10/2026")).toBeTruthy();
  });
});
