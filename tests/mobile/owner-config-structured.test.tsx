// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — structured configuration values
// must never render as "[object Object]". Business hours are summarised
// and linked to their real editor; UUID scope ids are not labels.

vi.mock("@/lib/actions/owner-config", () => ({
  setOwnerConfigValueAction: vi.fn(),
  requestConfigChangeAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { OwnerConfigForm } from "@/components/owner-config-form";

function item(overrides: Record<string, unknown>) {
  return {
    key: "operations.business_hours",
    value: { days: [] },
    visibility: "owner_edit",
    risk: "safe",
    description:
      "Opening and closing times per day for a location. Empty means not configured yet.",
    jsonSchema: { type: "object" },
    source: {
      scopeType: "default",
      scopeId: null,
      setBy: null,
      setAt: null,
    },
    editable: true,
    ...overrides,
  } as Parameters<typeof OwnerConfigForm>[0]["items"][number];
}

afterEach(cleanup);

describe("OwnerConfigForm structured values (P1)", () => {
  it("renders business hours readably and links to the location editor", () => {
    render(
      <OwnerConfigForm
        items={[
          item({
            value: {
              days: [
                { day: "monday", closed: false, open: "06:00", close: "21:00" },
                { day: "sunday", closed: true, open: "06:00", close: "21:00" },
              ],
            },
          }),
        ]}
      />,
    );

    const text = document.body.textContent ?? "";
    expect(text).not.toContain("[object Object]");
    expect(text).toContain("Mon 06:00–21:00");
    expect(text).toContain("Sun closed");
    const link = screen.getByRole("link", { name: /edit hours in locations/i });
    expect(link.getAttribute("href")).toBe("/owner/settings/locations");
    // No inline Save for a structured value (the request-change
    // disclosure is the only text input, and it lives behind details).
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("describes an empty business-hours value honestly", () => {
    render(<OwnerConfigForm items={[item({ value: { days: [] } })]} />);
    expect(document.body.textContent).toContain("Not configured yet.");
  });

  it("shows a human scope label instead of a UUID", () => {
    render(
      <OwnerConfigForm
        items={[
          item({
            key: "bookings.advance_window_days",
            value: 30,
            jsonSchema: { type: "integer", minimum: 1, maximum: 365 },
            source: {
              scopeType: "tenant",
              scopeId: "99999999-9999-4999-8999-999999999999",
              setBy: null,
              setAt: null,
            },
          }),
        ]}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("set for this academy");
    expect(text).not.toContain("99999999-9999-4999-8999-999999999999");
  });
});
