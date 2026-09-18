import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listNewMigrationFiles,
  TENANT_CONVENTION_CUTOFF,
  scanTenantConventions,
} from "./lib/tenant-conventions-scan";

// H-02 — CI scan: new migrations (>= TENANT_CONVENTION_CUTOFF) must
// keep the tenant conventions. Everything older is grandfathered. See
// scripts/lib/tenant-conventions-scan.ts for the rules and the two
// pre-tenant index exemptions.

const violations = listNewMigrationFiles().flatMap((file) =>
  scanTenantConventions(
    readFileSync(join(process.cwd(), file), "utf8"),
    file,
  ),
);

if (violations.length > 0) {
  console.error(
    `check-tenant-conventions: ${violations.length} violation(s) in migrations at/after ${TENANT_CONVENTION_CUTOFF}:\n` +
      violations
        .map((v) => `  ${v.file}:${v.line} — ${v.rule}: ${v.message}`)
        .join("\n") +
      `\n\nNew tenant-table indexes must lead with tenant_id (or be a platform/` +
      `pgboss/migration-infra table); new id columns must not default to ` +
      `gen_random_uuid() — UUIDv7 is generated app-side.`,
  );
  process.exit(1);
}

console.log(
  `check-tenant-conventions: ${listNewMigrationFiles().length} new migration(s) conform.`,
);
