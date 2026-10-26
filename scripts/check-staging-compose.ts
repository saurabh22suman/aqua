#!/usr/bin/env tsx
// `pnpm tsx scripts/check-staging-compose.ts [path]`.
//
// The named, fail-closed gate for the staging deployment unit. It parses
// docker-compose.staging.yml (or the given path) and fails on the
// isolation invariants listed in scripts/lib/staging-compose-scan.ts.
//
// It is a pure source parse: no container, no image, no database, no
// network. The rules exist because each one is a silent failure if
// broken — a staging unit that reuses the Dev volume writes the pilot's
// database, a runtime service holding the superuser URL crosses every RLS
// boundary, and a secret with a fallback starts on a placeholder.
//
// The output never contains a value from the file: only variable NAMES and
// the names of the resources that must be used. Run it in CI on the
// staging compose file; the known-bad proof lives in
// tests/scanner-fixtures/staging-isolation.test.ts.

import { readFileSync } from "node:fs";
import {
  scanStagingCompose,
  STAGING_COMPOSE_FILE,
} from "./lib/staging-compose-scan";

const path = process.argv[2] ?? STAGING_COMPOSE_FILE;

let source: string;
try {
  source = readFileSync(path, "utf8");
} catch {
  // Fail closed, without a stack trace: a missing file is a missing
  // deployment unit, not a reason to skip the check.
  console.error(`staging compose check failed: ${path} not found.`);
  process.exit(1);
}

const violations = scanStagingCompose(source);

if (violations.length > 0) {
  console.error(`staging compose check failed (${path}):`);
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`Staging compose check passed (${path}).`);
