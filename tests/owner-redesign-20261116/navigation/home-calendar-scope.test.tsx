// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OwnerDashboard } from "@/components/owner-dashboard";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";

const data = {
  tenantName: "Local scope fixture",
  scopeLocationName: null,
  today: "2026-11-16",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 0,
  attendanceThisWeekPct: null,
  activeBatchCount: 0,
  needsAttention: [],
  todaysLanes: [],
  nextClass: null,
  facilityBreakdown: [],
  money: {
    collectedTodayPaise: 0, collectedTodayCount: 0,
    outstandingPaise: 0, dueInvoiceCount: 0,
    overduePaise: 0, overdueInvoiceCount: 0, oldestOverdueDays: null,
  },
} as OwnerDashboardData;

const branding = {
  displayName: "Local scope fixture", shortName: "LSF", accent: "marine",
  fallbackDisplayName: "Local scope fixture", fallbackShortName: "LSF", initials: "LS",
} as BrandingData;

function dashboard(facility: string | null, viewSchedule = true) {
  return <OwnerDashboard data={data} branding={branding}
    terminology={{ overrides: {}, locale: "en" }} facility={facility}
    can={{ addMember: false, recordPayment: false, captureEnquiry: false,
      readFees: false, viewSchedule }} />;
}

afterEach(cleanup);

describe("Home calendar preserves the scope actually displayed", () => {
  it.each([null, "e3620d1a-2da9-41ee-a410-5c763ae653fd"])(
    "carries explicit all or selected facility %s so a device cookie cannot replace it",
    (facility) => {
      render(dashboard(facility));
      const href = screen.getByRole("link", { name: "Open calendar" }).getAttribute("href");
      const url = new URL(href!, "http://localhost");
      expect(url.pathname).toBe("/owner/schedule");
      expect(url.searchParams.get("date")).toBe("2026-11-16");
      expect(url.searchParams.get("facility")).toBe(facility ?? "all");
      expect(url.searchParams.has("location")).toBe(false);
    },
  );

  it("keeps the calendar unavailable when schedule access is absent", () => {
    render(dashboard(null, false));
    expect(screen.queryByRole("link", { name: "Open calendar" })).toBeNull();
  });
});
