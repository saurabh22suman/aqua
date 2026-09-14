import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listServiceFiles,
  scanLocationScope,
} from "./lib/location-scope-scan";

// O-08 — CI scan: location-bearing service reads must consult the
// location-access helper or be allowlisted with a reason. See
// scripts/lib/location-scope-scan.ts for the rule and the allowlist.

const violations: string[] = [];

for (const file of listServiceFiles()) {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  const result = scanLocationScope(source, file);
  if (result.violation) violations.push(`${file} — ${result.reason}`);
}

if (violations.length > 0) {
  console.error(
    `check-location-scope: ${violations.length} service file(s) query a location-bearing table without the location-access helper:\n` +
      violations.map((v) => `  ${v}`).join("\n") +
      `\n\nCall resolveLocationAccess(tx, ctx) + locationPredicate/locationVisible from lib/services/location-access.ts, ` +
      `or add the file to LOCATION_SCOPE_ALLOWLIST in scripts/lib/location-scope-scan.ts with a reason.`,
  );
  process.exit(1);
}

console.log("check-location-scope: enforcement or an allowlisted reason on every service file.");
