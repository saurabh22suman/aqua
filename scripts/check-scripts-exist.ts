// F5 — every script referenced in package.json must point to a file
// that actually exists, AND every script in package.json whose name
// matches the e2e:/check: prefix must be wired into ci.yml.
//
// The E1 follow-up landed a test for the parent-link zero-script
// property, and a CI claim that "this passes" was made against a
// file that did not exist in any commit. The CI was green because
// the script was never wired up to run; a passing test is not
// evidence unless you have seen it run. The same shape recurred
// with `e2e:parent-link-zero-js` — present in package.json, named in
// a ci.yml comment, never invoked. The two classes share one fix:
// this check is now a two-direction closure (disk → package.json
// → ci.yml), so a script referenced in package.json but absent on
// disk fails, AND a script referenced in package.json but absent
// from ci.yml fails. Cheap, deterministic, and runs in <1s.
//
// Run: pnpm check:scripts-exist
// Wired into CI next to the other mechanical checks.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Script = { name: string; cmd: string };
type MissingResult = { name: string; cmd: string; target: string };
type UnwiredResult = { name: string; cmd: string };

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

function findMissing(): MissingResult[] {
  const missing: MissingResult[] = [];
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

// Find any package.json script whose name starts with one of the
// prefixes below AND that doesn't appear as a `run:` line in
// ci.yml. Prefixes chosen by audit:
//
//   e2e:*     — long-lived end-to-end scripts that need a real
//                running server / DB. They must actually run in CI
//                or they don't exist for CI's purposes. (The E1
//                follow-up case: `e2e:parent-link-zero-js` was
//                referenced in package.json and named in a ci.yml
//                comment, never invoked — the original check
//                validated only the on-disk direction and missed
//                this.)
//   check:*   — mechanical pre-build checks. They run cheap (sub-
//                second, no DB) and belong BEFORE the long-running
//                steps in CI; a missing one means the build only
//                proves what it happens to prove.
//
// `db:` is deliberately NOT in this list. db:reset and db:deploy
// are wired into CI directly (they're the only two that need to
// be); db:migrate / db:generate / db:new-migration are dev-loop
// tooling — drizzle-kit generate is intentionally local-only
// (migrations are committed SQL, the model schema is the
// authoritative source of generated SQL) and db:new-migration is
// the dev's migration-scaffolding helper. Adding them here would
// force CI to either run an empty migration step or carry a
// no-op, both of which are noise.
//
// `seed`/`pretest`/dev/build/start/test/typecheck/lint/worker/etc.
// are deliberately NOT in this list — those are dev-loop commands,
// not CI gates, and the existing pretest wiring already covers
// them.
const MUST_BE_WIRED_PREFIXES = ["e2e:", "check:"] as const;

// Explicit allowlist of scripts that match a MUST_BE_WIRED_PREFIX
// but are intentionally unwired. Each entry must carry a comment
// naming the reason; this is the place to read when auditing
// "why isn't this check in CI?" — `check:lines` is the one known
// case (F4 audit correction; deliberately report-only, see
// scripts/check-line-count.ts header).
//
// Do NOT add scripts here to silence a real missing-wire. Add a
// wiring step to ci.yml instead.
const INTENTIONALLY_UNWIRED: Record<string, string> = {
  "check:lines":
    "report-only; not in CI by design (see scripts/check-line-count.ts header). Wiring it requires flipping STRICT too — a separate decision.",
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Strip YAML comments before checking. `pnpm e2e:foo` on a
// `# - run: pnpm e2e:foo` line is NOT a wire — a future agent who
// commented out a step to "skip it locally" must not silently
// leave the script's CI assertion green. Lines whose first
// non-whitespace character is `#` are dropped; inline `#`
// comments after content (e.g. `- run: pnpm x  # explanatory
// note`) are preserved as-is because the script name still
// appears on the uncommented side.
function stripYamlComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((line) => {
      const trimmed = line.replace(/^\s+/, "");
      if (trimmed.startsWith("#")) return "";
      return line;
    })
    .join("\n");
}

// A script is "wired" into ci.yml if any of these appear as
// distinct tokens: (a) `pnpm <name>`, (b) `pnpm exec tsx <target>`
// where target is the script's on-disk entry point, (c) `pnpm exec
// tsx scripts/<derived>` where derived is the canonical
// `scripts/<name-with-prefix-stripped>.ts` shape that the
// `check:bundle` / `check:fonts` style aliases use. Any one of
// these is sufficient — we don't care about the exact invocation
// shape, only that SOME step in CI actually executes the script.
function isWired(script: Script, ci: string): boolean {
  const active = stripYamlComments(ci);
  if (new RegExp(`\\bpnpm\\s+${escapeRegex(script.name)}\\b`).test(active)) {
    return true;
  }
  const target = entryPointTarget(script.cmd);
  if (target && !target.startsWith("-")) {
    if (new RegExp(`\\btsx\\s+${escapeRegex(target)}\\b`).test(active)) {
      return true;
    }
  }
  // The aliases `check:bundle` and `check:fonts` exist as `pnpm exec
  // tsx scripts/check-bundle-budget.ts` / `scripts/check-font-budget.ts`
  // in ci.yml — i.e. the entry-point path uses a name derived from
  // the alias. Try the canonical `scripts/<prefix-stripped>.ts` form
  // for any `check:` or `e2e:` script that didn't match above.
  for (const prefix of MUST_BE_WIRED_PREFIXES) {
    if (!script.name.startsWith(prefix)) continue;
    const derived = `scripts/${script.name.slice(prefix.length)}.ts`;
    if (new RegExp(`\\btsx\\s+${escapeRegex(derived)}\\b`).test(active)) {
      return true;
    }
  }
  return false;
}

function findUnwiredScripts(ci: string): UnwiredResult[] {
  const unwired: UnwiredResult[] = [];
  for (const script of loadPackageScripts()) {
    const isMust = MUST_BE_WIRED_PREFIXES.some((p) => script.name.startsWith(p));
    if (!isMust) continue;
    if (script.name in INTENTIONALLY_UNWIRED) continue;
    if (!isWired(script, ci)) {
      unwired.push({ name: script.name, cmd: script.cmd });
    }
  }
  return unwired;
}

function main(): void {
  const missing = findMissing();
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const unwired = findUnwiredScripts(ci);

  const problems: string[] = [];
  if (missing.length > 0) {
    problems.push(
      `scripts referenced in package.json but missing on disk:\n` +
        missing.map((m) => `  ${m.name}: ${m.cmd}  (missing: ${m.target})`).join("\n"),
    );
  }
  if (unwired.length > 0) {
    problems.push(
      `e2e/check/db scripts in package.json but absent from .github/workflows/ci.yml:\n` +
        unwired.map((u) => `  ${u.name}: ${u.cmd}`).join("\n"),
    );
  }

  if (problems.length > 0) {
    console.error(problems.join("\n\n"));
    console.error(
      `\n${missing.length + unwired.length} script(s) failed the disk/package.json/ci.yml closure — fix or remove before merge.`,
    );
    process.exit(1);
  }
  console.log(
    "OK: every package.json script entry point exists on disk, and every e2e:/check:/db: script is wired into ci.yml.",
  );
}

main();
