// @vitest-environment jsdom
//
// Owner Today — the approved Floodlit composition, pinned where a rendered
// regression can see it:
//
//   * the date, the title, the authorized scope control and BOTH financial
//     figures live INSIDE the photographic stage (the checker's
//     `metricsInHero` contract);
//   * the priority strip is the stage's next sibling and the agenda /
//     collections pair follows it, so the approved order cannot drift;
//   * a caller without the finance grant gets a stage with no money in it,
//     and an unavailable finance read states that inside the stage rather
//     than silently dropping the block.
//
// Geometry, artwork and font faces belong to the built-route checker
// (scripts/check-owner-floodlit.cjs); this file only owns the DOM contract.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/owner",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { FacilitySwitcher } from "@/components/facility-switcher";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { OwnerFacilityScopeProvider } from "@/components/owner-home/owner-facility-scope";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";

afterEach(cleanup);

const BRANDING = {
  displayName: "Synthetic Racquet Club",
  shortName: "Racquet Club",
  accent: "marine",
  fallbackDisplayName: "Synthetic Racquet Club",
  fallbackShortName: "Racquet Club",
  initials: "RC",
} as BrandingData;

const TERMINOLOGY = { locale: "en" as const, overrides: {} };

const LOCATIONS = [
  { id: "11111111-1111-7111-8111-111111111111", name: "North site" },
  { id: "22222222-2222-7222-8222-222222222222", name: "South site" },
];

const DATA: OwnerDashboardData = {
  tenantName: "Synthetic Racquet Club",
  scopeLocationName: "North site",
  today: "2026-11-20",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 18,
  attendanceThisWeekPct: null,
  activeBatchCount: 2,
  needsAttention: [
    {
      title: "Review cash count",
      detail: "₹850 short · 19 November",
      href: "/owner/reports/collections",
    },
  ],
  todaysLanes: [],
  nextClass: null,
  money: {
    collectedTodayPaise: 4_285_000,
    collectedTodayCount: 4,
    outstandingPaise: 6_180_000,
    dueInvoiceCount: 6,
    overduePaise: 1_840_000,
    overdueInvoiceCount: 2,
    oldestOverdueDays: 12,
  },
  facilityBreakdown: [],
};

type CanFlags = {
  addMember: boolean;
  recordPayment: boolean;
  captureEnquiry: boolean;
  readFees: boolean;
  viewSchedule: boolean;
  readEnquiries?: boolean;
  viewTrend?: boolean;
};

const ALL_CAN: CanFlags = {
  addMember: true,
  recordPayment: true,
  captureEnquiry: true,
  readFees: true,
  viewSchedule: true,
  readEnquiries: true,
  viewTrend: true,
};

function renderToday({
  can = {},
  data = {},
}: {
  can?: Partial<CanFlags>;
  data?: Partial<OwnerDashboardData>;
} = {}) {
  return render(
    <OwnerFacilityScopeProvider control={<FacilitySwitcher locations={LOCATIONS} />}>
      <OwnerDashboard
        data={{ ...DATA, ...data } as OwnerDashboardData}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        facility="north"
        can={{ ...ALL_CAN, ...can } as CanFlags}
      />
    </OwnerFacilityScopeProvider>,
  );
}

describe("owner Today — the Floodlit stage", () => {
  it("keeps the date, title, scope and both financial figures inside the stage", () => {
    renderToday();
    const hero = screen.getByTestId("owner-floodlit-hero");

    expect(within(hero).getByRole("heading", { level: 1, name: "Club overview" })).toBeTruthy();
    expect(within(hero).getByText(/Fri, 20 Nov 2026/)).toBeTruthy();
    expect(within(hero).getByTestId("facility-switcher")).toBeTruthy();

    const labels = within(hero).getAllByTestId("owner-floodlit-metric-label");
    expect(labels).toHaveLength(2);
    expect(labels.map((label) => label.textContent)).toEqual([
      "Payments recorded today",
      "Outstanding now",
    ]);

    const financial = hero.querySelector(".floodlit-financial");
    expect(financial).not.toBeNull();
    expect(financial!.querySelectorAll(".floodlit-metric")).toHaveLength(2);
    for (const label of labels) expect(financial!.contains(label)).toBe(true);
    expect(financial!.textContent).toContain("₹42,850");
    expect(financial!.textContent).toContain("₹61,800");
    expect(financial!.querySelector(".floodlit-overdue")?.textContent).toContain(
      "Of which ₹18,400 overdue",
    );
  });

  it("puts the priority strip after the stage and the agenda and collections below it", () => {
    renderToday();
    const hero = screen.getByTestId("owner-floodlit-hero");
    const priority = screen.getByTestId("owner-home-priority");
    const agenda = screen.getByTestId("owner-home-today");
    const collections = screen.getByRole("region", { name: "Collections trend" });

    expect(priority.className).toContain("floodlit-priority");
    // The strip is the stage's sibling, not a child: the approved page puts
    // it directly below the photographic block.
    expect(priority.parentElement).toBe(hero.parentElement);
    expect(hero.compareDocumentPosition(priority) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const support = document.querySelector(".floodlit-support");
    expect(support).not.toBeNull();
    expect(priority.compareDocumentPosition(support!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(support!.contains(agenda)).toBe(true);
    expect(support!.contains(collections)).toBe(true);
    expect(agenda.compareDocumentPosition(collections) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders no money in the stage without the finance grant", () => {
    renderToday({ can: { readFees: false } });
    const hero = screen.getByTestId("owner-floodlit-hero");

    expect(within(hero).queryByTestId("owner-home-lead")).toBeNull();
    expect(hero.querySelector(".floodlit-financial")).toBeNull();
    expect(hero.textContent).not.toContain("₹");
    // The approved stage still opens; only the figures are withheld.
    expect(within(hero).getByRole("heading", { level: 1, name: "Club overview" })).toBeTruthy();
    expect(screen.getByTestId("owner-home-priority")).toBeTruthy();
  });

  it("states an unavailable finance read inside the stage", () => {
    renderToday({ data: { money: null } });
    const hero = screen.getByTestId("owner-floodlit-hero");
    const financial = hero.querySelector(".floodlit-financial");

    expect(financial).not.toBeNull();
    expect(financial!.textContent).toContain("Financial figures are unavailable.");
    expect(within(hero).queryByTestId("owner-floodlit-metric-label")).toBeNull();
    const openFees = within(financial as HTMLElement).getByRole("link", { name: /Open Fees/i });
    expect(openFees.getAttribute("href")).toContain("/owner/fees?");
  });
});
