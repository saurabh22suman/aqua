// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SelfBilling } from "@/components/self-billing";

afterEach(cleanup);
it("shows the recorded payment date alongside the correct child and receipt", () => {
  render(<SelfBilling homeHref="/family" receiptBase="/api/family/billing/member-a/receipt" childName="Alex" memberCode="A-2" data={{ outstanding: [], payments: [{ id: "payment-a", amountPaise: 10000, method: "cash", invoiceNumber: "INV-1", receivedAt: "2026-11-14T00:30:00.000Z" }] }} />);
  expect(screen.getByText(/For Alex.*A-2/)).toBeTruthy();
  expect(screen.getByText(/14 Nov 2026/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /download receipt/i }).closest("form")?.getAttribute("action")).toBe("/api/family/billing/member-a/receipt/payment-a");
});
