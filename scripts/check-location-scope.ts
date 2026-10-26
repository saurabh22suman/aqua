import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  scanLocationScope,
  scanServiceTree,
} from "./lib/location-scope-scan";

// O-08 — CI scan: location-bearing service reads must consult the
// location-access helper or be allowlisted with a reason. See
// scripts/lib/location-scope-scan.ts for the rule and the allowlist.
//
// The walk is RECURSIVE: a service file in a subdirectory is a service
// file. The summary line prints how many files were scanned, so a
// change in that number is visible in the CI log rather than silent.

const tree = scanServiceTree();
const violations: string[] = [];

for (const file of tree.files) {
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

const escaped = tree.escapedSymlinks;
if (escaped.length > 0) {
  // Not a violation — a symlink out of the repository is not a service
  // file of this repository — but it is printed rather than dropped,
  // because a file hidden behind one is the kind of blind spot this
  // scan exists to close.
  console.warn(
    `check-location-scope: ${escaped.length} symlink(s) point outside the repository and were not followed:\n` +
      escaped.map((p) => `  ${p}`).join("\n"),
  );
}

console.log(
  `check-location-scope: enforcement or an allowlisted reason on every one of the ${tree.files.length} service files.`,
);
