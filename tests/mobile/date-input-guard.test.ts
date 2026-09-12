import { readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 3 (mobile UX plan v2) — F17. Native date inputs default to the
// browser's locale (mm/dd/yyyy in Chrome regardless of page lang), so
// every date control carries lang="en-IN" and a dd/mm/yyyy format hint
// for older browsers. The follow-up field is datetime-local and gets
// the matching hint.

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components"];
const PLATFORM_SKIP = "/(platform)/ops/";

type Occurrence = { path: string; line: number; tag: string };

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkFiles(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

// Same tag-walking shape as tests/tier1/input-font-size.test.ts: find
// the opening <input ...> tag, skipping quoted attribute values, then
// inspect its attributes.
function dateInputsIn(text: string): { tag: string; index: number }[] {
  const out: { tag: string; index: number }[] = [];
  const tagRegex = /<input\b/g;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(text))) {
    const start = m.index;
    let i = m.index + m[0].length;
    let inDouble = false;
    let inSingle = false;
    let inBack = false;
    let braceDepth = 0;
    while (i < text.length) {
      const c = text[i]!;
      if (inDouble) {
        if (c === "\\") { i += 2; continue; }
        if (c === '"') inDouble = false;
      } else if (inSingle) {
        if (c === "'") inSingle = false;
      } else if (inBack) {
        if (c === "`") inBack = false;
      } else if (braceDepth > 0) {
        if (c === "{") braceDepth++;
        else if (c === "}") braceDepth--;
      } else if (c === '"') inDouble = true;
      else if (c === "'") inSingle = true;
      else if (c === "`") inBack = true;
      else if (c === "{") braceDepth++;
      else if (c === ">") break;
      i++;
    }
    const tag = text.slice(start, i + 1);
    if (/type="(date|datetime-local)"/.test(tag)) out.push({ tag, index: start });
  }
  return out;
}

function findUnlabelled(): Occurrence[] {
  const out: Occurrence[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walkFiles(join(ROOT, dir))) {
      if (file.includes(PLATFORM_SKIP)) continue;
      const text = readFileSync(file, "utf8");
      for (const { tag, index } of dateInputsIn(text)) {
        const ok =
          tag.includes('lang="en-IN"') &&
          tag.includes("dd/mm/yyyy") &&
          tag.includes("placeholder=");
        if (ok) continue;
        out.push({
          path: file,
          line: text.slice(0, index).split("\n").length,
          tag: tag.replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  return out;
}

function relative(p: string): string {
  return p.startsWith(ROOT + "/") ? p.slice(ROOT.length + 1) : p;
}

describe("date inputs are locale-pinned (F17)", () => {
  it("every date/datetime-local input has lang, placeholder and dd/mm/yyyy hint", () => {
    const findings = findUnlabelled();
    if (findings.length > 0) {
      throw new Error(
        `date inputs missing lang="en-IN" + dd/mm/yyyy placeholder:\n` +
          findings.map((f) => `  ${relative(f.path)}:${f.line}\n    ${f.tag}`).join("\n"),
      );
    }
    expect(findings).toHaveLength(0);
  });

  it("catches a planted violation", () => {
    const planted = `<input\n  type="date"\n  className="text-[16px]"\n/>`;
    const tmp = join(ROOT, "_date-input-planted.test-tmp");
    writeFileSync(tmp, planted);
    try {
      expect(dateInputsIn(readFileSync(tmp, "utf8")).length).toBe(1);
      const tag = readFileSync(tmp, "utf8");
      expect(tag.includes('lang="en-IN"')).toBe(false);
    } finally {
      unlinkSync(tmp);
    }
  });
});
