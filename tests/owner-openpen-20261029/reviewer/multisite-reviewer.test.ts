import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The multi-branch reviewer must be a DURABLE artifact with two
// corrections over the throwaway driver it replaces.
//
//   1. The member evidence is derived. The old driver asserted a
//      hardcoded member name ("Aaradhya Sharma") that is not the first
//      member of the first branch ("Aadhya Sharma"), so every
//      branch-A assertion was wrong before it was run.
//   2. The option is chosen from the OPEN NAMED LISTBOX. The shared
//      Select is the native `<select>` PLUS the custom popup, so a
//      page-level `getByRole("option")` matches the native options and
//      the popup's options at once.
//
// The fixture is passed in explicitly and holds ids only: the reviewer
// must not name a real tenant, branch or database in code.
//
// The app's Select and its data are untouched by this suite — the
// reviewer reads the real control, it does not change it.

const REVIEWER = join(
  process.cwd(),
  "tests/owner-openpen-20261029/reviewer/multisite-chrome.ts",
);

function source(): string {
  if (!existsSync(REVIEWER)) return "";
  return readFileSync(REVIEWER, "utf8");
}

describe("the durable multi-branch reviewer", () => {
  it("exists as a reviewer artifact", () => {
    expect(
      existsSync(REVIEWER),
      "tests/owner-openpen-20261029/reviewer/multisite-chrome.ts must exist",
    ).toBe(true);
  });

  it("never names a member in code", () => {
    const text = source();
    expect(text).not.toContain("Aaradhya");
    expect(text).not.toContain("Aadhya Sharma");
  });

  it("derives the member evidence from the rendered list", () => {
    const text = source();
    expect(text).toContain('data-testid="member-row-name"');
  });

  it("chooses the option inside the control's own named listbox", () => {
    const text = source();
    expect(text).toContain('getByRole("listbox"');
    expect(text).toContain("Facility options");
    // The page-level option lookup is the mistake: it matches the
    // native options too.
    expect(text).not.toMatch(/page\.getByRole\("option"/);
  });

  it("takes the fixture path from the environment, not from code", () => {
    const text = source();
    expect(text).toContain("AQUA_MULTISITE_FIXTURE");
    expect(text).not.toContain("multisite-fixture.json");
    expect(text).not.toContain("aqua_test_b82f77fe39");
  });

  it("keeps the journey it was asked to keep", () => {
    const text = source();
    for (const check of [
      "initial-all-branches",
      "initial-member-present",
      "branch-b-control-matches-url",
      "branch-b-empty-not-other-branch-records",
      "branch-a-records-return",
      "back-syncs-control-and-records",
      "cookie-follows-branch",
      "explicit-url-wins-over-cookie",
      "reload-preserves-explicit-url",
      "all-clears-url-and-cookie",
      "all-restores-consolidated-records",
      "bookings-lists-venues-from-both-branches",
    ]) {
      expect(text).toContain(check);
    }
  });
});
