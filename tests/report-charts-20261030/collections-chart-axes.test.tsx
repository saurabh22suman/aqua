// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CollectionsExpensesCard } from "@/components/reports/analytics-cards";
import { chartText, svgByLabel } from "./chart-dom";

// 30 October 2026 — owner report chart readability.
//
// The Collections card has the same defect as the attendance card: bars
// with no dates and no money scale, so a reader cannot tell what day a
// bar belongs to or how much it is worth. The exact paise stay in the
// card's data table; the axis is display only and must never turn a
// rupee amount into a fractional paise value on the way to the label.

afterEach(cleanup);

const SERIES = {
  totalPaise: 125_000,
  byDay: [
    { date: "2026-09-01", paise: 50_000 },
    { date: "2026-09-02", paise: 75_000 },
    { date: "2026-09-03", paise: 0 },
  ],
  expensesPaise: null,
};

function chart() {
  return svgByLabel(/collections by day/i);
}

/** "₹1,234.56" -> 123456 paise. Returns null for anything unreadable. */
function paiseOf(label: string): number | null {
  const cleaned = label.replace(/[₹,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{2}))?$/.exec(cleaned);
  if (!match) return null;
  return Number(match[1]) * 100 + Number(match[2] ?? "0");
}

function axisLabels(): string[] {
  return chartText(chart());
}

describe("collections chart axes", () => {
  it("shows a money scale on the y axis", () => {
    render(<CollectionsExpensesCard series={SERIES} />);
    const money = axisLabels().filter((label) => label.startsWith("₹"));
    expect(money.length).toBeGreaterThanOrEqual(3);
  });

  it("names the unit of the y axis", () => {
    render(<CollectionsExpensesCard series={SERIES} />);
    expect(axisLabels().join(" ")).toMatch(/INR/i);
  });

  it("labels the x axis with the report's own dates", () => {
    render(<CollectionsExpensesCard series={SERIES} />);
    const text = axisLabels().join(" ");
    expect(text).toMatch(/\b1 Sept?\b/);
    expect(text).toMatch(/\b3 Sept?\b/);
    expect(text).toMatch(/date/i);
  });

  it("scales the money axis from zero so the bars keep their proportion", () => {
    render(<CollectionsExpensesCard series={SERIES} />);
    const values = axisLabels()
      .filter((label) => label.startsWith("₹"))
      .map(paiseOf);
    expect(values.every((value) => value !== null)).toBe(true);
    expect(values[0]).toBe(0);
    expect(Math.max(...(values as number[]))).toBeGreaterThanOrEqual(75_000);
  });

  it("keeps every tick an exact integer paise amount", () => {
    // A maximum that does not divide by the tick count: a fractional
    // paise tick would break the money formatter.
    render(
      <CollectionsExpensesCard
        series={{
          totalPaise: 123_456,
          byDay: [
            { date: "2026-09-01", paise: 61_728 },
            { date: "2026-09-02", paise: 123_456 },
          ],
          expensesPaise: null,
        }}
      />,
    );
    for (const label of axisLabels().filter((l) => l.startsWith("₹"))) {
      expect(paiseOf(label)).not.toBeNull();
    }
  });
});

describe("collections card keeps its exact table", () => {
  it("still offers the exact amounts for every day", () => {
    render(<CollectionsExpensesCard series={SERIES} />);
    const table = document.querySelector("table");
    expect(table).not.toBeNull();
    const body = table?.textContent ?? "";
    expect(body).toMatch(/1 Sept? 2026/);
    expect(body).toMatch(/3 Sept? 2026/);
    expect(body).toContain("₹500.00");
    expect(body).toContain("₹750.00");
    expect(body).toContain("₹0.00");
  });

  it("still states that expenses are not tracked", () => {
    render(<CollectionsExpensesCard series={SERIES} />);
    expect(document.body.textContent).toMatch(/expenses are not tracked in aqua yet/i);
  });
});
