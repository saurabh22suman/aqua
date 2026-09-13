import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// O-09 (docs/ops-platform-design.md §7) — import restriction for
// platform_leads. It holds real names and phone numbers and sits
// outside RLS, the same category as `users`; direct imports are
// allowlisted to the service, the ops action, the ops console UI and
// tests. Shared by the CLI (scripts/check-platform-leads-imports.ts)
// and its fixture test.

export const ALLOWED_IMPORTERS: readonly string[] = [
  "db/platform-leads.ts",
  "db/schema/platform-leads.ts",
  "db/schema/index.ts",
  "lib/actions/platform-leads.ts",
  "app/(platform)/ops/leads/",
  "tests/",
];

// Matches a specifier ENDING in `platform-leads` (optionally `.ts`) —
// not the scan helpers named platform-leads-import-scan.
const LEADS_IMPORT_RE =
  /(?:from\s+["'][^"']*platform-leads(?:\.ts)?["']|import\s*\(\s*["'][^"']*platform-leads(?:\.ts)?["']\s*\)|require\s*\(\s*["'][^"']*platform-leads(?:\.ts)?["']\s*\))/;

export function isAllowedImporter(filePath: string): boolean {
  return ALLOWED_IMPORTERS.some((entry) =>
    entry.endsWith("/") ? filePath.startsWith(entry) : filePath === entry,
  );
}

export function scanPlatformLeadsImports(
  source: string,
  filePath: string,
): boolean {
  if (!LEADS_IMPORT_RE.test(source)) return false;
  return !isAllowedImporter(filePath);
}

export function listSourceFiles(root = process.cwd()): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) {
        out.push(full.startsWith(root + "/") ? full.slice(root.length + 1) : full);
      }
    }
  };
  for (const dir of [
    join(root, "db"),
    join(root, "lib"),
    join(root, "app"),
    join(root, "components"),
    join(root, "scripts"),
  ]) {
    walk(dir);
  }
  return out.sort();
}
