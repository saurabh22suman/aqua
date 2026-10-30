// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

// Owner redesign · System lane — the approved Home payment mix.
//
// The human's approved composition (approved-preview.html, "Payment mix
// · same week" and the shared decisions):
//
//   "Home payment mix uses a donut, total in its centre, and direct
//    amounts and percentages in the legend. Same period/facility as
//    collections; real captured payment data and bigint arithmetic.
//    Cash/Digital/Other and existing method drill-downs remain truthful."
//
// The money is the real service shape (bigint paise, captured payments
// only); the fixture below is the same shape the service returns, not a
// new contract.
//
// RED status at the time of writing: the mix panel had no side-by-side
// donut/legend composition, no legend colour swatch and no "total
// collected" wording in the centre.
//
// AMENDMENT (release-combined 65e91ab, the approved donut fix): the
// approved composition above says "total in its centre", and that stays
// true for a total the ring's hole can hold. The hole holds six
// characters; "₹18,200" is seven. So the amount is now printed IN FULL
// next to the ring (components/owner-mini-donut.tsx, the
// `owner-mini-donut-amount` element) and the hole keeps only the
// ring's own caption. The case below is updated to that approved
// behaviour — the amount is still stated exactly, never truncated and
// never rounded. The original RED note above is kept as the historical
// evidence of how this suite was written; this amendment is a
// correction of a stale expectation, not a new RED.

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

// The ECharts island is a client island that only mounts at lg; the
// server-rendered SVG ring is the phone composition and is always in the
// document, so it is what this test reads.
vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { OwnerHomeCharts } from "@/components/owner-home-charts";
import OwnerHomeLoading from "@/app/(owner)/owner/loading";

afterEach(cleanup);

function chartData(overrides: Partial<OwnerChartsData> = {}): OwnerChartsData {
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "week",
      tabLabel: "This week",
      comparisonLabel: "WoW",
      comparisonMeaning: "week over week",
      currentLabel: "20–26 Oct 2026",
      previousLabel: "13–19 Oct 2026",
      currentFromDate: "2026-10-20",
      currentToDate: "2026-10-26",
      previousFromDate: "2026-10-13",
      previousToDate: "2026-10-19",
      previousCapped: false,
      capNote: null,
    },
    collections: {
      buckets: [],
      groups: [
        { key: "cash", label: "Cash", paise: 840000, count: 4, pct: 46.2 },
        { key: "digital", label: "Digital", paise: 980000, count: 6, pct: 53.8 },
        { key: "other", label: "Other", paise: 0, count: 0, pct: 0 },
      ],
      methods: [
        { key: "cash", label: "Cash", group: "cash", paise: 840000, count: 4, pct: 46.2 },
        { key: "upi", label: "UPI", group: "digital", paise: 600000, count: 4, pct: 33 },
        { key: "card", label: "Card", group: "digital", paise: 380000, count: 2, pct: 20.8 },
      ],
      totalPaise: 1820000,
      paymentCount: 10,
      previousTotalPaise: 1500000,
      previousPaymentCount: 8,
      previousIsZero: false,
      reversedPaise: 0,
      reversalCount: 0,
      comparison: "+21.3%",
    },
    attendance: {
      buckets: [],
      present: 0,
      total: 0,
      pct: null,
      previousPresent: 0,
      previousTotal: 0,
      previousPct: null,
      comparison: "No marks recorded",
    },
    ...overrides,
  };
}

function renderMix(data: OwnerChartsData, facility: string | null = "loc-1") {
  return render(
    <OwnerHomeCharts
      data={data}
      metric="collections"
      facility={facility}
      canReadFees
      today="2026-10-27"
    />,
  );
}

