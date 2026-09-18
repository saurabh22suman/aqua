import { computeTax } from "@/lib/money/arithmetic";
import type { MenuItemRow } from "@/lib/services/menu";

// K-07 — shapes and constants shared by the café counter client
// islands. No React, no database: cart arithmetic mirrors the
// service exactly (integer paise, per-line computeTax, line + tax).

export type PaymentMethod = "cash" | "upi" | "card" | "other";

export type PlacedOrder = {
  orderId: string;
  totalPaise: number;
  memberId: string | null;
};

export type RaisedInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  totalPaise: number;
};

export type CartLine = { item: MenuItemRow; qty: number };

export const WALK_IN_NOTE =
  "A walk-in order needs a member before it can be billed. Record it with Place order, or add a member and use Bill & pay.";

export const METHOD_OPTIONS: {
  value: PaymentMethod;
  label: string;
  hint: string;
}[] = [
  { value: "cash", label: "Cash", hint: "No reference needed" },
  { value: "upi", label: "UPI QR", hint: "UTR / transaction id" },
  { value: "card", label: "Card terminal", hint: "Terminal reference" },
  { value: "other", label: "Other", hint: "Payment reference" },
];

export const REFERENCE_LABEL: Record<Exclude<PaymentMethod, "cash">, string> =
  {
    upi: "UPI reference (UTR / transaction id)",
    card: "Card terminal reference",
    other: "Reference",
  };

export const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent)] focus:outline-none";

export function lineTotal(item: MenuItemRow, qty: number) {
  const base = Number(BigInt(item.pricePaise) * BigInt(qty));
  return { base, tax: computeTax(base, item.taxRateBp) };
}

export function cartTotals(lines: CartLine[]) {
  let subtotal = 0;
  let tax = 0;
  for (const line of lines) {
    const computed = lineTotal(line.item, line.qty);
    subtotal += computed.base;
    tax += computed.tax;
  }
  return { subtotal, tax, total: subtotal + tax };
}
