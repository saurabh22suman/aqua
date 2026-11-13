import { expect, it } from "vitest";
import { createMemberSchema } from "@/lib/schemas";
import { isOptionalContactPhoneValid } from "@/lib/contact-phone";

const phone = createMemberSchema.shape.phone;
it.each([
  ["", true, undefined], [" 9876543210 ", true, "+919876543210"],
  ["+1 (202) 555-0123", true, "+12025550123"], ["+0123456789", false, undefined],
  ["98765.43210", false, undefined], ["+919876543210123456789", false, undefined],
  ["   ", false, undefined],
] as const)("preserves server contact validation for %j", (input, valid, normalized) => {
  const result = phone.safeParse(input);
  expect(result.success).toBe(valid);
  if (result.success) expect(result.data).toBe(normalized);
  for (const role of ["member", "guardian"]) {
    expect(isOptionalContactPhoneValid(input), role).toBe(phone.safeParse(input.trim()).success);
  }
});
