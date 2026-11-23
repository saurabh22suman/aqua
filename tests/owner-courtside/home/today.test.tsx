// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OwnerDashboard } from "@/components/owner-dashboard";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";

afterEach(cleanup);

const data: OwnerDashboardData = {
  tenantName: "Synthetic Racquet Club",
  scopeLocationName: "North site",
  today: "2026-11-20",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 18,
  attendanceThisWeekPct: null,
  activeBatchCount: 2,
  needsAttention: [{ title: "Enquiry follow-ups", detail: "2 enquiries need a reply", href: "/owner/enquiries" }],
  todaysLanes: [],
  nextClass: {
    batchId: "batch-fixture",
    batchName: "Junior footwork",
    programName: "Badminton",
    startTime: "17:30",
    startsAt: new Date("2026-11-21T12:00:00Z"),
    sessionDate: "2026-11-21",
    coachName: "Coach Rao",
    enrolled: 7,
    capacity: 12,
  },
  money: null,
  facilityBreakdown: [],
};
const branding = {
  displayName: "Synthetic Racquet Club",
  shortName: "Racquet Club",
  accent: "marine",
  fallbackDisplayName: "Synthetic Racquet Club",
  fallbackShortName: "Racquet Club",
  initials: "RC",
} as BrandingData;
const can = { addMember: false, recordPayment: false, captureEnquiry: false, readFees: false, viewSchedule: true };

function renderToday(viewSchedule = true) {
  render(<OwnerDashboard data={data} branding={branding} terminology={{ locale: "en", overrides: {} }} facility="north" can={{ ...can, viewSchedule }} />);
}

