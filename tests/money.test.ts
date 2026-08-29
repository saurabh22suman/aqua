import { describe, expect, it } from "vitest";
import { applyPayments, computeTax, splitTotal } from "@/lib/money/arithmetic";
import { formatINR, parsePaise } from "@/lib/money/format";

// C-28. Example-based sanity tests only — NOT the Tier 1 property suite.
// tests/tier1/money-properties.test.ts (C-28a, docs/testing-strategy.md
// §2, file #4 of the 15 enumerated Tier 1 files) is human-owned; the
// agent may never write or edit it. These tests exist so this library
// has a working safety net and so TDD red/green is provable, not as a
// substitute for the 1000-run property suite.
describe("computeTax", () => {
  it("computes basis-point tax as an integer, no rounding drift for exact cases", () => {
    expect(computeTax(100000, 1800)).toBe(18000); // 18% of ₹1000.00
  });

  it("rounds half up on fractional paise", () => {
    // 100 * 1800 / 10000 = 18.00 exactly -> 18
    expect(computeTax(100, 1800)).toBe(18);
    // 1 * 1800 / 10000 = 0.18 -> rounds to 0
    expect(computeTax(1, 1800)).toBe(0);
    // 3 * 1800 / 10000 = 0.54 -> rounds to 1
    expect(computeTax(3, 1800)).toBe(1);
  });

  it("zero basis points is zero tax", () => {
    expect(computeTax(123456, 0)).toBe(0);
  });

  it("rejects a non-integer or negative base", () => {
    expect(() => computeTax(10.5, 1800)).toThrow();
    expect(() => computeTax(-100, 1800)).toThrow();
  });
});

describe("splitTotal — the inverse of computeTax", () => {
  it("recovers the exact base and tax from a GST-inclusive total", () => {
    const base = 100000;
    const bp = 1800;
    const tax = computeTax(base, bp);
    const total = base + tax;

    expect(splitTotal(total, bp)).toEqual({ base, tax });
  });

  it("base + tax always equals the original total, even where the inverse isn't exact", () => {
    // Not every total is exactly reachable by (base, bp) -> total, since
    // computeTax rounds. splitTotal must still never lose money: the
    // returned base+tax must equal the input total exactly, by
    // construction (tax is the remainder, not computed independently).
    const total = 100003;
    const bp = 733;
    const { base, tax } = splitTotal(total, bp);
    expect(base + tax).toBe(total);
  });
});

describe("applyPayments", () => {
  it("partial payments sum to paid, remainder is outstanding", () => {
    const result = applyPayments(100000, [30000, 40000]);
    expect(result).toEqual({ paid: 70000, outstanding: 30000 });
  });

  it("fully paid leaves zero outstanding", () => {
    expect(applyPayments(50000, [50000])).toEqual({ paid: 50000, outstanding: 0 });
  });

  it("overpayment clamps outstanding at zero, never negative", () => {
    const result = applyPayments(50000, [60000]);
    expect(result.outstanding).toBe(0);
    expect(result.paid).toBe(60000);
  });

  it("no payments leaves the full total outstanding", () => {
    expect(applyPayments(50000, [])).toEqual({ paid: 0, outstanding: 50000 });
  });
});

describe("formatINR", () => {
  it("formats paise as en-IN grouped rupees with two decimals", () => {
    expect(formatINR(123456789)).toBe("₹12,34,567.89");
  });

  it("formats a value under one rupee", () => {
    expect(formatINR(50)).toBe("₹0.50");
  });

  it("formats zero", () => {
    expect(formatINR(0)).toBe("₹0.00");
  });
});

describe("parsePaise — round-trips formatINR exactly", () => {
  it("parses a formatted string back to the exact paise it came from", () => {
    for (const paise of [0, 50, 100, 123456789, 999, 100000000]) {
      expect(parsePaise(formatINR(paise))).toBe(paise);
    }
  });

  it("parses without the currency symbol too", () => {
    expect(parsePaise("1,234.56")).toBe(123456);
  });

  it("rejects malformed input rather than silently truncating", () => {
    expect(() => parsePaise("not money")).toThrow();
    expect(() => parsePaise("₹1.5")).toThrow(); // not exactly 2 fractional digits
  });
});
