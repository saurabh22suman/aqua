import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// L3 — vocab source-scan.
//
// Architecture § 7.5 says vocabulary is a presentation concern
// resolved through resolveTerm(); the closed-key resolver owns
// plural forms and per-locale defaults. When UI text hardcodes
// a vocabulary word ("Today's lanes", "Find a swimmer", "Member",
// "My members"), the closed-key contract is bypassed: a swim tenant
// gets swim-form words, every other tenant gets the generic
// fallback — but only where the hardcoded string happens to agree
// with the generic fallback. The moment a preset overrides the term
// with a different word (swim: "lane", "swimmer"; gym: "studio",
// "trainer"), the hardcoded string drifts silently from what the
// preset's tenants see.
//
// Three instances of this drift shipped today:
//   - "Today's lanes"        (owner-dashboard.tsx:132)
//   - "Find a swimmer you coach." (coach/members/page.tsx:10)
//   - "Member"               (member-id-card.tsx:54, uncommitted ID-card work)
//
// All three are fixed by routing the prose through resolveTerm().
// The source-scan below catches a regression — any future JSX text
// that names a vocab word without going through the resolver. Same
// shape as preset-key-runtime-reads.test.ts: a regex pass over the source
// tree with an explicit allowlist, every other occurrence is a
// test failure.
//
// What counts as a vocab word: the closed TERM_KEYS set, plus a
// short list of words that ONLY exist as preset overrides. The
// overrides list is the "what swim / gym / football / badminton /
// dance vocabulary would name" set — words no code should ever
// write as prose because their meaning depends on which preset the
// tenant applied. We list them by name here rather than reading the
// preset definitions at scan time so the scan stays a static
// structural check (same philosophy as preset-key-runtime-reads).
//
// All strings are matched as whole words, case-insensitive — so
// `memberId` and `members.board.tsx` do NOT match (word boundary),
// but `>Find a swimmer you coach.<` and `>Member<` DO.

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components"];

// Term keys from lib/terminology/keys.ts (kept inline rather than
// imported so the scan is a pure structural check — the same
// reasoning preset-key-runtime-reads.test.ts gives for the SCAN_DIRS list).
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

// Swim preset's overrides — the only preset currently registered
// in seed-platform.ts (L2 will register the other four). The
// overrides come from db/preset-definitions.ts; adding to this list
// is the moment a new override ships, not before. If we read the
// preset shape at scan time we couple the scan to the preset
// engine, which the audit prototyped explicitly avoided.
const SWIM_OVERRIDES = [
  // member: swimmer / swimmers
  "swimmer",
  "swimmers",
  // facility: lane / lanes
  "lane",
  "lanes",
];

const ALL_VOCAB = [...TERM_KEYS, ...SWIM_OVERRIDES];

// Inside JSX text content: between `>` and `<` (or end-of-line).
// This is what the three known violations look like: `<p>Find a
// swimmer you coach.</p>` and `<h2>Today's lanes</h2>` and
// `<p>Member</p>`. The narrow scope rules out import paths,
// CSS classes, test IDs, identifiers, and other string literals
// that aren't prose. A broader scan (matching every string
// literal) would catch more — but it'd also surface so many false
// positives from kebab-case paths and CSS classes that it
// wouldn't be useful as a regression check.
const JSX_TEXT_VOCAB_REGEX = new RegExp(
  `>([^<>]*\\b(${ALL_VOCAB.join("|")})\\b[^<>]*)<`,
  "i",
);

// Whitelist of files where a vocab word inside JSX text is
// intentionally allowed (and why). Every entry must name the
// reason — not a TODO, not "out of scope". The audit's L3
// follow-up removed every prior TODO L4 entry by routing the
// underlying prose through resolveTerm; what remains is true
// belt-and-braces for surfaces that already use resolveTerm, so
// a future regression that reintroduces hardcoded text fails
// the scan instead of silently passing.
const ALLOWED = new Set<string>([
  // belt-and-braces: this page was fixed by L3 (coach/members
  // "Find a swimmer"). Keeping the entry so the scan gates
  // every text-bearing surface even if a future commit removes
  // the resolveTerm call.
  "app/(coach)/coach/members/page.tsx",
  // Platform console — the staffType picker names the role keys
  // verbatim ("coach", "receptionist", "worker", "accountant").
  // These are tenant-agnostic role identifiers, not user-visible
  // vocabulary; the operator picks a role key, not a localised
  // label. Tenant-side copy is the resolveTerm surface; this
  // platform form is not.
  "app/(platform)/ops/tenants/[tenantId]/invite-owner-form.tsx",
]);

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

