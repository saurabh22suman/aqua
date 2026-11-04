// @vitest-environment jsdom
//
// Owner Home — the day's sessions are the ONE owner of the day's
// occupancy (tranche 3, 31 Oct 2026).
//
// What the coordinator's Chrome sweep found on /owner (mint preset,
// 390 px and 1280 px): "Today's sessions" listed six session rows,
// each carrying the batch's places-taken / capacity, and a separate
// "Batch capacity" card below listed the SAME six batches with the
// SAME figures. Every per-batch fact was printed twice, and on the
// phone the duplicated block pushed the charts far below the fold.
//
// The contract this file pins:
//
//   1. Occupancy has ONE display owner on Home — the session row. The
//      duplicate capacity card is gone, and the facts it carried
//      (places taken, the progress meter, the places-booked total)
//      survive on the session rows.
//   2. A long day shows at most THREE session rows first, and every
//      remaining session stays reachable in a NATIVE <details>
//      disclosure — no truncation without recovery, no JavaScript.
//   3. The disclosure must not swallow the up-next session: when the
//      up-next session falls inside the collapsed set, the collapsed
//      screen still names it.
//   4. The order, the dates and the register states are the real
//      ones. Nothing is invented, and no attendance percentage is
//      printed where places belong.
//   5. A quiet day and a small day stay useful and carry no
//      disclosure. The schedule shortcut stays permission-gated and
//      keeps the facility scope.
//
// These assertions read the RENDERED result — rows, text, links and
// the native disclosure — not class names.

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

// The ECharts island is a lazy client island; the phone chart is
// server-rendered SVG, so the island can be stubbed out here.
vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { OwnerDashboard } from "@/components/owner-dashboard";
import type { BrandingData } from "@/lib/services/branding";
import type { OwnerDashboardData } from "@/lib/services/dashboard";

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

type Lane = OwnerDashboardData["todaysLanes"][number];

function lane(over: Partial<Lane>): Lane {
  return {
    sessionId: "s",
    batchId: "b",
    batchName: "Batch",
    programName: "Swimming Foundations",
    startTime: "07:00",
    enrolled: 0,
    capacity: 12,
    coachName: "Asha Rao",
    marked: 0,
    started: false,
    ...over,
  };
}

// Six sessions — a long day, in the order the day runs. The first
// three have already started; the 07:00 session has NOT started yet,
// so it is the UP NEXT session, and it is the fourth of the day —
// exactly the case the disclosure must not hide.
const LONG_DAY: Lane[] = [
  lane({
    sessionId: "s1",
    batchName: "Early Probe",
    startTime: "05:30",
    enrolled: 16,
    capacity: 20,
    marked: 16,
    started: true,
  }),
  lane({
    sessionId: "s2",
    batchName: "Overlap Probe A",
    startTime: "06:00",
    enrolled: 0,
    capacity: 12,
    started: true,
  }),
  lane({
    sessionId: "s3",
    batchName: "Overlap Probe B",
    startTime: "06:30",
    enrolled: 0,
    capacity: 12,
    started: true,
  }),
  // Up next — not started yet, and the fourth session of the day.
  lane({
    sessionId: "s4",
    batchName: "Morning Squad",
    startTime: "07:00",
    enrolled: 14,
    capacity: 18,
    started: false,
  }),
  lane({
    sessionId: "s5",
    batchName: "Evening Juniors",
    startTime: "17:00",
    enrolled: 0,
    capacity: 12,
    started: false,
  }),
  lane({
    sessionId: "s6",
    batchName: "Midnight Probe",
    startTime: "23:00",
    enrolled: 0,
    capacity: 12,
    coachName: null,
    started: false,
  }),
];

// A small day — one session, and it is the next one.
const SMALL_DAY: Lane[] = [
  lane({
    sessionId: "s1",
    batchName: "Morning Squad",
    startTime: "07:00",
    enrolled: 4,
    capacity: 12,
    started: false,
  }),
];

