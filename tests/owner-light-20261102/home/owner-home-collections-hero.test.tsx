// @vitest-environment jsdom
//
// Owner Home — the accepted collections hero (2 November 2026, HOME lane).
//
// The human-approved mock (outputs/owner-mock-20261102/khelsuite-owner-light-type-mock.html,
// SHA256 3bd4a5533baa…) composes Home as ONE collections card, one invoice
// tile and the day's sessions:
//
//   Collections (full-card artwork)
//     Collections                      [range chip]
//     Today            | Last 7 days   <- two columns
//     (Record payment) (View trend)    <- one small action, one secondary link
//   Invoices to review                 <- the overdue shortcut keeps its route
//   Today's sessions                   <- directly below
//
// This file pins the behaviour of that composition against the REAL
// application. It renders the real OwnerDashboard with the real read
// model shapes; no figure is invented, no mock data is copied, and the
// assertions read the RENDERED structure, links and amounts.
//
// Every figure the hero prints comes from the service read the page
// already makes:
//   * "Today"      → data.money.collectedTodayPaise (the tenant-local day)
//   * "Last 7 days"→ chartsData.collections.totalPaise (the service total —
//                    the page must NOT re-sum it from anything else)
// and "Unavailable" is the truthful answer when that read could not be
// made. A zero is never printed for a read that did not happen.
//
// RED-phase note: this file is written BEFORE any production edit. The
// assertions marked below are the intended regressions; the ones marked
// CONTROL are the passing negative controls that pin the behaviour that
// must NOT change.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

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

/**
 * The seven-day read model. `collections.totalPaise` is deliberately NOT
 * the sum of the buckets: the hero must print the service's own total,
 * never a figure it recomputed.
 */
function charts(overrides: Partial<OwnerChartsData> = {}): OwnerChartsData {
  const buckets = [
    {
      key: "2026-11-01",
      label: "Fri 1",
      fullLabel: "1 Nov 2026",
      cash: 1000000,
      digital: 500000,
      other: 0,
      totalPaise: 1500000,
    },
    {
      key: "2026-11-02",
      label: "Sat 2",
      fullLabel: "2 Nov 2026",
      cash: 625000,
      digital: 0,
      other: 0,
      totalPaise: 625000,
    },
  ];
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "last7",
      tabLabel: "Last 7 days",
      comparisonLabel: "7-day",
      comparisonExpansion: "the seven days before",
      comparisonMeaning:
        "Seven-day comparison — these seven calendar days against the seven days before them, to the same elapsed time",
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
      buckets,
      groups: [
        { key: "cash", label: "Cash", paise: 1625000, count: 30, pct: 80 },
        { key: "digital", label: "Digital", paise: 500000, count: 5, pct: 20 },
        { key: "other", label: "Other", paise: 0, count: 0, pct: 0 },
      ],
      methods: [
        { key: "cash", label: "Cash", group: "cash", paise: 1625000, count: 30, pct: 80 },
        { key: "upi", label: "UPI", group: "digital", paise: 500000, count: 5, pct: 20 },
        { key: "bank_transfer", label: "Bank transfer", group: "digital", paise: 0, count: 0, pct: 0 },
        { key: "card", label: "Card", group: "digital", paise: 0, count: 0, pct: 0 },
        { key: "other", label: "Other", group: "other", paise: 0, count: 0, pct: 0 },
      ],
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
      buckets: [
        { key: "2026-11-01", label: "Fri 1", fullLabel: "1 Nov 2026", present: 8, total: 10, pct: 80 },
        { key: "2026-11-02", label: "Sat 2", fullLabel: "2 Nov 2026", present: 0, total: 0, pct: null },
      ],
      present: 8,
      total: 10,
      pct: 80,
      previousPresent: 0,
      previousTotal: 0,
      previousPct: null,
      comparison: "No previous marks in the comparison range",
    },
    ...overrides,
  } as OwnerChartsData;
}

function renderHome(
  props: {
    data?: OwnerDashboardData;
    chartsData?: OwnerChartsData | null;
    can?: Partial<typeof ALL_CAN>;
    facility?: string | null;
  } = {},
) {
  const can = { ...ALL_CAN, ...(props.can ?? {}) };
  return render(
    <OwnerDashboard
      data={props.data ?? dashboard()}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      chartsData={props.chartsData === undefined ? charts() : props.chartsData}
      can={can}
      facility={props.facility ?? null}
    />,
  );
}

