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
import { cleanup, render, screen } from "@testing-library/react";

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

const enquiryFixture = {
  from: "2026-09-27",
  to: "2026-10-27",
  total: 0,
  rows: [],
};

const mocks = vi.hoisted(() => ({
  ctx: { permissions: new Set<string>(), features: new Set<string>() },
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
  mocks.enquiries.mockResolvedValue(enquiryFixture);
});

afterEach(() => {
  cleanup();
});

describe("Owner Home — the insights wiring", () => {
  // Analysis has moved to Reports; Home must not issue this read even
  // for an authorized owner and a facility filter.
  it("does not issue the reports-only enquiry read from Home", async () => {
    render(await OwnerHomePage({ searchParams: Promise.resolve({ facility: FACILITY }) }));
    expect(mocks.enquiries).not.toHaveBeenCalled();
  });

  it("never reads the insight model for a caller without the operational-reports grant", async () => {
    // A caller who may open the dashboard but not the operational
    // reports gets no insight read at all, and no section.
    mocks.ctx.permissions = new Set(["dashboard.view", "members.read"]);

    render(await OwnerHomePage({ searchParams: Promise.resolve({}) }));

    expect(mocks.enquiries).not.toHaveBeenCalled();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Enquiries by current stage");
  });

  it("keeps Home usable when a reports-only read would fail", async () => {
    mocks.enquiries.mockRejectedValue(new Error("connection reset"));
    render(await OwnerHomePage({ searchParams: Promise.resolve({}) }));
    expect(mocks.enquiries).not.toHaveBeenCalled();
    expect(screen.getByTestId("owner-home")).toBeTruthy();
  });

});
