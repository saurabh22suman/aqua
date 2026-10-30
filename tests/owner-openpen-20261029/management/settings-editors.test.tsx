// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// Bounded Settings editors: the academy form separates identity from
// billing and keeps a Cancel path; absence alerts state the FIXED rule
// apart from the one editable threshold.

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
  useRouter: () => ({ refresh: () => undefined }),
}));

vi.mock("@/lib/actions/tenant-profile", () => ({
  updateTenantProfileAction: async () => ({ kind: "ok" }),
  getTenantProfileAction: async () => ({
    name: "Splash Sports Club",
    currency: "INR",
    timezone: "Asia/Kolkata",
    gstin: "27AAAAA0000A1Z5",
  }),
}));

vi.mock("@/lib/actions/absence-alerts", () => ({
  updateAbsenceAlertThresholdAction: async () => ({ ok: true }),
  getAbsenceAlertThresholdAction: async () => 40,
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["settings.manage"]),
    features: new Set<string>(),
  }),
  requirePagePermission: (value: unknown) => value,
}));

import AcademySettingsPage from "@/app/(owner)/owner/settings/academy/page";
import AlertSettingsPage from "@/app/(owner)/owner/settings/alerts/page";

afterEach(cleanup);

describe("academy profile editor", () => {
  it("separates identity from billing and keeps a Cancel path", async () => {
    render(await AcademySettingsPage());

    expect(
      screen.getByRole("heading", { level: 2, name: "Academy identity" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Billing details" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Cancel" }).getAttribute("href"),
    ).toBe("/owner/settings");
    expect(
      screen.getByText(/changing gstin affects future invoices only/i),
    ).toBeTruthy();
  });
});

describe("absence alert editor", () => {
  it("keeps the fixed rule distinct from the editable threshold", async () => {
    render(await AlertSettingsPage());

    expect(screen.getByText("Fixed academy alert rule")).toBeTruthy();
    expect(screen.getByText("Three consecutive absences")).toBeTruthy();
    expect(
      screen.getByRole("spinbutton", { name: /monthly attendance below/i }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save threshold" })).toBeTruthy();
  });
});
