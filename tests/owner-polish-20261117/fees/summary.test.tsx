import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FeesSummaryMetrics } from "@/components/fees/fees-summary-metrics";
import type { FeesOverview } from "@/lib/services/fees-hub";

const period = { from: "2026-11-01", to: "2026-12-01" };
const overview: FeesOverview = { ...period, collectedPaise: 5416250, paymentCount: 1, reversedPaise: 250, reversalCount: 1, outstandingPaise: 1234567890, dueInvoiceCount: 1, overduePaise: 12345678900, overdueInvoiceCount: 1, overdueAgeing: [], today: "2026-11-17" };

it("keeps exact period and current amounts and scoped drilldowns distinct", () => {
  const html = renderToStaticMarkup(<FeesSummaryMetrics overview={overview} facility="club-a" period={period} />);
  for (const value of ["₹54,162.50", "₹1,23,45,678.90", "₹12,34,56,789.00", "₹2.50 reversed separately"]) expect(html).toContain(value);
  expect(html).toContain("Period collections");
  expect(html).toContain("Current balances");
  expect(html).toContain("facility=club-a");
  expect(html).toContain("from=2026-11-01");
  expect(html).toContain("Payment methods unavailable");
});

it("distinguishes empty data from unavailable data", () => {
  const html = renderToStaticMarkup(<FeesSummaryMetrics overview={{ ...overview, collectedPaise: 0, outstandingPaise: 0, overduePaise: 0, dueInvoiceCount: 0, overdueInvoiceCount: 0, reversedPaise: 0, methodTotals: [], followUps: [] }} facility={null} period={period} />);
  expect(html).toContain("₹0.00");
  expect(html).toContain("No payments in this period");
  expect(html).toContain("No outstanding invoices");
  expect(html).not.toContain("Payment methods unavailable");
});
