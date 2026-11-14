import { expect, it } from "vitest";
import { createMemberSchema } from "@/lib/schemas";

it("normalizes a supplied Indian contact to E.164 without changing optionality", () => {
  const result = createMemberSchema.parse({ fullName: "Synthetic", phone: "98765 43210", dateOfBirth: "2000-01-01", locationId: "00000000-0000-4000-8000-000000000001", memberCode: "X", consents: [{ purpose: "processing", policyVersion: "1", evidence: { channel: "test" } }] });
  expect(result.phone).toBe("+919876543210");
});
