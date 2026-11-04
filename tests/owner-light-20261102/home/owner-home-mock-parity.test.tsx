// @vitest-environment jsdom
//
// Owner Home — approved-mock parity (3 November 2026, HOME lane).
//
// Human rejection of the current visuals: the approved evening mock needs a
// compact time-of-day greeting, a REAL Last-7 date pill in the Collections
// hero, a divider between the two figures, and clean session rows
// (time · title + coach/facility · soft state pill) — with no invoice banner,
// no register subtitle, no capacity bars, no up-next chip, no footer and no
// truncated coach. Statuses must be TRUE: timestamps where provided, the
// legacy started flag otherwise, "Completed" only from a real completed
// status — never from register completion, never Confirmed/Waitlist open.
//
// This file is the intended RED: it renders the current Home and fails on the
// observable markup. The extra TodaysLane display fields are optional UI
// fields (the DTO proposal is being prepared separately), so the fixtures
// carry them through a local intersection cast and legacy rows stay plain.

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
import type { OwnerDashboardData, TodaysLane } from "@/lib/services/dashboard";
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

/** The optional UI display fields agreed for the row (DTO pending). */
type LaneWithDisplay = TodaysLane & {
  startsAt?: string;
  endsAt?: string | null;
  locationName?: string | null;
  status?: string;
};

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

function lane(overrides: Partial<LaneWithDisplay> & Pick<TodaysLane, "sessionId" | "batchName">): TodaysLane {
  const base: LaneWithDisplay = {
    batchId: `b-${overrides.sessionId}`,
    programName: "Swimming",
    startTime: "07:00",
    enrolled: 16,
    capacity: 20,
    coachName: "Asha Menon",
    marked: 0,
    started: false,
    ...overrides,
  };
  return base as TodaysLane;
}

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

function charts(overrides: Partial<OwnerChartsData> = {}): OwnerChartsData {
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
    ...overrides,
  } as OwnerChartsData;
}

function renderHome(props: {
  data?: OwnerDashboardData;
  chartsData?: OwnerChartsData | null;
  can?: Partial<typeof ALL_CAN>;
  facility?: string | null;
} = {}) {
  return render(
    <OwnerDashboard
      data={props.data ?? dashboard()}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      chartsData={props.chartsData === undefined ? charts() : props.chartsData}
      can={{ ...ALL_CAN, ...(props.can ?? {}) }}
      facility={props.facility ?? null}
    />,
  );
}

afterEach(cleanup);

describe("Owner Home — compact greeting and date (mock parity)", () => {
  it("greets with the time of day, and the date carries no facility suffix", () => {
    renderHome();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent ?? "").toMatch(/^(Good (morning|afternoon|evening)|Hello)$/);
    const context = screen.getByTestId("owner-home-context").textContent ?? "";
    expect(context).toContain("2 Nov 2026");
    // The facility scope is the switcher's job in the header row.
    expect(context).not.toContain("Splash Pool");
  });
});

describe("Owner Home — the Collections hero (mock parity)", () => {
  it("shows the real Last-7 date range as an informational pill, not a button", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    const pill = within(hero).getByTestId("owner-home-range-pill");
    expect(pill.tagName).toBe("SPAN");
    expect(pill.textContent).toBe("27 Oct – 2 Nov");
    // No invented filter: the pill is not a control.
    expect(within(hero).queryByRole("button", { name: /27 Oct/ })).toBeNull();
  });

  it("renders no pill when the charts read is unavailable", () => {
    renderHome({ chartsData: null });
    expect(screen.queryByTestId("owner-home-range-pill")).toBeNull();
  });

  it("separates Today and Last 7 days with a divider", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    const today = within(hero).getByText("Today");
    const last7 = within(hero).getByText("Last 7 days");
    const columns = today.closest("div")?.parentElement;
    expect(columns).toBe(last7.closest("div")?.parentElement);
    expect(last7.closest("div")?.className ?? "").toContain("border-l");
  });

  it("keeps the real amounts and the two actions", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    expect(hero.textContent).toContain("₹21,000");
    expect(hero.textContent).toContain("₹23,750");
    expect(within(hero).getByRole("link", { name: /record payment/i })).toBeTruthy();
    expect(within(hero).getByRole("link", { name: /view trend/i })).toBeTruthy();
  });
});

describe("Owner Home — no invoice banner between the hero and the sessions", () => {
  it("does not render a ledger/review-invoices shortcut on Home", () => {
    renderHome();
    expect(screen.queryByRole("link", { name: /invoice ledger|review invoices/i })).toBeNull();
  });
});

