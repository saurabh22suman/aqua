// @vitest-environment jsdom
//
// Finance lane — RED (2 Nov 2026): the Reports INDEX is a concise REPORT
// DIRECTORY, not a second dashboard of KPI figures.
//
// REPORTS-COMPOSITION-ADDENDUM (2 Nov 2026): the approved mock's
// viewReports() (khelsuite-owner-light-type-mock.html lines 1122-1134) is a
// concise list of purposeful destinations — Financial report, Batches report,
// Attendance report — each with a one-line purpose. The human repeatedly
// rejected repeating the same figures. The real Reports index today renders
// big Attendance / Members / Staff / Places / Payments KPI cards, which
// repeats what each detailed report already owns.
//
// This RED is a rendered PAGE test (the real page module, with the data
// actions mocked), so it fails on the actual composition and never on an
// import or a source string.
//
// What the intended composition must keep (all preserved by the fix):
//   * every supported report family still has a purposeful named destination
//     (Financial/Collections, Members, Staff, Batches, Attendance);
//   * the supplementary reports (Enquiries, Attendance records to review,
//     Coach load, Utilisation, Plan revenue) stay reachable through a concise
//     disclosure — not deleted, and not padded with duplicate KPI tiles;
//   * permissions, feature gates, report-visibility preferences, the facility
//     scope, unavailable/empty feedback and the existing query semantics of
//     each destination are unchanged;
//   * each detailed report keeps its own figures, charts and methodology.
//
// Reference: approved mock sha256
// 3bd4a5533ba345fb1daaad15761e8646df2993c6a57be94ce45960f523c5bca5.

import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  attendance: vi.fn(),
  members: vi.fn(),
  staff: vi.fn(),
  batches: vi.fn(),
  charts: vi.fn(),
  money: vi.fn(),
  enquiry: vi.fn(),
  retention: vi.fn(),
  coach: vi.fn(),
  utilisation: vi.fn(),
  permissions: new Set<string>(),
  features: new Set<string>(),
  cookie: "",
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

