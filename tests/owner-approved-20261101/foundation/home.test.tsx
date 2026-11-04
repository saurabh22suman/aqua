// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
vi.mock("next/link", async () => {
  const React = await import("react");
  return { default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement("a", { href, ...rest }, children) };
});
vi.mock("@/components/charts/owner-chart-island", () => ({ OwnerChartIsland: () => null }));
import { OwnerDashboard } from "@/components/owner-dashboard";
import { OwnerHomeActions } from "@/components/owner-home/owner-home-actions";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { BrandingData } from "@/lib/services/branding";
const BRANDING = { displayName: "Splash Sports Club", shortName: "SSC", accent: "marine", fallbackDisplayName: "Splash Sports Club", fallbackShortName: "SSC", initials: "SS" } as BrandingData;
const TERMINOLOGY = { overrides: {}, locale: "en" } as const;
const ALL_CAN = { addMember: true, recordPayment: true, captureEnquiry: true, readFees: true, viewSchedule: true, readEnquiries: true, readPrograms: true, readStaff: true, readMembers: true, viewTrend: true };
function dashboard(overrides: Partial<OwnerDashboardData> = {}): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: "Splash Pool",
    today: "2026-10-31",
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

function charts(overrides: Partial<OwnerChartsData> = {}): OwnerChartsData {
  const buckets = [
    ["2026-10-25", "Sun 25", 25000, 0],
    ["2026-10-26", "Mon 26", 50000, 0],
    ["2026-10-27", "Tue 27", 50000, 0],
    ["2026-10-28", "Wed 28", 50000, 0],
    ["2026-10-29", "Thu 29", 50000, 0],
    ["2026-10-30", "Fri 30", 50000, 0],
    ["2026-10-31", "Sat 31", 1600000, 500000],
  ].map(([key, label, cash, digital]) => ({
    key: key as string, label: label as string, fullLabel: `${label} Oct 2026`,
    cash: cash as number, digital: digital as number, other: 0,
    totalPaise: (cash as number) + (digital as number),
  }));
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "last7",
      tabLabel: "Last 7 days",
      comparisonLabel: "7-day",
      comparisonExpansion: "the seven days before",
      comparisonMeaning:
        "Seven-day comparison — these seven calendar days against the seven days before them, to the same elapsed time",
      currentLabel: "25 Oct 2026, 12:00 am – 31 Oct 2026, 9:15 am",
      previousLabel: "18 Oct 2026, 12:00 am – 24 Oct 2026, 9:15 am",
      currentFromDate: "2026-10-25",
      currentToDate: "2026-10-31",
      previousFromDate: "2026-10-18",
      previousToDate: "2026-10-24",
      previousCapped: false,
      capNote: null,
    },
    collections: {
      buckets,
      groups: [
        { key: "cash", label: "Cash", paise: 1875000, count: 30, pct: 80 },
        { key: "digital", label: "Digital", paise: 500000, count: 5, pct: 20 },
        { key: "other", label: "Other", paise: 0, count: 0, pct: 0 },
      ],
      methods: [
        { key: "cash", label: "Cash", group: "cash", paise: 1875000, count: 30, pct: 80 },
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
        { key: "2026-10-30", label: "Fri 30", fullLabel: "30 Oct 2026", present: 8, total: 10, pct: 80 },
        { key: "2026-10-31", label: "Sat 31", fullLabel: "31 Oct 2026", present: 0, total: 0, pct: null },
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
afterEach(cleanup);
describe("approved owner Home", () => {
  it("shows the setup entry only when the server-approved flag is true, even with other attention", () => {
    const data = dashboard({ needsAttention: [{ title: "Follow-up due", detail: "Contact a lead", href: "/owner/enquiries" }] });
    const view = render(<OwnerDashboard data={data} branding={BRANDING} terminology={TERMINOLOGY} can={ALL_CAN} />);
    expect(screen.queryByRole("link", { name: "Set up your club" })).toBeNull();
    view.rerender(<OwnerDashboard data={data} branding={BRANDING} terminology={TERMINOLOGY} can={ALL_CAN} showOnboarding />);
    expect(screen.getByRole("link", { name: "Set up your club" }).getAttribute("href")).toBe("/owner/onboarding");
  });
  it.each([["22222222-2222-7222-8222-222222222222"], [null]])("carries displayed scope %s into permitted contextual actions", (facility) => {
    const scope = facility ?? "all";
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={{ ...ALL_CAN, bookCourt: true }} facility={facility} />);
    const href = (name: RegExp) => screen.getByRole("link", { name }).getAttribute("href");
    // The accepted Home offers ONE contextual action (record a payment
    // against an explicit unpaid bill) plus the invoice shortcut and
    // the secondary trend link. All three carry the displayed scope.
    expect(href(/^record payment$/i)).toBe(`/owner/fees?tab=dues&facility=${scope}`);
    expect(href(/view trend/i)).toContain("/owner/reports/collections?");
    expect(href(/view trend/i)).toContain(`facility=${scope}`);
  });
  it("withholds scoped actions without the relevant grants", () => {
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} can={{ ...ALL_CAN, addMember: false, recordPayment: false, captureEnquiry: false, readFees: false, readMembers: false, bookCourt: false }} />);
    for (const name of [/^add member$/i, /^record payment$/i, /^book a slot$/i, /^enquiry$/i, /member directory/i, /invoice ledger|review invoices/i]) expect(screen.queryByRole("link", { name })).toBeNull();
  });
  it("opens the scoped dues list from the record action without promising an overdue-only filter", () => {
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} can={ALL_CAN} facility="pool-a" />);
    // The unpaid-bill selection is the record action's destination.
    const action = screen.getByRole("link", { name: /record payment/i });
    expect(action.textContent).not.toMatch(/overdue/i);
    expect(action.getAttribute("href")).toBe("/owner/fees?tab=dues&facility=pool-a");
    // The approved composition has no duplicate ledger banner on Home.
    expect(screen.queryByRole("link", { name: /invoice ledger|review invoices/i })).toBeNull();
  });
  it("uses resolved tenant terminology in the copy Home still owns", () => {
    const terminology = { locale: "en", overrides: { session: { en: { one: "class", other: "classes" } } } } as const;
    const lanes = ["a", "b", "c", "d"].map((key) => ({ sessionId: key, batchId: `b-${key}`, batchName: `Squad ${key.toUpperCase()}`, programName: "Swimming", startTime: "17:00", enrolled: 4, capacity: 8, coachName: "Asha", marked: 0, started: false }));
    render(<OwnerDashboard data={dashboard({ todaysLanes: lanes })} branding={BRANDING} terminology={terminology} can={ALL_CAN} />);
    // The fourth session is folded; the disclosure names it in the
    // tenant's own session word.
    expect(screen.getByTestId("owner-home-today-more").textContent).toContain("1 more class");
    expect(screen.queryByRole("link", { name: "Add swimmer" })).toBeNull();
  });
  it("groups today's recorded collections and the scoped last-seven-day total in one named surface", () => {
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={ALL_CAN} facility="pool-a" />);
    const card = screen.getByRole("region", { name: /collections/i });
    expect(within(card).getByText("Today")).toBeTruthy();
    expect(within(card).getByText("Last 7 days")).toBeTruthy();
    // Distinct fixture totals: ₹21,000 today, ₹23,750 in the seven-day read model.
    expect(card.textContent).toContain("₹21,000");
    expect(card.textContent).toContain("₹23,750");
  });
  it("shows only the two collection amounts in the named card, not operational or balance context", () => {
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={ALL_CAN} />);
    const card = screen.getByRole("region", { name: "Collections" });
    expect(within(card).getByRole("heading", { name: "Collections" })).toBeTruthy();
    expect(card.textContent?.match(/₹[\d,]+/g)).toEqual(["₹21,000", "₹23,750"]);
    expect(card.textContent).not.toMatch(/active members|sessions|overdue|outstanding/i);
  });
  it("does not display financial values to a caller without fees access", () => {
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={{ ...ALL_CAN, readFees: false }} />);
    expect(screen.queryByText("₹21,000")).toBeNull();
    expect(screen.queryByText("₹23,750")).toBeNull();
    expect(screen.queryByText("₹1,26,000")).toBeNull();
  });
  it("keeps the permitted payment action on Home, and no other create shortcut", () => {
    const { container } = render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={ALL_CAN} />);
    const hrefs = Array.from(container.querySelectorAll("a")).map(a => a.getAttribute("href"));
    expect(hrefs).toContain("/owner/fees?tab=dues&facility=all");
    // The Quick actions box left Home: Add member and Capture enquiry
    // are reached from their own navigation, not repeated here.
    expect(hrefs).not.toContain("/owner/members/new?facility=all");
    expect(hrefs).not.toContain("/owner/enquiries");
  });
  it("offers the scoped Fees shortcut while analytics stay off Home", () => {
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={ALL_CAN} facility="pool-a" />);
    expect(screen.getByRole("link", { name: /collected today/i }).getAttribute("href")).toContain("tab=transactions");
    // The duplicate member tile left Home with the Quick actions box.
    expect(screen.queryByRole("link", { name: /member directory/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /money at a glance/i })).toBeNull();
    expect(screen.getByText("Today’s sessions")).toBeTruthy();
  });
  it("withholds the Fees and directory shortcuts when their read grants are absent", () => {
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={{ ...ALL_CAN, readFees: false, readMembers: false }} />);
    expect(screen.queryByRole("link", { name: /invoice ledger|review invoices/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /member directory/i })).toBeNull();
  });
  it("does not offer the dues payment route without access to Fees", () => {
    const { container } = render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={{ ...ALL_CAN, readFees: false, recordPayment: true }} />);
    expect(Array.from(container.querySelectorAll("a")).some(a => a.getAttribute("href")?.startsWith("/owner/fees?tab=dues"))).toBe(false);
  });
  it("presents one clean ordered Home journey without duplicate shortcuts or an empty attention card", () => {
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={ALL_CAN} />);
    const collections = screen.getByRole("region", { name: "Collections" });
    const sessions = screen.getByTestId("owner-home-today");
    // The accepted order: the collections card, then the day's sessions,
    // with no banner between them.
    expect(collections.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(collections.closest('[data-testid="owner-home-lead"]')?.nextElementSibling).toBe(sessions.parentElement);
    expect(screen.queryByTestId("owner-home-actions")).toBeNull();
    expect(screen.queryByTestId("owner-home-compact-summary")).toBeNull();
    expect(screen.queryByTestId("owner-home-attention")).toBeNull();
    // No duplicate member shortcut anywhere on Home.
    expect(screen.queryByRole("link", { name: /add member/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /member directory/i })).toBeNull();
  });
  it("keeps the booking desk off Home, whatever the grant", () => {
    const { rerender } = render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={{ ...ALL_CAN, bookCourt: true }} facility="pool-a" />);
    expect(screen.queryByRole("link", { name: /book a slot/i })).toBeNull();
    rerender(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} chartsData={charts()} can={{ ...ALL_CAN, bookCourt: false }} facility="pool-a" />);
    expect(screen.queryByRole("link", { name: /book a slot/i })).toBeNull();
  });
  it("offers the actual quick-action destinations when allowed, and withholds them when denied", () => {
    const props = { collectHref: "/owner/fees?tab=dues", addMemberHref: "/owner/members/new", captureEnquiryHref: "/owner/enquiries", memberLabel: "member", enquiryLabel: "enquiry" };
    const { container, rerender } = render(<OwnerHomeActions {...props} />);
    const hrefs = () => Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs()).toEqual(expect.arrayContaining(Object.values(props).slice(0, 3)));
    rerender(<OwnerHomeActions {...props} collectHref={null} addMemberHref={null} captureEnquiryHref={null} />);
    expect(hrefs()).not.toContain(props.collectHref);
    expect(hrefs()).not.toContain(props.addMemberHref);
    expect(hrefs()).not.toContain(props.captureEnquiryHref);
  });
});
