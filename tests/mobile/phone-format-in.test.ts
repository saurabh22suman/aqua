import { describe, expect, it } from "vitest";
import { formatPhoneIN } from "@/lib/phone";

// Phase 3 (mobile UX plan v2) — Indian display format for the phone
// numbers the app shows. Storage is free text (persons.phone) with a
// mix of E.164 and 10-digit local rows (people-screens.test.ts pins
// local storage as legal), so the formatter must understand both and
// pass anything it doesn't recognise through unchanged.
//
// Display-only: never feed the output back into a write.

describe("formatPhoneIN", () => {
  it("formats E.164 Indian numbers as +91 98123 40010 (5+5)", () => {
    expect(formatPhoneIN("+919812340010")).toBe("+91 98123 40010");
  });

  it("formats 91-prefixed numbers without the plus", () => {
    expect(formatPhoneIN("919812340010")).toBe("+91 98123 40010");
  });

  it("formats 10-digit local mobiles", () => {
    expect(formatPhoneIN("9812340010")).toBe("+91 98123 40010");
    expect(formatPhoneIN("9876500001")).toBe("+91 98765 00001");
  });

  it("strips a leading trunk 0", () => {
    expect(formatPhoneIN("09812340010")).toBe("+91 98123 40010");
  });

  it("normalises already-spaced input", () => {
    expect(formatPhoneIN("+91 98123 40010")).toBe("+91 98123 40010");
    expect(formatPhoneIN("98123-40010")).toBe("+91 98123 40010");
  });

  it("passes unknown shapes through unchanged", () => {
    expect(formatPhoneIN("+14155552671")).toBe("+14155552671");
    expect(formatPhoneIN("1234567890")).toBe("1234567890");
    expect(formatPhoneIN("notaphone")).toBe("notaphone");
  });

  it("returns empty string for missing values", () => {
    expect(formatPhoneIN(null)).toBe("");
    expect(formatPhoneIN(undefined)).toBe("");
    expect(formatPhoneIN("")).toBe("");
  });
});
