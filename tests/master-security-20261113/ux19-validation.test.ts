import { afterEach, describe, expect, it, vi } from "vitest";
import { bookTrialSchema, createMemberSchema, updateMemberSchema } from "@/lib/schemas";

const base = {
  fullName: "Synthetic member",
  dateOfBirth: "2000-01-01",
  locationId: "00000000-0000-4000-8000-000000000001",
  memberCode: "TEST",
  consents: [{ purpose: "processing" as const, policyVersion: "1", evidence: { channel: "test" } }],
};

afterEach(() => vi.useRealTimers());

describe("UX19 member entry validation", () => {
  it("uses the current IST calendar day, including across the UTC boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T19:00:00Z")); // Nov 13 in India
    expect(createMemberSchema.safeParse({ ...base, dateOfBirth: "2026-11-13" }).success).toBe(true);
    expect(createMemberSchema.safeParse({ ...base, dateOfBirth: "2026-11-14" }).success).toBe(false);
    expect(updateMemberSchema.safeParse({ memberId: base.locationId, dateOfBirth: "2026-11-14" }).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...base, dateOfBirth: "2026-02-30" }).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...base, dateOfBirth: "2024-02-29" }).success).toBe(true);
  });

  it("accepts absent phone and supported numbers but rejects letters and excessive length", () => {
    expect(createMemberSchema.safeParse(base).success).toBe(true);
    expect(createMemberSchema.safeParse({ ...base, phone: "9876543210" }).success).toBe(true);
    expect(createMemberSchema.safeParse({ ...base, phone: "+442079460123" }).success).toBe(true);
    expect(createMemberSchema.safeParse({ ...base, phone: "abcdefgh" }).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...base, phone: "+12345678901234567890" }).success).toBe(false);
  });

  it("rejects future birth dates on the enquiry-to-trial path", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T19:00:00Z"));
    const result = bookTrialSchema.safeParse({
      enquiryId: base.locationId,
      batchId: base.locationId,
      details: { dateOfBirth: "2026-11-14", locationId: base.locationId, consents: base.consents },
    });
    expect(result.success).toBe(false);
  });

  it("treats an empty optional contact as absent", () => {
    const result = createMemberSchema.safeParse({ ...base, phone: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBeUndefined();
  });
});
