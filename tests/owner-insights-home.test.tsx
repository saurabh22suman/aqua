// @vitest-environment jsdom
//
// Owner Home — the insights section.
//
// The two read models that already exist (attendance-by-batch and
// enquiries-by-current-stage) are wired below the chart band as a
// compact, progressively disclosed block: ONE concise preview, with the
// detail one disclosure away.
//
// What this file pins (the intended behaviour, asserted BEFORE the
// implementation):
//
//   1. The preview carries TRUTHFUL labels. Register completion is
//      completion, never "attendance"; the enquiry figure is the
//      CURRENT stage of a cohort, never a conversion rate. Nothing in
//      the section invents a denominator, a trend or a target.
//   2. EMPTY and UNAVAILABLE are different sentences. A read that
//      failed says it could not be read; a read that succeeded with
//      nothing in it says there was nothing. A failed read is never
//      drawn as a zero.
//   3. The detail is ONE disclosure away and carries the same numbers
//      the preview summarises.
//   4. The drill-downs keep the scope the figures were computed under.
//      A destination that CANNOT honour the facility scope gets an
//      honest sentence instead of a link that would widen the view.
//   5. The section is quiet by default: no chart is on screen until the
//      owner asks for the detail.

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
// server-rendered SVG. Neither is under test here.
vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { OwnerDashboard } from "@/components/owner-dashboard";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";
import type {
  AttendanceByBatchInsight,
  EnquiryStageInsight,
} from "@/lib/services/owner-insights";

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

const WINDOW = { from: "2026-09-27", to: "2026-10-27" };

function dashboard(overrides: Partial<OwnerDashboardData> = {}): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: "Splash Pool",
    today: "2026-10-26",
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

function attendance(
  overrides: Partial<AttendanceByBatchInsight> = {},
): AttendanceByBatchInsight {
  const marks = { present: 90, late: 6, absent: 4, total: 100 };
  const register = {
    sessionsWithRoster: 4,
    completedRegisters: 3,
    completionPct: 75,
    rosterSlots: 120,
    markedSlots: 100,
    unmarkedSlots: 20,
  };
  return {
    from: WINDOW.from,
    to: WINDOW.to,
    rows: [
      {
        batchId: "batch-alpha",
        batchName: "Alpha Squad",
        programName: "Swim",
        locationId: "loc-a",
        sessions: 4,
        marks,
        shares: { present: 90, late: 6, absent: 4 },
        register,
      },
      {
        batchId: "batch-beta",
        batchName: "Beta Squad",
        programName: "Swim",
        locationId: "loc-a",
        sessions: 2,
        marks: { present: 0, late: 0, absent: 0, total: 0 },
        shares: { present: null, late: null, absent: null },
        register: {
          sessionsWithRoster: 2,
          completedRegisters: 0,
          completionPct: 0,
          rosterSlots: 24,
          markedSlots: 0,
          unmarkedSlots: 24,
        },
      },
    ],
    summary: { sessions: 6, marks, shares: { present: 90, late: 6, absent: 4 }, register },
    ...overrides,
  };
}

function enquiries(overrides: Partial<EnquiryStageInsight> = {}): EnquiryStageInsight {
  return {
    from: WINDOW.from,
    to: WINDOW.to,
    total: 5,
    rows: [
      { stage: "new", label: "New", count: 2, share: 40 },
      { stage: "contacted", label: "Contacted", count: 1, share: 20 },
      { stage: "trial_scheduled", label: "Trial scheduled", count: 0, share: 0 },
      { stage: "trial_completed", label: "Trial completed", count: 0, share: 0 },
      { stage: "converted", label: "Converted", count: 2, share: 40 },
      { stage: "lost", label: "Lost", count: 0, share: 0 },
    ],
    ...overrides,
  };
}

// A club with more batches than a phone should be asked to read at once.
// The names are deliberately uneven: one of them is long enough to be
// cut off on a 390px screen if it is not allowed to wrap.
const MANY_BATCH_NAMES = [
  "Alpha Squad",
  "Beta Squad",
  "Gamma Squad",
  "Delta Squad",
  "Sunday Open Practice",
];

