export const PLATFORM_TABLES = [
  "users",
  "ba_user",
  "ba_session",
  "ba_account",
  "ba_verification",
  "plans",
  "features",
  "plan_features",
  "presets",
  "permissions",
  // M-01 — the platform activity-type catalogue (swimming, tennis,
  // fitness, team sport, café). Closed, code-seeded, read-only to the
  // app role; tenant `facilities` reference its keys.
  "activity_types",
  // M-04 — the platform module registry. Same shape: closed and
  // code-seeded; the per-tenant ENABLED state lives in
  // `tenant_modules`, which is tenant-isolated and NOT exempt.
  "modules",
  // O-04 — the configuration key catalogue. Platform-owned, seeded from
  // code (db/config-definitions.ts); the per-tenant VALUES live in
  // config_values, which is tenant-isolated and NOT exempt.
  "config_keys",
  // OUR standard consent notice text, shown to every guardian/adult
  // member across every tenant -- not a per-tenant document (C-05a's
  // operator DPA is the separate, tenant-specific one). Same shape as
  // plans/features.
  "policy_versions",
  // Platform operator accounts (Day 1.1): platform_users and their
  // sessions are NOT tenant-scoped, NOT behind RLS, NOT reachable
  // from better-auth. Reached only via withPlatform(). Same allowlist
  // rationale as users / ba_session / plans.
  "platform_users",
  "platform_sessions",
  "platform_audit_log",
  // O-09 — sales leads hold real names and phone numbers and sit
  // outside RLS like users. Direct imports are restricted by
  // scripts/check-platform-leads-imports.ts.
  "platform_leads",
  // platform_metrics_daily is INTENTIONALLY NOT in this list.
  // Migration 20260917000000_platform_metrics_writer_scope.sql
  // enables + forces RLS on it and gates ALL on app.platform_metrics_
  // writer = 'true' (with a separate platform_admin_select policy
  // for Overview reads). Listing it here would land it in
  // RLS_EXEMPT_TABLES, which tests/tier1/isolation.test.ts then
  // uses to skip the "every table must be RLS+forced" assertion —
  // a real RLS gate silently masked by an allowlist entry.
];

export type PlatformTable = (typeof PLATFORM_TABLES)[number];

export const INFRA_TABLES = ["_migrations"] as const;

export const RLS_EXEMPT_TABLES: ReadonlySet<string> = new Set([
  ...PLATFORM_TABLES,
  ...INFRA_TABLES,
]);
