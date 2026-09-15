import { sql } from "drizzle-orm";
import { withTenant } from "./tenant";
import type { TenantId } from "@/lib/ids";

// PR4 (ops console improvements) — the Messaging tab on tenant detail.
// Reads message_log the same way a tenant's own user would
// (withTenant(), RLS-scoped) — this is a support/status view, not an
// audit log, so it goes through the tenant scope rather than
// withPlatformAdmin().

export type TenantMessagingSummary = {
  provider: string | null;
  lastSentAt: Date | null;
  sentCount7d: number;
  failedCount7d: number;
};

export async function getTenantMessagingSummary(
  tenantId: TenantId,
): Promise<TenantMessagingSummary> {
  return withTenant(tenantId, async (tx) => {
    const result = await tx.execute(sql`
      select
        (select provider from message_log
         where tenant_id = ${tenantId} and direction = 'outbound'
         order by created_at desc limit 1)                          as provider,
        (select max(created_at) from message_log
         where tenant_id = ${tenantId} and direction = 'outbound')   as "lastSentAt",
        (select count(*)::int from message_log
         where tenant_id = ${tenantId} and direction = 'outbound'
           and created_at >= now() - interval '7 days')             as "sentCount7d",
        (select count(*)::int from message_log
         where tenant_id = ${tenantId} and status = 'failed'
           and created_at >= now() - interval '7 days')             as "failedCount7d"
    `);
    type Row = {
      provider: string | null;
      lastSentAt: string | null;
      sentCount7d: number;
      failedCount7d: number;
    };
    const row = (result as unknown as { rows: Row[] }).rows[0];
    return {
      provider: row?.provider ?? null,
      lastSentAt: row?.lastSentAt ? new Date(row.lastSentAt) : null,
      sentCount7d: Number(row?.sentCount7d ?? 0),
      failedCount7d: Number(row?.failedCount7d ?? 0),
    };
  });
}