function attendanceWithManyBatches(): AttendanceByBatchInsight {
  const rows = MANY_BATCH_NAMES.map((batchName, index) => ({
    batchId: `batch-${index}`,
    batchName,
    programName: "Stroke development",
    locationId: "loc-a",
    sessions: 4 + index,
    marks: { present: 80, late: 10, absent: 10, total: 100 },
    shares: { present: 80, late: 10, absent: 10 },
    register: {
      sessionsWithRoster: 2,
      completedRegisters: 1,
      completionPct: 50,
      rosterSlots: 40,
      markedSlots: 30,
      unmarkedSlots: 10,
    },
  }));
  return {
    from: WINDOW.from,
    to: WINDOW.to,
    rows,
    summary: {
      sessions: 5 * 4,
      marks: { present: 400, late: 50, absent: 50, total: 500 },
      shares: { present: 80, late: 10, absent: 10 },
      register: {
        sessionsWithRoster: 10,
        completedRegisters: 5,
        completionPct: 50,
        rosterSlots: 200,
        markedSlots: 150,
        unmarkedSlots: 50,
      },
    },
  };
}

function renderInsights(
  insights: {
    from: string;
    to: string;
    attendance: AttendanceByBatchInsight | null;
    enquiries: EnquiryStageInsight | null;
  },
  options: { facility?: string | null } = {},
) {
  return render(
    <OwnerDashboard
      data={dashboard()}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      can={{ ...ALL_CAN, readEnquiries: true }}
      insights={insights}
      facility={options.facility ?? null}
    />,
  );
}

afterEach(cleanup);

describe("owner Home — the insights preview", () => {
  it("shows one concise preview per read model, with truthful labels", () => {
    renderInsights({
      ...WINDOW,
      attendance: attendance(),
      enquiries: enquiries(),
    });

    // The PREVIEW is the always-visible summary. It names both
    // subjects for what they measure.
    const preview = screen.getByTestId("owner-insights-preview");
    const previewText = preview.textContent ?? "";
    expect(previewText).toContain("Attendance by batch");
    expect(previewText).toContain("Enquiries by current stage");

    // The register figure is completion, not attendance. (The review
    // asked for the owner's words, so the copy says "sessions fully
    // marked" rather than "registers complete".)
    expect(previewText).toContain("3 of 4 sessions fully marked");
    expect(previewText).not.toMatch(/attendance rate/i);
    expect(previewText).not.toMatch(/% attendance/i);

    // The mark composition names its denominator: the marks recorded.
    expect(previewText).toContain("96 of 100 marks present or late");

    // The enquiry figure is the CURRENT stage of a cohort. The preview
    // never calls it a conversion rate…
    expect(previewText).not.toMatch(/conversion/i);
    // …and the detail says so in as many words.
    expect(document.body.textContent ?? "").toMatch(/not a conversion rate/i);
  });

  it("states an empty read as empty and a failed read as unavailable", () => {
    renderInsights({
      ...WINDOW,
      // The attendance read failed. It is NOT an empty result.
      attendance: null,
      // The enquiry read succeeded and the cohort is empty.
      enquiries: enquiries({ total: 0, rows: [] }),
    });

    const text = document.body.textContent ?? "";
    expect(text).toMatch(/attendance by batch could not be read/i);
    // The failed read is never drawn as "nothing happened".
    expect(text).not.toMatch(/no batch ran/i);
    // The empty cohort is stated as empty, not as unavailable.
    expect(text).toMatch(/no enquiries created/i);
    expect(text).not.toMatch(/enquiries by current stage could not be read/i);
  });

  it("keeps the detail one disclosure away, with the same numbers", () => {
    renderInsights({
      ...WINDOW,
      attendance: attendance(),
      enquiries: enquiries(),
    });

    const details = screen.getByTestId("owner-insights-detail");
    // Quiet by default: nothing is open until the owner asks.
    expect(details.hasAttribute("open")).toBe(false);
    const summary = details.querySelector("summary");
    expect(summary?.textContent ?? "").toMatch(/detail/i);

    const text = document.body.textContent ?? "";
    // The detail carries the batch rows and the stage rows.
    expect(text).toContain("Alpha Squad");
    expect(text).toContain("Beta Squad");
    expect(text).toContain("Converted");
    // A batch with no marks is unknown, never 0%.
    expect(text).toMatch(/no marks recorded/i);
    expect(text).not.toMatch(/0% present/i);
  });

  it("keeps the facility scope on the drill-down and never widens the view", () => {
    renderInsights(
      { ...WINDOW, attendance: attendance(), enquiries: enquiries() },
      { facility: "loc-a" },
    );

    const report = screen.getByRole("link", { name: /attendance report/i });
    const href = report.getAttribute("href") ?? "";
    // The drill-down carries the window and the facility the figures
    // were computed under.
    expect(href).toContain(`from=${WINDOW.from}`);
    expect(href).toContain(`to=${WINDOW.to}`);
    expect(href).toContain("facility=loc-a");

    // The enquiries list cannot be scoped to a facility, so it is not
    // offered as a drill-down under a narrower filter — an honest
    // sentence replaces the link.
    expect(screen.queryByRole("link", { name: /enquiries list/i })).toBeNull();
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/selected facility only/i);
  });

  it("offers the enquiries list when no facility filter narrows the view", () => {
    renderInsights(
      { ...WINDOW, attendance: attendance(), enquiries: enquiries() },
      { facility: null },
    );

    const link = screen.getByRole("link", { name: /enquiries list/i });
    expect(link.getAttribute("href")).toContain("/owner/enquiries");
  });

  it("renders nothing at all when there are no insights to show", () => {
    render(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        can={ALL_CAN}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Attendance by batch");
    expect(text).not.toContain("Enquiries by current stage");
  });
});

