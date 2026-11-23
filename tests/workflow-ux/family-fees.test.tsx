// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SelfBilling } from "@/components/self-billing";

it("leads with the selected child's next fee and names the receipt by invoice", () => {
  render(<SelfBilling homeHref="/family" receiptBase="/api/family/billing/anika/receipt" childName="Anika Joshi" memberCode="SELF-2"
    data={{
      outstanding: [{ id: "open", invoiceNumber: "NOV-17", dueOn: "2026-11-23", totalPaise: 150050, paidPaise: 50000, outstandingPaise: 100050, status: "partial" }],
      payments: [{ id: "paid", invoiceNumber: "NOV-15", method: "upi", receivedAt: "2026-11-19T12:30:00Z", amountPaise: 54050 }],
    }}
  />);
  expect(screen.getByRole("heading", { name: "Next fee due" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Next fee due" }).textContent).toMatch(/₹1,000\.50/);
  expect(screen.getByRole("region", { name: "Recent payments" })).toBeTruthy();
  const receipt = screen.getByRole("button", { name: /Download receipt for NOV-15/ });
  expect(receipt.closest("form")?.getAttribute("method")).toBe("post");
  expect(receipt.closest("form")?.getAttribute("action")).toBe("/api/family/billing/anika/receipt/paid");
});
