import type { PgBoss } from "pg-boss";

// C-47 — the invoices.generate schedule: nightly at 02:30 in the
// tenant's own timezone (architecture §9), after expiry has run so a
// subscription that just lapsed is not invoiced again.
export const INVOICES_GENERATE_QUEUE = "invoices.generate";
const INVOICES_GENERATE_CRON = "30 2 * * *";

export async function scheduleInvoicesGenerate(
  boss: PgBoss,
  tenantId: string,
  timezone: string,
): Promise<void> {
  await boss.schedule(
    INVOICES_GENERATE_QUEUE,
    INVOICES_GENERATE_CRON,
    { tenantId },
    { tz: timezone, key: tenantId },
  );
}
