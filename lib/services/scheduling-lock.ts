import { sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";

// Schedule writers take this tenant-wide lock before any session row lock.
// This bounds conflicts to one tenant and avoids cross-coach swap deadlocks.
export async function lockTenantSchedule(tx: TenantTx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`tenant-scheduling:${tenantId}`}, 0))`);
}
