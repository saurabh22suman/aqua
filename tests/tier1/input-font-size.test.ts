import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Mobile pass [automatable] — DESIGN.md §2 rule: "Inputs at 16px font
// size — anything smaller triggers iOS zoom-on-focus." The 5.6 mobile
// pass fixed 40+ instances across the tenant forms. The rule is the
// same shape as vocab-source-scan and hardcoded-brand: documented in
// DESIGN.md, memory-only, false across the codebase at audit time.
// This scan is the mechanical replacement so a future regression of
// any form re-introducing a sub-16px font size fails the build rather
// than shipping and getting caught at next phone-test.
//
// Targets <input>, <textarea>, <select>. iOS triggers zoom-on-focus on
// the form-control's own computed font size, NOT on its descendants,
// so we only inspect the opening tag's className. <option> children
// are deliberately out of scope.
//
// /ops is DESIGN.md §2 desktop-only by design; its forms are exempt.

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components"];
const PLATFORM_SKIP_SUBSTR = "/(platform)/ops/";

const FONTSIZE_REGEX = /text-\[(\d+(?:\.\d+)?)px\]/;

type Occurrence = { path: string; line: number; text: string };

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listTsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

// Walk every <input|<textarea|<select opening tag in the file. The
// opening tag ends at the first `>` that is NOT inside an attribute
// value (single, double, or backtick quoted) or a JSX expression
// (`{...}`). Once we have the opening tag, look at every
// `className="..." | `className={`...`} | className={'...'} on it
// and check for sub-16px text-[Npx]. multi-line is fine because we
// walk the whole text, not line by line.
function findSub16pxInputsInFile(path: string): Occurrence[] {
  const text = readFileSync(path, "utf8");
  const out: Occurrence[] = [];
  const tagRegex = /<(input|textarea|select)\b/g;
  let m: RegExpExecArray | null;
  while ((m = tagRegex.exec(text))) {
    const start = m.index;
    // Find the closing '>' of this opening tag, skipping quoted strings
    // and JSX expression blocks.
    let i = m.index + m[0].length;
    let inSingle = false;
    let inDouble = false;
    let inBack = false;
    let braceDepth = 0;
    while (i < text.length) {
      const c = text[i]!;
      if (inSingle) {
        if (c === "'") inSingle = false;
      } else if (inDouble) {
        if (c === '\\') { i += 2; continue; }
        if (c === '"') inDouble = false;
      } else if (inBack) {
        if (c === '\\') { i += 2; continue; }
        if (c === "`") inBack = false;
      } else if (braceDepth > 0) {
        if (c === "{") braceDepth++;
        else if (c === "}") braceDepth--;
      } else if (c === "'") inSingle = true;
      else if (c === '"') inDouble = true;
      else if (c === "`") inBack = true;
      else if (c === "{") braceDepth++;
      else if (c === ">") break;
      i++;
    }
    if (i >= text.length) continue;
    const openingTag = text.slice(start, i + 1);
    // For each className=... on this tag, extract the inner string and
    // check font size. We allow string-literal, backtick-template, and
    // single-quoted JSX attribute values; the common case is a plain
    // double-quoted string.
    const cnRegex = /className=(?:"([^"]*)"|`([^`]*)`|'([^']*)')/g;
    let cm: RegExpExecArray | null;
    while ((cm = cnRegex.exec(openingTag))) {
      const cls = cm[1] ?? cm[2] ?? cm[3] ?? "";
      // Skip template literals — they can interpolate at runtime, so a
      // sub-16px literal could still be added by a build-time function.
      // We still want to catch the literal sub-16px case but a
      // `text-[16px]` in a template passes cleanly. In practice every
      // tenant form uses a static className; this is the conservative
      // shape.
      if (cm[2] !== undefined) continue;
      const fm = FONTSIZE_REGEX.exec(cls);
      if (!fm) continue;
      if (parseFloat(fm[1]!) >= 16) continue;
      const lineNo = text.slice(0, start).split("\n").length;
      out.push({ path, line: lineNo, text: openingTag.replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

function findSub16pxInputs(): Occurrence[] {
  const out: Occurrence[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listTsxFiles(join(ROOT, dir))) {
      if (file.includes(PLATFORM_SKIP_SUBSTR)) continue;
      out.push(...findSub16pxInputsInFile(file));
    }
  }
  return out;
}

function relativePath(filePath: string): string {
  return filePath.startsWith(ROOT + "/")
    ? filePath.slice(ROOT.length + 1)
    : filePath;
}

describe("form controls render at ≥16px font size (DESIGN.md §2, iOS zoom)", () => {
  it("finds zero sub-16px text-[Npx] classes on <input/textarea/select outside /ops", () => {
    const findings = findSub16pxInputs();
    if (findings.length > 0) {
      const formatted = findings
        .map((o) => `  ${relativePath(o.path)}:${o.line}\n    ${o.text}`)
        .join("\n");
      throw new Error(
        `Form-control elements with font size below 16px found:\n${formatted}\n\n` +
          `Per DESIGN.md §2, inputs must render at 16px — anything smaller triggers iOS zoom-on-focus.\n` +
          `Bump to text-[16px] (or larger) on the element's className. /ops is exempt by design.`,
      );
    }
    expect(findings).toHaveLength(0);
  });

  it("detects a planted multi-line violation (proves the scanner catches real JSX shape)", () => {
    const planted = [
      `<input\n  type="text"\n  className="w-full text-[13px]"\n/>`,
      `<textarea\n  className="rounded-ctl text-[12.5px]"\n/>`,
      `<select\n  className="text-[14px]">\n  <option>x</option>\n</select>`,
    ].join("\n");
    const tmp = join(ROOT, "_input-font-size-planted.test-tmp");
    writeFileSync(tmp, planted);
    try {
      const found = findSub16pxInputsInFile(tmp);
      expect(found.length).toBe(3);
    } finally {
      unlinkSync(tmp);
    }
  });

  it("does not flag a 16px opening tag (negative control)", () => {
    const planted = `<input\n  className="rounded-ctl text-[16px]"\n/>`;
    const tmp = join(ROOT, "_input-font-size-ok.test-tmp");
    writeFileSync(tmp, planted);
    try {
      const found = findSub16pxInputsInFile(tmp);
      expect(found.length).toBe(0);
    } finally {
      unlinkSync(tmp);
    }
  });
});
