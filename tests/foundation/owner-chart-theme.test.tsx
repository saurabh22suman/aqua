// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner Home — the charts must belong to the preset.
//
// The coordinator's review: "Mint/Lavender chart controls currently use
// legacy marine green in Lavender; correct semantic accent adoption."
//
// The control pill was already corrected (the selected period wears the
// preset accent). The DATA series were not: cash, digital and other
// were painted with `--color-water`, `--color-marine` and
// `--color-ink-3` — a structural colour (marine is the dark hero
// surface, not a data colour) that never changes with the preset. So
// the Lavender screen drew a green/teal chart next to violet actions.
//
// The rule these assertions pin:
//
//   * the series wear the preset's CHART tokens (`--chart-1/2/3`), not
//     the structural palette;
//   * the MEANING of a series is fixed — cash is money and stays green
//     in both presets (the Lavender direction board keeps the money
//     series green), while digital takes the preset's second colour;
//   * the canvas colours are read when the chart is drawn, so switching
//     the preset repaints the chart instead of leaving the old colours.

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

const chartRenders: unknown[] = [];
vi.mock("@/components/charts/echarts-owner", () => ({
  default: (props: unknown) => {
    chartRenders.push(props);
    return <div data-testid="owner-chart" />;
  },
}));

import { OwnerChartIsland } from "@/components/charts/owner-chart-island";
import { OwnerHomeCharts } from "@/components/owner-home-charts";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

function charts(): OwnerChartsData {
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "month",
      tabLabel: "Month",
      comparisonLabel: "MoM",
      comparisonMeaning: "the same elapsed span",
      currentLabel: "1 Oct 2026 – 26 Oct 2026",
      previousLabel: "1 Sep 2026 – 26 Sep 2026",
      currentFromDate: "2026-10-01",
      currentToDate: "2026-10-26",
      previousFromDate: "2026-09-01",
      previousToDate: "2026-09-26",
      previousCapped: false,
      capNote: null,
    },
    collections: {
      buckets: [
        { key: "1", label: "1", fullLabel: "1 Oct 2026", cash: 1250000, digital: 500000, other: 0, totalPaise: 1750000 },
      ],
      groups: [
        { key: "cash", label: "Cash", paise: 1250000, count: 10, pct: 71 },
        { key: "digital", label: "Digital", paise: 500000, count: 5, pct: 29 },
        { key: "other", label: "Other", paise: 0, count: 0, pct: 0 },
      ],
      methods: [
        { key: "cash", label: "Cash", group: "cash", paise: 1250000, count: 10, pct: 71 },
        { key: "upi", label: "UPI", group: "digital", paise: 500000, count: 5, pct: 29 },
      ],
      totalPaise: 1750000,
      paymentCount: 15,
      previousTotalPaise: 0,
      previousPaymentCount: 0,
      previousIsZero: true,
      reversedPaise: 0,
      reversalCount: 0,
      comparison: "No previous collections in the comparison range",
    },
    attendance: {
      buckets: [
        { key: "1", label: "1", fullLabel: "1 Oct 2026", present: 8, total: 10, pct: 80 },
      ],
      present: 8,
      total: 10,
      pct: 80,
      previousPresent: 0,
      previousTotal: 0,
      previousPct: null,
      comparison: "No previous marks in the comparison range",
    },
  } as OwnerChartsData;
}

afterEach(() => {
  cleanup();
  chartRenders.length = 0;
  delete document.documentElement.dataset.theme;
});

describe("owner charts — the series belong to the preset", () => {
  it("paints the legend with the chart tokens, not the structural palette", () => {
    render(
      <OwnerHomeCharts
        data={charts()}
        metric="collections"
        facility={null}
        canReadFees
        today="2026-10-26"
      />,
    );
    const cash = within(screen.getByRole("list", { name: "Payment groups" })).getByText("Cash");
    const dot = cash.querySelector("span[aria-hidden]");
    expect(dot?.className ?? "").toContain("var(--chart-1)");
  });

  it("paints the phone chart with the chart tokens too", () => {
    const { container } = render(
      <OwnerHomeCharts
        data={charts()}
        metric="collections"
        facility={null}
        canReadFees
        today="2026-10-26"
      />,
    );
    const svg = container.querySelector("svg");
    const fills = Array.from(svg?.querySelectorAll("[fill]") ?? []).map((n) =>
      n.getAttribute("fill"),
    );
    expect(fills.join(" ")).toContain("var(--chart-1)");
  });

  it("keeps money green in the second preset and gives digital the preset colour", () => {
    // The selector is also mentioned in a comment; parse its actual rule.
    const css = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, "");
    const block = css.match(/\[data-theme="lavender"\]\s*\{([^}]+)\}/)?.[1] ?? "";
    expect(block).not.toBe("");
    const chart1 = block.match(/--chart-1:\s*(#[0-9A-Fa-f]{6})/)?.[1];
    const chart2 = block.match(/--chart-2:\s*(#[0-9A-Fa-f]{6})/)?.[1];
    expect(chart1, "cash stays money in the second preset").toBe("#1F5E3A");
    expect(chart2, "digital takes the preset colour").toBe("#4C2E93");
  });

  it("repaints the chart when the preset changes", async () => {
    // A chart canvas bakes its colours when it is drawn, so switching the
    // preset must redraw it rather than leave the old palette on screen.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("min-width: 1024px"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      render(
        <ThemeProvider theme="mint">
          <ThemeToggle />
          <OwnerChartIsland
            kind="doughnut"
            ariaLabel="Payment mix"
            groups={[{ key: "cash", label: "Cash", paise: 100 }]}
            totalPaise={100}
          />
        </ThemeProvider>,
      );
      await waitFor(() => {
        expect(chartRenders.length).toBeGreaterThan(0);
      });
      const before = chartRenders.length;

      fireEvent.click(screen.getByRole("button", {
        name: "Theme: Mint Garden. Switch to Lavender Club",
      }));
      await waitFor(() => {
        expect(chartRenders.length).toBeGreaterThan(before);
      });
    } finally {
      window.matchMedia = original;
      delete document.documentElement.dataset.theme;
    }
  });
});