describe("Owner Home — clean session rows with a truthful soft state pill (mock parity)", () => {
  const lanes = [
    lane({ sessionId: "s1", batchName: "Morning Squad", startsAt: minutes(30), locationName: "Worli" }),
    lane({ sessionId: "s2", batchName: "Evening Juniors", started: true }),
    lane({ sessionId: "s3", batchName: "Full Squad", enrolled: 22, capacity: 20, startsAt: minutes(-10), endsAt: minutes(50) }),
    lane({ sessionId: "s4", batchName: "Completed Squad", status: "completed", startsAt: minutes(-180), endsAt: minutes(-60) }),
  ];

  it("renders one soft pill per row with a truthful word", () => {
    renderHome({ data: dashboard({ todaysLanes: lanes }) });
    const card = screen.getByTestId("owner-home-today");
    const pills = within(card).getAllByTestId("session-state-pill");
    expect(pills).toHaveLength(4);
    expect(pills[0]!.textContent ?? "").toMatch(/^Starts in (29|30|31) min$/);
    expect(pills[1]!.textContent).toBe("Started");
    expect(pills[2]!.textContent).toBe("Scheduled now");
    expect(pills[3]!.textContent).toBe("Completed");
  });

  it("keeps the coach readable and adds the facility only when it is provided", () => {
    renderHome({ data: dashboard({ todaysLanes: lanes }) });
    const card = screen.getByTestId("owner-home-today");
    const row = within(card).getByText("Morning Squad").closest("li")!;
    expect(row.textContent).toContain("Asha Menon");
    expect(row.textContent).toContain("Worli");
    const rowWithoutFacility = within(card).getByText("Evening Juniors").closest("li")!;
    expect(rowWithoutFacility.textContent).toContain("Asha Menon");
    expect(rowWithoutFacility.textContent).not.toContain("null");
    // The meta line must not ellipsise the meaning away.
    const meta = row.querySelector("[data-testid='session-meta']");
    expect(meta?.className ?? "").not.toContain("truncate");
  });

  it("removes the legacy capacity bar, register subtitle, up-next chip and footer", () => {
    renderHome({ data: dashboard({ todaysLanes: lanes }) });
    const card = screen.getByTestId("owner-home-today");
    expect(card.querySelector('[role="meter"]')).toBeNull();
    expect(card.textContent ?? "").not.toMatch(/marked across/i);
    expect(card.textContent ?? "").not.toMatch(/places booked/i);
    expect(card.textContent ?? "").not.toMatch(/UP NEXT/i);
    expect(card.textContent ?? "").not.toMatch(/Register (opens|not started|in progress|complete)/i);
  });

  it("keeps the over-capacity warning visible without the bars", () => {
    renderHome({ data: dashboard({ todaysLanes: lanes }) });
    const card = screen.getByTestId("owner-home-today");
    const row = within(card).getByText("Full Squad").closest("li")!;
    expect(row.textContent ?? "").toMatch(/over capacity/i);
  });

  it("labels the schedule link Open calendar", () => {
    renderHome({ data: dashboard({ todaysLanes: lanes }) });
    expect(screen.getByRole("link", { name: /open calendar/i })).toBeTruthy();
  });

  it("keeps the empty day, the next class and the >3-session disclosure", () => {
    renderHome({ data: dashboard({ todaysLanes: [] }) });
    expect(screen.getByTestId("owner-home-today").textContent ?? "").toMatch(/nothing scheduled today/i);
    cleanup();
    renderHome({
      data: dashboard({
        todaysLanes: [],
        nextClass: {
          batchId: "b9",
          batchName: "Next Squad",
          programName: "Swimming",
          startTime: "18:00",
          startsAt: new Date(),
          sessionDate: "2026-11-03",
          coachName: "Asha Menon",
          enrolled: 3,
          capacity: 10,
        },
      }),
    });
    expect(screen.getByTestId("owner-home-today").textContent).toContain("Next Squad");
    cleanup();
    renderHome({ data: dashboard({ todaysLanes: lanes }) });
    expect(screen.getByTestId("owner-home-today-more")).toBeTruthy();
  });
});


