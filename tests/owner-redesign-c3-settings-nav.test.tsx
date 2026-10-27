// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign (27 October 2026) — the Settings navigation.
//
// The owner must be able to reach the booking desk and the price
// catalogue from Settings. The two destinations have different
// authority, so the links are gated differently:
//
//   * Booking prices sits under the Settings page's own
//     settings.manage authority, which is the destination's authority
//     too.
//   * Bookings points at a route that 404s for a caller without
//     bookings.read or without the pool.booking entitlement, so it is
//     only offered when both are true. A hidden link is not security;
//     the route guard stays authoritative.

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
  permissions: new Set<string>(),
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

function hrefsIn(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a")).map(
    (anchor) => anchor.getAttribute("href") ?? "",
  );
}

describe("owner settings navigation", () => {
  it("offers the booking desk under Programs & facilities when it is permitted", async () => {
    ctx.permissions = new Set(["settings.manage", "bookings.read"]);
    ctx.features = new Set(["pool.booking"]);
    const { container } = render(
      await SettingsPage({ searchParams: Promise.resolve({ category: "programs" }) }),
    );
    expect(hrefsIn(container)).toContain("/owner/bookings");
  });

  it("withholds the booking desk from a caller who may not read bookings", async () => {
    ctx.permissions = new Set(["settings.manage"]);
    ctx.features = new Set(["pool.booking"]);
    const { container } = render(
      await SettingsPage({ searchParams: Promise.resolve({ category: "programs" }) }),
    );
    expect(hrefsIn(container)).not.toContain("/owner/bookings");
  });

  it("withholds the booking desk when the tenant has no booking entitlement", async () => {
    ctx.permissions = new Set(["settings.manage", "bookings.read"]);
    ctx.features = new Set();
    const { container } = render(
      await SettingsPage({ searchParams: Promise.resolve({ category: "programs" }) }),
    );
    expect(hrefsIn(container)).not.toContain("/owner/bookings");
  });

  it("offers the price catalogue under Fees & payments", async () => {
    ctx.permissions = new Set(["settings.manage"]);
    ctx.features = new Set();
    const { container } = render(
      await SettingsPage({ searchParams: Promise.resolve({ category: "fees" }) }),
    );
    expect(hrefsIn(container)).toContain("/owner/settings/booking-prices");
    expect(screen.getByText("Booking prices")).toBeTruthy();
  });
});
