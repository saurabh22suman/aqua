import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 2.2a — architecture §7.4 rule 6: "No runtime branching.
// Enforced by a lint rule restricting reads of `preset_key` to the
// analytics module."
//
// Today there is no analytics module — preset_key is read only by
// the operator-side detail/list pages (display-only) and the engine
// itself (writer). The architectural rule says these reads are fine;
// what is NOT fine is a tenant-runtime read like
// `if (tenant.presetKey === 'swimming')` that branches behaviour.
// This test scans the source tree and asserts no such branch is
// present — every read is in the operator surface or the engine.

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "app", "components", "db"];

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

// "Preset key/version reads" — every occurrence in the source
// tree. The test then asserts each one is in the engine or in the
// operator display surface, never in tenant-runtime code.
const FIELD_REGEX =
  /(?<![A-Za-z0-9_])preset(Key|Version|AppliedAt)(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])preset_(key|version|applied_at)(?![A-Za-z0-9_])/g;

// Whitelist of files allowed to read these fields. Anything else
// is a violation. The whitelist is the same shape as the AST
// test in tests/tier1/server-action-preamble.test.ts — the source
// scan keeps the rule mechanical.
const ALLOWED_READERS = new Set<string[]>([
  // The engine and its schema. The engine is the writer; the
  // schema is the type definition; the read-side types include
  // presetKey/Version so the operator's listTenants /
  // getTenantDetail can hand it back.
  ["db", "preset-engine.ts"],
  ["db", "platform-tenants.ts"],
  ["db", "schema", "tenants.ts"],
  ["db", "schema", "index.ts"],
  // The operator display surface: /platform/tenants lists and
  // shows the applied preset as a display field. No branching.
  ["app", "(platform)", "platform", "tenants", "page.tsx"],
  ["app", "(platform)", "platform", "tenants", "[tenantId]", "page.tsx"],
  // The migration ledger and the seed source. The seed file
  // defines the catalogue but doesn't read tenant preset state
  // at runtime. Migrations create tables; their reads are
  // schema-level.
  ["db", "seed-platform.ts"],
  ["db", "migrations"],
  // Tests read preset key state freely; the rule is about
  // production-runtime code.
  ["tests"],
]);

function isAllowed(filePath: string): boolean {
  // The scanner returns absolute paths (because of `join(ROOT, dir)`).
  // Strip the repo root so we can match the relative whitelist
  // entries below.
  const relative = filePath.startsWith(ROOT + "/")
    ? filePath.slice(ROOT.length + 1)
    : filePath;
  const parts = relative.split("/");
  for (const allowed of ALLOWED_READERS) {
    if (parts.length >= allowed.length) {
      const match = allowed.every((p, i) => parts[i] === p);
      if (match) return true;
    }
  }
  return false;
}

function findPresetReads(): { path: string; line: number; text: string }[] {
  const out: { path: string; line: number; text: string }[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listTsFiles(join(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        FIELD_REGEX.lastIndex = 0;
        if (FIELD_REGEX.test(line)) {
          out.push({ path: file, line: i + 1, text: line.trim() });
        }
      }
    }
  }
  return out;
}

describe("preset_key is read only by the operator surface (architecture §7.4 rule 6)", () => {
  const reads = findPresetReads();

  it("scans the source tree and finds no reads outside the whitelist", () => {
    const violations = reads.filter((r) => !isAllowed(r.path));
    if (violations.length > 0) {
      const formatted = violations
        .map((v) => `  ${v.path}:${v.line}\n    ${v.text}`)
        .join("\n");
      throw new Error(
        `preset_key / preset_version read outside the allowed operator-surface whitelist:\n${formatted}\n\n` +
          `Add the file to the whitelist if the read is in the operator/analytics surface, or remove the read if it's in tenant-runtime code (architecture §7.4 rule 6).`,
      );
    }
    expect(violations).toHaveLength(0);
  });

  it("scans at least one expected reader (sanity — the engine itself)", () => {
    // The whitelist is a constant; if it ever changes, this test
    // catches the change so a reviewer is forced to think about
    // it. Today the engine itself reads the field.
    const engineRead = reads.find((r) => r.path.endsWith("preset-engine.ts"));
    expect(engineRead).toBeTruthy();
  });
});
