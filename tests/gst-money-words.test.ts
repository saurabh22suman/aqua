import { describe, expect, it } from "vitest";
import {
  GSTIN_RE,
  gstDocumentKind,
  gstDocumentLabel,
  gstinStateCode,
  isValidGstin,
  placeOfSupplyForGstin,
  splitIntraStateTax,
} from "@/lib/gst";
import { amountInWords } from "@/lib/money/words";

// C-32/C-39 — the India-specific pure helpers: GSTIN shape, document
// kind (tax invoice vs bill of supply), the intra-state CGST/SGST
// split, and amount-in-words with lakh/crore grouping.

describe("GSTIN shape and derived state", () => {
  it("accepts a well-formed GSTIN", () => {
    expect(isValidGstin("27ABCDE1234F1Z5")).toBe(true);
    expect(GSTIN_RE.test("27ABCDE1234F1Z5")).toBe(true);
  });

  it("rejects malformed GSTINs", () => {
    expect(isValidGstin("27abcde1234f1z5")).toBe(false); // lowercase
    expect(isValidGstin("27ABCDE1234F1A5")).toBe(false); // 14th char not Z
    expect(isValidGstin("27ABCDE1234F1Z")).toBe(false); // too short
    expect(isValidGstin("")).toBe(false);
  });

  it("derives the state code and place of supply", () => {
    expect(gstinStateCode("27ABCDE1234F1Z5")).toBe("27");
    expect(placeOfSupplyForGstin("27ABCDE1234F1Z5")).toBe(
      "Maharashtra (27)",
    );
    expect(placeOfSupplyForGstin("33ABCDE1234F1Z5")).toBe("Tamil Nadu (33)");
    expect(placeOfSupplyForGstin(null)).toBeNull();
  });
});

describe("document kind", () => {
  it("is a tax invoice only when a GSTIN exists", () => {
    expect(gstDocumentKind("27ABCDE1234F1Z5")).toBe("tax_invoice");
    expect(gstDocumentKind(null)).toBe("bill_of_supply");
    expect(gstDocumentLabel("tax_invoice")).toBe("Tax Invoice");
    expect(gstDocumentLabel("bill_of_supply")).toBe("Bill of Supply");
  });
});

describe("intra-state CGST/SGST split", () => {
  it("splits evenly and keeps the total exact", () => {
    expect(splitIntraStateTax(45000)).toEqual({
      cgstPaise: 22500,
      sgstPaise: 22500,
    });
  });

  it("gives the odd paise to SGST so the halves sum to the tax", () => {
    expect(splitIntraStateTax(1001)).toEqual({
      cgstPaise: 500,
      sgstPaise: 501,
    });
    expect(splitIntraStateTax(1)).toEqual({ cgstPaise: 0, sgstPaise: 1 });
  });

  it("handles zero", () => {
    expect(splitIntraStateTax(0)).toEqual({ cgstPaise: 0, sgstPaise: 0 });
  });
});

describe("amount in words (Indian grouping)", () => {
  it("prints plain rupee amounts", () => {
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(250000)).toBe("Rupees Two Thousand Five Hundred Only");
    expect(amountInWords(100)).toBe("Rupees One Only");
  });

  it("prints paise after 'and'", () => {
    expect(amountInWords(250050)).toBe(
      "Rupees Two Thousand Five Hundred and Fifty Paise Only",
    );
    expect(amountInWords(105)).toBe("Rupees One and Five Paise Only");
  });

  it("uses lakh and crore grouping", () => {
    // ₹2,50,000 = 25,000,000 paise.
    expect(amountInWords(25_000_000)).toBe(
      "Rupees Two Lakh Fifty Thousand Only",
    );
    // ₹1,23,45,678 = 1,234,567,800 paise.
    expect(amountInWords(1_234_567_800)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only",
    );
  });
});
