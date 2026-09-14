import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listSourceFiles,
  scanPlatformLeadsImports,
} from "./lib/platform-leads-import-scan";

// O-09 — CI scan: platform_leads may only be imported by its service,
// its ops action, the ops console UI and tests. It holds names and
// phone numbers and has no RLS; a random import is exactly how that
// class of data leaks into a request path.

const violations = listSourceFiles().filter((file) => {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  return scanPlatformLeadsImports(source, file);
});

if (violations.length > 0) {
  console.error(
    `check-platform-leads-imports: ${violations.length} file(s) import platform_leads outside the allowlist:\n` +
      violations.map((v) => `  ${v}`).join("\n") +
      `\n\nUse db/platform-leads.ts (the service) or lib/actions/platform-leads.ts instead, ` +
      `or add the file to ALLOWED_IMPORTERS in scripts/lib/platform-leads-import-scan.ts with a reason.`,
  );
  process.exit(1);
}

console.log("check-platform-leads-imports: import allowlist holds.");
