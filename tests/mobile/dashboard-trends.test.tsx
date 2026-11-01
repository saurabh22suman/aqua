// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The owner Home chart band: two panels, one period, honest comparison
// text, real drill-down links and an accessible table for every chart.
// jsdom has no layout engine and no matchMedia, so the ECharts islands
// stay unmounted and the server-rendered tables are what we assert.

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

import { OwnerHomeCharts } from "@/components/owner-home-charts";
import { OwnerHomeAttendance } from "@/components/owner-home/owner-home-attendance";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

const BASE_PERIOD = {
  key: "week" as const,
  tabLabel: "This week",
  comparisonLabel: "WoW",
  comparisonMeaning:
    "Week over week — this Monday-to-now against last week's same elapsed span",
  currentLabel: "Mon 26 Oct 2026, 12:00 am – Wed 28 Oct 2026, 10:00 am",
  previousLabel: "Mon 19 Oct 2026, 12:00 am – Wed 21 Oct 2026, 10:00 am",
  currentFromDate: "2026-10-26",
  currentToDate: "2026-10-28",
  previousFromDate: "2026-10-19",
  previousToDate: "2026-10-21",
  previousCapped: false,
  capNote: null,
};

function data(overrides: Partial<OwnerChartsData> = {}): OwnerChartsData {
  return {
    timezone: "Asia/Kolkata",
    period: BASE_PERIOD,
    collections: {
      buckets: [
        { key: "2026-10-26", label: "Mon 26", fullLabel: "26 Oct 2026", cash: 200000, digital: 400000, other: 0, totalPaise: 600000 },
        { key: "2026-10-27", label: "Tue 27", fullLabel: "27 Oct 2026", cash: 0, digital: 150000, other: 50000, totalPaise: 200000 },
        { key: "2026-10-28", label: "Wed 28", fullLabel: "28 Oct 2026", cash: 100000, digital: 0, other: 0, totalPaise: 100000 },
      ],
      groups: [
        { key: "cash", label: "Cash", paise: 300000, count: 2, pct: 33 },
        { key: "digital", label: "Digital", paise: 550000, count: 3, pct: 61 },
        { key: "other", label: "Other", paise: 50000, count: 1, pct: 6 },
      ],
      methods: [
        { key: "cash", label: "Cash", group: "cash", paise: 300000, count: 2, pct: 33 },
        { key: "upi", label: "UPI", group: "digital", paise: 400000, count: 2, pct: 45 },
        { key: "bank_transfer", label: "Bank transfer", group: "digital", paise: 50000, count: 0, pct: 6 },
        { key: "card", label: "Card", group: "digital", paise: 100000, count: 1, pct: 11 },
        { key: "other", label: "Other", group: "other", paise: 50000, count: 1, pct: 6 },
      ],
      totalPaise: 900000,
      paymentCount: 6,
      previousTotalPaise: 600000,
      previousPaymentCount: 4,
      previousIsZero: false,
      reversedPaise: 25000,
      reversalCount: 1,
      comparison: "Up 50% vs the previous range",
    },
    attendance: {
      buckets: [
        { key: "2026-10-26", label: "Mon 26", fullLabel: "26 Oct 2026", present: 9, total: 10, pct: 90 },
        { key: "2026-10-27", label: "Tue 27", fullLabel: "27 Oct 2026", present: 0, total: 0, pct: null },
        { key: "2026-10-28", label: "Wed 28", fullLabel: "28 Oct 2026", present: 7, total: 10, pct: 70 },
      ],
      present: 16,
      total: 20,
      pct: 80,
      previousPresent: 12,
      previousTotal: 20,
      previousPct: 60,
      comparison: "16 of 20 marks against 12 of 20 in the previous range",
    },
    ...overrides,
  };
}

afterEach(cleanup);

