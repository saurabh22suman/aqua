// @vitest-environment jsdom
//
// Finance lane — intended RED (3 November 2026): the Owner configuration
// form shows an owner two internal statements it does not need.
//
//   * the staff-location-scope row describes itself with registry
//     architecture ("An access control inside one academy, not tenant
//     isolation.") instead of the decision the owner is actually making;
//   * the source origin is printed TWICE — once in the badge beside the
//     row title and once after "Current value:" — even though the badge
//     already carries it.
//
// What must not change: the boolean policy, the values, the grants, the
// defaults, the request-only path, the required constraints, the
// failure/retry messages and the not-configured state. The registry's own
// description stays the definition of record — this is only what the owner
// reads.
//
// This renders the REAL form module, so the failure is the visible copy.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/owner-config", () => ({
  setOwnerConfigValueAction: vi.fn(),
  requestConfigChangeAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { OwnerConfigForm } from "@/components/owner-config-form";

type Item = Parameters<typeof OwnerConfigForm>[0]["items"][number];

const STAFF_SCOPE: Item = {
  key: "access.location_scoped_staff",
  value: false,
  visibility: "owner_read",
  risk: "sensitive",
  // The registry's own description — internal architecture included.
  description:
    "When on, staff see only the locations they are attached to. An access control inside one academy, not tenant isolation.",
  jsonSchema: { type: "boolean" },
  source: { scopeType: "default", scopeId: null, setBy: null, setAt: null },
  editable: false,
} as Item;

const ADVANCE_WINDOW: Item = {
  key: "bookings.advance_window_days",
  value: 7,
  visibility: "owner_edit",
  risk: "safe",
  description: "How far ahead a booking can be made.",
  jsonSchema: { type: "integer", minimum: 1, maximum: 90 },
  source: { scopeType: "default", scopeId: null, setBy: null, setAt: null },
  editable: true,
} as Item;

const BUSINESS_HOURS: Item = {
  key: "operations.business_hours",
  value: { days: [] },
  visibility: "owner_edit",
  risk: "safe",
  description: "Opening hours.",
  jsonSchema: { type: "object" },
  source: { scopeType: "default", scopeId: null, setBy: null, setAt: null },
  editable: true,
} as Item;

afterEach(cleanup);

describe("Owner configuration rows — owner-facing copy", () => {
  it("shows plain, decision-relevant help for the staff location scope", () => {
    render(<OwnerConfigForm items={[STAFF_SCOPE]} />);
    const row = screen.getByTestId("config-access.location_scoped_staff");
    const text = row.textContent ?? "";

    // INTENDED RED today.
    expect(text).toContain(
      "When enabled, staff are limited to their assigned locations.",
    );
    expect(text).not.toContain("tenant isolation");
    expect(text).not.toContain("access control inside one academy");
  });

  it("states the source origin once, in the badge", () => {
    render(<OwnerConfigForm items={[STAFF_SCOPE]} />);
    const row = screen.getByTestId("config-access.location_scoped_staff");
    const text = row.textContent ?? "";

    // INTENDED RED today: the origin is in the badge AND beside the
    // current value.
    expect(text.match(/platform default/g) ?? []).toHaveLength(1);
    expect(text).toContain("Current value:");
    expect(text).toContain("Off");
  });

  it("keeps the request-only path and offers no inline save for a read-only key", () => {
    // CONTROL (green today).
    render(<OwnerConfigForm items={[STAFF_SCOPE]} />);
    const row = screen.getByTestId("config-access.location_scoped_staff");
    expect(within(row).getByText(/Request change/i)).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Save" })).toBeNull();
    expect(row.textContent).toContain("Current value:");
    expect(row.textContent).toContain("Off");
  });

  it("keeps an editable key's inline control, its constraints and its save", () => {
    // CONTROL (green today): the writable path, the schema constraints
    // and the Save control are untouched.
    render(<OwnerConfigForm items={[ADVANCE_WINDOW]} />);
    const row = screen.getByTestId("config-bookings.advance_window_days");
    expect(within(row).getByRole("button", { name: "Save" })).toBeTruthy();
    const input = within(row).getByRole("spinbutton") as HTMLInputElement;
    expect(input.getAttribute("min")).toBe("1");
    expect(input.getAttribute("max")).toBe("90");
    expect(input.value).toBe("7");
  });

  it("keeps the managed-elsewhere row, its not-configured state and its destination", () => {
    // CONTROL (green today).
    render(<OwnerConfigForm items={[BUSINESS_HOURS]} />);
    const row = screen.getByTestId("config-operations.business_hours");
    expect(
      within(row).getByRole("link", { name: /Edit hours in Locations/i }),
    ).toBeTruthy();
    expect(row.textContent).toContain("Current value:");
    expect(row.textContent).toContain("Not configured yet.");
    // The origin is shown once — in the badge.
    expect((row.textContent ?? "").match(/platform default/g) ?? []).toHaveLength(
      1,
    );
  });
});
