// @vitest-environment jsdom
//
// Finance lane — P1/P2 actual-app parity (3 November 2026).
// Intended RED before production edits:
//   * Reports index is a flat 44px list, not independent category cards;
//   * no `report-categories` grid;
//   * no `report-card` links with the existing destination URLs.
// Portable fixtures only; actual React components; no mock HTML artifact.

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  permissions: new Set<string>(),
  features: new Set<string>(),
  cookie: "",
  money: vi.fn(),
  enquiry: vi.fn(),
  retention: vi.fn(),
  coach: vi.fn(),
  utilisation: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (s.cookie ? { value: s.cookie } : undefined) }),
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant",
    userId: "user",
    permissions: s.permissions,
    features: s.features,
    allLocations: true,
    locationIds: [],
  }),
  requirePagePermission: (_ctx: unknown, key: string) => {
    if (!s.permissions.has(key)) throw new Error("denied");
  },
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));
vi.mock("@/lib/actions/owner-reports", () => ({
  getEnquiryFunnelAction: s.enquiry,
  getRetentionViewAction: s.retention,
  getCoachLoadAction: s.coach,
  getFacilityUtilisationAction: s.utilisation,
  attendanceReportCsvAction: vi.fn(),
}));
vi.mock("@/lib/actions/owner-analytics", () => ({
  getMoneyAnalyticsAction: s.money,
}));
vi.mock("@/components/reports/enquiry-funnel-card", () => ({
  EnquiryFunnelCard: () => <h2>Current enquiry stages</h2>,
}));
vi.mock("@/components/reports/coach-load-card", () => ({ CoachLoadCard: () => <h2>Coach load</h2> }));
vi.mock("@/components/reports/retention-card", () => ({ RetentionCard: () => <h2>Attendance records</h2> }));
vi.mock("@/components/reports/utilisation-card", () => ({ UtilisationCard: () => <h2>Utilisation</h2> }));
vi.mock("@/components/reports/analytics-cards", () => ({ PlanRevenueCard: () => <h2>Plan revenue</h2> }));

import ReportsPage from "@/app/(owner)/owner/reports/page";

const ALL = ["reports.operational", "reports.financial", "invoices.read", "staff.attendance"];

beforeEach(() => {
  s.permissions = new Set(ALL);
  s.features = new Set(["reports", "billing"]);
  s.money.mockResolvedValue({ planRevenue: [] });
  s.enquiry.mockResolvedValue([]);
  s.retention.mockResolvedValue(null);
  s.coach.mockResolvedValue([]);
  s.utilisation.mockResolvedValue({ facilities: [], weeks: 4, businessHoursConfigured: false });
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function renderPage() {
  return render(await ReportsPage({ searchParams: Promise.resolve({}) }));
}

describe("Reports index category cards", () => {
  it("renders five independent category cards with the real destination URLs", async () => {
    const { container } = await renderPage();

    const grid = container.querySelector('[data-testid="report-categories"]');
    expect(grid, "the category grid exists").not.toBeNull();
    expect(grid!.className).toContain("grid-cols-2");

    const cards = Array.from(container.querySelectorAll<HTMLAnchorElement>('[data-testid="report-card"]'));
    expect(cards.map((card) => card.getAttribute("aria-label") ?? card.textContent)).toHaveLength(5);

    const hrefs = cards.map((card) => card.getAttribute("href") ?? "");
    const expected = [
      "/owner/reports/collections?view=trends&period=last7&facility=all",
      "/owner/reports/members?period=last7&facility=all",
      "/owner/reports/staff?period=last7&facility=all",
      "/owner/reports/batches?facility=all",
      "/owner/reports/attendance?period=last7&facility=all",
    ];
    for (const href of expected) {
      expect(hrefs, `destination ${href} is kept`).toContain(href);
    }

    // Cards carry no headline figures.
    const gridText = grid!.textContent ?? "";
    expect(gridText).not.toMatch(/\d/);
    expect(gridText).not.toMatch(/%|₹/);

    // The old single-column list rows are gone.
    expect(container.querySelector("main ul.divide-y")).toBeNull();
  });

  it("keeps the More reports disclosure and the report preferences recovery", async () => {
    const { container } = await renderPage();
    expect(container.textContent).toContain("More reports");
    // All five families hidden by the operator preference: no cards, and the
    // recovery notice still offers the settings path.
    window.localStorage.setItem(
      "aqua:owner-report-preferences:tenant:user",
      JSON.stringify({ attendance: false, members: false, staff: false, batches: false, collections: false }),
    );
    const { container: hidden } = await renderPage();
    expect(hidden.querySelectorAll('[data-testid="report-card"]')).toHaveLength(0);
    expect(hidden.textContent).toContain("No report cards selected");
  });
});