describe("owner Home chart band — collections", () => {
  it("shows one financial panel and the payment mix, scoped to the range and facility", () => {
    render(<OwnerHomeCharts data={data()} metric="collections" facility="loc-1" canReadFees />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Collections");
    expect(text).toContain("Payment mix");
    expect(text).toContain("₹9,000");
    expect(text).toContain("Up 50% vs the previous range");
    // The comparison no longer repeats the exact range: the range strip
    // owns it and the disclosure carries the instants.
    expect(text).not.toContain("Mon 19 Oct 2026, 12:00 am – Wed 21 Oct 2026, 10:00 am");

    const hrefs = Array.from(document.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    // Category and method drill-downs carry the same dates and scope.
    expect(hrefs).toContain(
      "/owner/fees?tab=transactions&from=2026-10-26&to=2026-10-29&group=digital&facility=loc-1",
    );
    expect(hrefs).toContain(
      "/owner/fees?tab=transactions&from=2026-10-26&to=2026-10-29&method=upi&facility=loc-1",
    );
  });

  it("labels Other as its own category and states what is measured", () => {
    render(<OwnerHomeCharts data={data()} metric="collections" facility={null} canReadFees />);
    const text = document.body.textContent ?? "";
    // The method behind "Digital" is methodology: it lives in a
    // disclosure, not as loose prose beside the legend.
    const detail = screen.getByTestId("owner-payment-mix-detail");
    expect(detail.textContent).toContain(
      "Digital = UPI, bank transfer and card. Other is its own category, not digital.",
    );
    expect(text).toContain("ledger-only and not netted");
    expect(text).toContain("₹250");
  });

  it("keeps a real data table available for the chart", () => {
    render(<OwnerHomeCharts data={data()} metric="collections" facility={null} canReadFees />);
    const tables = screen.getAllByRole("table");
    expect(tables.length).toBeGreaterThan(0);
    const collectionsTable = tables.find((table) =>
      (table.textContent ?? "").includes("26 Oct 2026"),
    )!;
    expect(collectionsTable).toBeTruthy();
    expect(within(collectionsTable).getByText("Digital")).toBeTruthy();
  });

  it("says there is no mix instead of drawing an empty ring", () => {
    const empty = data({
      collections: {
        ...data().collections,
        buckets: [],
        groups: [],
        methods: [],
        totalPaise: 0,
        paymentCount: 0,
        previousTotalPaise: 0,
        previousPaymentCount: 0,
        previousIsZero: true,
        reversedPaise: 0,
        reversalCount: 0,
        comparison: "No collections in either range",
      },
    });
    render(<OwnerHomeCharts data={empty} metric="collections" facility={null} canReadFees />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("No payments recorded in this period");
    // The fixture's own comparison: neither range recorded a collection.
    expect(text).toContain("No collections in either range");
    expect(screen.queryByTestId("owner-chart")).toBeNull();
  });

  it("says there were no previous collections rather than a growth figure", () => {
    const priorZero = data({
      collections: {
        ...data().collections,
        previousTotalPaise: 0,
        previousPaymentCount: 0,
        previousIsZero: true,
        comparison: "No previous collections in the comparison range",
      },
    });
    render(<OwnerHomeCharts data={priorZero} metric="collections" facility={null} canReadFees />);
    expect(document.body.textContent).toContain(
      "No previous collections in the comparison range",
    );
  });
});

describe("owner Home chart band — attendance", () => {
  it("keeps attendance OUT of the money band", () => {
    render(<OwnerHomeCharts data={data()} metric="attendance" facility={null} canReadFees />);
    const band = screen.getByTestId("owner-home-money");
    // Attendance is an operational fact: it has its own panel, not a
    // switch inside the Money section.
    expect(band.textContent).not.toContain("16 of 20 marks");
    expect(band.querySelector('nav[aria-label="Metric"]')).toBeNull();
  });

  it("states present/late over marks, and unknown for unmarked days", () => {
    render(<OwnerHomeAttendance data={data()} facility={null} />);
    const panel = screen.getByTestId("owner-home-attendance");
    const text = panel.textContent ?? "";
    expect(text).toContain("80%");
    expect(text).toContain("16 of 20 marks");
    expect(text).toContain("A day with no marks recorded is unknown, not 0%.");
  });

  it("says marks are unknown when a period has no attendance at all", () => {
    const noMarks = data({
      attendance: {
        buckets: [],
        present: 0,
        total: 0,
        pct: null,
        previousPresent: 0,
        previousTotal: 0,
        previousPct: null,
        comparison: "No marks in either range",
      },
    });
    render(<OwnerHomeAttendance data={noMarks} facility={null} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("No attendance marks recorded in this period — unknown, not zero");
    // The headline is "—", never a fabricated 0% attendance figure.
    expect(text).toContain("— 0 of 0 marks present or late");
    expect(text).not.toContain("0% present");
  });
});

describe("owner Home chart band — unavailable read", () => {
  it("states that charts are unavailable instead of rendering blank panels", () => {
    render(<OwnerHomeCharts data={null} metric="collections" facility={null} canReadFees />);
    // A failed financial read says so; it never renders blank panels.
    expect(document.body.textContent).toContain("Money figures are unavailable right now");
  });
});
