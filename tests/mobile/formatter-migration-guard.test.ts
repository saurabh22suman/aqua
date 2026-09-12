import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 3 (mobile UX plan v2) — one display formatter for dates/times.
//
// The audit found ~10 ad-hoc formatters with inconsistent zones and
// clock conventions; the worst shipped production times 5h30 off the
// wall (coach home used toLocaleTimeString without a timeZone under a
// UTC server). lib/time/tz.ts is the single home. This is the
// mechanical guard: every display surface either imports the helpers
// or fails here.

const ROOT = process.cwd();

const MIGRATED_FILES = [
  "app/(coach)/coach/page.tsx",
  "app/(coach)/coach/schedule/page.tsx",
  "app/(coach)/coach/register/[sessionId]/page.tsx",
  "app/(reception)/reception/page.tsx",
  "app/(reception)/reception/members/[memberId]/page.tsx",
  "app/(owner)/owner/members/[memberId]/page.tsx",
  "app/p/[token]/route.ts",
  "lib/hooks/use-offline-register.ts",
];

const UTC_DISPLAY_REGEX = /getUTCHours\(|getUTCMinutes\(/;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("display formatters live in lib/time/tz (Phase 3)", () => {
  it("every migrated surface imports the shared helpers", () => {
    const missing: string[] = [];
    for (const rel of MIGRATED_FILES) {
      const src = read(rel);
      if (!src.includes('from "@/lib/time/tz"')) missing.push(rel);
    }
    expect(
      missing,
      `these files still format dates/times locally:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("no app/ or components/ file formats a time via UTC getters", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const full = join(ROOT, dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) walk(join(dir, entry));
        else if (/\.(ts|tsx)$/.test(entry)) {
          if (UTC_DISPLAY_REGEX.test(readFileSync(full, "utf8"))) {
            hits.push(join(dir, entry));
          }
        }
      }
    };
    walk("app");
    walk("components");
    expect(hits, `UTC getters still used for display formatting:\n${hits.join("\n")}`).toEqual([]);
  });

  it("spot-checks the scanner catches a planted violation", () => {
    expect(UTC_DISPLAY_REGEX.test("const h = d.getUTCHours();")).toBe(true);
    expect(UTC_DISPLAY_REGEX.test("const h = d.getHours();")).toBe(false);
  });
});