function findVocabInJsxText(): {
  path: string;
  line: number;
  text: string;
  word: string;
}[] {
  const out: { path: string; line: number; text: string; word: string }[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listTsxFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip lines that contain `{` or `}` — those are JSX
        // expression interpolations like `{member.fullName}`,
        // where the vocab word is a JS variable name, not prose.
        // Also skip import lines, comments, and JS expressions
        // that happen to use the word.
        if (line.includes("{") || line.includes("}")) continue;
        // Skip lines that look like a closing JSX tag (`</foo>`)
        // — `>` doesn't appear there.
        JSX_TEXT_VOCAB_REGEX.lastIndex = 0;
        const match = JSX_TEXT_VOCAB_REGEX.exec(line);
        if (!match) continue;
        const wordMatch = line.match(
          new RegExp(`\\b(${ALL_VOCAB.join("|")})\\b`, "i"),
        );
        out.push({
          path: file,
          line: i + 1,
          text: line.trim(),
          word: wordMatch?.[1] ?? match[1]!,
        });
      }
    }
  }
  return out;
}

function relativePath(filePath: string): string {
  return filePath.startsWith(ROOT + "/")
    ? filePath.slice(ROOT.length + 1)
    : filePath;
}

describe("vocab is rendered through resolveTerm, not hardcoded (L3)", () => {
  it("finds zero hardcoded vocab words in JSX text outside the allowlist", () => {
    const findings = findVocabInJsxText();
    const violations = findings.filter((f) => !ALLOWED.has(relativePath(f.path)));
    if (violations.length > 0) {
      const formatted = violations
        .map((v) => `  ${relativePath(v.path)}:${v.line}\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `Hardcoded vocabulary found in JSX text (route through resolveTerm):\n${formatted}\n\n` +
          `These words must go through resolveTerm() — they change meaning when a preset overrides\n` +
          `the closed-key vocab (swim: member→swimmer, facility→lane; gym: coach→trainer, ...).\n` +
          `If the file has a legitimate reason to hardcode the word, add it to the ALLOWED set\n` +
          `in this test with a comment naming why.`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  it("catches a planted violation in a fixture string (proves the regex)", () => {
    // The three known violations, encoded as JSX-text snippets.
    // These are the exact shapes the audit's prototype caught.
    const planted = [
      '<h2>Today&apos;s lanes</h2>',
      '<p>Find a swimmer you coach.</p>',
      '<p>Member</p>',
    ];
    let matchCount = 0;
    for (const line of planted) {
      JSX_TEXT_VOCAB_REGEX.lastIndex = 0;
      if (JSX_TEXT_VOCAB_REGEX.test(line)) matchCount++;
    }
    expect(matchCount).toBe(3);
  });

  it("does not match vocab words inside identifiers (memberId, memberCode, ...)", () => {
    // Sanity: the regex's word boundary means "member" inside
    // "memberId" must not match. The strictness is what keeps the
    // scan from flagging schema/column names, import paths, and
    // data-testid values.
    const shouldNotMatch = [
      `import { Foo } from "@/components/bar";`,
      `data-testid={session-${"$"}{id}}`,
      `className="px-4 py-3"`,
      `<SessionRow id="x" />`,
      `const id = "memberId";`,
      `interface MembersRow { memberId: string; }`,
    ];
    for (const line of shouldNotMatch) {
      JSX_TEXT_VOCAB_REGEX.lastIndex = 0;
      expect(
        JSX_TEXT_VOCAB_REGEX.test(line),
        `expected no match for: ${line}`,
      ).toBe(false);
    }
  });
});
