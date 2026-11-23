import { expect, it } from "vitest";
import { billingAddressSchema } from "@/lib/services/facility-billing-contract";

it("rejects a postal PIN starting with zero", () => {
  expect(billingAddressSchema.safeParse({ line1: "Road", line2: null, city: "City", postalCode: "000000" }).success).toBe(false);
  expect(billingAddressSchema.safeParse({ line1: "Road", line2: null, city: "City", postalCode: "560001" }).success).toBe(true);
});
