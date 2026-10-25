// @vitest-environment jsdom
//
// Owner "Today" — the calm first screen (owner UX audit 2026-10-24).
//
// What this pins:
//   * the everyday actions (add a member, record a payment, capture an
//     enquiry) are on the screen, and ONLY the ones this caller may
//     actually perform;
//   * the attention list carries at most three rows, the real total is
//     visible, and nothing is hidden from the owner — the rest is one
//     disclosure away;
//   * a quiet day names the next scheduled class instead of repeating
//     that nothing is scheduled;
//   * the money block is a compact row of links, not a large hero.
//
// The data is a fixture; the dashboard service is not under test here
// (tests/reports/retention-truthfulness.test.ts covers the retention
// rule at the database layer).

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

function dashboard(overrides: Partial<OwnerDashboardData> = {}): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    today: "2026-10-25",
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
      collectedTodayPaise: 0,
      collectedTodayCount: 0,
      outstandingPaise: 0,
      dueInvoiceCount: 0,
      overduePaise: 0,
      overdueInvoiceCount: 0,
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

describe("owner Today — the everyday actions", () => {
  it("offers the actions this caller may perform, and only those", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={{ addMember: true, recordPayment: false, captureEnquiry: true }}
      />,
    );
    expect(screen.getByRole("link", { name: /add member/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /capture enquiry/i })).toBeTruthy();
    // Record payment is not permitted for this caller, so the action
    // is not offered. (The money block still links to the Fees hub —
    // that is a different link, and the figures are already the
    // caller's.)
    expect(screen.queryByRole("link", { name: /record payment/i })).toBeNull();
  });

  it("offers no actions when the caller holds none of them", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={{ addMember: false, recordPayment: false, captureEnquiry: false }}
      />,
    );
    expect(screen.queryByRole("link", { name: /add member/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /record payment/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /capture enquiry/i })).toBeNull();
  });
});

describe("owner Today — the attention list", () => {
  it("carries at most three rows and states the real total", () => {
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

describe("owner Today — a quiet day", () => {
  it("names the next scheduled class instead of an empty space", () => {
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
      "Nothing is scheduled for today, and there is no class booked ahead.",
    );
  });
});

describe("owner Today — the money block", () => {
  it("is a compact row of linked figures, not a hero", () => {
    render(
      <OwnerDashboard
        data={dashboard({
          money: {
            collectedTodayPaise: 0,
            collectedTodayCount: 0,
            outstandingPaise: 450000,
            dueInvoiceCount: 3,
            overduePaise: 0,
            overdueInvoiceCount: 0,
          },
        })}
        branding={BRANDING}
        terminology={TERMINOLOGY}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Payments recorded today");
    expect(text).toContain("Outstanding");
    expect(text).toContain("Overdue");
    expect(text).toContain("No payments recorded today yet");
    expect(text).toContain("3 invoices with a balance");
    // The old hero showed one large figure; the three figures are now
    // side by side and each links to its itemised view.
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/owner/fees?tab=dues");
    expect(hrefs).toContain("/owner/fees?tab=transactions");
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

  it("reports the eligible cohort when the history supports it", () => {
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
    expect(text).toContain("swimmers at risk");
    expect(text).toContain("Eligible swimmers");
    expect(text).not.toContain("Not enough attendance history");
  });
});
