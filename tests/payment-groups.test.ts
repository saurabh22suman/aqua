import { describe, expect, it } from "vitest";
import {
  GROUP_LABEL,
  GROUP_METHODS,
  PAYMENT_GROUPS,
  PAYMENT_METHODS,
  groupLabel,
  isPaymentGroup,
  isPaymentMethod,
  methodGroup,
  methodsForGroup,
} from "@/lib/money/payment-groups";

describe("payment groups — the owner's three buckets", () => {
  it("maps cash, digital and other without folding Other into Digital", () => {
    expect(methodGroup("cash")).toBe("cash");
    expect(methodGroup("upi")).toBe("digital");
    expect(methodGroup("bank_transfer")).toBe("digital");
    expect(methodGroup("card")).toBe("digital");
    expect(methodGroup("other")).toBe("other");
    // An unknown value is not digital either.
    expect(methodGroup("cheque")).toBe("other");
  });

  it("keeps the closed method set and its group split consistent", () => {
    expect([...PAYMENT_METHODS]).toEqual([
      "cash",
      "upi",
      "bank_transfer",
      "card",
      "other",
    ]);
    expect([...GROUP_METHODS.digital]).toEqual(["upi", "bank_transfer", "card"]);
    expect([...GROUP_METHODS.cash]).toEqual(["cash"]);
    expect([...GROUP_METHODS.other]).toEqual(["other"]);
    // Every method belongs to exactly one group.
    for (const method of PAYMENT_METHODS) {
      const groups = PAYMENT_GROUPS.filter((group) =>
        methodsForGroup(group).includes(method),
      );
      expect(groups, method).toHaveLength(1);
    }
  });

  it("labels the same groups the filter uses", () => {
    expect(GROUP_LABEL.digital).toBe("Digital");
    expect(groupLabel("digital")).toBe("Digital");
    expect(isPaymentGroup("digital")).toBe(true);
    expect(isPaymentGroup("upi")).toBe(false);
    expect(isPaymentMethod("bank_transfer")).toBe(true);
    expect(isPaymentMethod("card_terminal")).toBe(false);
  });
});
