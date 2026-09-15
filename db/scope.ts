import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { db } from "./client";

export type Scope =
  | { kind: "tenant"; tenantId: string }
  | { kind: "platform" }
  | { kind: "platform_admin" }
  | { kind: "platform_metrics_writer" }
  | { kind: "user"; userId: string };

export const scopeStorage = new AsyncLocalStorage<Scope>();

export function currentScope(): Scope | undefined {
  return scopeStorage.getStore();
}

// withTenant and withUser each open their own transaction and set a
// Postgres session variable RLS policies branch on (app.tenant_id,
// app.user_id respectively). Nesting either inside the other — or inside
// itself — would risk both variables being visible to the same
// transaction, OR-ing their RLS policies together into a wider view than
// either mode intends on its own. withPlatform sets no such variable —
// it never calls set_config — so it is safe to nest freely in either
// direction (better-auth's own call chain does this: an outer
// withPlatform around auth.api.verifyPhoneNumber legitimately triggers an
// inner withPlatform around linkBetterAuthUser via callbackOnVerification).
//
// The set of scopes that DO set a Postgres session variable is the
// union of the two below. The platform scope (`withPlatform()`) is
// the only scope that opens a session-scoped variable other than the
// tenant/user pair (via withPlatformAdmin).
const PLATFORM_ADMIN_SQL_SCOPED_KINDS = new Set<Scope["kind"]>([
  "tenant",
  "user",
]);

export function enterScope<T>(scope: Scope, fn: () => Promise<T>): Promise<T> {
  const existing = currentScope();
  if (
    existing &&
    PLATFORM_ADMIN_SQL_SCOPED_KINDS.has(scope.kind) &&
    PLATFORM_ADMIN_SQL_SCOPED_KINDS.has(existing.kind) &&
    scope.kind !== "platform_admin" &&
    existing.kind !== "platform_admin"
  ) {
    throw new Error(
      `Cannot enter ${scope.kind} scope while already inside a ${existing.kind} scope — ` +
        `withTenant() and withUser() must not nest with each other. ` +
        `withPlatformAdmin() nests with both (the platform variable ORs onto the tenant/user policies).`,
    );
  }
  return scopeStorage.run(scope, fn);
}

export async function withPlatform<T>(fn: () => Promise<T>): Promise<T> {
  return enterScope({ kind: "platform" }, fn);
}

// withPlatformAdmin opens a transaction and sets app.platform_admin =
// 'true' transaction-scoped. RLS policies on tenant-scoped tables
// (`platform_admin_select`, migration
// 20260901162028_platform_admin_tenant_read) key on this variable and
// grant cross-tenant visibility for SELECT only. Writes are NOT
// blanket-gated by `tenant_isolation` — every tenant table with a
// `platform_admin_write` policy (see migrations 20260902230000,
// 20260902210100, 20260902200000, 20260902210000,
// 20260914020000, 20260914030000, 20260915000000,
// 20260915010000, 20260915020000, 20260915030000,
// 20260915040000, 20260915050000, 20260915090000,
// 20260915100000, 20260915110000, 20260915120000,
// 20260915130000) is reachable for ALL operations under this scope.
// The platform operator legitimately writes tenant rows on a small
// set of paths: preset application (facilities, sub-units,
// location_presets), config resolution (config_values for
// plan/preset scope), change-request resolution
// (config_change_requests), reconciliation (cash_counts, payments,
// invoices, invoice_line_items), and platform-wide message
// metering (message_log via the cloud adapter).
//
// The invariant this scope comment is trying to express —
// "the platform scope cannot reach member PII" — lives in the
// *absence* of the platform_admin_write policy on members,
// persons, attendance, consents, and similar tables, NOT in a
// blanket refusal here. tests/tier1/no-superuser-on-request-
// path.test.ts is the mechanical guard that the underlying
// connection is app_user, never the migration role.
//
// Nesting: withPlatformAdmin nests freely with itself and with
// withPlatform (both kinds of platform scope share the same "no
// SQL-scoped variable combination with another scope" property
// — the platform variable and a tenant/user variable OR together,
// widening visibility to exactly what was asked for). It does NOT
// nest with withTenant() or withUser() without that warning — they
// each have their own session variable and stacking them widens
// visibility beyond what either intends.
export async function withPlatformAdmin<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return enterScope({ kind: "platform_admin" }, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.platform_admin', 'true', true)`,
      );
      return fn(tx);
    }),
  );
}

// withPlatformMetricsWriter is the scope that owns writes to
// platform_metrics_daily. It sets app.platform_metrics_writer =
// 'true' transaction-scoped. The platform_metrics_daily RLS
// policies (migration 20260917000000_platform_metrics_writer_scope.sql)
// grant ALL on that table only when this flag is set; FORCE RLS
// makes the gate mechanical rather than convention.
//
// Why this scope does NOT also set app.platform_admin: tenant
// tables' platform_admin_write policies (`for all to app_user using
// (app.platform_admin = 'true')`) would otherwise activate inside
// this scope and the scope would be able to write every tenant
// table with that policy. By setting ONLY the writer flag,
// withPlatformMetricsWriter is incapable of reaching any tenant
// table — the tenant_isolation policy blocks reads, and the
// platform_admin_write policies have no key on the writer flag.
// This is the mutual-exclusion guarantee: this scope's write
// surface is exactly {platform_metrics_daily} and nothing else.
//
// Read cross-tenant still requires withPlatformAdmin (sets
// app.platform_admin = 'true', activates platform_admin_select on
// tenant tables). The platform-metrics-snapshot job uses both
// scopes in sequence: a withPlatformAdmin transaction computes
// the counts, a withPlatformMetricsWriter transaction writes the
// row. Reads and writes are no longer atomic, but the upsert is
// idempotent and the snapshot is one row per day — a partial
// failure means the row is stale until the next run, not that
// counts go missing.
//
// Scope-kind namespace: `platform_metrics_writer` is intentionally
// NOT in PLATFORM_ADMIN_SQL_SCOPED_KINDS — the writer flag is
// deliberately orthogonal to the tenant/user variables so it
// cannot widen their visibility by accident.
export async function withPlatformMetricsWriter<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return enterScope({ kind: "platform_metrics_writer" }, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.platform_metrics_writer', 'true', true)`,
      );
      return fn(tx);
    }),
  );
}