function dashboard(
  overrides: Partial<OwnerDashboardData> = {},
): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: "Splash Pool",
    today: "2026-10-31",
    todayMarked: 16,
    todayTotal: 30,
    activeMemberCount: 16,
    attendanceThisWeekPct: null,
    activeBatchCount: 6,
    needsAttention: [],
    todaysLanes: LONG_DAY,
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
  lanes?: Lane[];
  nextClass?: OwnerDashboardData["nextClass"];
  can?: Partial<typeof ALL_CAN>;
  facility?: string | null;
} = {}) {
  return render(
    <OwnerDashboard
      data={dashboard({
        todaysLanes: props.lanes ?? LONG_DAY,
        nextClass: props.nextClass ?? null,
      })}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      can={{ ...ALL_CAN, ...(props.can ?? {}) }}
      facility={props.facility ?? null}
    />,
  );
}

/** The session rows of the today panel, split by whether they are folded away. */
function sessionRows(timeline: HTMLElement) {
  const rows = Array.from(timeline.querySelectorAll("li"));
  return {
    all: rows,
    shown: rows.filter((row) => !row.closest("details")),
    folded: rows.filter((row) => row.closest("details")),
  };
}

/** The batch name a row belongs to, read from the row's own text. */
function batchOf(row: Element, lanes: Lane[]): string {
  const text = row.textContent ?? "";
  return lanes.find((l) => text.includes(l.batchName))?.batchName ?? text;
}

afterEach(cleanup);

describe("owner Home — the day's occupancy has one display owner", () => {
  it("does not print the same per-batch capacity twice", () => {
    renderHome();
    // The separate capacity card is gone from Home.
    expect(screen.queryByTestId("owner-home-capacity")).toBeNull();
    expect(screen.queryByRole("heading", { name: /batch capacity/i })).toBeNull();

    // The approved Home states NO capacity: the schedule and Fees own the
    // day's occupancy, so the fraction appears zero times here.
    const body = document.body.textContent ?? "";
    const asFraction = body.match(/16\s*\/\s*20/g) ?? [];
    const asPhrase = body.match(/16 of 20/g) ?? [];
    expect(asFraction.length + asPhrase.length).toBe(0);
  });

  it("draws no capacity bar, meter or places total on the rows", () => {
    renderHome();
    const timeline = screen.getByTestId("owner-home-today");
    expect(timeline.textContent ?? "").not.toMatch(/\d+\s*\/\s*\d+/);
    expect(within(timeline).queryAllByRole("progressbar")).toHaveLength(0);
    expect(timeline.textContent ?? "").not.toMatch(/places booked/);
  });

  it("keeps the full-schedule shortcut, permission-gated and scoped", () => {
    const { unmount } = renderHome({ facility: "loc-9" });
    const link = within(screen.getByTestId("owner-home-today")).getByRole("link", {
      name: /open calendar/i,
    });
    expect(link.getAttribute("href")).toBe(
      "/owner/schedule?date=2026-10-31&location=loc-9",
    );
    unmount();

    // Without the schedule grant, the shortcut is not offered.
    renderHome({ can: { viewSchedule: false } });
    expect(
      within(screen.getByTestId("owner-home-today")).queryByRole("link", {
        name: /open calendar/i,
      }),
    ).toBeNull();
  });
});

