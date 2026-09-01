import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { db } from "./client";

export type Scope =
  | { kind: "tenant"; tenantId: string }
  | { kind: "platform" }
  | { kind: "platform_admin" }
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
const SQL_SCOPED_KINDS = new Set<Scope["kind"]>(["tenant", "user", "platform_admin"]);

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
// grant cross-tenant visibility for SELECT only. Writes remain gated by
// the original `tenant_isolation` policy — the platform scope can read
// every tenant but cannot mutate tenant data through this path. Audit
// writes (platform_audit_log) are RLS-exempt at the table level
// (allowlist) and reachable via plain withPlatform().
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
