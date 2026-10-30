// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Roster composition: the working week leads; shift creation is an explicit
// disclosure after it. Zero shifts still shows every authorised staff row
// before the editor, and closing the editor preserves the draft.

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
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["staff.roster"]),
    features: new Set<string>(),
  }),
  requirePagePermission: (value: unknown) => value,
}));
vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));
vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [{ id: "loc-1", name: "Worli Main" }],
}));
vi.mock("@/lib/actions/staff", () => ({
  listStaffAction: async () =>
    ["Aanya Rao", "Bhaskar Menon", "Rhea Jain", "Anil Shah"].map(
      (fullName, index) => ({
        id: `staff-${index}`,
        personId: `person-${index}`,
        fullName,
        staffType: index === 3 ? "accountant" : "coach",
        userId: null,
        employedOn: null,
      }),
    ),
}));
vi.mock("@/lib/actions/shifts", () => ({
  listRosterWeekAction: async () => [],
  listShiftTemplatesAction: async () => [],
  createShiftAction: async () => ({ ok: true }),
  createShiftTemplateAction: async () => ({ ok: true }),
  deleteShiftAction: async () => ({ ok: true }),
  publishRosterAction: async () => ({ ok: true }),
}));

import StaffRosterPage from "@/app/(owner)/owner/staff/roster/page";

afterEach(cleanup);

describe("roster add-shift disclosure", () => {
  it("shows zero-shift staff rows before a collapsed add-shift disclosure", async () => {
    render(await StaffRosterPage({}));

    const table = screen.getByRole("table", { name: "Working week" });
    expect(within(table).getAllByRole("rowheader")).toHaveLength(4);

    const disclosure = screen.getByRole("button", { name: "Add shift" });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(disclosure.className).toMatch(/min-h-(11|12)/);

    const editor = document.querySelector("[data-add-shift-form]");
    expect(editor?.hasAttribute("hidden")).toBe(true);

    // The table precedes the disclosure in document order.
    const tableTop = table.compareDocumentPosition(disclosure);
    expect(tableTop & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the draft when the editor is cancelled and reopened", async () => {
    render(await StaffRosterPage({}));

    fireEvent.click(screen.getByRole("button", { name: "Add shift" }));
    const editor = document.querySelector("[data-add-shift-form]");
    expect(editor?.hasAttribute("hidden")).toBe(false);

    const date = screen.getByLabelText(/^Date/) as HTMLInputElement;
    fireEvent.change(date, { target: { value: "30/10/2026" } });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(editor?.hasAttribute("hidden")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Add shift" }));
    expect(screen.getByLabelText(/^Date/)).toHaveProperty(
      "value",
      "30/10/2026",
    );
  });
});
