import { describe, expect, it } from "vitest";
import { normaliseToE164, phoneDigits } from "@/lib/phone";

// L1 / M2 — canonical phone normalisation. The seed stores
// users.phone in +91XXXXXXXXXX form; better-auth hands raw phone
// in 91XXXXXXXXXX form (its phone plugin strips the leading +).
// linkBetterAuthUser must canonicalise at the write boundary so
// the seed row and the auth callback target the same key. Tests
// pin every shape the codebase, the runbook, and the auth library
// could hand the helper.

describe("normaliseToE164", () => {
  it("passes through E.164 with leading + unchanged", () => {
    expect(normaliseToE164("+919000000001")).toBe("+919000000001");
    expect(normaliseToE164("+919876543210")).toBe("+919876543210");
  });

  it("prepends +91 to a 10-digit Indian local number", () => {
    expect(normaliseToE164("9000000001")).toBe("+919000000001");
    expect(normaliseToE164("9876543210")).toBe("+919876543210");
  });

  it("converts 91XXXXXXXXXX (no +) to +91XXXXXXXXXX", () => {
    expect(normaliseToE164("919000000001")).toBe("+919000000001");
    expect(normaliseToE164("919876543210")).toBe("+919876543210");
  });

  it("strips a leading 0 and prepends +91", () => {
    expect(normaliseToE164("09000000001")).toBe("+919000000001");
  });

  it("strips spaces, hyphens, and parentheses before parsing", () => {
    expect(normaliseToE164("+91 90000 00001")).toBe("+919000000001");
    expect(normaliseToE164("90000-00001")).toBe("+919000000001");
    expect(normaliseToE164("(+91) 9000000001")).toBe("+919000000001");
  });

  it("passes through unknown shapes unchanged for caller-Zod to surface", () => {
    // Pure-noise strings fall through (after whitespace/hyphen
    // stripping). The Zod regex in callers will reject these.
    expect(normaliseToE164("notaphone")).toBe("notaphone");
    expect(normaliseToE164("+")).toBe("+");
  });
});

describe("phoneDigits", () => {
  it("strips all non-digit characters", () => {
    expect(phoneDigits("+919000000001")).toBe("919000000001");
    expect(phoneDigits("919000000001")).toBe("919000000001");
    expect(phoneDigits("90000-00001")).toBe("9000000001");
    expect(phoneDigits("(+91) 90000 00001")).toBe("919000000001");
  });
});
