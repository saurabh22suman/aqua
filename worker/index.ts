import { createAppScopedBoss } from "@/db/queue";
import { runSessionsGenerateJob } from "@/lib/jobs/sessions-generate-job";
import { runAbsenceAlertsJob } from "@/lib/jobs/absence-alerts-job";
import { runSubscriptionsExpireJob } from "@/lib/jobs/subscriptions-expire-job";
import { runInvoicesGenerateJob } from "@/lib/jobs/invoices-generate-job";
import { runReportsRollupJob } from "@/lib/jobs/reports-rollup-job";
import { SESSIONS_GENERATE_QUEUE } from "@/lib/jobs/sessions-generate-schedule";
import { ABSENCE_ALERTS_QUEUE } from "@/lib/jobs/absence-alerts-schedule";
import { SUBSCRIPTIONS_EXPIRE_QUEUE } from "@/lib/jobs/subscriptions-expire-schedule";
import { INVOICES_GENERATE_QUEUE } from "@/lib/jobs/invoices-generate-schedule";
import { REPORTS_ROLLUP_QUEUE } from "@/lib/jobs/reports-rollup-schedule";
import { asTenantId, type TenantId } from "@/lib/ids";

// Connects as app_user (via db/queue.ts's drizzle-backed adapter) —
// never the privileged migration role. No tenant enumeration happens
// here or anywhere in this process: db/deploy.ts registers one schedule
// per tenant, each carrying its own tenantId (see
// syncPerTenantSchedules), so every job this worker receives already
// knows which tenant it's for. See docs/architecture.md's
// "Cross-tenant job scheduling" section for why — this process must
// never hold the privileged migration connection string (enforced
// mechanically, source-file level, by the no-superuser-on-request-path
// test).
//
// C-47 added the three billing queues; `data.tenantId` is deserialized
// from pg-boss's queue table (an untrusted input boundary, same class
// of cast as a Zod-validated request body) — db/deploy.ts and
// db/platform-tenant-create.ts are the only enqueuers and both always
// write a real tenants.id.

const HANDLERS: ReadonlyArray<{
  queue: string;
  run: (tenantId: TenantId) => Promise<void>;
}> = [
  { queue: SESSIONS_GENERATE_QUEUE, run: runSessionsGenerateJob },
  { queue: ABSENCE_ALERTS_QUEUE, run: runAbsenceAlertsJob },
  { queue: SUBSCRIPTIONS_EXPIRE_QUEUE, run: runSubscriptionsExpireJob },
  { queue: INVOICES_GENERATE_QUEUE, run: runInvoicesGenerateJob },
  { queue: REPORTS_ROLLUP_QUEUE, run: runReportsRollupJob },
];

async function main(): Promise<void> {
  const boss = createAppScopedBoss();
  boss.on("error", (err: Error) => console.error("[worker] pg-boss error:", err));

  await boss.start();

  for (const handler of HANDLERS) {
    await boss.work<{ tenantId: string }>(handler.queue, async ([job]) => {
      await handler.run(asTenantId(job.data.tenantId));
    });
  }

  console.log(
    `[worker] started — listening on ${HANDLERS.map((h) => h.queue).join(", ")}`,
  );
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
