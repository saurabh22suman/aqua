import { describe, expect, it } from "vitest";
import { formatINR, formatINRWhole } from "@/lib/money/format";

describe("whole-rupee Owner summaries", () => {
  it.each([
    [0, "₹0"],
    [49, "Under ₹1"],
    [50, "₹1"],
    [5_820_650, "₹58,207"],
    [5_805_650, "₹58,057"],
    [12_345_650, "₹1,23,457"],
  ])("rounds %s integer paise for display", (paise, expected) => {
    expect(formatINRWhole(paise)).toBe(expected);
  });

  it("keeps an exact whole-rupee integer after rounding bigint paise", () => {
    expect(formatINRWhole(900_719_925_474_099_250n)).toBe("₹9,00,71,99,25,47,40,993");
  });

  it("preserves the exact invoice formatter", () => {
    expect(formatINR(5_820_650)).toBe("₹58,206.50");
  });
});