// The independent review of the first delivery found one real problem:
// the expanded detail was a wall of rows on a phone — seven batches,
// each with a meter and two lines of figures — and a batch name that
// was cut off with an ellipsis instead of being readable.
//
// What this block pins:
//
//   1. at most THREE batches are shown at first, and the rest sit
//      behind an explicit "Show all N batches / Show fewer" control;
//   2. the selection is STATED (which rows, and in what order), so a
//      reader never has to guess why a batch is missing;
//   3. the totals keep describing the FULL scoped result — the bound is
//      on the rows, never on the denominators;
//   4. the whole batch name is available on a narrow screen: it wraps,
//      it is not an ellipsis and it is not a title attribute;
//   5. the disclosure opens and closes from the keyboard, because it is
//      a native <details> and not a div with a click handler;
//   6. the words are the owner's, not the data model's: no "registers";
//   7. the section says that cancelled sessions are not counted, and
//      that the report it links to counts them, so the two are never
//      presented as the same numbers.
describe("owner Home — the expanded detail stays readable on a phone", () => {
  it("shows three batches at first and keeps the rest behind a disclosure", () => {
    renderInsights({
      ...WINDOW,
      attendance: attendanceWithManyBatches(),
      enquiries: enquiries(),
    });

    const list = screen.getByTestId("owner-insights-batch-list");
    expect(within(list).getAllByTestId("owner-insights-batch-row")).toHaveLength(3);

    const more = screen.getByTestId("owner-insights-more-batches");
    expect(within(more).getAllByTestId("owner-insights-batch-row")).toHaveLength(2);
    // Closed until the owner asks for the rest.
    expect(more.hasAttribute("open")).toBe(false);
  });

  it("offers an explicit control that names the whole set and can collapse it", () => {
    renderInsights({
      ...WINDOW,
      attendance: attendanceWithManyBatches(),
      enquiries: enquiries(),
    });

    const more = screen.getByTestId("owner-insights-more-batches");
    const summary = more.querySelector("summary");
    expect(summary).not.toBeNull();
    const label = summary!.textContent ?? "";
    // Both halves of the control are in the markup: which one is
    // visible follows the open state.
    expect(label).toContain("Show all 5 batches");
    expect(label).toContain("Show fewer");
  });

  it("opens and closes the disclosure from its native control", () => {
    renderInsights({
      ...WINDOW,
      attendance: attendanceWithManyBatches(),
      enquiries: enquiries(),
    });

    const more = screen.getByTestId("owner-insights-more-batches");
    const summary = more.querySelector("summary")!;
    expect(more.hasAttribute("open")).toBe(false);

    // A native <summary> is focusable and Enter/Space activate it —
    // the browser's own behaviour, which is why the click below is the
    // same path the keyboard takes.
    summary.focus();
    expect(document.activeElement).toBe(summary);
    summary.click();
    expect(more.hasAttribute("open")).toBe(true);
    summary.click();
    expect(more.hasAttribute("open")).toBe(false);
  });

  it("states the selection and keeps the totals on the full scoped result", () => {
    renderInsights({
      ...WINDOW,
      attendance: attendanceWithManyBatches(),
      enquiries: enquiries(),
    });

    const detail = screen.getByTestId("owner-insights-detail");
    const text = detail.textContent ?? "";
    // The selection is stated, not implied.
    expect(text).toMatch(/3 of 5 batches/i);
    expect(text).toMatch(/name order/i);
    // The totals still describe every batch in the scoped result.
    expect(text).toContain("5 batches");
    expect(text).toContain("500 marks recorded");
    // And so does the preview.
    const preview = screen.getByTestId("owner-insights-preview").textContent ?? "";
    expect(preview).toContain("5 batches ran");
    expect(preview).toContain("450 of 500 marks present or late");
  });

  it("shows the whole batch name instead of cutting it off", () => {
    renderInsights({
      ...WINDOW,
      attendance: attendanceWithManyBatches(),
      enquiries: enquiries(),
    });

    const more = screen.getByTestId("owner-insights-more-batches");
    const name = within(more).getByText(/Sunday Open Practice/);
    // The name is real text, not a title attribute.
    expect(name.textContent).toContain("Sunday Open Practice");
    expect(name.getAttribute("title")).toBeNull();
    // And it is allowed to wrap instead of being ellipsised.
    expect(name.className).not.toContain("truncate");
    expect(name.className).toContain("break-words");
  });

  it("uses the owner's words rather than the data model's", () => {
    renderInsights({
      ...WINDOW,
      attendance: attendanceWithManyBatches(),
      enquiries: enquiries(),
    });

    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/registers/i);
    expect(text).toMatch(/fully marked/i);
  });

  it("says that cancelled sessions are not counted, and that the report counts them", () => {
    renderInsights({
      ...WINDOW,
      attendance: attendanceWithManyBatches(),
      enquiries: enquiries(),
    });

    const text = screen.getByTestId("owner-insights-detail").textContent ?? "";
    expect(text).toMatch(/cancelled sessions are not counted/i);
    // The drill-down is not presented as the same numbers.
    expect(text).toMatch(/attendance report counts them too/i);
  });

  it("gives the expand control a visible open/closed cue and a themed focus ring", () => {
    renderInsights({
      ...WINDOW,
      attendance: attendanceWithManyBatches(),
      enquiries: enquiries(),
    });

    const summary = screen.getByTestId("owner-insights-detail").querySelector("summary")!;
    // The cue: a chevron that turns with the open state.
    expect(summary.querySelector("svg")).not.toBeNull();
    // The two halves of the label.
    expect(summary.textContent).toContain("Show the detail");
    expect(summary.textContent).toContain("Hide the detail");
    // The focus ring, applied here because the shared rule does not
    // reach a <summary>.
    expect(summary.className).toContain("focus-visible:outline");
    expect(summary.className).toContain("--focus-ring");
  });
});
