// @vitest-environment jsdom
//
// Owner Home — the daily oversight workspace (DESIGN.md §7).
//
// What this pins:
//   * ONE dominant shortcut: collecting a payment, linked to the real
//     collection journey (Fees → Dues → open invoice → record payment),
//     never to the history-only transactions list; secondary actions
//     are quiet links and only the permitted ones exist;
//   * the summary row labels its basis: today's collection, the current
//     overdue balance with its invoice count and the outstanding total;
//   * at most three exceptions carry the queue, the real total is
//     visible, and the rest stay one disclosure away;
//   * a quiet day names the next scheduled class with its coach;
//   * a class row reports REGISTER COMPLETION (marks recorded), never
//     attendance;
//   * drill-downs keep the facility scope.
//
// The data is a fixture; the dashboard service is not under test here
// (tests/tier1/owner-dashboard.test.ts covers the reads).

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { RetentionCard } from "@/components/reports/retention-card";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";

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
};

function dashboard(overrides: Partial<OwnerDashboardData> = {}): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: "Splash Pool",
    today: "2026-10-25",
    todayMarked: 0,
    todayTotal: 0,
    activeMemberCount: 8,
    attendanceThisWeekPct: null,
    activeBatchCount: 2,
    needsAttention: [],
    todaysLanes: [],
    nextClass: null,
    facilityBreakdown: [],
    money: {
      collectedTodayPaise: 0,
      collectedTodayCount: 0,
      outstandingPaise: 0,
      dueInvoiceCount: 0,
      overduePaise: 0,
      overdueInvoiceCount: 0,
      oldestOverdueDays: null,
    },
    ...overrides,
  } as OwnerDashboardData;
}

function attentionItem(index: number) {
  return {
    title: `Attention ${index}`,
    detail: `Detail ${index}`,
    href: `/owner/enquiries/e${index}`,
  };
}

afterEach(cleanup);

describe("owner Home — the dominant shortcut", () => {
  it("collects payment as the single primary action, into the real journey", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
      />,
    );
    const collect = screen.getByRole("link", { name: /collect payment/i });
    // The Dues list is where an invoice is opened and the payment is
    // recorded — not the transactions history.
    expect(collect.getAttribute("href")).toBe("/owner/fees?tab=dues");
    expect(collect.className).toContain("bg-[var(--accent-strong)]");
    // Secondary actions are quiet links, not competing filled buttons.
    const add = screen.getByRole("link", { name: /add member/i });
    expect(add.className).not.toContain("bg-[var(--accent-strong)]");
    expect(screen.getByRole("link", { name: /capture enquiry/i })).toBeTruthy();
  });

  it("never offers an action the caller cannot perform", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={{
          addMember: true,
          recordPayment: false,
          captureEnquiry: true,
          readFees: true,
          viewSchedule: false,
        }}
      />,
    );
    expect(screen.queryByRole("link", { name: /collect payment/i })).toBeNull();
    expect(screen.getByRole("link", { name: /add member/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /capture enquiry/i })).toBeTruthy();
  });

  it("offers no actions when the caller holds none of them", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={{
          addMember: false,
          recordPayment: false,
          captureEnquiry: false,
          readFees: false,
          viewSchedule: false,
        }}
      />,
    );
    expect(screen.queryByRole("link", { name: /collect payment/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /add member/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /capture enquiry/i })).toBeNull();
  });
});

describe("owner Home — the summary row", () => {
  it("states each figure's basis and keeps the facility on the collection drill-down", () => {
    render(
      <OwnerDashboard
        data={dashboard({
          facilityBreakdown: [
            { locationId: "l1", locationName: "Splash Pool", activeMembers: 8, attendancePct: null },
          ],
          money: {
            collectedTodayPaise: 300000,
            collectedTodayCount: 1,
            outstandingPaise: 10500000,
            dueInvoiceCount: 35,
            overduePaise: 5700000,
            overdueInvoiceCount: 19,
            oldestOverdueDays: 18,
          },
        })}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
        facility="loc-1"
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Collected today");
    expect(text).toContain("Overdue");
    // Indian grouping without immaterial ".00" (DESIGN.md §4).
    expect(text).toContain("₹3,000");
    expect(text).not.toContain("₹3,000.00");
    // The unified money surface states the current outstanding balance
    // and the overdue count/age, with overdue explicitly included in
    // outstanding rather than a second balance to add.
    const money = screen.getByTestId("owner-home-money-surface");
    const outstanding = within(money).getByText("Outstanding now").parentElement!;
    expect(outstanding.textContent).toContain("₹1,05,000");
    expect(outstanding.textContent).toContain("35 invoices open");
    const overdue = within(money).getByText("Overdue now").parentElement!;
    expect(overdue.textContent).toContain("₹57,000");
    expect(overdue.textContent).toContain("19 invoices past due");
    expect(overdue.textContent).toContain("oldest 18 days");
    expect(overdue.textContent).toContain("Included in outstanding");

    const hrefs = Array.from(document.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    // The collected-today figure keeps its existing day-level ledger
    // drilldown, with the exact today range and facility scope. The one
    // dominant collection action still goes to Dues.
    expect(hrefs).toContain(
      "/owner/fees?tab=transactions&from=2026-10-25&to=2026-10-26&facility=loc-1",
    );
    expect(hrefs).toContain("/owner/fees?tab=dues&facility=loc-1");
  });

  it("says so plainly when nothing was collected or is late", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("No payments recorded today yet");
    expect(text).toContain("Nothing past due");
    const money = screen.getByTestId("owner-home-money-surface");
    const outstanding = within(money).getByText("Outstanding now").parentElement!;
    expect(outstanding.textContent).toContain("₹0");
    expect(outstanding.textContent).toContain("0 invoices open");
    const overdue = within(money).getByText("Overdue now").parentElement!;
    expect(overdue.textContent).toContain("Nothing past due");
  });
});

describe("owner Home — the attention queue", () => {
  it("carries at most three exceptions and states the real total", () => {
    const items = [1, 2, 3, 4, 5].map(attentionItem);
    render(
      <OwnerDashboard
        data={dashboard({ needsAttention: items })}
        branding={BRANDING}
        terminology={TERMINOLOGY}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Attention 1");
    expect(text).toContain("Attention 3");
    // Rows four and five are one disclosure away, not gone.
    expect(text).toContain("2 more need attention");
    expect(screen.getByTestId("count-chip").textContent).toContain("5");
  });

  it("says so plainly when nothing needs attention", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
      />,
    );
    expect(document.body.textContent).toContain("Nothing needs attention right now.");
  });
});

