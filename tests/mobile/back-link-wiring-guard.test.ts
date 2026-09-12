import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 4 (mobile UX plan v2) — F13 wiring. Every detail page that a
// thumb-back gesture can't be trusted to cover must render BackLink.
// Five pages were missing one; two settings pages had a hand-rolled
// copy. This guard fails if one drifts back to a bespoke link.

const ROOT = process.cwd();

const PAGES = [
  "app/(owner)/owner/members/[memberId]/page.tsx",
  "app/(owner)/owner/enquiries/[enquiryId]/page.tsx",
  "app/(owner)/owner/sessions/page.tsx",
  "app/(coach)/coach/members/[memberId]/page.tsx",
  "app/(reception)/reception/enquiries/[enquiryId]/page.tsx",
  "app/(owner)/owner/settings/branding/page.tsx",
  "app/(owner)/owner/settings/terminology/page.tsx",
];

describe("BackLink wiring (F13)", () => {
  it("every listed page imports and renders BackLink", () => {
    const missing: string[] = [];
    for (const rel of PAGES) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      if (!src.includes("@/components/ui/BackLink")) missing.push(rel);
    }
    expect(missing, `pages without BackLink:\n${missing.join("\n")}`).toEqual([]);
  });
});