describe("the approved Home payment mix", () => {
  it("states the captured total in full outside the donut's hole", () => {
    renderMix(chartData());
    const donut = screen.getByTestId("owner-mini-donut");
    expect(donut.getAttribute("role")).toBe("img");
    // The exact captured total is still stated, in full: the fixture's
    // 1820000 paise is "₹18,200", unchanged.
    const amount = screen.getByTestId("owner-mini-donut-amount");
    expect(amount.textContent).toBe("₹18,200");
    // It is printed OUTSIDE the ring, because the hole holds six
    // characters and this total has seven: the amount never paints over
    // the band, and it is never truncated or rounded to fit.
    expect(donut.contains(amount)).toBe(false);
    expect(donut.textContent).not.toContain("₹18,200");
    // The ring still says what the number is, so the ring is readable on
    // its own.
    expect(donut.textContent).toContain("collected");
  });

  it("lists every group with its direct amount AND its percentage", () => {
    renderMix(chartData());
    const legend = screen.getByTestId("owner-payment-mix-legend");
    const cash = within(legend).getByText("Cash").closest("li");
    expect(cash?.textContent).toContain("₹8,400");
    expect(cash?.textContent).toContain("46.2%");
    const digital = within(legend).getByText("Digital").closest("li");
    expect(digital?.textContent).toContain("₹9,800");
    expect(digital?.textContent).toContain("53.8%");
  });

  it("marks the colour with a swatch without making colour the only cue", () => {
    renderMix(chartData());
    const legend = screen.getByTestId("owner-payment-mix-legend");
    const swatches = legend.querySelectorAll("[data-testid='owner-payment-mix-swatch']");
    expect(swatches.length).toBeGreaterThanOrEqual(3);
    // The swatch is decorative; the words carry the meaning.
    for (const swatch of swatches) {
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
    }
    expect(legend.textContent).toContain("Cash");
    expect(legend.textContent).toContain("Digital");
    expect(legend.textContent).toContain("Other");
  });

  it("keeps each group's drill-down on the same period and facility", () => {
    renderMix(chartData(), "loc-1");
    const legend = screen.getByTestId("owner-payment-mix-legend");
    const cashLink = within(legend).getByRole("link", { name: "Cash" });
    const href = cashLink.getAttribute("href") ?? "";
    expect(href).toContain("group=cash");
    expect(href).toContain("from=2026-10-20");
    expect(href).toContain("to=2026-10-27");
    expect(href).toContain("facility=loc-1");
  });

  it("expands Digital into its own methods without inventing a total", () => {
    renderMix(chartData());
    const legend = screen.getByTestId("owner-payment-mix-legend");
    expect(legend.textContent).toContain("UPI");
    expect(legend.textContent).toContain("₹6,000");
    expect(legend.textContent).toContain("Card");
  });

    it("keeps the LOADING skeleton's money band on the real band's grid", () => {
    // The independent follow-up review found that the loading skeleton
    // still used the OLD 3-column money band (trends over two, mix over
    // one) while the real Home uses 5 columns (trends over three, mix
    // over two) — so the band rearranged itself when the data arrived.
    //
    // The contract is the same grid, not a similar one.
    renderMix(chartData());
    const realBand = screen.getByTestId("owner-home-money-band");
    const realTrends = screen.getByTestId("owner-home-money-trends");
    const realMix = screen.getByTestId("owner-payment-mix");
    const gridTokens = (source: string) =>
      (source.match(/(?:[a-z]+:)?grid-cols-\d/g) ?? []).sort().join(" ");
    const spanTokens = (source: string) =>
      (source.match(/(?:[a-z]+:)?col-span-\d/g) ?? []).sort().join(" ");

    cleanup();
    render(<OwnerHomeLoading />);
    const skeletonBand = screen.getByTestId("owner-home-loading-money-band");
    // The current loading band no longer exposes separate old band ids;
    // its two columns are the direct children, matching the real grid.
    const skeletonTrends = skeletonBand.children[0] as HTMLElement;
    const skeletonMix = skeletonBand.children[1] as HTMLElement;

    expect(gridTokens(skeletonBand.className)).toBe(gridTokens(realBand.className));
    expect(spanTokens(skeletonTrends.className)).toBe(
      spanTokens(realTrends.className),
    );
    expect(spanTokens(skeletonMix.className)).toBe(spanTokens(realMix.className));
  });

  it("keeps every legend drill-down an effective 44×44 target", () => {
    renderMix(chartData());
    const legend = screen.getByTestId("owner-payment-mix-legend");
    const links = within(legend).getAllByRole("link");
    expect(links.length).toBeGreaterThan(2);
    for (const link of links) {
      // The floor is an effective 44×44 target, not a height alone: a
      // short label ("Cash", "UPI") must not be a narrow target.
      expect(link.className).toContain("min-h-11");
      expect(link.className).toContain("min-w-[44px]");
    }
  });

  it("says plainly when the period holds no captured payments", () => {
    const empty = chartData();
    empty.collections = {
      ...empty.collections,
      totalPaise: 0,
      paymentCount: 0,
      groups: [
        { key: "cash", label: "Cash", paise: 0, count: 0, pct: 0 },
        { key: "digital", label: "Digital", paise: 0, count: 0, pct: 0 },
        { key: "other", label: "Other", paise: 0, count: 0, pct: 0 },
      ],
      methods: [],
    };
    renderMix(empty);
    expect(screen.queryByTestId("owner-mini-donut")).toBeNull();
    // … and no amount is printed outside the ring either: a period with
    // no captured payments states no total.
    expect(screen.queryByTestId("owner-mini-donut-amount")).toBeNull();
    expect(screen.getByTestId("owner-home-money").textContent).toContain(
      "No collections in this period",
    );
  });
});
