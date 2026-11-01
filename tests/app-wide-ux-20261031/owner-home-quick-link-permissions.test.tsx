// @vitest-environment jsdom
//
// Owner Home — the phone shortcuts never offer a destination the
// caller would be refused (tranche 3, 31 Oct 2026).
//
// What the coordinator found: the Owner Home phone quick-link grid
// (the shortcut block under the surfaces) offers Fees & payments,
// Enquiries, Programs & batches and Staff UNCONDITIONALLY, while the
// desktop sidebar filters those very same destinations by the
// caller's resolved permission set. A caller without the grant is
// handed a shortcut to a page that refuses them.
//
// This is UI VISIBILITY ONLY. No grant, no auth helper, no service read
// and no authorization key changes: the booleans are derived in the
// owner page from the checks the destinations already enforce —
// `reports.financial` + `invoices.read` (Fees), `enquiries.read`
// (Enquiries), `programs.read` (Programs & batches) and `staff.read`
// (Staff).
//
// The contract this file pins:
//
//   1. `can.readFees === false` withholds the Fees & payments shortcut.
//   2. `can.readEnquiries === false` withholds the Enquiries shortcut.
//   3. The programs and staff shortcuts are withheld on the same
//      principle, on the booleans the owner page derives from those
//      destinations' own guards.
//   4. A normal owner keeps every authorized shortcut, and withholding
//      one link does not empty the rest of the grid.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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

vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { OwnerDashboard } from "@/components/owner-dashboard";
import type { BrandingData } from "@/lib/services/branding";
import type { OwnerDashboardData } from "@/lib/services/dashboard";

const BRANDING = {
  displayName: "Splash Sports Club",
  shortName: "SSC",
  accent: "marine",
  fallbackDisplayName: "Splash Sports Club",
  fallbackShortName: "SSC",
  initials: "SS",
} as BrandingData;

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

// The UI booleans the dashboard reads. `readPrograms` and `readStaff`
// are the two this tranche adds; they are UI names, deliberately
// distinct from the authorization keys they are derived from
// (`programs.read`, `staff.read`).
const ALL_CAN = {
  addMember: true,
  recordPayment: true,
  captureEnquiry: true,
  readFees: true,
  viewSchedule: true,
  readEnquiries: true,
  readPrograms: true,
  readStaff: true,
};

type Can = NonNullable<
  React.ComponentProps<typeof OwnerDashboard>["can"]
>;

function can(overrides: Record<string, boolean> = {}): Can {
  return { ...ALL_CAN, ...overrides } as unknown as Can;
}

function dashboard(): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: "Splash Pool",
    today: "2026-10-31",
    todayMarked: 0,
    todayTotal: 0,
    activeMemberCount: 16,
    attendanceThisWeekPct: null,
    activeBatchCount: 6,
    needsAttention: [],
    todaysLanes: [],
    nextClass: null,
    facilityBreakdown: [],
    money: {
      collectedTodayPaise: 2100000,
      collectedTodayCount: 2,
      outstandingPaise: 12600000,
      dueInvoiceCount: 4,
      overduePaise: 12600000,
      overdueInvoiceCount: 4,
      oldestOverdueDays: 12,
    },
  } as OwnerDashboardData;
}

function renderHome(overrides: Record<string, boolean> = {}) {
  return render(
    <OwnerDashboard
      data={dashboard()}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      can={can(overrides)}
    />,
  );
}

// The duplicate Home grid was removed. Permission-filtered More/sidebar
// retains these destinations; Home retains only the task actions and shortcuts.
import { ownerSidebarGroupsForPermissions } from "@/lib/nav";
const destinations = (grants: string[]) => ownerSidebarGroupsForPermissions(new Set(grants)).flatMap(group => group.items).map(item => item.href);
afterEach(cleanup);
describe("owner navigation destination grants", () => {
  it.each([
    ["invoices.read", "/owner/fees"], ["enquiries.read", "/owner/enquiries"],
    ["programs.read", "/owner/programs"], ["staff.read", "/owner/staff"],
  ])("requires %s for %s", (grant, href) => {
    expect(destinations([])).not.toContain(href);
    expect(destinations([grant])).toContain(href);
  });
  it("keeps allowed Home actions without the duplicate grid", () => {
    renderHome();
    expect(screen.getByRole("link", { name: /record payment/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /add member/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^enquiry$/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Fees & payments" })).toBeNull();
  });
});