/** The closest element that contains both nodes. */
function commonAncestor(a: Element, b: Element): Element | null {
  let node: Element | null = a;
  while (node) {
    if (node.contains(b)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * The rendered font size of an amount, in CSS pixels. Tailwind's step
 * names are resolved here so the assertion does not depend on which
 * utility the implementation happens to use.
 */
const STEP_PX: Record<string, number> = {
  "text-sm": 14,
  "text-base": 16,
  "text-lg": 18,
  "text-xl": 20,
  "text-2xl": 24,
  "text-3xl": 30,
};

function fontSizePx(className: string): number | null {
  const arbitrary = className.match(/text-\[(\d+(?:\.\d+)?)px\]/);
  if (arbitrary) return Number(arbitrary[1]);
  const step = className.match(/\b(text-(?:sm|base|lg|xl|2xl|3xl))\b/);
  return step ? (STEP_PX[step[1]] ?? null) : null;
}

afterEach(cleanup);

describe("Owner Home — the collections hero", () => {
  // CONTROL (passes today): one Collections card, and the two figures
  // share a single two-column row.
  it("shows Today and Last 7 days side by side in one Collections card", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    expect(within(hero).getByRole("heading", { name: "Collections" })).toBeTruthy();
    const todayLabel = within(hero).getByText("Today");
    const last7Label = within(hero).getByText("Last 7 days");
    const row = commonAncestor(todayLabel, last7Label);
    expect(row).not.toBeNull();
    expect(row?.className ?? "").toContain("grid-cols-2");
  });

  // RED: the manual-provenance line is a Home badge the mock does not
  // have. The truthful manual-confirmation detail belongs to the payment
  // flow, not to the daily overview.
  it("states no manual-recording badge or methodology line on Home", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    expect(hero.textContent ?? "").not.toMatch(/manually recorded/i);
    expect(hero.textContent ?? "").not.toMatch(/\bmanual\b/i);
    expect(document.body.textContent ?? "").not.toMatch(/manually recorded/i);
  });

  // RED: the contextual Record payment action does not exist yet.
  it("offers one small Record payment action inside the Collections card", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    const record = within(hero).getByRole("link", { name: /record payment/i });
    // Destination parity: the action opens the EXPLICIT unpaid-bill
    // selection (Fees → Dues), not the transactions history and not a
    // second route to the chart.
    expect(record.getAttribute("href")).toBe("/owner/fees?tab=dues&facility=all");
  });

  // RED: View trend does not exist yet; it must be the SECONDARY action
  // and must reach the real collections trend report with the scope it
  // was read under.
  it("keeps View trend as the secondary action into the real trend report", () => {
    renderHome({ facility: "pool-a" });
    const hero = screen.getByRole("region", { name: "Collections" });
    const trend = within(hero).getByRole("link", { name: /view trend/i });
    const href = trend.getAttribute("href") ?? "";
    expect(href).toContain("/owner/reports/collections");
    expect(href).toContain("view=trends");
    expect(href).toContain("period=last7");
    expect(href).toContain("facility=pool-a");
  });

  // RED: the actions must be withheld by permission AND by what the
  // destination itself allows. A caller who cannot read Fees must not be
  // offered the unpaid-bill route.
  it("withholds the payment and trend actions when the caller may not use them", () => {
    const { rerender } = renderHome({ can: { recordPayment: false } });
    const hero = screen.getByRole("region", { name: "Collections" });
    expect(within(hero).queryByRole("link", { name: /record payment/i })).toBeNull();
    expect(within(hero).getByRole("link", { name: /view trend/i })).toBeTruthy();

    rerender(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        chartsData={charts()}
        can={{ ...ALL_CAN, recordPayment: true, readFees: false }}
      />,
    );
    // The destination refuses this caller: no action may offer it.
    expect(screen.queryByRole("link", { name: /record payment/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /view trend/i })).toBeNull();
  });

  // RED: the Quick actions box and the duplicate member tile leave Home.
  it("drops the Quick actions box and the duplicate member shortcut", () => {
    renderHome();
    expect(screen.queryByTestId("owner-home-actions")).toBeNull();
    expect(screen.queryByRole("heading", { name: /quick actions/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /find a member/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /member directory/i })).toBeNull();
  });

  // CONTROL: the approved composition puts the day's sessions directly
  // below the Collections card, with NO invoice banner between them.
  it("puts Today's sessions directly below the card, with no ledger banner", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    expect(screen.queryByRole("link", { name: /invoice ledger|review invoices/i })).toBeNull();
    const sessions = screen.getByTestId("owner-home-today");
    expect(
      hero.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(hero.closest('[data-testid="owner-home-lead"]')?.nextElementSibling).toBe(sessions.parentElement);
  });

  // CONTROL: the page states the tenant's OWN day; the facility in scope
  // is the header switcher's job and is not repeated under the date.
  it("states the tenant's own day without repeating the facility scope", () => {
    renderHome({ facility: "pool-a" });
    const context = screen.getByTestId("owner-home-context");
    expect(context.textContent ?? "").toContain("2 Nov 2026");
    expect(context.textContent ?? "").not.toContain("Splash Pool");
  });

  // CONTROL: the printed figures are the real reads — the day figure from
  // the money read, the seven-day figure from the service total — and
  // each total is printed once.
  it("prints the real day and seven-day figures once each", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    expect(hero.textContent).toContain("₹21,000");
    // The service total (₹23,750), NOT a re-sum of the buckets
    // (₹1,500,000 + ₹625,000 = ₹15,000).
    expect(hero.textContent).toContain("₹23,750");
    expect(hero.textContent).not.toContain("₹15,000");
    const amounts = (hero.textContent ?? "").match(/₹[\d,]+(\.\d{2})?/g) ?? [];
    expect(amounts).toEqual(["₹21,000", "₹23,750"]);
  });

  // CONTROL: an unread seven-day read is unknown, never zero.
  it("says Unavailable, never zero, when the seven-day read could not be made", () => {
    renderHome({ chartsData: null });
    const hero = screen.getByRole("region", { name: "Collections" });
    expect(within(hero).getByText("Unavailable")).toBeTruthy();
    expect(hero.textContent ?? "").not.toMatch(/Last 7 days\s*₹0\b/);
  });

  // CONTROL + RED: the INR figure stays large on a 320px screen, and a
  // long amount wraps instead of overflowing.
  it("keeps the INR figure large at 320px and lets a long amount wrap", () => {
    const short = renderHome();
    const shortAmount = within(screen.getByRole("region", { name: "Collections" })).getByText(
      "₹21,000",
    );
    expect(fontSizePx(shortAmount.className)).toBeGreaterThanOrEqual(19);
    short.unmount();

    renderHome({
      data: dashboard({
        money: {
          collectedTodayPaise: 12345678900,
          collectedTodayCount: 2,
          outstandingPaise: 12600000,
          dueInvoiceCount: 4,
          overduePaise: 12600000,
          overdueInvoiceCount: 4,
          oldestOverdueDays: 12,
        },
      }),
    });
    // ₹1,23,45,678.90 paise-wise → ₹12,34,56,789 (Indian grouping).
    const longAmount = within(screen.getByRole("region", { name: "Collections" })).getByText(
      "₹12,34,56,789",
    );
    expect(longAmount.className).not.toContain("whitespace-nowrap");
    expect(longAmount.className).toMatch(/overflow-wrap|break-words/);
    expect(fontSizePx(longAmount.className)).toBeGreaterThanOrEqual(19);
  });

  // CONTROL + RED: the sports artwork covers the whole card and fades
  // behind the copy and the actions.
  it("covers the card with the artwork and fades it behind the copy", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    const artwork = hero.querySelector("[data-owner-artwork]");
    expect(artwork).not.toBeNull();
    // The artwork covers the whole card…
    const artworkBox = artwork?.closest("span");
    expect(artworkBox?.className ?? "").toContain("absolute");
    expect(artworkBox?.className ?? "").toContain("inset-0");
    expect(hero.className).toContain("overflow-hidden");
    // …and the copy is painted above it.
    expect(within(hero).getByRole("heading", { name: "Collections" }).className).toMatch(
      /relative|absolute/,
    );
    // …through a fade layer, so the line work never fights the words.
    const fade = Array.from(hero.querySelectorAll("*")).find(element => {
      if (element === artwork) return false;
      const marker = `${element.className} ${element.getAttribute("style") ?? ""}`;
      return /gradient|fade|veil|scrim/i.test(marker);
    });
    expect(fade).toBeTruthy();
  });
});

