// @vitest-environment jsdom
//
// Owner Home — the navigation-prefetch contract (2 November 2026, HOME lane).
//
// Human-authorized reliability change: the Owner pages must not issue
// OPPORTUNISTIC background prefetches of their own links. The measured
// production failure is a client navigation (profile → edit → Cancel) that
// stalls on a prefetched RSC payload; the chosen, supported UI-level remedy is
// to request `prefetch={false}` on Owner destinations through the shared
// OwnerLink facade (foundation-owned, `components/owner-ui/owner-link.tsx`).
//
// This file is the INTENDED RED for this lane: it renders the real Owner
// Home with a spy on `next/link` and asserts the PREFETCH BEHAVIOUR THE
// COMPONENT REQUESTS. Today every Owner link asks for the framework default
// (an automatic prefetch), so the first case fails.
//
// The facade is NOT imported here — it does not exist yet — so this is not an
// import-error RED.
//
// Controls kept alongside the regression:
//   * the hrefs (query, facility scope) are unchanged;
//   * a caller without the fees grant renders no Fees link at all;
//   * a NON-Owner destination keeps the framework default (the facade's
//     boundary: `/ownerly-members` must NOT be treated as an Owner path);
//   * no link gains an onClick / replace / target, so modified clicks and
//     ordinary navigation keep the browser behaviour.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// Every `next/link` render is recorded with the navigation props the caller
// actually asked for. The spy is the only place the requested `prefetch`
// value is observable: the DOM never carries it.
const linkCalls = vi.hoisted(() => [] as Array<{
  href: unknown;
  prefetch: unknown;
  onClick: unknown;
  replace: unknown;
  target: unknown;
}>);

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      prefetch?: unknown;
      onClick?: unknown;
      replace?: unknown;
      target?: unknown;
      children?: unknown;
      [key: string]: unknown;
    }) => {
      const { href, children, prefetch, onClick, replace, target, ...rest } = props;
      linkCalls.push({ href, prefetch, onClick, replace, target });
      return React.createElement(
        "a",
        {
          href: typeof href === "string" ? href : "#",
          ...(target ? { target: target as string } : {}),
          ...rest,
        },
        children as React.ReactNode,
      );
    },
  };
});

import { OwnerDashboard } from "@/components/owner-dashboard";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
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
  readEnquiries: true,
  readMembers: true,
  bookCourt: true,
  viewTrend: true,
};

function dashboard(overrides: Partial<OwnerDashboardData> = {}): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: "Splash Pool",
    today: "2026-11-02",
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
    ...overrides,
  } as OwnerDashboardData;
}

function charts(): OwnerChartsData {
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "last7",
      tabLabel: "Last 7 days",
      comparisonLabel: "7-day",
      comparisonExpansion: "the seven days before",
      comparisonMeaning: "Seven-day comparison",
      currentLabel: "27 Oct 2026, 12:00 am – 2 Nov 2026, 9:15 am",
      previousLabel: "20 Oct 2026, 12:00 am – 26 Oct 2026, 9:15 am",
      currentFromDate: "2026-10-27",
      currentToDate: "2026-11-02",
      previousFromDate: "2026-10-20",
      previousToDate: "2026-10-26",
      previousCapped: false,
      capNote: null,
    },
    collections: {
      buckets: [],
      groups: [],
      methods: [],
      totalPaise: 2375000,
      paymentCount: 35,
      previousTotalPaise: 0,
      previousPaymentCount: 0,
      previousIsZero: true,
      reversedPaise: 0,
      reversalCount: 0,
      comparison: "No previous collections in the comparison range",
    },
    attendance: {
      buckets: [],
      present: 0,
      total: 0,
      pct: null,
      previousPresent: 0,
      previousTotal: 0,
      previousPct: null,
      comparison: "No previous marks in the comparison range",
    },
  } as OwnerChartsData;
}

