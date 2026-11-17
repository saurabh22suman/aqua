// @vitest-environment jsdom
//
// Owner Lavender B — "Money at a glance".
//
// The retained range control sits above the two money panels (collections
// and payment mix), so both panels describe the same period and scope:
//
//   * the control keeps the facility scope;
//   * the drill-downs carry the same dates and the same facility;
//   * a period with no money says so instead of drawing an empty ring;
//   * a failed read says "unavailable", never ₹0.
//

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { OwnerHomeCharts } from "@/components/owner-home-charts";
import { OwnerHomeRange } from "@/components/owner-home/owner-home-range";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

function data(overrides: Partial<OwnerChartsData> = {}): OwnerChartsData {
  return {
    timezone: "Asia/Kolkata",
    period: {
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
    },
    collections: {
      buckets: [
        {
          key: "2026-10-26",
          label: "Mon 26",
          fullLabel: "26 Oct 2026",
          cash: 200000,
          digital: 400000,
          other: 0,
          totalPaise: 600000,
        },
      ],
      groups: [
        { key: "cash", label: "Cash", paise: 300000, count: 2, pct: 33 },
        { key: "digital", label: "Digital", paise: 550000, count: 3, pct: 61 },
        { key: "other", label: "Other", paise: 50000, count: 1, pct: 6 },
      ],
      methods: [
        { key: "cash", label: "Cash", group: "cash", paise: 300000, count: 2, pct: 33 },
        { key: "upi", label: "UPI", group: "digital", paise: 400000, count: 2, pct: 45 },
        { key: "other", label: "Other", group: "other", paise: 50000, count: 1, pct: 6 },
      ],
      totalPaise: 900000,
      paymentCount: 6,
      previousTotalPaise: 600000,
      previousPaymentCount: 4,
      previousIsZero: false,
      reversedPaise: 0,
      reversalCount: 0,
      comparison: "Up 50% vs the previous range",
    },
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
    ...overrides,
  } as OwnerChartsData;
}

afterEach(cleanup);

describe("owner Home — money at a glance", () => {
  it("puts ONE period control above both money panels", () => {
    render(
      <><OwnerHomeRange data={data()} period="week" facility="loc-1" /><OwnerHomeCharts
        data={data()}
        metric="collections"
        facility="loc-1"
        canReadFees
      /></>,
    );
    const band = screen.getByTestId("owner-home-money");
    expect(within(band).getByText("Money at a glance")).toBeTruthy();
    // Exactly one range control is composed alongside the money band.
    const periods = screen.getByRole("navigation", { name: "Range" });
    const labels = within(periods)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual(["Day", "Last 7 days", "Month"]);
    // Both panels live inside the same band, so they always describe
    // the same period.
    expect(within(band).getByText("Payment mix")).toBeTruthy();
    expect(within(band).getByText("Collections")).toBeTruthy();
    expect(screen.getByTestId("owner-home-range-detail").textContent).toContain("26 Oct 2026");
  });

  it("keeps facility scope on range links and dates on the transaction drill-down", () => {
    render(
      <><OwnerHomeRange data={data()} period="week" facility="loc-1" /><OwnerHomeCharts
        data={data()}
        metric="collections"
        facility="loc-1"
        canReadFees
      /></>,
    );
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/owner?period=day&facility=loc-1");
    expect(hrefs).toContain("/owner?period=last7&facility=loc-1");
    expect(hrefs).toContain("/owner?period=month&facility=loc-1");
    expect(hrefs.some(href => href?.includes("from=2026-10-26") && href.includes("to=2026-10-29") && href.includes("facility=loc-1"))).toBe(true);
  });

  it("says there is no mix instead of drawing an empty ring", () => {
    render(
      <OwnerHomeCharts
        data={data({
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
        })}
        metric="collections"
        facility={null}
        canReadFees
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("No payments recorded in this period");
    expect(screen.queryByText("Payment mix")).toBeNull();
  });

  it("states that the charts are unavailable instead of showing zero", () => {
    render(
      <OwnerHomeCharts
        data={null}
        metric="collections"
        facility={null}
        canReadFees
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Money figures are unavailable right now");
    expect(text).not.toContain("₹0");
  });
});
