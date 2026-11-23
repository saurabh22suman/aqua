import { describe, expect, it } from "vitest";
import * as facilities from "@/lib/facility";
import * as ownerTerms from "@/lib/terminology/owner-terms";
import { resolveTerm, type TerminologyState } from "@/lib/terminology/keys";

const site = "11111111-1111-4111-8111-111111111111";
type Resolver = (input: { facility?: string | null; location?: string | null; cookie?: string | null }) => { valid: boolean; facilityId: string | undefined };
const requested = () => (facilities as unknown as { resolveRequestedFacility?: Resolver }).resolveRequestedFacility;
type TermMapper = (state: TerminologyState) => TerminologyState;
const mapTerms = () => (ownerTerms as unknown as { ownerTerminology?: TermMapper }).ownerTerminology;

describe("coordinated owner presentation contracts", () => {
  it("prioritises explicit scope without widening invalid values", () => {
    expect(requested()?.({ facility: "all", cookie: site })).toEqual({ valid: true, facilityId: undefined });
    expect(requested()?.({ facility: "bad", location: site, cookie: site })).toEqual({ valid: false, facilityId: undefined });
    expect(requested()?.({ facility: site, location: "invalid", cookie: "invalid" })).toEqual({ valid: true, facilityId: site });
    expect(requested()?.({ facility: "", cookie: site })).toEqual({ valid: false, facilityId: undefined });
    expect(requested()?.({ location: "", cookie: site })).toEqual({ valid: true, facilityId: undefined });
    expect(requested()?.({ location: site, cookie: "invalid" })).toEqual({ valid: true, facilityId: site });
    expect(requested()?.({ cookie: site })).toEqual({ valid: true, facilityId: site });
    expect(requested()?.({ cookie: "bad" })).toEqual({ valid: false, facilityId: undefined });
    expect(requested()?.({})).toEqual({ valid: true, facilityId: undefined });
  });
  it("uses owner defaults while preserving other overrides and input", () => {
    const input: TerminologyState = { locale: "en", overrides: {
      member: { en: { one: "swimmer", other: "swimmers" } },
      coach: { en: { one: "instructor", other: "instructors" } },
    } };
    const result = mapTerms()?.(input);
    expect(result && resolveTerm(result, "member", "other")).toBe("members");
    expect(result && resolveTerm(result, "coach", "other")).toBe("instructors");
    expect(resolveTerm(input, "member", "other")).toBe("swimmers");
  });
});
