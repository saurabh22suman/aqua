// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// W1-6 continuation — the onboarding checklist is a first-run aid.
// Once every step is complete it must disappear from BOTH owner
// entry points (the dashboard tile and the Settings row); the page
// itself stays live for direct links. This pins the Settings half.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("@/lib/auth/surface-guard", () => ({
  // The settings page now consumes the requireOwner() ctx directly
  // (R07 page gate); the fake carries the sets the page reads.
  requireOwner: async () => ({
    features: new Set<string>(),
    permissions: new Set(["settings.manage"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({ features: new Set<string>() }),
}));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: () => {} }));
vi.mock("@/lib/services/staff", () => ({
  getCurrentStaffIdentity: async () => ({ fullName: "Owner Ojaswi", phone: "+919000000001" }),
}));
vi.mock("@/lib/actions/locations", () => ({
  listAdminLocationsAction: async () => [{ id: "loc-1", name: "Worli Main" }],
}));
vi.mock("@/components/tenant-sign-out", () => ({
  TenantSignOut: () => <div data-testid="tenant-sign-out" />,
}));

const checklist = vi.hoisted(() => ({
  value: {
    items: [
      { key: "add_members", complete: true },
      { key: "create_batch", complete: true },
      { key: "assign_coach", complete: true },
    ],
    completedCount: 3,
    totalCount: 3,
  },
}));
vi.mock("@/lib/actions/onboarding-checklist", () => ({
  getOnboardingChecklistAction: async () => checklist.value,
}));

import SettingsPage from "@/app/(owner)/owner/settings/page";

afterEach(cleanup);

describe("settings onboarding row (W1-6 continuation)", () => {
  it("hides the Setup row once every step is complete", async () => {
    checklist.value = {
      items: [
        { key: "add_members", complete: true },
        { key: "create_batch", complete: true },
        { key: "assign_coach", complete: true },
      ],
      completedCount: 3,
      totalCount: 3,
    };
    render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByTestId("settings-onboarding")).toBeNull();
    expect(document.body.textContent).not.toContain("Onboarding checklist");
    expect(document.body.textContent).not.toContain("Setup guide");
  });

  it("keeps the Setup row while any step is incomplete", async () => {
    checklist.value = {
      items: [
        { key: "add_members", complete: true },
        { key: "create_batch", complete: false },
        { key: "assign_coach", complete: false },
      ],
      completedCount: 1,
      totalCount: 3,
    };
    render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    const row = screen.getByTestId("settings-onboarding");
    expect(row.getAttribute("href")).toBe("/owner/onboarding");
    expect(document.body.textContent).toContain("Onboarding checklist");
  });
});
