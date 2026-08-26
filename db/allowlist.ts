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
] as const;

export type PlatformTable = (typeof PLATFORM_TABLES)[number];

export const INFRA_TABLES = ["_migrations"] as const;

export const RLS_EXEMPT_TABLES: ReadonlySet<string> = new Set([
  ...PLATFORM_TABLES,
  ...INFRA_TABLES,
]);
