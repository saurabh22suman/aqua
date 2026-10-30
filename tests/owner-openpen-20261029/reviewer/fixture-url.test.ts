import { describe, expect, it } from "vitest";
import {
  interpolateUrl,
  normaliseFixtureValue,
  unresolvedParams,
} from "./capture-owner";

// The old resolver stored the captured href, so a template like
// /owner/members/{memberId} became /owner/members//owner/members/<uuid>.
// These are assertion-level RED cases; importing the driver must not run main().
const ID = "01a184db-58e1-76cd-8233-2904f52af0f7";

const CASES: Array<[string, string, string]> = [
  ["memberId", `/owner/members/${ID}`, `/owner/members/${ID}`],
  ["memberId", `/owner/members/${ID}/edit`, `/owner/members/${ID}/edit`],
  ["batchId", `/owner/batches/${ID}`, `/owner/batches/${ID}`],
  ["enquiryId", `/owner/enquiries/${ID}`, `/owner/enquiries/${ID}`],
  ["staffId", `/owner/staff/${ID}`, `/owner/staff/${ID}`],
];

describe("captured fixture URL normalisation", () => {
  it("keeps one valid UUID segment for member, edit, batch, enquiry and staff templates", () => {
    for (const [key, captured, expected] of CASES) {
      expect(
        interpolateUrl(expected.replace(ID, `{${key}}`), { [key]: captured }),
      ).toBe(expected);
    }
  });

  it("preserves an explicit full path when a baseline caller uses the Path token alone", () => {
    expect(
      interpolateUrl("{memberIdPath}", {
        memberIdPath: `/owner/members/${ID}`,
      }),
    ).toBe(`/owner/members/${ID}`);
  });

  it("rejects invalid or missing fixture values and treats them as blocked", () => {
    expect(normaliseFixtureValue("not-a-uuid")).toBeNull();
    expect(normaliseFixtureValue("/owner/members/not-a-uuid")).toBeNull();
    expect(normaliseFixtureValue(null)).toBeNull();
    expect(
      unresolvedParams("/owner/members/{memberId}", { memberId: null }),
    ).toEqual(["memberId"]);
  });

  it("keeps the old full-href resolver value safe at the final boundary", () => {
    expect(
      unresolvedParams("/owner/members/{memberId}", {
        memberId: `/owner/members/${ID}`,
      }),
    ).toEqual([]);
    expect(
      unresolvedParams("/owner/members/{memberId}", {
        memberId: "/owner/members/not-a-uuid",
      }),
    ).toEqual(["memberId"]);
    expect(
      unresolvedParams("/owner/members/{memberIdPath}", {
        memberIdPath: `/owner/members/${ID}`,
      }),
    ).toEqual([]);
  });
});
