import { GST_STATE_NAMES } from "@/lib/gst";
import type { BillingIssuer } from "@/lib/services/facility-billing-contract";
import { sanitisePdfText, type PdfOp } from "@/lib/receipts/pdf";

const LEFT = 48;
const SIZE = 9;
const LEADING = 12;
// The widest WinAnsi Helvetica glyph is below 1.05 em. This bound remains
// safe for unbroken wide names, unlike the average-width amount estimator.
const MAX_CHARS = Math.floor((595 - LEFT * 2) / (SIZE * 1.05));

function wrap(text: string): string[] {
  const lines: string[] = [];
  let rest = sanitisePdfText(text).replace(/[\r\n\t]+/g, " ").trim();
  while (rest.length > MAX_CHARS) {
    const space = rest.lastIndexOf(" ", MAX_CHARS);
    const end = space > 0 ? space : MAX_CHARS;
    lines.push(rest.slice(0, end));
    rest = rest.slice(end).trimStart();
  }
  if (rest) lines.push(rest);
  return lines;
}

export function appendSupplierBlock(
  ops: PdfOp[], issuer: BillingIssuer, startY: number, invoiceNumber: string,
  wrapLine: (text: string) => string[] = wrap,
): PdfOp[] | null {
  const address = issuer.legalAddress;
  const lines = [issuer.legalName, address.line1, address.line2,
    `${address.city} ${address.postalCode}`,
    `${GST_STATE_NAMES[issuer.stateCode]} (${issuer.stateCode})`,
    issuer.gstin ? `GSTIN: ${issuer.gstin}` : "Not registered under GST",
  ].filter((line): line is string => line !== null).flatMap(wrapLine);
  const overflow = startY - 16 - (lines.length - 1) * LEADING < 110;
  const target: PdfOp[] = overflow ? [] : ops;
  let y = overflow ? 780 : startY;
  const text = (value: string, at: number, bold = false): void => {
    target.push({ kind: "text", x: LEFT, y: at, size: SIZE, text: value, bold });
  };
  if (overflow) {
    ops.push({ kind: "text", x: LEFT, y: startY, size: SIZE,
      text: "Supplier identity continues on page 2." });
    text(`Payment receipt - ${invoiceNumber}`, y);
    y -= 28;
  }
  text("Supplier details", y, true);
  y -= 16;
  for (const line of lines) { text(line, y); y -= LEADING; }
  if (overflow) text("Supplier identity saved when the invoice was issued.", 82);
  return overflow ? target : null;
}
