// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// The reference Settings page is ONE page of six task surfaces — Academy,
// Programs & facilities, Fees & payments, Team & access, Communications and
// Appearance & advanced — each listing its destinations as rows with an
// "Open" action, with the account block as its own section below. A reader
// must not have to drill through a category card to discover a destination.
//
// The `?category=` view stays supported (it is the existing deep-link shape
// and another lane's test asserts its contents), but the default page is the
// six-surface composition above.

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

const ctx = vi.hoisted(() => ({
  permissions: new Set<string>(["settings.manage"]),
  features: new Set<string>(),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: ctx.permissions,
    features: ctx.features,
  }),
  requirePagePermission: (value: unknown) => value,
}));
vi.mock("@/lib/services/staff", () => ({
  getCurrentStaffIdentity: async () => ({
    fullName: "Owner Ojaswi",
    phone: "+919000000001",
  }),
}));
vi.mock("@/lib/actions/locations", () => ({
  listAdminLocationsAction: async () => [{ id: "loc-1", name: "Worli Main" }],
}));
vi.mock("@/components/tenant-sign-out", () => ({
  TenantSignOut: () => <div data-testid="tenant-sign-out" />,
}));
vi.mock("@/lib/actions/onboarding-checklist", () => ({
  getOnboardingChecklistAction: async () => ({
    items: [{ key: "add_members", complete: true }],
    completedCount: 1,
    totalCount: 1,
  }),
}));

import SettingsPage from "@/app/(owner)/owner/settings/page";

afterEach(cleanup);

const GROUPS = [
  "Academy",
  "Programs & facilities",
  "Fees & payments",
  "Team & access",
  "Communications",
  "Appearance & advanced",
];

describe("owner settings — six task surfaces", () => {
  it("shows every task group on the page itself as a section heading", async () => {
    render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeTruthy();
    for (const group of GROUPS) {
      expect(
        screen.getByRole("heading", { level: 2, name: group }),
      ).toBeTruthy();
    }
  });

  it("links each destination from the page itself with a named Open action", async () => {
    render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    // A destination inside the FIRST group is reachable without opening a
    // category first.
    const academy = screen.getByRole("link", {
      name: "Open Academy profile",
    });
    expect(academy.getAttribute("href")).toBe("/owner/settings/academy");

    expect(
      screen
        .getByRole("link", { name: "Open Membership plans" })
        .getAttribute("href"),
    ).toBe("/owner/settings/plans");
    expect(
      screen
        .getByRole("link", { name: "Open Absence alerts" })
        .getAttribute("href"),
    ).toBe("/owner/settings/alerts");
  });

  it("keeps the account block in its own section after the task groups", async () => {
    const { container } = render(
      await SettingsPage({ searchParams: Promise.resolve({}) }),
    );

    const account = screen.getByRole("heading", {
      level: 2,
      name: "Your account",
    });
    expect(account).toBeTruthy();
    expect(screen.getByTestId("tenant-sign-out")).toBeTruthy();

    const text = container.textContent ?? "";
    expect(text.indexOf("Appearance & advanced")).toBeLessThan(
      text.indexOf("Your account"),
    );
  });
});
