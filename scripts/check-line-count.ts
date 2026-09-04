#!/usr/bin/env tsx
// scripts/check-line-count.ts — report-only check for the "Files
// under 300 lines" rule documented in CLAUDE.md.
//
// Test files (`tests/**`) are explicitly exempt. Reasons:
//   - Test files are fixture-heavy: each case brings a multi-line
//     setup block (a typed pool, run-scoped fixtures, named rows,
//     afterAll cleanup). A 30-test file can easily exceed 300 lines
//     without that reflecting scope drift the way adding more
//     production code does.
//   - Splitting test files purely for line count would put unrelated
//     tests in different files, fragmenting the regression surface
//     and making it harder to read a single concern top-to-bottom.
//   - The review-checklist §6 mutation-proof discipline already
//     enforces a meaningful code-quality bar per test file; line
//     count adds friction without catching what mutation-proof
//     doesn't already catch.
//
// Product code under `app/`, `lib/`, `db/`, and `components/` is in
// scope. The thresholds:
//   - `WARN_LIMIT = 300` — the rule's documented line count.
//   - `HARD_LIMIT = 350` — the mechanical refusal point.
// Today this script is report-only (exit 0). The repo already has
// several files past 350 lines, accumulated before this check
// existed; turning the gate red today would block unrelated work.
// Refactoring the existing oversized files is a Phase 5 task on
// its own. After that lands, flip `STRICT` to `true` and the script
// will start refusing new offenders (and re-failing on those that
// grow further).
//
// NOT WIRED INTO CI (F4 audit correction): the previous header
// said "wired into CI alongside the other checks via
// `pnpm check:lines`". It is not. `.github/workflows/ci.yml`
// does not run this script. The audit caught this — a false
// claim of enforcement is worse than an honest "not enforced";
// it stops anyone checking by hand. `pnpm check:lines` is
// available to run locally and is documented in package.json;
// wiring it into CI is a separate decision (alongside flipping
// STRICT, see above).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib", "db", "components"];
const EXEMPT_GLOBS = [/^tests\//];
const HARD_LIMIT = 350;
const WARN_LIMIT = 300;
const STRICT = false;

type FileResult = {
  path: string;
  lines: number;
  category: "ok" | "warn" | "fail";
};

function isExempt(filePath: string): boolean {
  return EXEMPT_GLOBS.some((re) => re.test(filePath));
}

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

function countLines(filePath: string): number {
  const text = readFileSync(filePath, "utf8");
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

function categorized(filePath: string): FileResult {
  const lines = countLines(filePath);
  let category: FileResult["category"] = "ok";
  if (lines >= HARD_LIMIT) category = "fail";
  else if (lines >= WARN_LIMIT) category = "warn";
  return { path: filePath, lines, category };
}

function main(): void {
  const all: FileResult[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listTsFiles(join(ROOT, dir))) {
      if (isExempt(file)) continue;
      all.push(categorized(file));
    }
  }
  const warnings = all.filter((r) => r.category !== "ok").sort((a, b) => b.lines - a.lines);

  if (warnings.length === 0) {
    console.log(`All ${all.length} product-code files within ${WARN_LIMIT} lines.`);
    return;
  }

  for (const w of warnings) {
    const tag = w.category === "fail" ? "FAIL" : "WARN";
    console.log(`  ${tag}  ${String(w.lines).padStart(3, " ")}  ${w.path}`);
  }

  const failed = warnings.filter((w) => w.category === "fail");
  if (failed.length > 0) {
    console.log("");
    console.log(
      `${failed.length} file(s) exceed the ${HARD_LIMIT}-line hard limit. ` +
        `Refactor: split along an existing responsibility boundary, or hoist shared logic.`,
    );
    if (STRICT) process.exit(1);
  } else {
    console.log("");
    console.log(
      `${warnings.length} file(s) over the ${WARN_LIMIT}-line soft limit but under the ${HARD_LIMIT}-line hard limit. ` +
        `Treat as a refactoring nudge, not a build break.`,
    );
  }
}

main();
