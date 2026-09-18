import type { PgBoss } from "pg-boss";

// E-03 — the audit.checkpoint schedule: nightly at 04:00 in the
// tenant's own timezone, after the rollups have frozen the operational
// day. The checkpoint digest covers the tenant-local day that just
// ended, so 04:00 gives late-committing transactions some grace.
export const AUDIT_CHECKPOINT_QUEUE = "audit.checkpoint";
const AUDIT_CHECKPOINT_CRON = "0 4 * * *";

export async function scheduleAuditCheckpoint(
  boss: PgBoss,
  tenantId: string,
  timezone: string,
): Promise<void> {
  await boss.schedule(
    AUDIT_CHECKPOINT_QUEUE,
    AUDIT_CHECKPOINT_CRON,
    { tenantId },
    { tz: timezone, key: tenantId },
  );
}
