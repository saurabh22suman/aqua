import { describe, expect, it } from "vitest";
import {
  buildUpiUri,
  formatPaiseForUpi,
  parseRupeesToPaise,
} from "@/lib/payment-qr";

// C-35/C-37 — pure payment-QR helpers. The amount path is bigint paise
// end to end; these are the exact strings a UPI app receives.

describe("formatPaiseForUpi", () => {
  it("formats paise as rupees with two decimals, without floats", () => {
    expect(formatPaiseForUpi(0n)).toBe("0.00");
    expect(formatPaiseForUpi(1n)).toBe("0.01");
    expect(formatPaiseForUpi(99n)).toBe("0.99");
    expect(formatPaiseForUpi(100n)).toBe("1.00");
    expect(formatPaiseForUpi(250000n)).toBe("2500.00");
    expect(formatPaiseForUpi(123456n)).toBe("1234.56");
  });

  it("refuses a negative amount", () => {
    expect(() => formatPaiseForUpi(-1n)).toThrow();
  });
});

describe("buildUpiUri", () => {
  it("builds the standard payload without an amount", () => {
    expect(
      buildUpiUri({ upiId: "club@okhdfcbank", payeeName: "Sharma Sports" }),
    ).toBe("upi://pay?pa=club@okhdfcbank&pn=Sharma%20Sports&cu=INR");
  });

  it("includes the amount when given, from bigint paise", () => {
    expect(
      buildUpiUri(
        { upiId: "club@okhdfcbank", payeeName: "Sharma Sports" },
        250000n,
      ),
    ).toBe(
      "upi://pay?pa=club@okhdfcbank&pn=Sharma%20Sports&cu=INR&am=2500.00",
    );
    expect(buildUpiUri({ upiId: "a@b", payeeName: "X" }, 1n)).toBe(
      "upi://pay?pa=a@b&pn=X&cu=INR&am=0.01",
    );
  });
});

describe("parseRupeesToPaise", () => {
  it("accepts clean rupee amounts", () => {
    expect(parseRupeesToPaise("2500")).toBe(250000n);
    expect(parseRupeesToPaise("2500.5")).toBe(250050n);
    expect(parseRupeesToPaise("2500.50")).toBe(250050n);
    expect(parseRupeesToPaise("0.01")).toBe(1n);
    expect(parseRupeesToPaise(" 1,200.75 ")).toBe(120075n);
  });

  it("rejects anything ambiguous or not a money amount", () => {
    expect(parseRupeesToPaise("")).toBeNull();
    expect(parseRupeesToPaise("abc")).toBeNull();
    expect(parseRupeesToPaise("12.345")).toBeNull();
    expect(parseRupeesToPaise("-5")).toBeNull();
    expect(parseRupeesToPaise("1.")).toBeNull();
    expect(parseRupeesToPaise(".5")).toBeNull();
    expect(parseRupeesToPaise("1e3")).toBeNull();
  });
});
