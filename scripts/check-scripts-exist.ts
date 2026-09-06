// F5 — every script referenced in package.json must point to a file
// that actually exists.
//
// The E1 follow-up landed a test for the parent-link zero-script
// property, and a CI claim that "this passes" was made against a
// file that did not exist in any commit. The CI was green because
// the script was never wired up to run; a passing test is not
// evidence unless you have seen it run. This check closes the
// "referenced-but-missing" class: every tsx/node entry point in
// package.json must resolve on disk. Cheap, deterministic, and runs
// in <1s.
//
// Run: pnpm check:scripts-exist
// Wired into CI next to the other mechanical checks.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Script = { name: string; cmd: string };
type Result = { name: string; cmd: string; target: string };

function loadPackageScripts(): Script[] {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  return Object.entries(pkg.scripts ?? {}).map(([name, cmd]) => ({
    name,
    cmd,
  }));
}

// Extract the entry-point path from a script command. We recognise
// `tsx <path>`, `node <path>`, and the bare `<path>` shape (e.g.
// `next build`). Anything else (a flag, a built-in like `tsc`, a
// bare binary on PATH) is ignored.
function entryPointTarget(cmd: string): string | null {
  // We only care about scripts that invoke a tsx/node file. Other
  // commands (next build, vitest run, eslint ., tsc --noEmit) are
  // either framework CLIs or shell pipelines; they either resolve
  // at install time (deps in node_modules/.bin) or are pure string
  // shells that wouldn't slip a missing file past a reviewer.
  const tsxMatch = cmd.match(/\btsx\s+([^\s]+)/);
  if (tsxMatch) return tsxMatch[1]!;
  const nodeMatch = cmd.match(/\bnode\s+([^\s]+)/);
  if (nodeMatch) return nodeMatch[1]!;
  return null;
}

function findMissing(): Result[] {
  const missing: Result[] = [];
  for (const script of loadPackageScripts()) {
    const target = entryPointTarget(script.cmd);
    if (target === null) continue;
    // Skip flags (e.g. `tsx --env-file=...` would have started
    // with `--`, but our regex already anchors on the literal token
    // after the runner). Be defensive: skip anything starting with
    // a dash.
    if (target.startsWith("-")) continue;
    const resolved = resolve(process.cwd(), target);
    if (!existsSync(resolved)) {
      missing.push({ name: script.name, cmd: script.cmd, target });
    }
  }
  return missing;
}

function main(): void {
  const missing = findMissing();
  if (missing.length > 0) {
    console.error(
      `scripts referenced in package.json but missing on disk:`,
    );
    for (const m of missing) {
      console.error(`  ${m.name}: ${m.cmd}  (missing: ${m.target})`);
    }
    console.error(
      `\n${missing.length} script(s) missing — fix or remove before merge.`,
    );
    process.exit(1);
  }
  console.log("OK: every script entry point referenced in package.json exists on disk.");
}

main();
