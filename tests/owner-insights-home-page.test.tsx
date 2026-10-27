// @vitest-environment jsdom
//
// Owner Home — the page wiring for the insights section.
//
// The read models are read through the existing Server Actions
// (lib/actions/owner-insights.ts), so the page's job is narrow and
// security-relevant:
//
//   1. The selected facility is passed to the read as the LOCATION
//      SCOPE, so the numbers under a narrow filter are the narrow
//      numbers. A read that ignores the filter would show another
//      site's batches under this one's heading.
//   2. A caller without the operational-reports grant never reaches a
//      read at all — the section is not rendered, so it cannot leak
//      the fact that the data exists.
//   3. A read that fails degrades to an unavailable panel; it never
//      takes the page down and it is never drawn as a zero.
//
// The actions are mocked here: this file is about the WIRING, not
// about the read models (those are covered against a real database in
// tests/owner-insights-home-scope.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const FACILITY = "33333333-3333-4333-8333-333333333333";

const dashboardFixture = {
  tenantName: "Splash Sports Club",
  scopeLocationName: "Splash Pool",
  today: "2026-10-26",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 8,
  attendanceThisWeekPct: null,
  activeBatchCount: 1,
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
};

const attendanceFixture = {
  from: "2026-09-27",
  to: "2026-10-27",
  rows: [],
  summary: {
    sessions: 0,
    marks: { present: 0, late: 0, absent: 0, total: 0 },
    shares: { present: null, late: null, absent: null },
    register: {
      sessionsWithRoster: 0,
      completedRegisters: 0,
      completionPct: null,
      rosterSlots: 0,
      markedSlots: 0,
      unmarkedSlots: 0,
    },
  },
};

const enquiryFixture = {
  from: "2026-09-27",
  to: "2026-10-27",
  total: 0,
  rows: [],
};

const mocks = vi.hoisted(() => ({
  ctx: { permissions: new Set<string>(), features: new Set<string>() },
  attendance: vi.fn(),
  enquiries: vi.fn(),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => mocks.ctx,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/actions/dashboard", () => ({
  getOwnerDashboardAction: async () => dashboardFixture,
}));

vi.mock("@/lib/actions/branding", () => ({
  getBrandingAction: async () => ({
    displayName: "Splash Sports Club",
    shortName: "SSC",
    accent: "marine",
    fallbackDisplayName: "Splash Sports Club",
    fallbackShortName: "SSC",
    initials: "SS",
  }),
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/lib/actions/onboarding-checklist", () => ({
  getOnboardingChecklistAction: async () => ({
    completedCount: 1,
    totalCount: 3,
    items: [],
  }),
}));

vi.mock("@/lib/actions/owner-home-charts", () => ({
  getOwnerChartsAction: async () => null,
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));

vi.mock("@/lib/actions/owner-insights", () => ({
  getOwnerInsightsAttendanceAction: (...args: unknown[]) => mocks.attendance(...args),
  getOwnerInsightsEnquiryStagesAction: (...args: unknown[]) => mocks.enquiries(...args),
}));

import OwnerHomePage from "@/app/(owner)/owner/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.permissions = new Set([
    "dashboard.view",
    "reports.operational",
    "members.read",
    "enquiries.read",
  ]);
  mocks.ctx.features = new Set(["reports", "members", "enquiries"]);
  mocks.attendance.mockResolvedValue(attendanceFixture);
  mocks.enquiries.mockResolvedValue(enquiryFixture);
});

afterEach(() => {
  cleanup();
});

describe("Owner Home — the insights wiring", () => {
  it("reads both insight models with the selected facility as the location scope", async () => {
    render(
      await OwnerHomePage({ searchParams: Promise.resolve({ facility: FACILITY }) }),
    );

    expect(mocks.attendance).toHaveBeenCalledTimes(1);
    expect(mocks.enquiries).toHaveBeenCalledTimes(1);
    for (const call of [
      mocks.attendance.mock.calls[0]![0],
      mocks.enquiries.mock.calls[0]![0],
    ]) {
      const input = call as { from: string; to: string; locationId?: string };
      // The facility narrows the read; it is never dropped.
      expect(input.locationId).toBe(FACILITY);
      // A real 30-day window ending today (exclusive end).
      expect(input.from).toBe("2026-09-27");
      expect(input.to).toBe("2026-10-27");
    }
  });

  it("never reads the insight models for a caller without the operational-reports grant", async () => {
    // A caller who may open the dashboard but not the operational
    // reports gets no insight read at all, and no section.
    mocks.ctx.permissions = new Set(["dashboard.view", "members.read"]);

    render(await OwnerHomePage({ searchParams: Promise.resolve({}) }));

    expect(mocks.attendance).not.toHaveBeenCalled();
    expect(mocks.enquiries).not.toHaveBeenCalled();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Enquiries by current stage");
  });

  it("degrades a failed read to an unavailable panel instead of breaking the page", async () => {
    mocks.attendance.mockRejectedValue(new Error("connection reset"));

    render(await OwnerHomePage({ searchParams: Promise.resolve({}) }));

    const text = document.body.textContent ?? "";
    // The page is still there…
    expect(text).toContain("Collected today");
    // …and the failed read says it could not be read, which is not the
    // same as "nothing happened".
    expect(text).toMatch(/could not be read/i);
    expect(text).not.toMatch(/no batch ran/i);
  });
});
