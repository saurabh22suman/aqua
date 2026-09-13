import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// F-3 (2026-09-13 Indian-user UX audit) — vocabulary on route handlers.
//
// The L3 vocab source-scan (tests/tier1/vocab-source-scan.test.ts) only
// reads `.tsx` files, so `app/p/[token]/route.ts` — which hand-builds
// its HTML as strings to ship zero client JavaScript — escaped it and
// shipped hardcoded "Member view" / "Member" / "Next session" labels
// while every React surface resolved the tenant's vocabulary.
//
// This is the route-handler half of that scan. It is deliberately
// outside tests/tier1 (agents must not write there). It reads every
// `app/**/route.ts`, matches vocab words inside `>text<` HTML runs
// (the same narrow rule as the L3 scan), and pins the parent route's
// use of the closed-key resolver.
//
// Route handlers currently in the tree that serve no user prose
// (JSON/CSV endpoints) simply produce no matches. If a future route
// handler renders HTML with a hardcoded vocab word, this fails.
//
// Vocab set copied from lib/terminology/keys.ts + the swim preset's
// overrides (the same inline-list reasoning as the L3 scan: keep the
// check structural rather than coupled to the preset engine).
const TERM_KEYS = [
  "member",
  "batch",
  "coach",
  "session",
  "program",
  "facility",
  "guardian",
  "enquiry",
];
const SWIM_OVERRIDES = ["swimmer", "swimmers", "lane", "lanes"];
const ALL_VOCAB = [...TERM_KEYS, ...SWIM_OVERRIDES];

const HTML_TEXT_VOCAB_REGEX = new RegExp(
  `>([^<>]*\\b(${ALL_VOCAB.join("|")})\\b[^<>]*)<`,
  "i",
);

const ROOT = process.cwd();

function listRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listRouteFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

function relativePath(filePath: string): string {
  return filePath.startsWith(ROOT + "/")
    ? filePath.slice(ROOT.length + 1)
    : filePath;
}

function findHardcodedVocabInRouteHtml(): {
  path: string;
  line: number;
  text: string;
}[] {
  const out: { path: string; line: number; text: string }[] = [];
  for (const file of listRouteFiles(join(ROOT, "app"))) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // JSX/TS interpolation and object literals: a vocab word there
      // is an identifier or a resolved value, not hardcoded prose.
      if (line.includes("{") || line.includes("}")) continue;
      HTML_TEXT_VOCAB_REGEX.lastIndex = 0;
      if (!HTML_TEXT_VOCAB_REGEX.test(line)) continue;
      out.push({ path: relativePath(file), line: i + 1, text: line.trim() });
    }
  }
  return out;
}

describe("vocab on route handlers is resolved, not hardcoded (F-3)", () => {
  it("finds zero hardcoded vocab words in app/**/route.ts HTML text", () => {
    const violations = findHardcodedVocabInRouteHtml();
    if (violations.length > 0) {
      const formatted = violations
        .map((v) => `  ${v.path}:${v.line}\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `Hardcoded vocabulary found in route-handler HTML (route it through resolveTerm):\n${formatted}\n\n` +
          `Route handlers hand-build HTML strings, so they bypass the JSX-only L3 scan.\n` +
          `Resolve the tenant's term server-side and interpolate the string.`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  const parentRoute = readFileSync(
    join(ROOT, "app", "p", "[token]", "route.ts"),
    "utf8",
  );

  it("parent route resolves the member and session terms", () => {
    expect(parentRoute).toMatch(/resolveTerm\(terminology,\s*"member"/);
    expect(parentRoute).toMatch(/resolveTerm\(terminology,\s*"session"/);
  });

  it("parent route carries no hardcoded Member / session labels", () => {
    expect(parentRoute).not.toMatch(/>Member(\s+view)?</);
    expect(parentRoute).not.toMatch(/>Next session</);
    expect(parentRoute).not.toMatch(/>No upcoming sessions scheduled\.</);
  });
});
