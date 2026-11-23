import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FeesOverviewCards } from "@/components/fees/fees-overview-cards";
import type { FeesOverview } from "@/lib/services/fees-hub";

const overview: FeesOverview = { from: "2026-11-01", to: "2026-12-01", collectedPaise: 300, paymentCount: 2, reversedPaise: 0, reversalCount: 0, outstandingPaise: 100, dueInvoiceCount: 1, overduePaise: 0, overdueInvoiceCount: 0, overdueAgeing: [], today: "2026-11-16", methodTotals: [{ method: "cash", paise: 300 }], followUps: [{ id: "invoice-id", invoiceNumber: "INV-1", payerName: "Synthetic payer", dueOn: "2026-11-20", outstandingPaise: 100 }] };
it("links actual follow-ups with invoice, period and club and presents actual method totals", () => {
  const html = renderToStaticMarkup(<FeesOverviewCards overview={overview} facility="club-id" from="2026-11-01" to="2026-12-01" />);
  expect(html).toContain("Synthetic payer");
  expect(html).toContain("invoice=invoice-id");
  expect(html).toContain("facility=club-id");
  expect(html).toContain("from=2026-11-01");
  expect(html).toContain("to=2026-12-01");
  expect(html).toContain("Cash");
});
it("distinguishes missing summaries from a real zero and hides missing follow-ups", () => {
  const missing = renderToStaticMarkup(<FeesOverviewCards overview={{ ...overview, methodTotals: undefined, followUps: undefined }} facility="all" from="2026-11-01" to="2026-12-01" />);
  expect(missing).not.toContain("Payment follow-ups");
  expect(missing).toContain("Payment methods unavailable");
  const empty = renderToStaticMarkup(<FeesOverviewCards overview={{ ...overview, methodTotals: [], followUps: [] }} facility="all" from="2026-11-01" to="2026-12-01" />);
  expect(empty).toContain("No payments in this period");
  expect(empty).toContain("No outstanding invoices");
});