it("opens on the club overview and links the real priority before the queue", () => {
  renderToday();
  expect(screen.getByRole("heading", { level: 1, name: "Club overview" })).toBeTruthy();
  expect(screen.getByText(/Fri, 20 Nov 2026/)).toBeTruthy();

  const priority = screen.getByTestId("owner-home-priority");
  expect(within(priority).getByText("Needs attention")).toBeTruthy();
  expect(within(priority).getByRole("heading", { level: 2, name: "Enquiry follow-ups" })).toBeTruthy();
  expect(within(priority).getByText("2 enquiries need a reply")).toBeTruthy();
  expect(within(priority).getByRole("link", { name: /Review Enquiry follow-ups/i }).getAttribute("href")).toBe("/owner/enquiries");

  const queue = screen.getByTestId("owner-home-attention");
  expect(within(queue).getByRole("link", { name: /Enquiry follow-ups/ }).getAttribute("href")).toContain("/owner/enquiries");
  const jump = screen.getByRole("link", { name: /Need attention/i });
  expect(jump.getAttribute("href")).toBe("#owner-attention");
  expect(document.getElementById("owner-attention")?.contains(queue)).toBe(true);
  const agenda = screen.getByTestId("owner-home-today");
  expect(priority.compareDocumentPosition(agenda) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("highlights the actual next session with its IST time and a scoped calendar link", () => {
  renderToday();
  const next = within(screen.getByRole("region", { name: "Next session" }));
  expect(next.getByText("Junior footwork")).toBeTruthy();
  expect(next.getByText("17:30").getAttribute("aria-label")).toMatch(/5:30\s*pm/i);
  const href = new URL(next.getByRole("link").getAttribute("href")!, "https://fixture.invalid");
  expect(href.pathname).toBe("/owner/schedule");
  expect(href.searchParams.get("facility")).toBe("north");
  expect(href.searchParams.get("date")).toBe("2026-11-21");
});

it("withholds a schedule link when the existing permission does not allow it", () => {
  renderToday(false);
  expect(screen.queryByRole("link", { name: /calendar|schedule/ })).toBeNull();
});

it("keeps the next-session details inside the agenda", () => {
  renderToday();
  const agenda = screen.getByTestId("owner-home-today");
  const next = within(agenda).getByRole("region", { name: "Next session" });
  expect(next).toBeTruthy();
});

describe("the financial snapshot", () => {
  const money = {
    collectedTodayPaise: 1_840_075,
    collectedTodayCount: 5,
    outstandingPaise: 2_100_000,
    dueInvoiceCount: 3,
    overduePaise: 45_000,
    overdueInvoiceCount: 2,
    oldestOverdueDays: 9,
  };
  const withFees = { ...can, readFees: true };

  function href(link: HTMLElement) {
    return new URL(link.getAttribute("href")!, "https://fixture.invalid");
  }

  it("states full exact INR and links each count to its own scoped ledger", () => {
    render(
      <OwnerDashboard
        data={{ ...data, money }}
        branding={branding}
        terminology={{ locale: "en", overrides: {} }}
        facility="north"
        can={withFees}
      />,
    );
    const card = screen.getByTestId("owner-home-lead");
    expect(within(card).getByText("Financial snapshot")).toBeTruthy();
    expect(within(card).getByText("Payments recorded today")).toBeTruthy();
    expect(within(card).getByText("Outstanding now")).toBeTruthy();
    expect(within(card).getAllByTestId("owner-floodlit-metric-value").map(value => value.textContent))
      .toEqual(["₹18,400.75", "₹21,000"]);
    expect(within(card).getByText("₹450 overdue").parentElement?.textContent).toBe("Of which ₹450 overdue");

    const payments = href(within(card).getByRole("link", { name: /5 recorded payments/i }));
    expect(payments.pathname).toBe("/owner/fees");
    expect(payments.searchParams.get("tab")).toBe("transactions");
    expect(payments.searchParams.get("from")).toBe("2026-11-20");
    expect(payments.searchParams.get("to")).toBe("2026-11-21");
    expect(payments.searchParams.get("facility")).toBe("north");

    const invoices = href(within(card).getByRole("link", { name: /3 open invoices/i }));
    expect(invoices.searchParams.get("tab")).toBe("dues");
    expect(invoices.searchParams.has("overdue")).toBe(false);
    expect(invoices.searchParams.get("facility")).toBe("north");

    const overdue = href(within(card).getByRole("link", { name: /Review overdue/i }));
    expect(overdue.searchParams.get("tab")).toBe("dues");
    expect(overdue.searchParams.get("overdue")).toBe("1");
    expect(overdue.searchParams.get("facility")).toBe("north");
  });

  it("keeps a true zero as a real amount, not an empty card", () => {
    render(
      <OwnerDashboard
        data={{
          ...data,
          money: {
            collectedTodayPaise: 0,
            collectedTodayCount: 0,
            outstandingPaise: 0,
            dueInvoiceCount: 0,
            overduePaise: 0,
            overdueInvoiceCount: 0,
            oldestOverdueDays: null,
          },
        }}
        branding={branding}
        terminology={{ locale: "en", overrides: {} }}
        can={withFees}
      />,
    );
    const card = screen.getByTestId("owner-home-lead");
    expect(within(card).getAllByTestId("owner-floodlit-metric-value").map(value => value.textContent))
      .toEqual(["₹0", "₹0"]);
    expect(within(card).getByText("0 recorded payments")).toBeTruthy();
    expect(within(card).getByText("0 open invoices")).toBeTruthy();
  });

  it("withholds the figures without the finance grant and says when the read is unavailable", () => {
    const { unmount } = render(
      <OwnerDashboard data={{ ...data, money }} branding={branding} terminology={{ locale: "en", overrides: {} }} can={can} />,
    );
    expect(screen.queryByTestId("owner-home-lead")).toBeNull();
    expect(screen.getByTestId("owner-home-priority")).toBeTruthy();
    unmount();

    render(
      <OwnerDashboard data={{ ...data, money: null }} branding={branding} terminology={{ locale: "en", overrides: {} }} can={withFees} />,
    );
    expect(screen.getByText(/Financial figures are unavailable/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Fees/i }).getAttribute("href")).toContain("/owner/fees?");
  });

  it("shows just one primary overdue action when that issue leads", () => {
    render(
      <OwnerDashboard
        data={{
          ...data,
          money,
          needsAttention: [
            { title: "Overdue fees", detail: "₹450.00 across 2 invoices past the due date", href: "/owner/fees?tab=dues" },
            { title: "Enquiry follow-ups", detail: "2 enquiries need a reply", href: "/owner/enquiries" },
          ],
        }}
        branding={branding}
        terminology={{ locale: "en", overrides: {} }}
        facility="north"
        can={withFees}
      />,
    );
    expect(within(screen.getByTestId("owner-home-lead")).queryByRole("link", { name: /Review overdue/i })).toBeNull();
    const priority = screen.getByTestId("owner-home-priority");
    expect(within(priority).getByRole("heading", { level: 2, name: "Overdue fees" })).toBeTruthy();
    expect(within(priority).getByRole("link", { name: "Open overdue invoices" }).getAttribute("href")).toContain("overdue=1");
    expect(within(screen.getByTestId("owner-home-attention")).getByRole("link", { name: /Enquiry follow-ups/ })).toBeTruthy();
  });
});

it("does not present the combined facility view as the next session's venue", () => {
  render(
    <OwnerDashboard
      data={{
        ...data,
        scopeLocationName: null,
        facilityBreakdown: [
          { locationId: "north", locationName: "North site", activeMembers: 11, attendancePct: null },
          { locationId: "south", locationName: "South site", activeMembers: 7, attendancePct: null },
        ],
      }}
      branding={branding}
      terminology={{ locale: "en", overrides: {} }}
      can={can}
    />,
  );
  const next = within(screen.getByRole("region", { name: "Next session" }));
  expect(next.queryByText("All locations")).toBeNull();
});
