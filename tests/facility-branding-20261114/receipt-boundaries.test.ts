import { describe, expect, it } from "vitest";
import { receiptIssuer } from "@/lib/receipts/issuer-snapshot";
import { renderPdfPages } from "@/lib/receipts/pdf";

const snapshot = {
  issuerSnapshotVersion: 1,
  issuerLegalName: "Synthetic Supplier",
  issuerLegalAddress: { line1: "Road 11", line2: null, city: "Mumbai", postalCode: "400001" },
  issuerStateCode: "27", issuerRegistrationMode: "registered", gstin: "27ABCDE1234F1Z5",
};

describe("Saved issuer rendering boundaries (supplementary)", () => {
  it("rejects incomplete, unknown-version and state/mode inconsistent snapshots", () => {
    for (const input of [
      { ...snapshot, issuerLegalAddress: {} },
      { ...snapshot, issuerSnapshotVersion: 2 },
      { ...snapshot, issuerStateCode: "29" },
      { ...snapshot, issuerRegistrationMode: "unregistered" },
      { ...snapshot, gstin: null },
    ]) expect(() => receiptIssuer(input)).toThrow();
  });

  it("supports an explicitly unregistered saved issuer and preserves the legacy null path", () => {
    expect(receiptIssuer({ ...snapshot, gstin: null, issuerRegistrationMode: "unregistered" })?.gstin).toBeNull();
    expect(receiptIssuer({ ...snapshot, issuerSnapshotVersion: 0 })).toBeNull();
    expect(receiptIssuer(snapshot)?.legalName).toBe("Synthetic Supplier");
  });

  it("writes deterministic multipage xrefs and correct stream/page references", () => {
    const pages = [[{ kind: "text" as const, x: 48, y: 700, size: 9, text: "Page one" }],
      [{ kind: "text" as const, x: 48, y: 700, size: 9, text: "Page two" }]];
    const pdf = renderPdfPages(pages);
    expect(renderPdfPages(pages).equals(pdf)).toBe(true);
    const text = pdf.toString("latin1");
    expect(text).toContain("/Kids [5 0 R 7 0 R] /Count 2");
    expect(text).toContain("/Contents 6 0 R");
    expect(text).toContain("/Contents 8 0 R");
    const xref = text.slice(text.indexOf("xref\n0 ")).split("\n")
      .filter((line) => /^\d{10} 00000 n/.test(line));
    expect(xref).toHaveLength(8);
    xref.forEach((line, index) => expect(text.slice(Number(line.slice(0, 10))).startsWith(`${index + 1} 0 obj\n`)).toBe(true));
  });
});
