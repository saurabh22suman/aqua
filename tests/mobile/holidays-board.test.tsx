// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// R.3 (docs/five-day-work-guide.md) — holiday and closure calendar UI.
// The backend (table, service, actions, generator skip) shipped
// earlier; the owner-facing surface is the missing half. TDD: fails
// before the component exists.

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
const addHolidayAction = vi.hoisted(() =>
  vi.fn(async () => ({ kind: "ok" as const, holidayId: "h-new" })),
);
const removeHolidayAction = vi.hoisted(() =>
  vi.fn(async () => ({ kind: "ok" as const, holidayId: "h1" })),
);
vi.mock("@/lib/actions/holidays", () => ({
  addHolidayAction,
  removeHolidayAction,
}));

import { HolidaysBoard } from "@/components/holidays-board";

const HOLIDAYS = [
  { id: "h1", name: "Independence Day", holidayDate: "2026-08-15", recurringYearly: false },
  { id: "h2", name: "Diwali", holidayDate: "2026-11-08", recurringYearly: true },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HolidaysBoard (R.3)", () => {
  it("lists holidays with formatted dates and recurrence", () => {
    render(<HolidaysBoard initialHolidays={HOLIDAYS} />);
    expect(document.body.textContent).toContain("Independence Day");
    expect(document.body.textContent).toContain("15 Aug 2026");
    expect(document.body.textContent).toContain("Diwali");
    expect(document.body.textContent).toContain("Repeats yearly");
  });

  it("shows an empty state when there are no holidays", () => {
    render(<HolidaysBoard initialHolidays={[]} />);
    expect(document.body.textContent).toContain("No holidays yet");
  });

  it("adds a holiday with the entered values", async () => {
    render(<HolidaysBoard initialHolidays={[]} />);

    fireEvent.change(screen.getByPlaceholderText("Holiday name"), {
      target: { value: "Independence Day" },
    });
    fireEvent.change(screen.getByTestId("holiday-date"), {
      target: { value: "2026-08-15" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));

    await vi.waitFor(() =>
      expect(addHolidayAction).toHaveBeenCalledWith({
        name: "Independence Day",
        holidayDate: "2026-08-15",
        recurringYearly: true,
      }),
    );
  });

  it("shows the duplicate message returned by the action", async () => {
    addHolidayAction.mockResolvedValueOnce({
      kind: "error",
      code: "duplicate",
      message: "A holiday on that date already exists for this tenant.",
    } as never);

    render(<HolidaysBoard initialHolidays={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Holiday name"), {
      target: { value: "Independence Day" },
    });
    fireEvent.change(screen.getByTestId("holiday-date"), {
      target: { value: "2026-08-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));

    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("already exists"),
    );
  });

  it("removes a holiday through the action", async () => {
    render(<HolidaysBoard initialHolidays={HOLIDAYS} />);
    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]!);
    expect(removeHolidayAction).toHaveBeenCalledWith({ holidayId: "h1" });
  });
});
