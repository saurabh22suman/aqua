// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 12-hour TimeField consumers — business hours, shift templates, add shift.
//
// The visible controls are Hour / Minutes / AM/PM, while every emitted
// value stays canonical 24-hour HH:mm. Partial entries are invalid and must
// guard the imperative save actions; a CLOSED day has no times and must not
// block saving.

const setBusinessHoursAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/locations", () => ({
  getBusinessHoursAction: async () => ({
    days: [
      { day: "monday", closed: false, open: "06:00", close: "20:00" },
      { day: "tuesday", closed: true, open: "06:00", close: "20:00" },
    ],
  }),
  setBusinessHoursAction,
}));

const createShiftTemplateAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/shifts", () => ({
  createShiftTemplateAction,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { BusinessHoursEditor } from "@/components/settings/business-hours-editor";
import { ShiftTemplateEditor } from "@/components/shift-template-editor";
import { AddShiftForm } from "@/components/roster/add-shift-form";

afterEach(() => {
  cleanup();
  setBusinessHoursAction.mockReset();
  createShiftTemplateAction.mockReset();
});

describe("business hours TimeField", () => {
  it("renders 12-hour groups and guards a partial time without blocking a closed day", async () => {
    render(<BusinessHoursEditor locationId="loc-1" canWrite />);

    const opening = await screen.findByRole("group", {
      name: /monday opening time/i,
    });
    expect(screen.getByRole("group", { name: /monday closing time/i })).toBeTruthy();
    expect(within(opening).getByLabelText("Hour")).toBeTruthy();
    expect(within(opening).getByLabelText("Minutes")).toBeTruthy();
    expect(within(opening).getByLabelText("AM/PM")).toBeTruthy();

    const save = screen.getByRole("button", { name: "Save hours" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    fireEvent.change(within(opening).getByLabelText("Minutes"), {
      target: { value: "" },
    });
    expect(save.disabled).toBe(true);

    fireEvent.change(within(opening).getByLabelText("Minutes"), {
      target: { value: "00" },
    });
    expect(save.disabled).toBe(false);

    // Closing a day removes its times; that is a valid all-day closure.
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(save.disabled).toBe(false);
  });
});

describe("shift template TimeField", () => {
  it("renders 12-hour groups, guards partial entries and saves canonical HH:mm", async () => {
    createShiftTemplateAction.mockResolvedValue({ ok: true, id: "t1" });
    render(<ShiftTemplateEditor templates={[]} locationId="loc-1" />);

    fireEvent.change(screen.getByPlaceholderText("Morning shift"), {
      target: { value: "Morning" },
    });
    const start = screen.getByRole("group", { name: "Start" });
    const save = screen.getByRole("button", { name: "Save template" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    fireEvent.change(within(start).getByLabelText("Minutes"), {
      target: { value: "" },
    });
    expect(save.disabled).toBe(true);
    fireEvent.change(within(start).getByLabelText("Minutes"), {
      target: { value: "30" },
    });
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() =>
      expect(createShiftTemplateAction).toHaveBeenCalledWith(
        expect.objectContaining({ startTime: "06:30", endTime: "10:00" }),
      ),
    );
  });
});

describe("add shift TimeField", () => {
  it("renders start/end groups and guards a partial time", () => {
    render(
      <AddShiftForm
        weekStart="2026-10-26"
        templates={[]}
        staff={[
          {
            id: "staff-1",
            personId: "person-1",
            fullName: "Aanya Rao",
            staffType: "coach",
            userId: null,
            employedOn: null,
          } as never,
        ]}
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        initialLocationId="loc-1"
        pending={false}
        onAdd={() => undefined}
      />,
    );

    const start = screen.getByRole("group", { name: "Start" });
    expect(screen.getByRole("group", { name: "End" })).toBeTruthy();
    const submit = screen.getByRole("button", { name: /add shift/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.change(within(start).getByLabelText("Minutes"), {
      target: { value: "" },
    });
    expect(submit.disabled).toBe(true);
  });
});
