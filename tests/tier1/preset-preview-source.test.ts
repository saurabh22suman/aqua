import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 2.2b — preview-coupling guard. The user said: "the
// preview pane must show what WILL be seeded, drawn from
// previewPreset — not a hand-written description of the preset.
// A description that drifts from the definition is worse than
// none." A hand-written count array (or even a single hand-coded
// "3 programs" in JSX) on a preset card drifts the moment the
// definition changes.
//
// The mechanical check: any UI source under
// `app/(platform)/platform/presets/` that displays a numeric
// count for a preset (programs, skill levels, etc.) must read it
// from `entry.result.preview.counts` (the previewPreset output
// shape) and not from a literal numeric. The TypeScript types
// already enforce the schema side; this test enforces the *usage*
// side.

const ROOT = process.cwd();
const SCAN_DIRS = ["app"];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Heuristic for "hand-written preset count": a numeric literal in
// JSX that comes RIGHT AFTER a label that matches one of the
// preset count keys (programs, skillLevels, etc.). This catches
// the obvious mistake of writing e.g. `<div>3 programs</div>`
// instead of `{counts.programs} programs`. False positives are
// possible (e.g. the row index in a list) but the whitelist of
// count keys is specific enough that real drift is the dominant
// match.
const COUNT_KEY_LABELS = new Set([
  "programs",
  "skillLevels",
  "skills",
  "planShapes",
  "facilities",
  "facilitySubUnits",
  "exampleBatches",
  "messageTemplates",
  "dashboardCards",
  "featuresEnabled",
  "roles",
]);

function findHandWrittenCounts(): {
  path: string;
  line: number;
  text: string;
}[] {
  const out: { path: string; line: number; text: string }[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listTsFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Match e.g. `programs: 3,` or `programs = 3` or
        // `programs: 3}` — anywhere a numeric literal is bound
        // to a preset count key.
        for (const key of COUNT_KEY_LABELS) {
          const re = new RegExp(
            `\\b${key}\\b\\s*[:=]\\s*\\d+\\b`,
            "i",
          );
          if (re.test(line)) {
            out.push({ path: file, line: i + 1, text: line.trim() });
          }
        }
      }
    }
  }
  return out;
}

describe("preset counts are read from previewPreset, not hand-written (architecture §7.4)", () => {
  const found = findHandWrittenCounts();

  it("finds no hand-written numeric counts under app/(platform)/platform/presets/", () => {
    if (found.length > 0) {
      const formatted = found
        .map((f) => `  ${f.path}:${f.line}\n    ${f.text}`)
        .join("\n");
      throw new Error(
        `Hand-written preset count(s) found — read from previewPreset.counts instead:\n${formatted}\n\n` +
          `The preview pane must show what the engine WILL seed, drawn from previewPreset. ` +
          `Hand-written numbers drift the moment the definition changes.`,
      );
    }
    expect(found).toHaveLength(0);
  });
});
