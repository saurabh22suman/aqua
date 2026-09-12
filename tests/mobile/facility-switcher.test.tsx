// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// W1-6 (docs/role-surfaces-plan.md) — the owner facility switcher and
// consolidated view. The switcher appears on every owner screen only
// when the tenant has more than one facility, persists the choice in
// `?facility=`, and the members list filters on it. Home shows a
// per-facility breakdown in the All view.
//
// Wave 1 limitation (documented in the plan): only member-scoped data
// can be split by facility today — batches/sessions have no location
// until Wave 2.

const push = vi.hoisted(() => vi.fn());
const { LOCATIONS, FACILITY_2 } = vi.hoisted(() => ({
  FACILITY_2: "22222222-2222-7222-8222-222222222222",
  LOCATIONS: [
    { id: "11111111-1111-7111-8111-111111111111", name: "Worli Main" },
    { id: "22222222-2222-7222-8222-222222222222", name: "Bandra Annex" },
  ],
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/owner/members",
  useSearchParams: () => new URLSearchParams(),
}));
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
vi.mock("@/lib/actions/tenant-auth", () => ({ logoutTenantAction: vi.fn() }));
vi.mock("@/lib/actions/people", () => ({
  listMembersAction: vi.fn(async () => []),
  listLocationsAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ overrides: {}, locale: "en" }),
}));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}) }));
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => ({ tenantId: "t1", roleKey: "owner" }),
}));
vi.mock("@/lib/auth/surface-access", () => ({
  canAccessSurface: () => true,
  SURFACE_OWNER: "owner",
}));
vi.mock("@/lib/services/people", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/people")>();
  return { ...actual, listLocations: async () => LOCATIONS };
});

import { FacilitySwitcher } from "@/components/facility-switcher";
import { OwnerDashboard } from "@/components/owner-dashboard";
import MembersPage from "@/app/(owner)/owner/members/page";
import OwnerLayout from "@/app/(owner)/layout";
import { listMembersAction } from "@/lib/actions/people";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

const DASHBOARD: OwnerDashboardData = {
  tenantName: "Aqua",
  today: "2026-09-13",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 32,
  attendanceThisWeekPct: null,
  activeBatchCount: 4,
  needsAttention: [],
  todaysLanes: [],
  facilityBreakdown: [
    { locationId: "loc-1", locationName: "Worli Main", activeMembers: 20, attendancePct: 80 },
    { locationId: "loc-2", locationName: "Bandra Annex", activeMembers: 12, attendancePct: null },
  ],
};

const BRANDING = {
  displayName: "Aqua",
  shortName: "AQ",
  accent: "mango",
  fallbackDisplayName: "Aqua",
  fallbackShortName: "AQ",
  initials: "AQ",
} as BrandingData;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("facility switcher (W1-6)", () => {
  it("is hidden for a single-facility tenant", () => {
    const { container } = render(<FacilitySwitcher locations={[LOCATIONS[0]!]} />);
    expect(container.querySelector('[data-testid="facility-switcher"]')).toBeNull();
  });

  it("offers All facilities plus each facility", () => {
    render(<FacilitySwitcher locations={LOCATIONS} />);
    const select = screen.getByTestId("facility-switcher") as HTMLSelectElement;
    expect(select.value).toBe("all");
    expect(screen.getByRole("option", { name: "All facilities" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Bandra Annex" })).toBeTruthy();
  });

  it("persists the choice in the URL", () => {
    render(<FacilitySwitcher locations={LOCATIONS} />);
    fireEvent.change(screen.getByTestId("facility-switcher"), {
      target: { value: FACILITY_2 },
    });
    expect(push).toHaveBeenCalledWith(`/owner/members?facility=${FACILITY_2}`);
  });
});

describe("owner members page reads ?facility= (W1-6)", () => {
  it("passes the facility filter to the list action", async () => {
    await MembersPage({
      searchParams: Promise.resolve({ facility: FACILITY_2 }),
    });
    expect(listMembersAction).toHaveBeenCalledWith({ locationId: FACILITY_2 });
  });

  it("ignores a malformed facility value", async () => {
    await MembersPage({
      searchParams: Promise.resolve({ facility: "not-a-uuid" }),
    });
    expect(listMembersAction).toHaveBeenCalledWith({});
  });
});

describe("owner layout hosts the switcher (W1-6)", () => {
  it("renders the switcher when the tenant has multiple facilities", async () => {
    const layout = await OwnerLayout({ children: null });
    render(layout);
    expect(screen.getByTestId("facility-switcher")).toBeTruthy();
  });
});

describe("consolidated per-facility view (W1-6)", () => {
  it("shows the breakdown on Home", () => {
    render(
      <OwnerDashboard data={DASHBOARD} branding={BRANDING} terminology={TERMINOLOGY} />,
    );
    expect(document.body.textContent).toContain("Worli Main");
    expect(document.body.textContent).toContain("Bandra Annex");
    expect(document.body.textContent).toContain("20 active");
    expect(document.body.textContent).toContain("no attendance yet");
  });
});
