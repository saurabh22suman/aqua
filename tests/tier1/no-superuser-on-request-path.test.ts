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
//   scripts/e2e-offline-disabled.ts - same pattern as e2e-offline.ts: the
//                            OFFLINE_SYNC_ENABLED=false counterpart,
//                            verifying the fail-loud UI instead of offline
//                            queueing — still just a driver script
//   scripts/e2e-platform-form-leak.ts - H1 driver script. Tier 1.5 needs
//                            to provision a platform_users row + a fully
//                            authed platform_sessions row so it can reach
//                            an auth-gated form with JS on; that fixture
//                            setup goes through the privileged pool the
//                            same way scripts/e2e-offline.ts does. Reads
//                            are limited to the one active-tenant lookup;
//                            it never serves a request path.
//   scripts/e2e-parent-link-zero-js.ts - C-45 driver script. Derives a
//                            valid parent-link token by looking up
//                            Aarav Sharma's tenant_id + member_id from
//                            the privileged pool (fixture setup, not a
//                            request-path read); the test then asserts
//                            the production build's /p/[token] response
//                            ships zero <script> tags.
const ALLOWLIST = new Set([
  "db/migrate.ts",
  "db/migrations/20260904090000_makeup_credits.sql",
  "db/migrations/20260904100000_tenant_holidays.sql",
  "db/migrations/20260904110000_waitlist_entries.sql",
  "db/bootstrap-roles.ts",
  "db/reset.ts",
  "db/deploy.ts",
  "db/seed-platform.ts",
  "scripts/seed.ts",
  "scripts/seed-platform-user.ts",
  "scripts/seed-demo.ts",
  // L5 — one-off dev-DB sweep, dev only, refuses to run when
  // NODE_ENV=production. Same fixture-setup pattern as
  // scripts/seed.ts: privileged pool because (a) tenants has RLS
  // and (b) the script is one-off maintenance, not request-path.
  "scripts/l5-clean-dev-orphans.ts",
  // L2-followup one-off vocabulary fixers; demo-side scripts that
  // talk to the privileged pool the same way scripts/seed-demo.ts
  // does (env.MIGRATION_DATABASE_URL), no request-path code.
  // l2-apply-presets.ts was retired — the demo seed now routes
  // through applyPreset() in scripts/seed-demo.ts so the backfill
  // is no longer needed.
  "scripts/l2-set-terminology.ts",
  "tests/tier1/link-better-auth-user.test.ts",
  "lib/env.ts",
  "tests/env.test.ts",
  "tests/tier1/attendance-upsert.test.ts",
  "tests/tier1/sessions-generate-job.test.ts",
  "tests/migrations/",  // PR #125 + #126 — same fixture-setup pattern as the other tier1 tests: privileged pool for migrations + invite tests that need to seed tenants. The agent workflow rule disallows writing in tests/tier1/; this directory is the human-readable replacement.
  "scripts/e2e-role-bypass.ts",  // PR #123 — the red e2e that drives the D1 attack. Fixture setup, no request-path code.
  "tests/auth/",  // 2026-09-11 phone+PIN auth feature — same pattern as tests/migrations/: a privileged pool for fixture setup (seeding ba_user/ba_account/users rows the credentials service then exercises). No request-path code; the tests call the service directly and the route handlers in later slices.
  "tests/db/",  // PR #180 — catalogue-deploy-order.test.ts, catalogue-parity.test.ts,
  // and (already added under tests/platform-metrics-snapshot-scope.test.ts) scope-nesting.test.ts.
  // Same pattern as tests/migrations/ above: Testcontainer Postgres, privileged pool
  // for setup, never the app's own request path. Mechanical closure extension for
  // the new files added by the catalogue-into-migrations PR — none of them touch
  // the request-path code in app/, components/, lib/.
  "tests/tier1/auth-context.test.ts",
  "tests/tier1/platform-entitlements.test.ts",
  "tests/tier1/roles-permissions.test.ts",
  "tests/tier1/tenants-locations.test.ts",
  "tests/tier1/user-scope.test.ts",
  "tests/tier1/membership-role-scope.test.ts",
  "tests/tier1/coach-session-scope.test.ts",
  "tests/tier1/enrolment-capacity.test.ts",
  "tests/tier1/programs-batches-crud.test.ts",
  "tests/tier1/programs-batches-completion.test.ts",
  "tests/tier1/owner-dashboard.test.ts",
  "tests/tier1/consent-schema.test.ts",
  "tests/tier1/member-status-lifecycle.test.ts",
  "tests/tier1/people-screens.test.ts",
  "tests/tier1/enquiries.test.ts",
  "tests/tier1/attendance-history.test.ts",
  "tests/tier1/staff-records.test.ts",
  "tests/tier1/platform-auth.test.ts",
  "tests/tier1/platform-auth-actions.test.ts",
  "tests/tier1/platform-user-delete-cascade.test.ts",
  "tests/tier1/member-enrolment.test.ts",
  "tests/tier1/platform-tenants-list.test.ts",
  "tests/tier1/platform-tenants-detail.test.ts",
  "tests/tier1/platform-admin-tenant-write-rls.test.ts",
  "tests/tier1/platform-admin-tenant-update-rls.test.ts",
  "tests/tier1/platform-tenants-create.test.ts",
  "tests/tier1/platform-tenants-create-action.test.ts",
  "tests/tier1/platform-tenants-status.test.ts",
  "tests/tier1/platform-tenants-status-action.test.ts",
  "tests/tier1/platform-features.test.ts",
  "tests/tier1/platform-features-action.test.ts",
  "tests/tier1/platform-tenant-features.test.ts",
  "tests/tier1/platform-tenant-features-action.test.ts",
  "tests/tier1/platform-presets.test.ts",
  "tests/tier1/platform-admin-tenant-features-rls.test.ts",
  "tests/tier1/tenant-feature-resolution.test.ts",
  "tests/tier1/preset-engine.test.ts",
  "tests/tier1/preset-key-runtime-reads.test.ts",
  "tests/tier1/preset-catalogue-coverage.test.ts", // L2 — same fixture-setup pattern as the other tier1 preset tests above
  "tests/tier1/preset-feature-coverage.test.ts", // L2-followup — same fixture-setup pattern as preset-catalogue-coverage; reads features table to cross-check every preset's features[]
  "tests/tier1/apply-preset-action.test.ts",
  "tests/tier1/preset-preview-source.test.ts",
  "tests/tier1/preset-sample-data.test.ts",
  "tests/tier1/sample-data-hide-rule.test.ts",
  "tests/tier1/invite-owner-action.test.ts",
  "tests/tier1/membership-activation.test.ts",
  "tests/tier1/tenant-creation-parity.test.ts",
  "tests/tier1/onboarding-checklist.test.ts",
  "tests/tier1/branding.test.ts",
  "tests/tier1/terminology.test.ts",
  "tests/tier1/staff-directory.test.ts",
  "tests/tier1/staff-invitations.test.ts",
  "tests/tier1/platform-activity.test.ts",
  "tests/tier1/owner-reports.test.ts",
  "tests/tier1/waitlist.test.ts",
  "tests/tier1/holidays.test.ts",
  "tests/tier1/permission-matrix.test.ts",
  "tests/tier1/role-gating-matrix.test.ts", // sub-PR 3: matrix test seeds through the privileged pool, same shape as permission-matrix above
  "tests/tier1/makeup.test.ts",
  "tests/tier1/coach-substitution.test.ts",
  "tests/tier1/coach-conflicts.test.ts",
  "tests/tier1/presets-r22.test.ts",
  "tests/tier1/batch-transfer.test.ts",
  "tests/tier1/batch-detail-page.test.ts", // K1 click-through regression test, same fixture-setup pattern as the other tier1 tests above
  "tests/mobile/coach-me-page.test.ts", // F4 (mobile UX plan v2): real-DB coach membership drives CoachMePage, same fixture-setup pattern as batch-detail-page above
  "tests/tier1/session-lifecycle.test.ts",
  "tests/tier1/coach-schedule.test.ts",
  "tests/tier1/reschedule-coach-conflict.test.ts",
  "tests/tier1/agent-protected-paths.test.ts",
  "tests/tier1/parent-link-audit.test.ts",
  "tests/tier1/sunday-coach-assignment.test.ts",
  "tests/tier1/demo-mode-env.test.ts",
  "tests/tier1/magic-link-login.test.ts",
  "scripts/platform-code.ts",
  "tests/tier1/platform-code-gates.test.ts",
  "app/(owner)/owner/reports/attendance.csv/route.ts",
  // Tenant detail page reads sample/real state via the
  // privileged pool for the "remove sample data" gate. Same shape
  // as 1.5's tenant list page: the production code goes through
  // withPlatformAdmin() for cross-tenant data; the test fixture
  // uses the admin pool for setup and the post-action assertions.
  "app/(platform)/ops/tenants/[tenantId]/page.tsx",
  "scripts/e2e-offline.ts",
  "scripts/e2e-offline-disabled.ts",
  "scripts/e2e-platform-form-leak.ts",
  "scripts/e2e-parent-link-zero-js.ts",
  "tests/tier1/no-superuser-on-request-path.test.ts", // this file: names the string in comments/allowlist
  // Ops console improvements — Testcontainers-only tests (per that
  // work's standing instruction) that set MIGRATION_DATABASE_URL to
  // point @/db/client at a disposable, per-test Postgres container
  // before dynamically importing it. Same fixture-setup pattern as
  // tests/tier1/* above (privileged pool for setup, never the app's
  // own request path) — these just provision their own container
  // instead of using the shared dev/CI database.
  "tests/tenant-health-query-shape.test.ts",
  "tests/platform-metrics-snapshot-job.test.ts",
  "tests/platform-overview.test.ts",
  "tests/platform-tenants-filters.test.ts",
  "tests/config-chain.test.ts",
  // PR #176 follow-up — the render-based focus test boots a real
  // Chromium against a real next dev (Testcontainer Postgres, seed
  // via scripts/seed.ts). Same fixture-setup pattern as the four
  // Ops-console-improvements entries above; this is a mechanical
  // closure extension for the new file, not a Tier-1 test
  // semantics change. agent-protected-paths source-scans this
  // allowlist for any future drift.
  "tests/a11y/ops-focus-rendered.test.ts",
  // PR #177 — the platform_metrics_writer scope mutation test.
  // Testcontainer Postgres (startIsolatedDb) with two-transaction
  // shape: withPlatformAdmin for setup, withPlatformMetricsWriter
  // for the write assertion. Same fixture-setup pattern as the four
  // Ops-console-improvements entries above; mechanical closure
  // extension for the new file.
  "tests/platform-metrics-snapshot-scope.test.ts",
  // H-01/H-02 — schema-audit tests that read pg_indexes/pg_policies
  // through the privileged pool against the migrated database. Same
  // fixture-setup pattern as the other tier1 tests above (never the
  // app's own request path); mechanical closure extension for the two
  // new files.
  "tests/tier1/hardening-indexes.test.ts",
  "tests/tier1/rls-policy-shape.test.ts",
  // E-01/H-04 — audit actor model: creates tenants + subscriptions via
  // the privileged pool (tenants has FORCE RLS), then exercises the job
  // through the app path. Same fixture-setup pattern as every entry
  // above; the base branch landed the file without this entry.
  "tests/tier1/audit-actor-model.test.ts",
  // E-05 — activity_events: same fixture-setup pattern (privileged pool
  // for tenants, runActivityIngestJob/withTenant for everything the app
  // would do, admin reads for partition/ACL introspection).
  "tests/tier1/activity-events.test.ts",
  // E-06 — events rollup: same fixture-setup pattern (privileged pool to
  // seed partitioned activity_events rows, the job itself under
  // withTenant).
  "tests/tier1/events-rollup-job.test.ts",
  // H-03 — audit_log partitioning: same fixture-setup pattern
  // (privileged pool for partition/RLS/ACL introspection and partition
  // seeding; every write and the UPDATE/DELETE denials go through
  // withTenant over app_user, never the superuser).
  "tests/tier1/audit-partitioning.test.ts",
  // E-03 — audit tamper evidence: same fixture-setup pattern (privileged
  // pool to insert/tamper audit_log rows around the append-only trigger,
  // the job and verifier on the app path).
  "tests/tier1/audit-tamper-evidence.test.ts",
  // E-06 — activity export: same fixture-setup pattern (privileged pool
  // seeds partitioned activity_events rows, the job runs under
  // withTenant against a fake object store).
  "tests/tier1/activity-export-job.test.ts",
  // E-06 — retention is the operator-only path that DROPs partitions:
  // it reads MIGRATION_DATABASE_URL to decide whether the privileged
  // pool is available at all (never for request-path code), and refuses
  // to DROP without it. Not scheduled, not imported by the app.
  "scripts/retention-activity-events.ts",
  // K-01/K-02/K-03/K-04/K-06 — café module. Same fixture-setup pattern
  // as the entries above: the privileged pool seeds tenants/locations/
  // users (tables under FORCE RLS), then every app operation goes
  // through withTenant()/the services; never request-path code.
  "tests/tier1/cafe-menu.test.ts",
  "tests/tier1/cafe-orders.test.ts",
  "tests/tier1/cafe-payments.test.ts",
  "tests/tier1/cafe-reconciliation.test.ts",
  // M-01..M-06 — module kernel. Same fixture-setup pattern as the K
  // entries above: the privileged pool seeds tenants/locations/users
  // (tables under FORCE RLS), then every app operation goes through
  // withTenant()/the services; never request-path code. The M-01
  // backfill test lives under tests/migrations/ (directory-covered).
  "tests/tier1/activity-types.test.ts",
  "tests/tier1/skill-framework.test.ts",
  "tests/tier1/module-registry.test.ts",
  "tests/tier1/module-versioning.test.ts",
  "tests/tier1/pricing-models.test.ts",
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
    .filter(
      (f) =>
        !f.startsWith("node_modules/") &&
        !f.startsWith(".next/") &&
        // Local agent worktrees are git-ignored full repo copies; every
        // finding in them is a duplicate of one in the real tree. CI
        // never has this directory.
        !f.startsWith(".claude/"),
    )
    .sort();
}

describe("MIGRATION_DATABASE_URL has zero request-path references", () => {
  it("matches the allowlist exactly — no app/, components/, lib/ (outside lib/env.ts), or db/ (outside migrate/bootstrap/reset) file references it", () => {
    const found = filesReferencingMigrationUrl();
    // Allowlist entries match by exact path OR by directory prefix
    // (an entry ending in `/` covers every file under it). This is
    // how `tests/migrations/` covers every migration-fixture file
    // added by PR #125 + #126 without enumerating them by name —
    // the directory is the audit unit.
    const allowed = (f: string): boolean => {
      for (const entry of ALLOWLIST) {
        if (entry.endsWith("/")) {
          if (f.startsWith(entry)) return true;
        } else if (entry === f) {
          return true;
        }
      }
      return false;
    };
    const unexpected = found.filter((f) => !allowed(f));
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
