import { describe, expect, it } from "vitest";
import { toSafePaise, sumPaise } from "@/lib/money/safe-paise";
import { computeTax, applyPayments } from "@/lib/money/arithmetic";
import { formatINR, parsePaise } from "@/lib/money/format";

describe("review exact paise boundaries", () => {
  it("rejects unsafe amounts and aggregate conversions rather than rounding", () => {
    expect(toSafePaise(9007199254740991n)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => toSafePaise(9007199254740993n)).toThrow(RangeError);
    expect(() => sumPaise([Number.MAX_SAFE_INTEGER, 2])).toThrow(RangeError);
    expect(() => computeTax(Number.MAX_SAFE_INTEGER + 1, 1800)).toThrow();
    expect(() => applyPayments(100, [Number.MAX_SAFE_INTEGER, 2])).toThrow(RangeError);
  });

  it("formats the last exact integer without losing fractional paise", () => {
    const formatted = formatINR(Number.MAX_SAFE_INTEGER);
    expect(formatted).toBe("₹9,00,71,99,25,47,409.91");
    expect(parsePaise(formatted)).toBe(Number.MAX_SAFE_INTEGER);
    expect(formatINR(9007199254740993n)).toBe("₹9,00,71,99,25,47,409.93");
    expect(() => parsePaise("₹9,00,71,99,25,47,409.93")).toThrow(RangeError);
  });
});