describe("owner Home — a quiet day", () => {
  it("names the next class with its coach instead of an empty space", () => {
    render(
      <OwnerDashboard
        data={dashboard({
          nextClass: {
            batchId: "b1",
            batchName: "Evening Squad",
            programName: "Learn to swim",
            startTime: "18:00:00",
            startsAt: new Date("2026-10-27T12:30:00Z"),
            sessionDate: "2026-10-27",
            coachName: "Imran Sheikh",
            enrolled: 4,
            capacity: 12,
          },
        })}
        branding={BRANDING}
        terminology={TERMINOLOGY}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Nothing scheduled today");
    expect(text).toContain("Evening Squad");
    expect(text).toContain("6:00 pm");
    expect(text).toContain("Imran Sheikh");
    expect(text).toContain("4 of 12 enrolled");
  });

  it("says when there is nothing booked ahead either", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
      />,
    );
    expect(document.body.textContent).toContain(
      "Nothing scheduled today, and no class booked ahead.",
    );
  });
});

describe("owner Home — today's classes", () => {
  it("reports register completion, not attendance", () => {
    render(
      <OwnerDashboard
        data={dashboard({
          todayMarked: 9,
          todayTotal: 12,
          todaysLanes: [
            {
              sessionId: "s1",
              batchId: "b1",
              batchName: "Morning Squad",
              programName: "Learn to swim",
              startTime: "07:00:00",
              enrolled: 12,
              capacity: 16,
              coachName: "Imran Sheikh",
              marked: 12,
              started: true,
            },
            {
              sessionId: "s2",
              batchId: "b2",
              batchName: "Junior TTS",
              programName: "Stroke clinic",
              startTime: "08:00:00",
              enrolled: 8,
              capacity: 16,
              coachName: null,
              marked: 0,
              started: true,
            },
          ],
        })}
        branding={BRANDING}
        terminology={TERMINOLOGY}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Morning Squad");
    expect(text).toContain("Imran Sheikh");
    expect(text).toContain("Register complete — 12 of 12 marked");
    expect(text).toContain("Register not started");
    expect(text).toContain("no coach assigned");
    expect(text).toContain("9 of 12 marked across 2 sessions");
    // Completion is never dressed up as attendance.
    expect(text.toLowerCase()).not.toContain("attendance — 12");
  });
});

describe("retention card — honest states", () => {
  it("says there is not enough history instead of a risk count", () => {
    render(
      <RetentionCard
        report={{
          row: {
            memberCountAtRisk: 0,
            membersWithZeroLast30: 0,
            membersWithPartialLast30: 0,
            totalActiveMembers: 8,
          },
          eligibleMemberCount: 0,
          sessionsInWindow: 0,
          history: "insufficient",
        }}
        memberLabel="swimmers"
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Not enough attendance history");
    expect(text).not.toContain("at risk");
  });

  it("reports the members without records when the history supports it", () => {
    render(
      <RetentionCard
        report={{
          row: {
            memberCountAtRisk: 2,
            membersWithZeroLast30: 2,
            membersWithPartialLast30: 0,
            totalActiveMembers: 20,
          },
          eligibleMemberCount: 18,
          sessionsInWindow: 12,
          history: "sufficient",
        }}
        memberLabel="swimmers"
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("swimmers with no attendance records");
    expect(text).toContain("swimmers active for the period");
    expect(text).not.toContain("Not enough attendance history");
  });
});
