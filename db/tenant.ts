import { sql } from "drizzle-orm";
import { db } from "./client";
import { scopeStorage } from "./scope";

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

  return scopeStorage.run({ kind: "tenant", tenantId }, () =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${tenantId}, true)`,
      );
      return fn(tx);
    }),
  );
}

export type { TenantTx };
