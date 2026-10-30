// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// India-first items 4 + 5: business hours and the absence threshold are
// managed by their real editors. No generic inline edit/request duplicate;
// genuinely owner_read keys keep the change-request path.

vi.mock("@/lib/actions/owner-config", () => ({
  setOwnerConfigValueAction: vi.fn(),
  requestConfigChangeAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
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

import { OwnerConfigForm } from "@/components/owner-config-form";

function item(overrides: Record<string, unknown>) {
  return {
    key: "operations.business_hours",
    value: {
      days: [{ day: "monday", closed: false, open: "06:00", close: "21:00" }],
    },
    visibility: "owner_edit",
    risk: "safe",
    description: "Opening hours.",
    jsonSchema: { type: "object" },
    source: { scopeType: "default", scopeId: null, setBy: null, setAt: null },
    editable: true,
    ...overrides,
  } as Parameters<typeof OwnerConfigForm>[0]["items"][number];
}

afterEach(cleanup);

describe("owner config managed-elsewhere rows", () => {
  it("links business hours to Locations without a request-change duplicate", () => {
    render(<OwnerConfigForm items={[item({})]} />);

    const row = screen.getByTestId("config-operations.business_hours");
    expect(
      within(row)
        .getByRole("link", { name: /Edit hours in Locations/i })
        .getAttribute("href"),
    ).toBe("/owner/settings/locations");
    expect(within(row).queryByText(/Request change/i)).toBeNull();
    expect(within(row).queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("shows the stored threshold value and links to Alerts without a duplicate edit", () => {
    render(
      <OwnerConfigForm
        items={[
          item({
            key: "attendance.absence_alert_threshold_pct",
            value: 40,
            visibility: "owner_edit",
            jsonSchema: { type: "integer", minimum: 0, maximum: 100 },
            description: "Absence alert threshold.",
          }),
        ]}
      />,
    );

    const row = screen.getByTestId(
      "config-attendance.absence_alert_threshold_pct",
    );
    expect(within(row).getByText("40")).toBeTruthy();
    expect(
      within(row)
        .getByRole("link", { name: /Edit threshold in Alerts/i })
        .getAttribute("href"),
    ).toBe("/owner/settings/alerts");
    expect(within(row).queryByText(/Request change/i)).toBeNull();
    expect(within(row).queryByRole("spinbutton")).toBeNull();
    expect(within(row).queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("keeps the request path for an owner_read business-hours value", () => {
    render(
      <OwnerConfigForm
        items={[
          item({
            visibility: "owner_read",
            editable: false,
          }),
        ]}
      />,
    );

    const row = screen.getByTestId("config-operations.business_hours");
    expect(within(row).getByText(/Request change/i)).toBeTruthy();
  });

  it("keeps the change-request path for a genuine owner_read setting", () => {
    render(
      <OwnerConfigForm
        items={[
          item({
            key: "attendance.low_attendance_window_days",
            value: 7,
            visibility: "owner_read",
            editable: false,
            structured: false,
            jsonSchema: { type: "integer" },
            description: "Window.",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/Request change/i)).toBeTruthy();
  });
});
