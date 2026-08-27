import { sql } from "drizzle-orm";
import { db } from "./client";
import { enterScope } from "./scope";

type TenantTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(
      `withTenant: tenantId is not a valid uuid — refusing to set tenant context`,
    );
  }

  return enterScope({ kind: "tenant", tenantId }, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${tenantId}, true)`,
      );
      return fn(tx);
    }),
  );
}

// The sanctioned accessor for pre-tenant resolution: identity is known
// (better-auth has authenticated the user) but the tenant is not yet —
// that's what this function is for. RLS on tenant_memberships/tenants/roles
// carries a second, SELECT-only policy keyed on app.user_id (migration
// 0011) so an unscoped or wrongly-filtered query here is still confined to
// this user's own rows by Postgres, not by the caller getting the SQL
// right. Never use this to read or write ordinary tenant data — once a
// tenantId is known, switch to withTenant().
export async function withUser<T>(
  userId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(userId)) {
    throw new Error(
      `withUser: userId is not a valid uuid — refusing to set user context`,
    );
  }

  return enterScope({ kind: "user", userId }, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.user_id', ${userId}, true)`,
      );
      return fn(tx);
    }),
  );
}

export type { TenantTx };