vi.mock("@/lib/actions/owner-insights", () => ({
  getOwnerInsightsAttendanceAction: s.attendance,
}));
vi.mock("@/lib/services/owner-people-reports", () => ({
  getMembersReport: s.members,
  getStaffReport: s.staff,
}));
vi.mock("@/lib/services/owner-batch-report", () => ({
  getOwnerBatchReport: s.batches,
}));
vi.mock("@/lib/services/owner-home-charts", () => ({
  getOwnerCharts: s.charts,
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
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

// These two report cards are async server components; the jsdom renderer
// cannot await them. The stubs keep their headings, so the assertions still
// read the REAL composition of the page (which reports sit in the
// disclosure) rather than a stub's own layout.
vi.mock("@/components/reports/enquiry-funnel-card", () => ({
  EnquiryFunnelCard: () => <h2>Current enquiry stages</h2>,
}));
vi.mock("@/components/reports/coach-load-card", () => ({
  CoachLoadCard: () => <h2>Coach load</h2>,
}));

import ReportsPage from "@/app/(owner)/owner/reports/page";

const FACILITY = "11111111-1111-4111-8111-111111111111";

/** The report families the directory must offer a destination for. */
const DIRECTORY_FAMILIES = [
  { key: "collections", name: /financial|collections/i },
  { key: "members", name: /members/i },
  { key: "staff", name: /staff/i },
  { key: "batches", name: /batches/i },
  { key: "attendance", name: /attendance/i },
] as const;

/** Renders the real page and returns its OWN container (queries are scoped). */
async function renderIndex(params: Record<string, string> = {}) {
  const page = await ReportsPage({ searchParams: Promise.resolve(params) });
  const view = render(page);
  return { view, scope: within(view.container) };
}

beforeEach(() => {
  s.permissions.clear();
  s.permissions.add("reports.operational");
  s.permissions.add("reports.financial");
  s.permissions.add("invoices.read");
  s.permissions.add("staff.attendance");
  s.features.clear();
  s.features.add("reports");
  s.features.add("billing");
  s.cookie = "";

  // Real figures exist for every report. The directory must NOT print them.
  s.attendance.mockReset().mockResolvedValue({
    from: "2026-10-26",
    to: "2026-11-02",
    summary: {
      sessions: 4,
      marks: { present: 51, late: 9, absent: 12, total: 72 },
      shares: { present: 71, late: 13, absent: 17 },
      register: {
        sessionsWithRoster: 4,
        completedRegisters: 3,
        completionPct: 75,
        rosterSlots: 90,
        markedSlots: 80,
        unmarkedSlots: 10,
      },
    },
    rows: [],
  });
  s.members.mockReset().mockResolvedValue({
    statuses: [{ status: "active", count: 42 }],
    joined: 3,
    joinedUnknown: 0,
    joinedByDay: [],
  });
  s.staff.mockReset().mockResolvedValue({
    attendance: [{ checkedIn: true }],
    shifts: [],
  });
  s.batches.mockReset().mockResolvedValue([
    { batchId: "b1", batchName: "Swim A", reservedPlaces: 8, capacity: 12 },
  ]);
  s.charts.mockReset().mockResolvedValue({
    collections: { totalPaise: 4200000, paymentCount: 17 },
  });
  s.money.mockReset().mockResolvedValue({ collections: {}, planRevenue: [] });
  s.enquiry.mockReset().mockResolvedValue([]);
  s.retention.mockReset().mockResolvedValue(null);
  s.coach.mockReset().mockResolvedValue([]);
  s.utilisation.mockReset().mockResolvedValue(null);

  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Reports index composition (approved mock report directory)", () => {
  it("offers a purposeful named destination for every supported report", async () => {
    const { scope } = await renderIndex();

    for (const family of DIRECTORY_FAMILIES) {
      const link = scope
        .getAllByRole("link")
        .find((candidate) => family.name.test(candidate.textContent ?? ""));
      expect(
        link,
        `the directory offers a named ${family.key} destination`,
      ).toBeTruthy();
      expect(link?.getAttribute("href"), `${family.key} destination href`).toBeTruthy();
    }
  });

  it("does not repeat the core KPI figures that each detailed report owns", async () => {
    const { view } = await renderIndex();

    const body = view.container.textContent ?? "";

    // The attendance rate, the members/staff/places/payments headline numbers
    // and the register completion belong to their own detailed reports.
    expect(body, "no repeated attendance percentage").not.toContain("83%");
    expect(body, "no repeated attendance marks breakdown").not.toContain(
      "60 of 72",
    );
    expect(body, "no repeated members active count").not.toContain("42");
    expect(body, "no repeated staff check-in count").not.toContain(
      "Recorded check-ins",
    );
    expect(body, "no repeated places capacity breakdown").not.toContain(
      "Reserved of 12 places",
    );
    expect(body, "no repeated captured-payments count").not.toContain(
      "Captured payments",
    );
  });

  it("hides the directory list when every family is hidden", async () => {
    // 2 Nov 2026 (production Chrome): with every family switched off in the
    // real Settings controls, the recovery notice appears and the list has no
    // children — but it still painted an empty bordered card (358x2px). The
    // list therefore carries `empty:hidden`, so an empty list paints nothing.
    window.localStorage.setItem(
      "aqua:owner-report-preferences:tenant:user",
      JSON.stringify({
        attendance: false,
        members: false,
        staff: false,
        batches: false,
        collections: false,
      }),
    );
    const { view } = await renderIndex();

    const grid = view.container.querySelector('[data-testid="report-categories"]')!;
    expect(grid.querySelectorAll('[data-testid="report-card"]').length, "no cards when every family is hidden").toBe(0);
    expect(
      grid.className,
      "the empty category grid is hidden instead of painting a card",
    ).toContain("empty:hidden");
    // The recovery path is still offered.
    expect(view.getByText("No report cards selected")).toBeTruthy();
  });

  it("keeps the directory list visible and populated when families are shown", async () => {
    const { view } = await renderIndex();

    const grid = view.container.querySelector('[data-testid="report-categories"]')!;
    expect(grid.querySelectorAll('[data-testid="report-card"]').length, "one card per supported family").toBe(5);
    // A populated grid is never empty, so `empty:hidden` (which applies to
    // the empty grid only) leaves it showing.
    expect(grid.className).toContain("empty:hidden");
    expect(view.queryByText("No report cards selected")).toBeNull();
  });

  it("carries no generic instructional paragraph under the title", async () => {
    const { view } = await renderIndex();
    const body = view.container.textContent ?? "";

    // The approved mock's Reports directory has a title and named
    // destinations with one-line purposes. It has no generic
    // instructional paragraph telling the owner what a report is.
    expect(body, "no generic instructional paragraph").not.toContain(
      "Open a report",
    );
    expect(body, "no generic method paragraph").not.toMatch(
      /each one carries its own/i,
    );

    // The meaning comes from the destination rows themselves.
    expect(body).toContain("Trends and payment methods");
    expect(body).toContain("Reserved places and capacity");
  });

  it("keeps the report-visibility preferences and the settings entry reachable", async () => {
    const { scope } = await renderIndex();

    // Report visibility settings remain one click away.
    const customize = scope.getByRole("link", { name: "Customize reports" });
    expect(customize.getAttribute("href")).toContain("/owner/settings/reports");

    // Hiding every family still leaves the recovery path.
    cleanup();
    window.localStorage.setItem(
      "aqua:owner-report-preferences:tenant:user",
      JSON.stringify({
        attendance: false,
        members: false,
        staff: false,
        batches: false,
        collections: false,
      }),
    );
    const hidden = await renderIndex();
    expect(hidden.scope.getByText("No report cards selected")).toBeTruthy();
    expect(
      hidden.scope.getByRole("link", { name: "Customize reports" }),
    ).toBeTruthy();
  });

  it("keeps the supplementary reports reachable without duplicating KPI tiles", async () => {
    s.enquiry.mockResolvedValue([
      {
        source: "walk_in",
        total: 4,
        byStage: { new: 4 },
        converted: 1,
        conversionPct: 25,
      },
    ]);
    s.coach.mockResolvedValue([
      { coachStaffId: "c1", coachName: "Riya", sessionCount: 3, distinctMembers: 5 },
    ]);
    s.retention.mockResolvedValue({
      row: { memberCountAtRisk: 2 },
      eligibleMemberCount: 9,
      sessionsInWindow: 5,
      history: "sufficient",
    });
    s.utilisation.mockResolvedValue({
      fromDate: "2026-10-05",
      toDate: "2026-11-02",
      weeks: 4,
      businessHoursConfigured: true,
      facilities: [],
      byDay: [],
      byHour: [],
      emptiest: null,
    });

    const { scope } = await renderIndex();

    // The supplementary reports are still offered, in a concise disclosure.
    const disclosure = scope.getByText("More reports").closest("details");
    expect(disclosure, "a More reports disclosure carries the extra reports").toBeTruthy();

    const more = within(disclosure as HTMLElement);
    expect(more.getByText("Current enquiry stages")).toBeTruthy();
    expect(more.getByText("Coach load")).toBeTruthy();
    expect(more.getByText("Attendance records to review")).toBeTruthy();
    expect(more.getByText("Facility utilisation")).toBeTruthy();
    expect(more.getByText("Collections by membership plan")).toBeTruthy();

    // The disclosure carries reports, not a second copy of the core tiles.
    expect(more.queryByText("Recorded check-ins")).toBeNull();
    expect(more.queryByText("Captured payments")).toBeNull();
    expect(more.queryByText("Reserved of 12 places · current")).toBeNull();
  });

  it("keeps permission and facility scope on every directory destination", async () => {
    const { scope } = await renderIndex({ facility: FACILITY });

    // Every destination keeps the caller's facility scope.
    for (const link of scope.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("/owner/reports/")) {
        expect(href, `destination ${href} keeps the facility scope`).toContain(
          `facility=${FACILITY}`,
        );
      }
    }

    // A caller without the financial grant gets no financial destination, and
    // a caller without the staff grant gets no staff destination.
    cleanup();
    s.permissions.delete("reports.financial");
    s.permissions.delete("invoices.read");
    s.permissions.delete("staff.attendance");
    const limited = await renderIndex();
    const limitedHrefs = limited.scope
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "");
    expect(
      limitedHrefs.some((href) => href.startsWith("/owner/reports/collections")),
      "no collections destination without the financial grant",
    ).toBe(false);
    expect(
      limitedHrefs.some((href) => href.startsWith("/owner/reports/staff")),
      "no staff destination without the staff grant",
    ).toBe(false);
    expect(
      limitedHrefs.some((href) => href.startsWith("/owner/reports/members")),
      "the members destination stays for an operational reader",
    ).toBe(true);
  });
});
