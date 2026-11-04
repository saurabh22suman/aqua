// @vitest-environment jsdom
//
// Finance lane — final Payment mix composition (3 November 2026).
// Intended RED: the Payment mix card repeats an "Payment methods" heading and
// every visible legend row repeats "N payments", which wraps badly beside the
// 132px ring at 320. Approved: one heading, legend = method label + amount,
// per-method exact counts in a closed "Method details" disclosure.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CollectionsTrends } from "@/components/reports/owner-approved/collections-trends";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

const charts: OwnerChartsData = {
  timezone: "Asia/Kolkata",
  period: {
    key: "last7",
    tabLabel: "Last 7 days",
    comparisonLabel: "",
    comparisonMeaning: "",
    currentLabel: "",
    previousLabel: "",
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

describe("payment mix legend", () => {
  it("shows label + amount only, with one heading and counts in Details", () => {
    const { container } = render(<CollectionsTrends data={charts} />);
    const mix = Array.from(container.querySelectorAll('[data-testid="report-plot"]')).find(
      (plot) => plot.querySelector("h2")?.textContent === "Payment mix",
    )!;
    expect(mix).toBeTruthy();

    // One visible heading only (no repeated "Payment methods").
    expect(mix.querySelectorAll("h3")).toHaveLength(0);

    const legend = mix.querySelector('[data-testid="method-legend"]')!;
    const details = legend.querySelector('[data-testid="method-details"]')!;
    expect(details, "per-method details disclosure exists").not.toBeNull();

    // Default legend text excludes the disclosure and repeats no counts.
    const defaultText = Array.from(legend.childNodes)
      .filter((node) => node !== details)
      .map((node) => node.textContent ?? "")
      .join(" ");
    expect(defaultText).toMatch(/Cash/);
    expect(defaultText).toMatch(/₹/);
    expect(defaultText).not.toMatch(/payments/i);
    expect(defaultText).not.toMatch(/Payment methods/);

    // Exact count and full amount are retained inside the closed Details.
    expect(details.textContent).toMatch(/Cash · ₹9\.00 · 3 payments/);
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.querySelector("summary")?.className ?? "").toContain("min-h-11");

    // Structural guard for the fixed 320 layout (class-level only; Root owns
    // the actual-Chrome geometry): the label never letter-breaks, the amount
    // never breaks, and label+amount wrap as whole items inside the legend.
    const row = legend.querySelector("li")!;
    const content = row.querySelector("span.flex")!;
    expect(content.className).toContain("flex-wrap");
    const labelSpan = row.querySelector("span.break-normal")!;
    expect(labelSpan, "the label keeps normal word wrapping").not.toBeNull();
    expect(labelSpan.className).not.toContain("break-words");
    expect((labelSpan.textContent ?? "").startsWith("Cash")).toBe(true);
    const amountSpan = row.querySelector("span.whitespace-nowrap")!;
    expect(amountSpan, "the amount never breaks").not.toBeNull();
  });
});
