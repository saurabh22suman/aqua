// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Review round 2 — management delta findings MD-01…MD-04 (holiday/activity
// only). Removal must be reviewed, the session-generation consequence stated
// truthfully, the sub-unit field named, and the holiday DateField's real
// label/required/description chain covered.

const routerRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh, push: vi.fn() }),
}));

const removeHolidayAction = vi.hoisted(() => vi.fn());
const addHolidayAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/holidays", () => ({
  addHolidayAction,
  removeHolidayAction,
}));

vi.mock("@/lib/actions/activities", () => ({
  createActivityAction: async () => ({ ok: true, id: "a2" }),
  updateActivityAction: async () => ({ ok: true, id: "a1" }),
  deleteActivityAction: async () => ({ ok: true, id: "a1" }),
  addSubUnitAction: async () => ({ ok: true }),
  removeSubUnitAction: async () => ({ ok: true }),
}));

import { HolidaysBoard } from "@/components/holidays-board";
import { ActivityManager } from "@/components/activity-manager";

const HOLIDAY = {
  id: "hol-1",
  name: "Founder's Day",
  holidayDate: "2026-10-24",
  recurringYearly: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  routerRefresh.mockReset();
});

describe("MD-01 holiday removal is reviewed", () => {
  it("shows a refusal inside the open dialog, keeps the row and allows retry", async () => {
    removeHolidayAction.mockResolvedValue({
      kind: "error",
      message: "Could not remove — this holiday is still in use.",
    });
    render(<HolidaysBoard initialHolidays={[HOLIDAY]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Founder's Day" }));
    const dialog = document.querySelector("dialog") as HTMLElement;
    expect(dialog).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm removal" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/still in use/i);
    // The row survives and the active dialog still offers retry + cancel.
    expect(
      screen.getByRole("button", { name: "Remove Founder's Day" }),
    ).toBeTruthy();
    expect(
      (within(dialog).getByRole("button", {
        name: "Confirm removal",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(removeHolidayAction).toHaveBeenCalledTimes(2));
  });

  it("reports a lost removal result as unknown, not as a failed removal", async () => {
    removeHolidayAction.mockRejectedValue(new Error("response lost"));
    render(<HolidaysBoard initialHolidays={[HOLIDAY]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Founder's Day" }));
    const dialog = document.querySelector("dialog") as HTMLElement;
    fireEvent.click(await screen.findByRole("button", { name: "Confirm removal" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toMatch(/could not be confirmed/i);
    expect(alert.textContent).not.toMatch(/did not complete/i);
    expect(alert.textContent).not.toMatch(/list was not changed/i);
    expect(alert.textContent).toMatch(/refresh the list before retrying/i);
    expect(
      screen.getByRole("button", { name: "Remove Founder's Day" }),
    ).toBeTruthy();
  });

  it("removes the confirmed row even when the follow-up refresh fails", async () => {
    removeHolidayAction.mockResolvedValue({ kind: "ok", holidayId: "hol-1" });
    routerRefresh.mockImplementation(() => {
      throw new Error("refresh failed");
    });
    render(<HolidaysBoard initialHolidays={[HOLIDAY]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Founder's Day" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm removal" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Remove Founder's Day" }),
      ).toBeNull(),
    );
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(removeHolidayAction).toHaveBeenCalledTimes(1);
  });

  it("does not remove until confirmed and keeps the row on cancel", async () => {
    removeHolidayAction.mockResolvedValue({ kind: "ok" });
    render(<HolidaysBoard initialHolidays={[HOLIDAY]} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Founder's Day" }));
    // jsdom does not expose the native modal as a role=dialog once closed;
    // assert the real dialog element and its reviewed copy instead.
    const dialog = document.querySelector("dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toMatch(
      /removing this holiday allows future session generation for this date/i,
    );
    expect(dialog?.textContent).toMatch(/existing sessions are unchanged/i);
    expect(dialog?.textContent).not.toMatch(/will skip this date/i);
    expect(removeHolidayAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(removeHolidayAction).not.toHaveBeenCalled();
    expect(screen.getByText("Founder's Day")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove Founder's Day" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm removal" }));
    await waitFor(() =>
      expect(removeHolidayAction).toHaveBeenCalledWith({ holidayId: "hol-1" }),
    );
  });
});

describe("MD-02 session-generation consequence notice", () => {
  it("is visible with a populated list and with no holidays", () => {
    const { unmount } = render(<HolidaysBoard initialHolidays={[HOLIDAY]} />);
    expect(
      screen.getByText(/session generation skips these dates/i),
    ).toBeTruthy();
    expect(screen.getByText(/does not cancel sessions already generated/i)).toBeTruthy();
    unmount();

    render(<HolidaysBoard initialHolidays={[]} />);
    expect(
      screen.getByText(/session generation skips these dates/i),
    ).toBeTruthy();
  });
});

describe("MD-03 activity sub-unit field is named", () => {
  it("exposes an accessible name for the add-sub-unit input", () => {
    render(
      <ActivityManager
        locations={[{ id: "loc-1", name: "Worli Main", isPrimary: true }]}
        activities={[
          {
            id: "act-1",
            locationId: "loc-1",
            locationName: "Worli Main",
            name: "Main pool",
            kind: "pool",
            capacity: 16,
            isSample: false,
            subUnits: [],
            createdAt: "2026-10-01T04:00:00.000Z",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Add sub-unit to Main pool" }),
    ).toBeTruthy();
  });
});

describe("MD-04 holiday DateField association chain", () => {
  it("has a real label, required input and resolvable description", () => {
    render(<HolidaysBoard initialHolidays={[HOLIDAY]} />);

    const date = screen.getByTestId("holiday-date");
    expect(date.getAttribute("required")).not.toBeNull();
    expect(date.getAttribute("aria-required")).toBe("true");

    const describedBy = date.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    for (const id of (describedBy ?? "").split(/\s+/)) {
      expect(document.getElementById(id)).not.toBeNull();
    }

    const label = document.querySelector(`label[for="${date.id}"]`);
    expect(label?.textContent).toContain("Date");
  });
});