describe("Owner Home — the RECORDED session status (real enum: scheduled|held|cancelled)", () => {
  it("shows a real held session as Held, never as a clock guess", () => {
    renderHome({
      data: dashboard({
        todaysLanes: [
          // The clock would say "Earlier today" (its window has passed)…
          lane({
            sessionId: "h1",
            batchName: "Held Squad",
            status: "held",
            startsAt: minutes(-120),
            endsAt: minutes(-60),
          }),
          // …and a legacy row's flag would say "Started".
          lane({ sessionId: "h2", batchName: "Legacy Held", status: "held", started: true }),
        ],
      }),
    });
    const card = screen.getByTestId("owner-home-today");
    const pills = within(card).getAllByTestId("session-state-pill");
    // The recorded fact outranks every clock inference.
    expect(pills[0]!.textContent).toBe("Held");
    expect(pills[1]!.textContent).toBe("Held");
    // "Held" is the recorded session state — it is never attendance.
    expect(card.textContent ?? "").not.toMatch(/attendance/i);
  });
});


describe("Owner Home — the row's TIME is the actual session, not the batch default", () => {
  // A rescheduled session keeps the batch's default wall time; the row must
  // print the SESSION's real start, so the time and the state pill describe
  // the same actual session.
  it("shows the session's real start when it differs from the batch default", () => {
    renderHome({
      data: dashboard({
        todaysLanes: [
          lane({
            sessionId: "r1",
            batchName: "Rescheduled Squad",
            startTime: "07:00",
            startsAt: "2026-11-02T13:00:00Z", // 6:30 pm IST
          }),
        ],
      }),
    });
    const row = within(screen.getByTestId("owner-home-today"))
      .getByText("Rescheduled Squad")
      .closest("li")!;
    expect(row.textContent).toContain("6:30 pm");
    expect(row.textContent).not.toContain("7:00 am");
  });

  // The quiet-day next class carries a REAL startsAt too.
  it("shows the next class's real start on a quiet day", () => {
    renderHome({
      data: dashboard({
        todaysLanes: [],
        nextClass: {
          batchId: "b9",
          batchName: "Next Squad",
          programName: "Swimming",
          startTime: "18:00",
          startsAt: new Date("2026-11-03T13:45:00Z"), // 7:15 pm IST
          sessionDate: "2026-11-03",
          coachName: "Asha Menon",
          enrolled: 3,
          capacity: 10,
        },
      }),
    });
    const card = screen.getByTestId("owner-home-today");
    expect(card.textContent).toContain("7:15 pm");
    expect(card.textContent).not.toContain("6:00 pm");
  });

  // CONTROL: a legacy row without a real start keeps the batch wall time.
  it("falls back to the batch wall time for a legacy row without a start", () => {
    renderHome({
      data: dashboard({
        todaysLanes: [
          lane({ sessionId: "l1", batchName: "Legacy Squad", startTime: "07:00" }),
        ],
      }),
    });
    const row = within(screen.getByTestId("owner-home-today"))
      .getByText("Legacy Squad")
      .closest("li")!;
    expect(row.textContent).toContain("7:00 am");
  });
});


describe("Owner Home — the narrow row reflows instead of squeezing the title", () => {
  // Measured in real Chrome: at 320px the fixed time + pill columns left the
  // title only ~77px. The row must keep a useful title column (>=120px) and
  // let the pill move to its own line BELOW the details, while the approved
  // 390px arrangement (time | details | pill) stays unchanged.
  it("keeps a >=120px title column and wraps the pill below the details", () => {
    renderHome({
      data: dashboard({
        todaysLanes: [
          lane({
            sessionId: "n1",
            batchName: "Calendar probe session with a long class title",
            locationName: "Worli",
            startsAt: minutes(30),
          }),
        ],
      }),
    });
    const row = within(screen.getByTestId("owner-home-today"))
      .getByText(/Calendar probe session/)
      .closest("li")!;
    // The row may wrap instead of compressing the middle column.
    expect(row.className).toContain("flex-wrap");
    const details = row.querySelector("[data-testid='session-meta']")!.parentElement!;
    expect(details.className).toContain("flex-1");
    expect(details.className).toContain("min-w-[120px]");
    // The pill keeps its own width and lands at the end of the wrapped line.
    const pill = row.querySelector("[data-testid='session-state-pill']")!;
    expect(pill.className).toContain("ml-auto");
    expect(pill.className).toContain("shrink-0");
    // Reading order stays time → details → pill.
    const time = row.querySelector("time")!;
    expect(
      time.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      details.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // No hidden information or shrunk type.
    const title = within(row).getByText(/Calendar probe session/);
    expect(title.className).toContain("text-[15px]");
    expect(title.className).not.toContain("truncate");
    expect(details.className).not.toContain("truncate");
  });
});
