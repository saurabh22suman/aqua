// @vitest-environment jsdom
//
// Owner Home — the decision queue says one thing when there is nothing
// to decide (tranche 3, 31 Oct 2026).
//
// What the coordinator's Chrome sweep found on /owner: the empty
// "Needs your decision" panel printed BOTH "Nothing needs your
// attention today" (the summary line) AND "Nothing needs attention
// right now." (the empty body). Two sentences for one fact.
//
// The contract this file pins:
//
//   1. An empty queue prints ONE empty-state sentence — never two.
//   2. The panel still says something useful when it is empty, and the
//      onboarding nudge stays (it is a different statement, not a
//      second copy of the same one).
//   3. A POPULATED queue keeps every reason, every action and the true
//      total, and the rows that do not fit stay reachable in a native
//      disclosure.
//   4. The money-late row is never one of the folded ones.
//
// These assertions read the RENDERED result.

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
import type {
  NeedsAttentionItem,
  OwnerDashboardData,
} from "@/lib/services/dashboard";

const BRANDING = {
  displayName: "Splash Sports Club",
  shortName: "SSC",
  accent: "marine",
  fallbackDisplayName: "Splash Sports Club",
  fallbackShortName: "SSC",
  initials: "SS",
} as BrandingData;

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

const ALL_CAN = {
  addMember: true,
  recordPayment: true,
  captureEnquiry: true,
  readFees: true,
  viewSchedule: true,
  readEnquiries: true,
};

const ATTENTION: NeedsAttentionItem[] = [
  {
    title: "Cash discrepancy",
    detail: "Two payments on 30 Oct differ from the ledger by ₹1,200.",
    href: "/owner/fees?tab=transactions",
  },
  {
    title: "Overdue fees",
    detail: "₹12,600 is past due across 4 invoices.",
    href: "/owner/fees?tab=dues",
  },
  {
    title: "Enquiry to follow up",
    detail: "Meera Nair asked for a call back today.",
    href: "/owner/enquiries",
  },
  {
    title: "Register not finished",
    detail: "Morning Squad was not marked for every swimmer.",
    href: "/owner/schedule?date=2026-10-31",
  },
];

function dashboard(
  overrides: Partial<OwnerDashboardData> = {},
): OwnerDashboardData {
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
    ...overrides,
  } as OwnerDashboardData;
}

function renderHome(props: {
  needsAttention?: NeedsAttentionItem[];
  showOnboarding?: boolean;
} = {}) {
  return render(
    <OwnerDashboard
      data={dashboard({ needsAttention: props.needsAttention ?? [] })}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      can={ALL_CAN}
      showOnboarding={props.showOnboarding ?? false}
    />,
  );
}

/**
 * The empty-state clauses in the panel. A panel may say one of them;
 * it may not say two. The count is of CLAUSES, not of sentences: the
 * panel's lines are not punctuated, so sentence splitting would miss
 * the duplication entirely.
 */
function emptyStatements(panel: HTMLElement): string[] {
  return (
    panel.textContent ?? ""
  ).match(/nothing needs|no items need|no attention needed|no decisions? (are )?waiting/gi) ?? [];
}

afterEach(cleanup);

describe("owner Home — the empty decision queue says it once", () => {
  it("omits the empty queue instead of repeating empty-state copy", () => {
    renderHome();
    expect(screen.queryByTestId("owner-home-attention")).toBeNull();
  });

  it("keeps today's work available when there is nothing to decide", () => {
    renderHome();
    expect(screen.getByTestId("owner-home-work")).toBeTruthy();
  });

  it("keeps the onboarding nudge as a different statement", () => {
    renderHome({ showOnboarding: true });
    const panel = screen.getByTestId("owner-home-attention");
    // One empty statement…
    expect(emptyStatements(panel)).toHaveLength(1);
    // …and the onboarding hint, which is not a second copy of it.
    expect(panel.textContent ?? "").toContain("Setting the academy up");
  });
});

describe("owner Home — the populated decision queue stays informative", () => {
  it("keeps every reason, every action and the true count", () => {
    renderHome({ needsAttention: ATTENTION });
    const panel = screen.getByTestId("owner-home-attention");
    for (const item of ATTENTION.filter((item) => item.title !== "Overdue fees")) {
      expect(panel.textContent ?? "").toContain(item.title);
      expect(panel.textContent ?? "").toContain(item.detail);
    }
    // The count is the true total, not the number on screen.
    expect(panel.textContent ?? "").toContain("3 things to keep your club on track");
    expect(panel.textContent).not.toContain("Overdue fees");
    expect(screen.getByRole("link", { name: /record payment/i }).getAttribute("href")).toContain("tab=dues");
  });

  it("keeps the rows that do not fit reachable in a native disclosure", () => {
    const rows = [...ATTENTION, { title: "Roster", detail: "A roster was not published." }];
    renderHome({ needsAttention: rows });
    const panel = screen.getByTestId("owner-home-attention");
    // The row that does not fit is folded — but it is still reachable,
    // and the disclosure says how many are folded.
    const details = panel.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.tagName.toLowerCase()).toBe("details");
    expect(details?.querySelector("summary")?.textContent ?? "").toMatch(/1 more/);
    expect(details?.textContent ?? "").toContain("Roster");
    // Nothing is lost: every item is in the panel.
    for (const item of rows.filter((item) => item.title !== "Overdue fees")) {
      expect(panel.textContent ?? "").toContain(item.title);
    }
  });

  it("leaves money-late liabilities to the Fees destination", () => {
    const many: NeedsAttentionItem[] = [
      ATTENTION[0]!,
      { title: "Follow up", detail: "One enquiry to call back." },
      { title: "Register", detail: "A register was not finished." },
      { title: "Roster", detail: "A roster was not published." },
      // The money-late row arrives last and must still be on screen.
      ATTENTION[1]!,
    ];
    renderHome({ needsAttention: many });
    const panel = screen.getByTestId("owner-home-attention");
    expect(panel.textContent).not.toContain("Overdue fees");
    expect(screen.getByRole("link", { name: /record payment/i }).getAttribute("href")).toContain("tab=dues");
  });
});
