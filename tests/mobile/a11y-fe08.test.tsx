// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 2026-10-05 audit FE-08 — the specific remaining unnamed controls and
// undersized tap targets. Source pins, matching the PR3-C10 sweep's
// mechanical style: they fail if the attribute or size floor is
// removed again.

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("accessible names (FE-08)", () => {
  it("member search has an accessible name", () => {
    const src = source("components/members-board.tsx");
    expect(src).toMatch(/aria-label="Search members"/);
  });

  it("the enrolment batch selector has an accessible name", () => {
    const src = source("components/member-enrolment-panel.tsx");
    expect(src).toMatch(/aria-label=\{`Select \$\{resolveTerm\(terminology, "batch", 1\)\} to enrol in`\}/);
  });

  it("the void-reason input has an accessible name", () => {
    const src = source("components/member-detail/invoice-expanded.tsx");
    expect(src).toMatch(/aria-label="Reason for voiding"/);
  });
});

describe("tap targets (FE-08)", () => {
  it("the staff directory header links carry the 44px floor", () => {
    const src = source("app/(owner)/owner/staff/page.tsx");
    const links = src.match(/className="inline-flex min-h-11 items-center rounded-pill px-4 py-2/g);
    expect(links?.length).toBe(3);
  });

  it("Confirm reversal carries the 44px floor", () => {
    const src = source("components/member-detail/invoice-expanded.tsx");
    expect(src).toMatch(
      /inline-flex min-h-11 items-center justify-center rounded-pill px-3\.5 py-1\.5 text-\[12px\] font-semibold/,
    );
  });
});
