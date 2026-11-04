// @vitest-environment jsdom
//
// Finance lane — P2 collections composition (3 November 2026).
// Intended RED: one card carries the chart, the ring and the repeated totals;
// approved is two purposeful plot cards (Daily collections, Payment mix), the
// ring and legend side by side without wrapping, exact counts/gross/reversals
// inside Details, and the 132px ring kept (no giant circle).

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CollectionsTrends } from "@/components/reports/owner-approved/collections-trends";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

const CHARTS: OwnerChartsData = {
  timezone: "Asia/Kolkata",
  period: {
    key: "last7",
    tabLabel: "Last 7 days",
    comparisonLabel: "vs previous 7 days",
    comparisonMeaning: "",
    currentLabel: "Last 7 days",
    previousLabel: "Previous 7 days",
    currentFromDate: "2026-10-27",
    currentToDate: "2026-11-02",
    previousFromDate: "2026-10-20",
    previousToDate: "2026-10-26",
    previousCapped: false,
    capNote: null,
  },
  collections: {
    buckets: [
      { key: "2026-10-27", label: "27 Oct", fullLabel: "27 Oct 2026", cash: 100, digital: 200, other: 0, totalPaise: 300 },
      { key: "2026-10-28", label: "28 Oct", fullLabel: "28 Oct 2026", cash: 200, digital: 100, other: 0, totalPaise: 300 },
    ],
    groups: [],
    methods: [
      { key: "cash", label: "Cash", group: "cash", paise: 900, count: 3, pct: 50 },
      { key: "upi", label: "UPI", group: "digital", paise: 600, count: 2, pct: 33 },
      { key: "card", label: "Card", group: "digital", paise: 300, count: 1, pct: 17 },
    ],
    totalPaise: 1800,
    paymentCount: 6,
    previousTotalPaise: 0,
    previousPaymentCount: 0,
    previousIsZero: true,
    reversedPaise: 100,
    reversalCount: 1,
    comparison: "",
  },
  attendance: {
    buckets: [],
    present: 0,
    total: 0,
    pct: null,
    previousPresent: 0,
    previousTotal: 0,
    previousPct: null,
    comparison: "",
  },
};

afterEach(cleanup);

describe("collections composition", () => {
  it("splits the report into two plot cards without repeating headline totals", () => {
    const { container } = render(<CollectionsTrends data={CHARTS} />);
    const plots = Array.from(container.querySelectorAll('[data-testid="report-plot"]'));
    expect(plots.map((plot) => plot.querySelector("h2")?.textContent)).toEqual([
      "Daily collections",
      "Payment mix",
    ]);
    expect(container.querySelector('[data-testid="report-plots"]')?.className).toContain(
      "lg:grid-cols-2",
    );

    // Repeated headline total/count paragraph is not in the default view.
    const defaultText = Array.from(container.querySelectorAll("p"))
      .filter((p) => !p.closest("details"))
      .map((p) => p.textContent ?? "")
      .join(" ");
    expect(defaultText).not.toMatch(/payments recorded/i);
  });

  it("keeps the ring and the legend side by side, at the approved size", () => {
    const { container } = render(<CollectionsTrends data={CHARTS} />);
    const pair = container.querySelector('[data-testid="method-pair"]');
    expect(pair, "method ring + legend pair exists").not.toBeNull();
    expect(pair!.className).toContain("flex-nowrap");
    const ring = pair!.querySelector("svg");
    expect(ring, "method ring is present").not.toBeNull();
    expect(ring!.getAttribute("viewBox")).toBe("0 0 132 132");
    expect(ring!.getAttribute("class") ?? "").toContain("w-[132px]");
    const legend = pair!.querySelector('[data-testid="method-legend"]');
    expect(legend).not.toBeNull();
    expect(legend!.className).toContain("min-w-0");
    expect(legend!.textContent).toMatch(/Cash/);
  });

  it("keeps exact counts, gross and reversals in Details", () => {
    const { container } = render(<CollectionsTrends data={CHARTS} />);
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    const text = details!.textContent ?? "";
    expect(text).toMatch(/6 payments recorded/);
    expect(text).toMatch(/Reversals/);
    expect(text).toMatch(/not subtracted|gross/i);
  });
});
