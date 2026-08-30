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
  // OUR standard consent notice text, shown to every guardian/adult
  // member across every tenant -- not a per-tenant document (C-05a's
  // operator DPA is the separate, tenant-specific one). Same shape as
  // plans/features.
  "policy_versions",
] as const;

export type PlatformTable = (typeof PLATFORM_TABLES)[number];

export const INFRA_TABLES = ["_migrations"] as const;

export const RLS_EXEMPT_TABLES: ReadonlySet<string> = new Set([
  ...PLATFORM_TABLES,
  ...INFRA_TABLES,
]);
