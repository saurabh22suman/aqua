import { describe, expect, it } from "vitest";
import { scalePayments } from "@/scripts/demo-history/write-invoices";
import type { HistoryPlan } from "@/scripts/demo-history/types";

// The GST scaling of the planned instalments.
//
// A plan price is GST-exclusive (architecture §7.4): the invoice adds
// the tax on top, so the instalments the planner wrote have to be
// scaled to the invoice's real total. The scaling must preserve the
// invoice's PAID ratio — a part-paid invoice stays part-paid — and it
// must not lose or invent a paise when it rounds.

type Invoice = HistoryPlan["invoices"][number];

function invoiceWith(
  totalPaise: number,
  paidPaise: number,
  payments: number[],
): Invoice {
  return {
    key: "invoice-key",
    subscriptionKey: "subscription-key",
    memberId: "member-1",
    memberCode: "AWS-001",
    planId: "plan-1",
    planName: "Monthly Membership",
    issuedOn: "2026-10-01",
    dueOn: "2026-10-08",
    totalPaise,
    paidPaise,
    status:
      paidPaise === totalPaise ? "paid" : paidPaise > 0 ? "partial" : "issued",
    description: "Monthly Membership",
    payments: payments.map((amountPaise, index) => ({
      key: `payment-${index}`,
      invoiceKey: "invoice-key",
      memberId: "member-1",
      amountPaise,
      method: "upi" as const,
      receivedAtIso: "2026-10-02T06:00:00.000Z",
      reference: `DEMO-AWS-001-20261001${index > 0 ? `-${index}` : ""}`,
    })),
  };
}

const sum = (payments: { amountPaise: number }[]) =>
  payments.reduce((total, payment) => total + payment.amountPaise, 0);

describe("demo history — GST scaling of the instalments", () => {
  // The reviewer's numbers: a ₹100 price with 18 % GST is an ₹118
  // invoice; half of it paid is ₹59, NOT ₹118.
  it("keeps a part-paid invoice part-paid when the invoice carries GST", () => {
    const invoice = invoiceWith(10000, 5000, [5000]);
    const scaled = scalePayments(invoice, 11800);
    expect(scaled).toHaveLength(1);
    expect(scaled[0]!.amountPaise).toBe(5900);
    expect(sum(scaled)).toBe(5900);
    expect(sum(scaled)).toBeLessThan(11800);
  });

  it("leaves an unpaid invoice unpaid", () => {
    const invoice = invoiceWith(10000, 0, []);
    expect(scalePayments(invoice, 11800)).toEqual([]);
  });

  it("scales a fully paid invoice to its full total", () => {
    const invoice = invoiceWith(10000, 10000, [10000]);
    const scaled = scalePayments(invoice, 11800);
    expect(sum(scaled)).toBe(11800);
  });

  it("keeps a split payment split, and the sum exact", () => {
    const invoice = invoiceWith(10000, 10000, [4000, 6000]);
    const scaled = scalePayments(invoice, 11800);
    expect(scaled).toHaveLength(2);
    expect(scaled[0]!.amountPaise).toBe(4720);
    expect(scaled[1]!.amountPaise).toBe(7080);
    expect(sum(scaled)).toBe(11800);
  });

  it("loses and invents no paise when the split does not divide evenly", () => {
    const invoice = invoiceWith(10000, 10000, [3333, 3333, 3334]);
    const scaled = scalePayments(invoice, 11800);
    expect(sum(scaled)).toBe(11800);
    for (const payment of scaled) expect(payment.amountPaise).toBeGreaterThan(0);
  });

  it("does nothing when the invoice carries no tax", () => {
    const invoice = invoiceWith(10000, 5000, [5000]);
    const scaled = scalePayments(invoice, 10000);
    expect(scaled).toHaveLength(1);
    expect(scaled[0]!.amountPaise).toBe(5000);
  });
});
