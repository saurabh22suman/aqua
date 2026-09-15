import { ACCENTS, type AccentKey } from "@/lib/branding/accents";
import { formatINR } from "@/lib/money/format";
import { amountInWords } from "@/lib/money/words";
import { formatDateIST, formatDateTimeIST } from "@/lib/time/tz";
import { gstDocumentLabel, type GstDocumentKind } from "@/lib/gst";
import {
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  estimateTextWidthPt,
  renderPdf,
  type PdfColor,
  type PdfOp,
} from "@/lib/receipts/pdf";

// C-39 — the receipt document. One A4 page, tenant-branded: the
// tenant's initials on their accent band as the mark (no raster logo
// exists yet — the inline-SVG initials fallback is what every tenant
// has), the payment's amount in figures and Indian-format words, and
// the GST references from the invoice (number, kind, GSTIN, place of
// supply, SAC) so the receipt stands on its own.

export type ReceiptDocumentData = {
  tenantDisplayName: string;
  initials: string;
  accent: AccentKey;
  documentKind: GstDocumentKind;
  invoiceNumber: string;
  invoiceIssuedOn: string;
  gstin: string | null;
  placeOfSupply: string | null;
  sacCode: string | null;
  memberName: string;
  paymentAmountPaise: number;
  paymentMethodLabel: string;
  paymentReference: string | null;
  paymentReceivedAt: string;
  invoiceSubtotalPaise: number;
  invoiceTaxPaise: number;
  invoiceTotalPaise: number;
  invoicePaidPaise: number;
  outstandingPaise: number;
};

function hexToColor(hex: string): PdfColor {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
  ];
}

export function pdfAmount(paise: number): string {
  return `Rs. ${formatINR(paise).replace(/\u20b9/g, "").trim()}`;
}

const INK: PdfColor = [0.09, 0.13, 0.15];
const MUTED: PdfColor = [0.42, 0.45, 0.47];
const WHITE: PdfColor = [1, 1, 1];
const RULE: PdfColor = [0.85, 0.87, 0.88];

const LEFT = 48;
const RIGHT = A4_WIDTH_PT - 48;
const RIGHT_COL = 320;

export function renderReceiptPdf(data: ReceiptDocumentData): Buffer {
  const accent = hexToColor(ACCENTS[data.accent].base);
  const ops: PdfOp[] = [];

  // Header band with the tenant mark.
  ops.push({ kind: "rect", x: 0, y: 752, width: A4_WIDTH_PT, height: 90, color: accent });
  ops.push({ kind: "text", x: LEFT, y: 796, size: 26, bold: true, text: data.initials, color: WHITE });
  ops.push({ kind: "text", x: LEFT, y: 770, size: 14, bold: true, text: data.tenantDisplayName, color: WHITE });
  const title = "PAYMENT RECEIPT";
  ops.push({
    kind: "text",
    x: RIGHT - estimateTextWidthPt(title, 12),
    y: 788,
    size: 12,
    bold: true,
    text: title,
    color: WHITE,
  });

  // Amount block.
  ops.push({ kind: "text", x: LEFT, y: 706, size: 10, text: "Received with thanks from", color: MUTED });
  ops.push({ kind: "text", x: LEFT, y: 686, size: 15, bold: true, text: data.memberName, color: INK });
  const amount = pdfAmount(data.paymentAmountPaise);
  ops.push({ kind: "text", x: LEFT, y: 648, size: 24, bold: true, text: amount, color: INK });
  ops.push({ kind: "text", x: LEFT, y: 630, size: 10, text: amountInWords(data.paymentAmountPaise), color: MUTED });

  ops.push({ kind: "line", x1: LEFT, y1: 612, x2: RIGHT, y2: 612, color: RULE });

  // Reference column (left): the document the payment is against.
  let y = 592;
  const label = (text: string, atY: number, x = LEFT): void => {
    ops.push({ kind: "text", x, y: atY, size: 9, text, color: MUTED });
  };
  const value = (text: string, atY: number, x = LEFT, bold = false): void => {
    ops.push({ kind: "text", x, y: atY, size: 11, bold, text, color: INK });
  };

  label("Against invoice", y);
  value(data.invoiceNumber, y - 14, LEFT, true);
  y -= 42;
  label("Invoice date", y);
  value(formatDateIST(data.invoiceIssuedOn), y - 14);
  y -= 42;
  label("Document", y);
  value(gstDocumentLabel(data.documentKind), y - 14);

  // Payment column (right).
  let ry = 592;
  label("Method", ry, RIGHT_COL);
  value(data.paymentMethodLabel, ry - 14, RIGHT_COL, true);
  ry -= 42;
  label("Reference", ry, RIGHT_COL);
  value(data.paymentReference ?? "-", ry - 14, RIGHT_COL);
  ry -= 42;
  label("Received at", ry, RIGHT_COL);
  value(formatDateTimeIST(data.paymentReceivedAt), ry - 14, RIGHT_COL);

  // GST block for a tax invoice; a note for a bill of supply.
  y -= 48;
  if (data.documentKind === "tax_invoice" && data.gstin) {
    label("GSTIN", y);
    value(data.gstin, y - 14);
    if (data.placeOfSupply) {
      label("Place of supply", y - 42);
      value(data.placeOfSupply, y - 56);
      y -= 42;
    }
    if (data.sacCode) {
      label("SAC", y - 42);
      value(data.sacCode, y - 56);
      y -= 42;
    }
    y -= 42;
  } else {
    label("Bill of supply", y);
    value("Not registered under GST - no tax charged.", y - 14);
    y -= 42;
  }

  ops.push({ kind: "line", x1: LEFT, y1: y, x2: RIGHT, y2: y, color: RULE });
  y -= 24;
  label("Invoice total", y);
  value(pdfAmount(data.invoiceTotalPaise), y - 14, LEFT);
  label("Paid to date", y, RIGHT_COL);
  value(pdfAmount(data.invoicePaidPaise), y - 14, RIGHT_COL, true);
  y -= 48;
  label("Outstanding", y);
  value(
    data.outstandingPaise > 0 ? pdfAmount(data.outstandingPaise) : "Nil",
    y - 14,
    LEFT,
    data.outstandingPaise > 0,
  );

  // Footer. Deliberately no "generated at now" line: the document
  // must be deterministic so a re-generated (never re-stored) copy is
  // byte-identical, and the received-at field above is the timestamp
  // that matters.
  ops.push({
    kind: "text",
    x: LEFT,
    y: 82,
    size: 9,
    text: "Computer-generated receipt. No signature required.",
    color: MUTED,
  });

  return renderPdf(ops, { widthPt: A4_WIDTH_PT, heightPt: A4_HEIGHT_PT });
}
