// @vitest-environment jsdom
//
// Owner Lavender B — the approved Owner Home composition.
//
// The human approved a specific Owner Home (the "Lavender Club — Option
// B" board and the later illustration direction). This file pins the
// composition the approval asks for, with the incumbent truthfulness
// rules kept intact:
//
//   * the screen opens with the REAL day, club and location scope;
//   * four figures on a desktop, the two money figures plus a compact
//     member/session line on a phone;
//   * ONE dominant action (collect a payment) and quiet secondary
//     actions, each behind its own permission;
//   * the day's sessions carry the real occupancy and a truthful
//     current/next distinction;
//   * the attention queue is in the service's priority order and every
//     item stays reachable, including the money-late ones;
//   * a quiet day names the next class instead of showing a blank.
//
// The data is a fixture; the dashboard service is not under test here
// (tests/tier1/owner-dashboard.test.ts covers the reads).
//
// RED status at the time of writing: the screen opened with the club
// mark and an account menu, had no day/scope/illustration header, no
// compact phone summary, no "up next" marker on the timeline and no
// shared period control above the money band.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { OwnerDashboard } from "@/components/owner-dashboard";
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
    activeMemberCount: 128,
    attendanceThisWeekPct: null,
    activeBatchCount: 6,
    needsAttention: [],
    todaysLanes: [],
    nextClass: null,
    facilityBreakdown: [],
    money: {
      collectedTodayPaise: 1840000,
      collectedTodayCount: 5,
      outstandingPaise: 620000,
      dueInvoiceCount: 7,
      overduePaise: 420000,
      overdueInvoiceCount: 3,
      oldestOverdueDays: 4,
    },
    ...overrides,
  } as OwnerDashboardData;
}

function lane(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s1",
    batchId: "b1",
    batchName: "Morning Masters",
    programName: "Adult swimming",
    startTime: "06:00:00",
    enrolled: 14,
    capacity: 16,
    coachName: "Aanya Rao",
    marked: 14,
    started: true,
    ...overrides,
  };
}

afterEach(cleanup);

describe("owner Home — the screen opens with the real context", () => {
  it("names the day, the club and the location the figures cover", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
      />,
    );
    const context = screen.getByTestId("owner-home-context");
    const text = context.textContent ?? "";
    // The real date, the real club and the real location scope.
    expect(text).toContain("Sun, 25 Oct 2026");
    expect(text).toContain("Splash Sports Club");
    expect(text).toContain("Splash Pool");
  });

  it("puts a small piece of club artwork beside the heading", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
      />,
    );
    const art = screen.getByTestId("owner-home-illustration");
    expect(art.querySelector("svg")).toBeTruthy();
  });
});

describe("owner Home — the figures", () => {
  it("leads with the day's money and keeps the member and session counts", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
      />,
    );
    const cards = screen.getAllByTestId("stat-card");
    expect(cards).toHaveLength(4);
    expect(within(cards[0]!).getByText("Collected today")).toBeTruthy();
    expect(within(cards[1]!).getByText("Overdue")).toBeTruthy();
    expect(within(cards[2]!).getByText(/Active members/)).toBeTruthy();
    expect(within(cards[3]!).getByText(/Sessions today/)).toBeTruthy();
  });

  it("gives a phone the two money figures and a compact real summary", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
      />,
    );
    const summary = screen.getByTestId("owner-home-compact-summary");
    const text = summary.textContent ?? "";
    // Real numbers, not a placeholder.
    expect(text).toContain("128");
    expect(text).toContain("6");
  });
});

describe("owner Home — the actions", () => {
  it("gives one dominant action and quiet secondary ones", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
      />,
    );
    const collect = screen.getByRole("link", { name: /collect payment/i });
    expect(collect.className).toContain("bg-[var(--accent-strong)]");
    const add = screen.getByRole("link", { name: /add member/i });
    expect(add.className).not.toContain("bg-[var(--accent-strong)]");
    expect(screen.getByRole("link", { name: /capture enquiry/i })).toBeTruthy();
  });
});

describe("owner Home — today's sessions", () => {
  it("states the real occupancy and a truthful next marker", () => {
    render(
      <OwnerDashboard
        data={dashboard({
          todaysLanes: [
            lane(),
            lane({
              sessionId: "s2",
              batchName: "Evening Squad",
              startTime: "18:00:00",
              enrolled: 12,
              capacity: 16,
              marked: 0,
              started: false,
            }),
          ],
        })}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
      />,
    );
    const timeline = screen.getByTestId("owner-home-today");
    const text = timeline.textContent ?? "";
    // The real fraction of places taken.
    expect(text).toContain("14");
    expect(text).toContain("16");
    // Register completion, not attendance.
    expect(text).toContain("Register complete — 14 of 14 marked");
    // The next session is marked as the next one — not the finished one.
    const next = within(timeline).getByTestId("owner-home-next-session");
    expect(next.textContent).toContain("Evening Squad");
  });
});

describe("owner Home — the attention queue", () => {
  it("keeps every item reachable, including a money-late one further down", () => {
    render(
      <OwnerDashboard
        data={dashboard({
          needsAttention: [
            { title: "Cash count needs review", detail: "Splash Pool — 12 Oct: ₹600 short", href: "/owner/reports/collections" },
            { title: "Follow-up overdue", detail: "Priya Rao — due 2 days ago", href: "/owner/enquiries/e1" },
            { title: "Register not started", detail: "Junior TTS — started 20 min ago", href: "/owner/reports" },
            { title: "Overdue fees", detail: "₹4,200 across 3 invoices past the due date", href: "/owner/fees?tab=dues" },
          ],
        })}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
      />,
    );
    const queue = screen.getByTestId("owner-home-attention");
    const text = queue.textContent ?? "";
    // The money-late item is never the one hidden behind a disclosure.
    expect(text).toContain("Overdue fees");
    // And the real total is stated.
    expect(within(queue).getByTestId("count-chip").textContent).toContain("4");
  });
});
