import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// MIGRATION_DATABASE_URL connects as `aqua`, a real Postgres superuser
// (rolsuper=t, rolbypassrls=t) — verified against a fresh db:reset. It
// bypasses RLS unconditionally regardless of FORCE ROW LEVEL SECURITY.
// db/platform.ts used to open it directly on the authenticated request
// path (resolveTenantAccessBySlug, resolveHomePath, resolveDefaultMembership,
// linkBetterAuthUser) — that's the R1 defect this migration/policy pair
// (0011, withUser()) replaced. This test is the mechanical guarantee that
// it stays replaced: the connection string may appear only in migration
// and seed tooling, never in application code a live request can reach.
//
// Allowlist, and why each entry is here:
//   db/migrate.ts          - runs migrations, explicitly named in the ask
//   db/bootstrap-roles.ts  - "the bootstrap script", explicitly named
//   db/reset.ts            - orchestrates migrate+bootstrap for `pnpm db:reset`
//   db/deploy.ts           - the production deploy-time equivalent of
//                            db:reset, minus the destructive schema drop
//                            (D3) — runs once, before web/worker start
//   db/seed-platform.ts    - `pretest` hook (package.json) and `pnpm seed`;
//                            seeds the RLS-exempt platform catalogue only
//   scripts/seed.ts        - dev seed script, not request-path; the
//                            tenant-scoped writes it makes go through
//                            withTenant() (R4) — the admin pool here is
//                            for genuinely platform-level bootstrap only
//                            (tenant creation, platform catalogue)
//   lib/env.ts              - declares the env var name in the zod schema;
//                            opens no connection
//   tests/env.test.ts       - tests env var parsing itself
//   tests/tier1/*.test.ts   - fixture setup on tables with FORCE RLS, via
//                            the privileged pool, never the app pool — a
//                            documented pattern (see comments in those
//                            files), not request-path code
//   scripts/e2e-offline.ts  - same fixture-setup pattern as scripts/seed.ts,
//                            plus reads attendance rows directly to verify
//                            sync outcomes — a Playwright driver script,
//                            not request-path code
const ALLOWLIST = new Set([
  "db/migrate.ts",
  "db/bootstrap-roles.ts",
  "db/reset.ts",
  "db/deploy.ts",
  "db/seed-platform.ts",
  "scripts/seed.ts",
  "lib/env.ts",
  "tests/env.test.ts",
  "tests/tier1/attendance-upsert.test.ts",
  "tests/tier1/sessions-generate-job.test.ts",
  "tests/tier1/auth-context.test.ts",
  "tests/tier1/platform-entitlements.test.ts",
  "tests/tier1/roles-permissions.test.ts",
  "tests/tier1/tenants-locations.test.ts",
  "tests/tier1/user-scope.test.ts",
  "tests/tier1/membership-role-scope.test.ts",
  "tests/tier1/coach-session-scope.test.ts",
  "tests/tier1/enrolment-capacity.test.ts",
  "tests/tier1/programs-batches-crud.test.ts",
  "tests/tier1/owner-dashboard.test.ts",
  "scripts/e2e-offline.ts",
  "scripts/e2e-offline-disabled.ts",
  "tests/tier1/no-superuser-on-request-path.test.ts", // this file: names the string in comments/allowlist
]);

function filesReferencingMigrationUrl(): string[] {
  const output = execFileSync(
    "grep",
    ["-rl", "MIGRATION_DATABASE_URL", "--include=*.ts", "--include=*.tsx", "."],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  return output
    .split("\n")
    .filter(Boolean)
    .map((f) => f.replace(/^\.\//, ""))
    .filter((f) => !f.startsWith("node_modules/") && !f.startsWith(".next/"))
    .sort();
}

describe("MIGRATION_DATABASE_URL has zero request-path references", () => {
  it("matches the allowlist exactly — no app/, components/, lib/ (outside lib/env.ts), or db/ (outside migrate/bootstrap/reset) file references it", () => {
    const found = filesReferencingMigrationUrl();
    const unexpected = found.filter((f) => !ALLOWLIST.has(f));
    expect(unexpected, "unexpected MIGRATION_DATABASE_URL reference(s)").toEqual([]);
  });

  it("specifically: app/, components/, db/platform.ts, and db/client.ts never reference it", () => {
    const found = new Set(filesReferencingMigrationUrl());
    expect(found.has("db/platform.ts")).toBe(false);
    expect(found.has("db/client.ts")).toBe(false);
    for (const f of found) {
      expect(f.startsWith("app/"), f).toBe(false);
      expect(f.startsWith("components/"), f).toBe(false);
    }
  });
});
