// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — the holidays board adopts the
// server's refreshed collection: a successful add/remove is visible
// without a manual reload, a removed row is not resurrected from local
// state, and a failed add keeps the draft.

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
const addHolidayAction = vi.hoisted(() => vi.fn());
const removeHolidayAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/holidays", () => ({
  addHolidayAction,
  removeHolidayAction,
}));

import { HolidaysBoard } from "@/components/holidays-board";

const H1 = {
  id: "h1",
  name: "Founder's Day",
  holidayDate: "2026-10-24",
  recurringYearly: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HolidaysBoard refresh reconciliation (P1)", () => {
  it("adopts a refreshed collection and does not resurrect a removed row", async () => {
    removeHolidayAction.mockResolvedValue({ kind: "ok", holidayId: "h1" });
    const { rerender } = render(<HolidaysBoard initialHolidays={[H1]} />);
    expect(screen.getByText("Founder's Day")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(removeHolidayAction).toHaveBeenCalled());

    // The server re-render delivers an empty collection.
    rerender(<HolidaysBoard initialHolidays={[]} />);
    expect(screen.queryByText("Founder's Day")).toBeNull();
    expect(document.body.textContent).toContain("No holidays yet");
  });

  it("shows a newly added holiday from the refreshed props", async () => {
    addHolidayAction.mockResolvedValue({ kind: "ok", holidayId: "h2" });
    const { rerender } = render(<HolidaysBoard initialHolidays={[]} />);

    fireEvent.change(screen.getByLabelText("Holiday name"), {
      target: { value: "Diwali" },
    });
    fireEvent.change(screen.getByTestId("holiday-date"), {
      target: { value: "08/11/2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    await waitFor(() => expect(addHolidayAction).toHaveBeenCalled());

    rerender(
      <HolidaysBoard
        initialHolidays={[
          H1,
          {
            id: "h2",
            name: "Diwali",
            holidayDate: "2026-11-08",
            recurringYearly: false,
          },
        ]}
      />,
    );
    expect(screen.getByText("Diwali")).toBeTruthy();
  });

  it("keeps the draft when the add fails", async () => {
    addHolidayAction.mockResolvedValue({
      kind: "error",
      code: "duplicate",
      message: "A holiday on that date already exists for this tenant.",
    });
    render(<HolidaysBoard initialHolidays={[]} />);

    fireEvent.change(screen.getByLabelText("Holiday name"), {
      target: { value: "Founder's Day" },
    });
    fireEvent.change(screen.getByTestId("holiday-date"), {
      target: { value: "24/10/2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/already exists/i),
    );
    expect((screen.getByLabelText("Holiday name") as HTMLInputElement).value).toBe(
      "Founder's Day",
    );
  });
});
