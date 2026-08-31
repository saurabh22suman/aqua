import { describe, expect, it } from "vitest";
import { createMemberSchema } from "@/lib/schemas";

// C-05: date_of_birth mandatory for member creation, enforced at the
// Zod boundary (not just createMember's TypeScript signature, which
// only protects callers already inside the type system) -- this is
// the layer a Server Action's raw request body actually goes through.
describe("createMemberSchema — C-05 requirements", () => {
  const base = {
    fullName: "Someone",
    locationId: "01a04eaa-48ca-7338-a5bf-8da56af8f968",
    memberCode: "SCH-001",
    consents: [
      {
        purpose: "processing" as const,
        policyVersion: "2026.1",
        evidence: { channel: "web-form" },
      },
    ],
  };

  it("rejects a missing dateOfBirth", () => {
    const result = createMemberSchema.safeParse(base);
    expect(result.success).toBe(false);
  });

  it("rejects an empty consents array", () => {
    const result = createMemberSchema.safeParse({
      ...base,
      dateOfBirth: "1990-01-01",
      consents: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid adult self-consent payload, no guardian required", () => {
    const result = createMemberSchema.safeParse({
      ...base,
      dateOfBirth: "1990-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid minor payload with a new guardian", () => {
    const result = createMemberSchema.safeParse({
      ...base,
      dateOfBirth: "2015-01-01",
      guardian: { fullName: "A Guardian", relationship: "mother" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid minor payload with an existing guardian by id", () => {
    const result = createMemberSchema.safeParse({
      ...base,
      dateOfBirth: "2015-01-01",
      guardian: {
        existingPersonId: "01a04eaa-48ca-7338-a5bf-8da56af8f968",
        relationship: "father",
      },
    });
    expect(result.success).toBe(true);
  });

  it("strips an unrecognised field rather than letting it silently pass through (e.g. a spoofed isMinor flag)", () => {
    const result = createMemberSchema.safeParse({
      ...base,
      dateOfBirth: "2015-01-01",
      guardian: { fullName: "A Guardian", relationship: "mother" },
      isMinor: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("isMinor" in result.data).toBe(false);
    }
  });
});
