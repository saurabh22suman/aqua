// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";

vi.mock("@/lib/actions/fees-hub", () => ({ listHubInvoicesAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/member-detail/invoice-expanded", () => ({ InvoiceExpanded: ({ onSettled }: { onSettled?: (summary: unknown) => void }) => <div><p>Invoice details</p><button onClick={() => onSettled?.({ invoiceId: "invoice-a", invoiceNumber: "INV-123", memberId: "member-a", memberName: "Ananya Sharma", payerName: "Ananya Sharma", amountPaise: 5416250, method: "cash", paymentId: "payment-a", outstandingPaise: null, confirmed: false })}>Simulate unknown result</button></div> }));
import { FeesInvoiceList } from "@/components/fees/fees-invoice-list";

const row: HubInvoiceRow = {
  id: "invoice-a", invoiceNumber: "INV-123", memberId: "member-a", memberName: "Ananya Sharma",
  payerKind: "member", payerName: "Ananya Sharma", totalPaise: 12345678900,
  paidPaise: 0, outstandingPaise: 12345678900, status: "issued", source: "membership",
  issuedOn: "2020-01-01", dueOn: "2020-01-10", locationName: "Worli",
};
const permissions = { canWrite: false, canRecord: false, canRefund: false, canReadPayments: false };
afterEach(cleanup);

it("names each invoice disclosure and reflects its expanded state", () => {
  render(<FeesInvoiceList initial={[row]} filter="dues" facility="club-a" {...permissions} />);
  const open = screen.getByRole("button", { name: /open.*(?:INV-123|Ananya Sharma)/i });
  expect(open.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(open);
  expect(screen.getByRole("button", { name: /hide.*(?:INV-123|Ananya Sharma)/i }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("Invoice details")).toBeTruthy();
});

it("retains exact large amounts, overdue wording, scoped identity and table headings", () => {
  render(<FeesInvoiceList initial={[row]} filter="dues" facility="club-a" {...permissions} />);
  const ledger = screen.getByTestId("invoice-ledger-row");
  expect(within(ledger).getAllByText("₹12,34,56,789.00").length).toBeGreaterThan(0);
  expect(within(ledger).getByText("Overdue")).toBeTruthy();
  expect(within(ledger).getByRole("link", { name: "Ananya Sharma" }).getAttribute("href")).toContain("facility=club-a");
  expect(within(screen.getByTestId("invoice-ledger-head")).getByText("Invoice total")).toBeTruthy();
});

it("keeps void balances non-collectible and walk-in identity unlinked", () => {
  const walkIn: HubInvoiceRow = { ...row, id: "void-a", invoiceNumber: "VOID-1", memberId: null, memberName: null, payerKind: "guest", payerName: "Guest payer", status: "void" };
  render(<FeesInvoiceList initial={[walkIn]} filter="all" {...permissions} />);
  const ledger = screen.getByTestId("invoice-ledger-row");
  expect(within(ledger).getByText("Void")).toBeTruthy();
  expect(within(ledger).getByText("Balance on a void document")).toBeTruthy();
  expect(within(ledger).queryByText("Overdue")).toBeNull();
  expect(within(ledger).queryByText("Balance outstanding")).toBeNull();
  expect(within(ledger).queryByRole("link", { name: "Guest payer" })).toBeNull();
});

it("retains a truthful settled zero in the full ledger", () => {
  render(<FeesInvoiceList initial={[{ ...row, outstandingPaise: 0, status: "paid" }]} filter="all" {...permissions} />);
  const ledger = screen.getByTestId("invoice-ledger-row");
  expect(within(ledger).getByText("Nothing outstanding")).toBeTruthy();
  expect(within(ledger).getByText("₹0.00")).toBeTruthy();
});

it("retains focus and recovery wording when a recorded payment cannot be re-read", () => {
  render(<FeesInvoiceList initial={[row]} filter="dues" facility="club-a" {...permissions} />);
  fireEvent.click(screen.getByRole("button", { name: /open.*INV-123/i }));
  fireEvent.click(screen.getByRole("button", { name: "Simulate unknown result" }));
  const result = screen.getByTestId("dues-settled-result");
  expect(within(result).getByText(/check it before recording another payment/i)).toBeTruthy();
  expect(within(result).getByRole("link", { name: "View receipt" }).getAttribute("href")).toBe("/api/receipts/payment-a");
  expect(document.activeElement?.textContent).toBe("Payment recorded");
});
