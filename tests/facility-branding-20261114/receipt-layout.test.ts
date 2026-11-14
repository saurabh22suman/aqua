import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { renderReceiptPdf, type ReceiptDocumentData } from "@/lib/receipts/receipt-document";

const data: ReceiptDocumentData = {
  tenantDisplayName: "Fixture Club", initials: "FC", accent: "marine",
  documentKind: "tax_invoice", invoiceNumber: "INV/2026-27/0001", invoiceIssuedOn: "2026-11-14",
  gstin: "27ABCDE1234F1Z5", placeOfSupply: "Maharashtra (27)", sacCode: "9992",
  memberName: "Synthetic Payer", paymentAmountPaise: 100, paymentMethodLabel: "Cash",
  paymentReference: null, paymentReceivedAt: "2026-11-14T00:30:00Z", invoiceSubtotalPaise: 100,
  invoiceTaxPaise: 0, invoiceTotalPaise: 100, invoicePaidPaise: 100, outstandingPaise: 0,
};

describe("Issuer receipt layout", () => {
  it("keeps a short supplier profile on one readable A4 page", () => {
    const input = { ...data, supplier: {
      legalName: "Original Legal Supplier", stateCode: "27", gstin: data.gstin,
      legalAddress: { line1: "Road 11", line2: null, city: "Mumbai", postalCode: "400001" },
    } };
    const text = renderReceiptPdf(input).toString("latin1");
    expect(text).toContain("Original Legal Supplier");
    expect(text).toContain("Road 11");
    expect(text).toContain("/Count 1");
  });

  it("paginates maximum valid wide-character issuer details rather than clipping", () => {
    const wide = "W".repeat(200);
    const input = { ...data, supplier: {
      legalName: wide, stateCode: "27", gstin: data.gstin,
      legalAddress: { line1: wide, line2: wide, city: wide, postalCode: "400001" },
    } };
    const text = renderReceiptPdf(input).toString("latin1");
    expect(text).toContain("/Count 2");
    const operators = [...text.matchAll(/\(((?:\\.|[^\\()])*)\) Tj ET/g)].map((match) => match[1]).join("");
    expect([...operators].filter((char) => char === "W").length).toBe(800);
  });

  it("preserves the legacy one-page document when no supplier snapshot exists", () => {
    const pdf = renderReceiptPdf(data);
    const text = pdf.toString("latin1");
    expect(createHash("sha256").update(pdf).digest("hex")).toBe("98bfac2ed8069f78a9004d0d545898de75e69686190f31d5af1f833f2e1f67a2");
    expect(text).toContain("/Count 1");
    expect(text).not.toContain("Supplier details");
  });
});
