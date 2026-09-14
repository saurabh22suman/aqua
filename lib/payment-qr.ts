// C-35/C-37 — pure payment-QR helpers, shared by the server service and
// the collect-payment client island. No database, no React.

export type PaymentQrKind = "upi" | "image";

export const PAYMENT_QR_IMAGE_MAX_BYTES = 262144;

export const PAYMENT_QR_IMAGE_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

// The UPI deep-link payload. `am` is rupees with two decimals (the NPCI
// convention), built from bigint paise without any float step.
export function formatPaiseForUpi(amountPaise: bigint): string {
  if (amountPaise < 0n) {
    throw new Error("formatPaiseForUpi: amount must not be negative");
  }
  const rupees = amountPaise / 100n;
  const paise = amountPaise % 100n;
  return `${rupees}.${paise.toString().padStart(2, "0")}`;
}

export function buildUpiUri(
  qr: { upiId: string; payeeName: string },
  amountPaise?: bigint,
): string {
  // Built by hand rather than via URLSearchParams: the VPA's "@" must
  // stay literal (the regex layer already limits it to
  // letters/digits/._-@), while the payee name is percent-encoded
  // (encodeURIComponent emits %20 for spaces, which UPI apps expect).
  const parts = [
    `pa=${qr.upiId}`,
    `pn=${encodeURIComponent(qr.payeeName)}`,
    "cu=INR",
  ];
  if (amountPaise !== undefined) {
    parts.push(`am=${formatPaiseForUpi(amountPaise)}`);
  }
  return `upi://pay?${parts.join("&")}`;
}

// Owner/reception input ("2500", "2,500.50") to bigint paise. Returns
// null for anything that is not a clean, non-negative rupee amount with
// at most two decimals. No float parse of the amount itself.
export function parseRupeesToPaise(raw: string): bigint | null {
  const text = raw.trim().replace(/,/g, "");
  if (text.length === 0) return null;
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const rupees = BigInt(match[1]);
  const decimals = (match[2] ?? "").padEnd(2, "0");
  const paise = BigInt(decimals || "0");
  return rupees * 100n + paise;
}
