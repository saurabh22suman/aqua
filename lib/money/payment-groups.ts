// Payment methods and the three owner-facing collection groups.
//
// The database method set is closed (payments_method_check): cash, upi,
// bank_transfer, card, other. Owners think in three buckets — cash,
// digital and other — and "other" is NOT digital: a cheque or an
// adjustment is its own bucket. One mapping, used by the Home doughnut,
// its drill-down links and the Fees transactions filter, so the legend,
// the filter and the total can never disagree.

export const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "card", "other"] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_GROUPS = ["cash", "digital", "other"] as const;
export type PaymentGroupKey = (typeof PAYMENT_GROUPS)[number];

export const METHOD_LABEL: Record<PaymentMethodKey, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  card: "Card",
  other: "Other",
};

export const GROUP_LABEL: Record<PaymentGroupKey, string> = {
  cash: "Cash",
  digital: "Digital",
  other: "Other",
};

export const GROUP_METHODS: Record<PaymentGroupKey, readonly PaymentMethodKey[]> = {
  cash: ["cash"],
  digital: ["upi", "bank_transfer", "card"],
  other: ["other"],
};

export function isPaymentMethod(value: unknown): value is PaymentMethodKey {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export function isPaymentGroup(value: unknown): value is PaymentGroupKey {
  return typeof value === "string" && (PAYMENT_GROUPS as readonly string[]).includes(value);
}

export function methodGroup(method: string): PaymentGroupKey {
  if (method === "cash") return "cash";
  if (method === "upi" || method === "bank_transfer" || method === "card") return "digital";
  // "other", and anything the closed set does not recognise, is its own
  // bucket — never folded into Digital because that would inflate a
  // category owners read as "money that arrived through a bank/UPI".
  return "other";
}

export function methodsForGroup(group: PaymentGroupKey): readonly PaymentMethodKey[] {
  return GROUP_METHODS[group];
}

export function methodLabel(method: string): string {
  return isPaymentMethod(method) ? METHOD_LABEL[method] : method;
}

export function groupLabel(group: string): string {
  return isPaymentGroup(group) ? GROUP_LABEL[group] : group;
}
