import { eq } from "drizzle-orm";
import type { TenantTx } from "./tenant";
import { tenants } from "./schema/tenants";
import { OPERATIONAL_TENANT_STATUSES } from "./platform";
import type { TenantId } from "@/lib/ids";

// Keep legacy bearer-link reads ordered against a concurrent club suspension.
// The lock lasts through the caller's read/generation transaction.
export async function tenantIsOperational(tx: TenantTx, tenantId: TenantId): Promise<boolean> {
  const [tenant] = await tx.select({ status: tenants.status }).from(tenants)
    .where(eq(tenants.id, tenantId)).limit(1).for("share");
  return !!tenant && (OPERATIONAL_TENANT_STATUSES as readonly string[]).includes(tenant.status);
}
