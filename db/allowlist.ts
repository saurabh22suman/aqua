export const PLATFORM_TABLES = ["users"] as const;

export type PlatformTable = (typeof PLATFORM_TABLES)[number];

export const INFRA_TABLES = ["_migrations"] as const;

export const RLS_EXEMPT_TABLES: ReadonlySet<string> = new Set([
  ...PLATFORM_TABLES,
  ...INFRA_TABLES,
]);