describe("Owner Home — the shared outline icons", () => {
  // ICON-ADDENDUM.md (2 Nov 2026): the owner's icons must be the exact
  // outline geometry of the approved mock — a 24×24 box, fill none,
  // stroke currentColor at 1.8, round caps and joins — not the filled
  // Khel glyphs the baseline screenshot showed. The shared OwnerIcon
  // belongs to FOUNDATION; this lane consumes it after the reviewed
  // transfer and never keeps a private icon map.
  //
  // The reference geometry is the mock's own ICONS map (mock lines
  // 646–672): money is a note with a band and a short stroke, invoice
  // is a folded sheet with two lines.
  it("draws the Record payment action with the mock's money glyph at 16px", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    const action = within(hero).getByRole("link", { name: /record payment/i });
    const svg = action.querySelector("svg");
    expect(svg, "the action carries an inline outline glyph").toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("fill")).toBe("none");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("stroke-width")).toBe("1.8");
    expect(svg?.getAttribute("stroke-linecap")).toBe("round");
    expect(svg?.getAttribute("stroke-linejoin")).toBe("round");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
    const rect = svg?.querySelector("rect");
    expect(rect?.getAttribute("x")).toBe("3.5");
    expect(rect?.getAttribute("y")).toBe("6");
    expect(rect?.getAttribute("width")).toBe("17");
    expect(rect?.getAttribute("height")).toBe("12");
    expect(rect?.getAttribute("rx")).toBe("2");
    const paths = Array.from(svg?.querySelectorAll("path") ?? []).map(path =>
      path.getAttribute("d"),
    );
    expect(paths).toEqual(["M3.5 10.5h17", "M7 14.5h4"]);
  });

});