describe("owner Home — a long day is bounded, never truncated", () => {
  it("shows three session rows first and keeps the rest in a native disclosure", () => {
    renderHome();
    const timeline = screen.getByTestId("owner-home-today");

    // A native disclosure — it works with no JavaScript and from a
    // keyboard.
    const details = timeline.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.tagName.toLowerCase()).toBe("details");
    expect(details?.querySelector("summary")).toBeTruthy();
    // One disclosure, not a second stacked block.
    expect(timeline.querySelectorAll("details")).toHaveLength(1);

    const rows = sessionRows(timeline);
    // At most three rows are on screen before the disclosure.
    expect(rows.shown).toHaveLength(3);
    // …and every other session is still there, in the same order.
    expect(rows.folded).toHaveLength(LONG_DAY.length - 3);
    expect(rows.all).toHaveLength(LONG_DAY.length);
    expect(rows.shown.map((row) => batchOf(row, LONG_DAY))).toEqual([
      "Early Probe",
      "Overlap Probe A",
      "Overlap Probe B",
    ]);
    expect(rows.folded.map((row) => batchOf(row, LONG_DAY))).toEqual([
      "Morning Squad",
      "Evening Juniors",
      "Midnight Probe",
    ]);
  });

  it("says how many sessions the disclosure holds", () => {
    renderHome();
    const details = screen
      .getByTestId("owner-home-today")
      .querySelector("details");
    const summary = details?.querySelector("summary")?.textContent ?? "";
    expect(summary).toMatch(/3/);
    expect(summary).toMatch(/session/i);
  });

  it("still names the up-next session when it sits inside the collapsed set", () => {
    renderHome();
    const timeline = screen.getByTestId("owner-home-today");

    // The up-next session is the fourth of the day, so it is inside the
    // folded set — but the collapsed screen still says which one it is.
    // A collapsed <details> shows its SUMMARY, so the collapsed screen
    // is the panel without the folded ROWS, not without the summary.
    const collapsed = timeline.cloneNode(true) as HTMLElement;
    collapsed.querySelectorAll("details").forEach((node) => {
      Array.from(node.children).forEach((child) => {
        if (child.tagName.toLowerCase() !== "summary") child.remove();
      });
    });
    expect(collapsed.textContent ?? "").toContain("Morning Squad");

    // The collapsed SUMMARY names the up-next session (no chip on the
    // row, which the approved composition removed).
    expect(collapsed.textContent ?? "").toMatch(/up next Morning Squad/i);
  });

  it("keeps a small day free of a disclosure", () => {
    renderHome({ lanes: SMALL_DAY });
    const timeline = screen.getByTestId("owner-home-today");
    expect(timeline.querySelector("details")).toBeNull();
    expect(sessionRows(timeline).all).toHaveLength(1);
    expect(timeline.textContent ?? "").toContain("Morning Squad");
  });

  it("keeps a quiet day useful", () => {
    renderHome({ lanes: [] });
    const timeline = screen.getByTestId("owner-home-today");
    expect(timeline.querySelector("details")).toBeNull();
    expect(sessionRows(timeline).all).toHaveLength(0);
    expect(timeline.textContent ?? "").toMatch(/Nothing scheduled today/i);
  });
});

describe("owner Home — the session rows tell the truth", () => {
  it("states a truthful clock state and never recasts the register", () => {
    renderHome();
    const timeline = screen.getByTestId("owner-home-today");
    const text = timeline.textContent ?? "";
    // The register's own words are no longer on the row…
    expect(text).not.toMatch(/Register (complete|not started|in progress|opens)/i);
    expect(text).not.toMatch(/marked/);
    // …and the row still says what is true about the session's clock.
    expect(
      Array.from(timeline.querySelectorAll('[data-testid="session-state-pill"]')).length,
    ).toBe(LONG_DAY.length);
    expect(text).toMatch(/Scheduled|Started|Starts in/);
    // Never a percentage of people present.
    expect(text).not.toMatch(/\d+(\.\d+)?%/);
  });

  it("does not invent a marked count for a session with no register", () => {
    renderHome({
      lanes: [
        lane({
          sessionId: "s1",
          batchName: "Morning Squad",
          enrolled: 0,
          capacity: 12,
          marked: 0,
          started: true,
        }),
      ],
    });
    const timeline = screen.getByTestId("owner-home-today");
    // No register claim and no invented denominator on the row.
    expect(timeline.textContent ?? "").not.toMatch(/marked/i);
    expect(timeline.textContent ?? "").not.toMatch(/\d+\s*of\s*\d+/);
    // The legacy row still states its truthful clock state.
    expect(timeline.textContent ?? "").toContain("Started");
  });
});
