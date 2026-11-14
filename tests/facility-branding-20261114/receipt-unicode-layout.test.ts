import { execFileSync } from "node:child_process";
import PDFDocument from "pdfkit";
import { expect, it, vi } from "vitest";
import { renderIssuedReceipt } from "@/lib/receipts/render-issued-receipt";
import type { ReceiptDocumentData } from "@/lib/receipts/receipt-document";

const data: ReceiptDocumentData = {
  tenantDisplayName: "खेल Club", initials: "KC", accent: "marine",
  documentKind: "bill_of_supply", invoiceNumber: "INV-1", invoiceIssuedOn: "2026-11-14",
  gstin: null, placeOfSupply: null, sacCode: null, memberName: "ಬೆಂಗಳೂರಿನ ಆಟಗಾರ",
  paymentAmountPaise: 100, paymentMethodLabel: "Cash", paymentReference: null,
  paymentReceivedAt: "2026-11-14T00:30:00Z", invoiceSubtotalPaise: 100,
  invoiceTaxPaise: 0, invoiceTotalPaise: 100, invoicePaidPaise: 100, outstandingPaise: 0,
  supplier: { legalName: "भारत खेल", legalAddress: { line1: "ಬೆಂಗಳೂರು ರಸ್ತೆ", line2: null, city: "ಬೆಂಗಳೂರು", postalCode: "560001" }, stateCode: "29", gstin: null },
};

it("preserves brand, payer and supplier text and generates deterministic bytes", async () => {
  const first = await renderIssuedReceipt(data);
  const second = await renderIssuedReceipt(data);
  expect(second.equals(first)).toBe(true);
  const text = execFileSync("pdftotext", ["-", "-"], { input: first, encoding: "utf8" });
  expect(text).toContain("खेल");
  expect(text).toContain("ಆಟಗಾರ");
  expect(text).toContain("भारत");
});

it("wraps a long multilingual supplier onto a second page without dropping text", async () => {
  const long = "W".repeat(196) + "भारत";
  const supplier = { ...data.supplier!, legalName: long, legalAddress: { ...data.supplier!.legalAddress, line1: long, line2: long, city: long } };
  const pdf = await renderIssuedReceipt({ ...data, supplier });
  const output = execFileSync("pdftotext", ["-", "-"], { input: pdf, encoding: "utf8" });
  expect(output.replace(/\s/g, "").split("भारत").length - 1).toBe(4);
  expect([...output].filter((char) => char === "W")).toHaveLength(784);
  expect(pdf.toString("latin1")).toMatch(/\/Count 2\b/);
});

it("preserves complex Devanagari clusters in the extracted issuer", async () => {
  const supplier = { ...data.supplier!, legalName: "किरण क्रीड़ा क्षेत्र" };
  const pdf = await renderIssuedReceipt({ ...data, supplier });
  const output = execFileSync("pdftotext", ["-", "-"], { input: pdf, encoding: "utf8" });
  expect(output).toContain(supplier.legalName);
  expect(output).toContain("ಬೆಂಗಳೂರು ರಸ್ತೆ");
});

it("uses a bold embedded face for bold receipt labels", async () => {
  const pdf = await renderIssuedReceipt(data);
  expect(pdf.toString("latin1")).toMatch(/\/BaseFont\s+\/[^\s/]*Bold/);
  expect(pdf.toString("latin1")).toContain("NotoSansDevanagari-Bold");
  expect(pdf.toString("latin1")).toContain("NotoSansKannada-Bold");
});

it("does not open unrelated script fonts for a Hindi and Kannada receipt", async () => {
  const read = vi.spyOn(PDFDocument.prototype, "font");
  try {
    await renderIssuedReceipt(data);
    const paths = read.mock.calls.map(([path]) => String(path));
    expect(paths).not.toContain("NotoSansArabic");
    expect(paths).not.toContain("NotoSansTamil");
  } finally { read.mockRestore(); }
});

it("destroys the document when unsupported input fails validation", async () => {
  const destroy = vi.spyOn(PDFDocument.prototype, "destroy");
  try {
    await expect(renderIssuedReceipt({ ...data, memberName: "Unsupported 🦄" })).rejects.toThrow();
    expect(destroy).toHaveBeenCalled();
  } finally { destroy.mockRestore(); }
});

it("rejects and destroys a stream exceeding the PDF byte limit", async () => {
  const destroy = vi.spyOn(PDFDocument.prototype, "destroy");
  const end = vi.spyOn(PDFDocument.prototype, "end").mockImplementation(function (this: PDFKit.PDFDocument) {
    this.emit("data", Buffer.alloc(4 * 1024 * 1024 + 1));
  });
  try {
    await expect(renderIssuedReceipt(data)).rejects.toThrow("size limit");
    expect(destroy).toHaveBeenCalled();
  } finally { end.mockRestore(); destroy.mockRestore(); }
});
