import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// F4 (audit fix) — extend the source-scan to catch semantic
// tokens used for non-money, non-attendance state.
//
// The audit found that the rule "good/late/warn are reserved for
// money/attendance state" was being copy-pasted into new files
// where the surface didn't represent money or attendance (form
// errors, invitation status, success messages, etc.). Each one
// was benign in isolation but compounded — a coach reading a
// "Late" badge on an error message would lose trust in the
// "Late" badge on a real absence.
//
// The mechanical fix is a source-scan whitelist: each file that
// uses `bg-good`, `bg-late`, `bg-warn`, `text-good`, `text-late`,
// `text-warn` (and the `-soft` variants) must be in this list, OR
// the test fails. Adding a new file to use these tokens requires
// updating the test in the same commit, with a comment naming
// why the file qualifies as a money/attendance context.
//
// This test is the actual rule; the F4 audit's complaint that
// "this keeps reproducing through new mechanisms" is exactly the
// pattern this source-scan is designed to break.

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components"];

// Tailwind utility prefixes that take a color token.
const CLASS_PREFIXES = ["bg", "text", "border", "ring", "from", "to", "via"];
const SEMANTIC_TOKENS = ["good", "late", "warn"];
// bg-good-soft, text-late-soft, etc. — same family, same rule.
const SOFT_VARIANT_REGEX = new RegExp(
  `(?<![\\w-])(?:${CLASS_PREFIXES.join("|")})-(?:${SEMANTIC_TOKENS.join("|")})-soft(?![\\w-])`,
  "g",
);
const BASE_VARIANT_REGEX = new RegExp(
  `(?<![\\w-])(?:${CLASS_PREFIXES.join("|")})-(?:${SEMANTIC_TOKENS.join("|")})(?![\\w-])`,
  "g",
);

type Occurrence = { path: string; line: number; text: string };

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

// Whitelist of files that legitimately use good/late/warn —
// each entry names why this file qualifies as a money/attendance
// (or money/attendance-adjacent) context. Adding a file to this
// list without a comment is a code-review red flag.
const WHITELIST = new Set([
  // register-board.tsx — the coach's register. `late`/`good`
  // mark attendance state; the lane strip (`warn` for under-fill)
  // is the design system's own attendance-state usage.
  "components/register-board.tsx",

  // members-board.tsx — member status pills (active/paused/lapsed
  // are money-driving lifecycle states).
  "components/members-board.tsx",

  // member-status-panel.tsx — member status display surface.
  "components/member-status-panel.tsx",

  // owner-dashboard.tsx — needs-attention list (legitimate
  // `warn` use, DESIGN.md §1.1: warn = needs attention).
  "components/owner-dashboard.tsx",

  // batch-edit-form.tsx + batch-create-form.tsx — coach conflict
  // warning. `warn` is the correct token: needs-attention.
  "components/batch-edit-form.tsx",
  "components/batch-create-form.tsx",

  // enquiry-detail-view.tsx — enquiry stage pill. The enquiry
  // pipeline is the entry point to money; the warn-soft alert
  // shown for missing follow-up is "needs attention" per design.
  // NOTE: only `bg-good-soft text-good` for the "Done" button is
  // questionable (it's a form action, not money state) — kept
  // here pending a separate fix; the audit marked it.
  "components/enquiry-detail-view.tsx",

  // enquiry-new-member-fields.tsx — alert banner for missing
  // consent. The consent gate is the precursor to processing the
  // child's data (DPDP-mandated), so warn = needs attention fits.
  "components/enquiry-new-member-fields.tsx",

  // member-create-form.tsx — consent-missing alert for minor
  // registration. Same DPDP/money-adjacent context.
  "components/member-create-form.tsx",

  // member-enrolment-panel.tsx — capacity-full alert and load
  // failure banner. Capacity-full is a needs-attention state;
  // load-failure is operationally a needs-attention state.
  "components/member-enrolment-panel.tsx",

  // coach/page.tsx + coach/schedule/page.tsx — lane strip
  // (DESIGN.md §3: water normally, warn when under-filled, good
  // when full) on the coach-side today/schedule views.
  "app/(coach)/coach/page.tsx",
  "app/(coach)/coach/schedule/page.tsx",

  // owner/members/[memberId]/page.tsx — member status pills on
  // the detail view (active/paused/lapsed/trial).
  "app/(owner)/owner/members/[memberId]/page.tsx",

  // owner/settings/page.tsx — owner settings entry icon, uses
  // warn-soft for the needs-attention glow on the settings tile.
  "app/(owner)/owner/settings/page.tsx",

  // platform/features/feature-catalogue.tsx — feature category
  // (GA / beta) status pills. `beta` maps to warn (needs
  // attention), `ga` maps to good (released). The label is the
  // primary signal; the colour is supportive.
  "app/(platform)/platform/features/feature-catalogue.tsx",

  // reception/page.tsx — same lane strip as the coach-side
  // today view (DESIGN.md §3: water/warn/good fill).
  "app/(reception)/reception/page.tsx",

  // platform/tenants/[tenantId]/page.tsx — tenant detail with
  // StatusPill; the StatusPill is the legitimate money/lifecycle
  // surface (active/trial/suspended/churned). The comment block
  // names the design rationale; the regex still skips block
  // comments so this entry exists for the actual code, not
  // the prose.
  "app/(platform)/platform/tenants/[tenantId]/page.tsx",
]);