function renderHome(props: {
  data?: OwnerDashboardData;
  can?: Partial<typeof ALL_CAN>;
  facility?: string | null;
} = {}) {
  return render(
    <OwnerDashboard
      data={props.data ?? dashboard()}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      chartsData={charts()}
      can={{ ...ALL_CAN, ...(props.can ?? {}) }}
      facility={props.facility ?? null}
    />,
  );
}

/** The paths the OwnerLink facade must own: /owner, /owner/…, /owner?…, /owner#… (never /ownerly). */
function isOwnerDestination(href: unknown): boolean {
  if (typeof href !== "string") {
    // A UrlObject still carries a pathname the facade must judge.
    const pathname = (href as { pathname?: unknown } | null)?.pathname;
    return typeof pathname === "string" ? isOwnerDestination(pathname) : false;
  }
  if (href === "/owner") return true;
  if (href.startsWith("/owner/")) return true;
  if (href.startsWith("/owner?") || href.startsWith("/owner#")) return true;
  return false;
}

function recordedOwnerLinks() {
  return linkCalls.filter((call) => isOwnerDestination(call.href));
}

function recordedOtherLinks() {
  return linkCalls.filter((call) => !isOwnerDestination(call.href));
}

beforeEach(() => {
  linkCalls.length = 0;
});

afterEach(cleanup);

describe("Owner Home — the links request no automatic prefetch (intended RED)", () => {
  it("asks for prefetch={false} on every Owner destination it renders", () => {
    renderHome();
    const ownerLinks = recordedOwnerLinks();
    // The Home renders several Owner destinations (collections drill-downs,
    // the ledger shortcut, the schedule link, the trend report).
    expect(ownerLinks.length).toBeGreaterThan(3);
    for (const call of ownerLinks) {
      expect(
        call.prefetch,
        `${String(call.href)} must request prefetch={false}`,
      ).toBe(false);
    }
  });
});

describe("Owner Home — the controls that must survive the change", () => {
  it("keeps every href, with its query and the facility scope", () => {
    renderHome({ facility: "pool-a" });
    const hrefs = recordedOwnerLinks().map((call) => String(call.href));
    expect(hrefs).toContain("/owner/fees?tab=dues&facility=pool-a");
    // The duplicate invoice banner is gone from Home.
    expect(hrefs.some((href) => href.includes("tab=invoices"))).toBe(false);
  });

  it("renders no Fees link at all without the fees grant", () => {
    renderHome({ can: { readFees: false } });
    const hrefs = recordedOwnerLinks().map((call) => String(call.href));
    expect(hrefs.some((href) => href.startsWith("/owner/fees"))).toBe(false);
  });

  it("leaves a NON-Owner destination on the framework default (facade boundary)", () => {
    // A synthetic non-Owner destination, including the near-miss path
    // `/ownerly-members` that must NOT be treated as an Owner path.
    renderHome({
      data: dashboard({
        needsAttention: [
          { title: "Follow-up overdue", detail: "Call the lead", href: "/reception/members" },
          { title: "Register not started", detail: "Open the register", href: "/ownerly-members" },
          { title: "Follow-up due", detail: "Message the lead", href: "/owner?tab=notes" },
        ],
      }),
    });
    const others = recordedOtherLinks().map((call) => String(call.href));
    expect(others).toContain("/reception/members");
    expect(others).toContain("/ownerly-members");
    for (const call of recordedOtherLinks()) {
      expect(
        call.prefetch,
        `${String(call.href)} is not an Owner destination and must keep the default`,
      ).toBeUndefined();
    }
    // …while the true Owner destination beside them is still opted out.
    const ownerHrefs = recordedOwnerLinks().map((call) => String(call.href));
    expect(ownerHrefs).toContain("/owner?tab=notes");
  });

  it("adds no click handler, replace or target that would break modified clicks", () => {
    renderHome();
    for (const call of recordedOwnerLinks()) {
      expect(call.onClick, `${String(call.href)} must not gain an onClick`).toBeUndefined();
      expect(call.replace, `${String(call.href)} must not gain replace`).toBeUndefined();
      expect(call.target, `${String(call.href)} must not gain target`).toBeUndefined();
    }
  });
});
