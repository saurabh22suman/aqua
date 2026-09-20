import { eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { asTenantId } from "@/lib/ids";

// One reader for the tenant's IANA timezone, used by the staff
// services (shifts, attendance, leave) to resolve tenant-local days
// and materialise wall times. Falls back to the product's canonical
// zone only when the tenant row is somehow absent — never to UTC,
// which would shift an Indian academy's day by 5:30.

export async function tenantTimezoneInTx(
  tx: TenantTx,
  tenantId: string,
): Promise<string> {
  const [row] = await tx
    .select({ timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, asTenantId(tenantId)))
    .limit(1);
  return row?.timezone ?? "Asia/Kolkata";
}