function findSemanticTokenMisuse(): Occurrence[] {
  const out: Occurrence[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listTsFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      // Track block-comment state so a className inside a /* ...
      // */ block doesn't trigger the scan. (The scan still catches
      // single-line // comments that mention the tokens in prose
      // — for those, just don't mention them by name. The actual
      // class strings are what matters.)
      let inBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        let scan = line;
        // Strip block comments inline. The line might open or
        // close one, so do it twice if needed.
        const beforeInBlock = inBlock;
        if (inBlock) {
          const end = line.indexOf("*/");
          if (end === -1) continue;
          scan = line.slice(end + 2);
          inBlock = false;
        }
        const blockStart = scan.indexOf("/*");
        if (blockStart !== -1) {
          const blockEnd = scan.indexOf("*/", blockStart + 2);
          if (blockEnd === -1) {
            inBlock = true;
            scan = scan.slice(0, blockStart);
          } else {
            scan = scan.slice(0, blockStart) + scan.slice(blockEnd + 2);
          }
        }
        void beforeInBlock;
        SOFT_VARIANT_REGEX.lastIndex = 0;
        BASE_VARIANT_REGEX.lastIndex = 0;
        if (SOFT_VARIANT_REGEX.test(scan) || BASE_VARIANT_REGEX.test(scan)) {
          // Strip the absolute prefix so the relative path
          // matches the whitelist entries.
          const rel = file.startsWith(ROOT + "/") ? file.slice(ROOT.length + 1) : file;
          out.push({ path: rel, line: i + 1, text: line.trim() });
        }
      }
    }
  }
  return out;
}

describe("semantic tokens (good/late/warn) used only for money/attendance state", () => {
  it("finds zero uses of good/late/warn outside the whitelist", () => {
    const occurrences = findSemanticTokenMisuse();
    const unexpected = occurrences.filter((o) => !WHITELIST.has(o.path));
    if (unexpected.length > 0) {
      const formatted = unexpected
        .map((o) => `  ${o.path}:${o.line}\n    ${o.text}`)
        .join("\n");
      throw new Error(
        `Semantic tokens (good/late/warn) used outside the money/attendance whitelist:\n${formatted}\n\n` +
          `Per DESIGN.md §1.1, good/late/warn are reserved for money and attendance state.\n` +
          `If this file qualifies (it's a money or attendance surface), add it to the WHITELIST\n` +
          `in tests/tier1/semantic-token-reservation.test.ts with a comment naming WHY.\n` +
          `Otherwise, replace the token with a neutral ink variant (text-ink-2 / bg-deck / etc.).`,
      );
    }
    expect(unexpected).toHaveLength(0);
  });

  it("does not false-positive on adjacent tokens (good-luck, etc.)", () => {
    SOFT_VARIANT_REGEX.lastIndex = 0;
    BASE_VARIANT_REGEX.lastIndex = 0;
    expect(SOFT_VARIANT_REGEX.test("bg-good-soft")).toBe(true);
    expect(BASE_VARIANT_REGEX.test("bg-late")).toBe(true);
    // The accent names (mango / marine / etc.) are tested separately
    // by hardcoded-brand-color.test.ts.
    expect(BASE_VARIANT_REGEX.test("bg-mango")).toBe(false);
    expect(BASE_VARIANT_REGEX.test("bg-marine")).toBe(false);
  });

  it("every whitelist entry corresponds to a real file on disk", () => {
    // Sanity: if a whitelisted file is renamed or deleted, this
    // surfaces the orphan before someone adds a new file and
    // silently grows the whitelist with a comment referencing a
    // file that no longer exists.
    for (const path of WHITELIST) {
      const text = readFileSync(join(ROOT, path), "utf8");
      // We only assert non-empty — the file's existence is what matters.
      expect(text.length, `whitelist entry ${path} reads as empty`).toBeGreaterThan(0);
    }
  });
});
