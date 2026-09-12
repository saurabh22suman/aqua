import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 3 (mobile UX plan v2) — F18 follow-up. The existing
// vocab-source-scan only sees JSX text between > and <, so plural
// headings ("Members") and prop strings escaped it. This guard pins
// the specific leaks the audit found and requires the files to route
// through resolveTerm.

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const BANNED: { file: string; literals: string[] }[] = [
  {
    file: "app/(owner)/owner/members/page.tsx",
    literals: [">Members<", ">Members<"],
  },
  {
    file: "app/(coach)/coach/members/page.tsx",
    literals: [">Members<", "No members in your batches yet", "Members appear here once"],
  },
  {
    file: "components/members-board.tsx",
    literals: [
      "No members match.",
      "No members yet.",
      "Add your first member",
    ],
  },
];

describe("member vocabulary is resolved, never hardcoded (F18)", () => {
  it("has no hardcoded plural member copy in the three surfaces", () => {
    const hits: string[] = [];
    for (const { file, literals } of BANNED) {
      const src = read(file);
      for (const literal of literals) {
        if (src.includes(literal)) hits.push(`${file}: ${literal}`);
      }
    }
    expect(hits, `hardcoded member vocabulary:\n${hits.join("\n")}`).toEqual([]);
  });

  it("routes the copy through resolveTerm / terminology", () => {
    const missing: string[] = [];
    for (const { file } of BANNED) {
      const src = read(file);
      if (!src.includes("resolveTerm")) missing.push(file);
    }
    if (!read("app/(owner)/owner/members/page.tsx").includes("getTerminologyAction")) {
      missing.push("app/(owner)/owner/members/page.tsx (no terminology fetch)");
    }
    expect(missing, `not using resolveTerm:\n${missing.join("\n")}`).toEqual([]);
  });
});
