import { createAppScopedBoss } from "@/db/queue";
import { runSessionsGenerateJob } from "@/lib/jobs/sessions-generate-job";
import { asTenantId } from "@/lib/ids";

// Connects as app_user (via db/queue.ts's drizzle-backed adapter) —
// never the privileged migration role. No tenant enumeration happens
// here or anywhere in this process: db/deploy.ts registers one schedule
// per tenant, each carrying its own tenantId (see
// syncSessionGenerateSchedules), so every job this worker receives
// already knows which tenant it's for. See docs/architecture.md's
// "Cross-tenant job scheduling" section for why — this process must
// never hold the privileged migration connection string (enforced
// mechanically, source-file level, by the no-superuser-on-request-path
// test).
const QUEUE = "sessions.generate";

async function main(): Promise<void> {
  const boss = createAppScopedBoss();
  boss.on("error", (err: Error) => console.error("[worker] pg-boss error:", err));

  await boss.start();

  await boss.work<{ tenantId: string }>(QUEUE, async ([job]) => {
    // Job payload deserialized from pg-boss's queue table (untrusted
    // input boundary, same class of cast as a Zod-validated request
    // body) -- db/deploy.ts's syncSessionGenerateSchedules is the only
    // enqueuer, and it always writes a real tenants.id.
    await runSessionsGenerateJob(asTenantId(job.data.tenantId));
  });

  console.log(`[worker] started — listening on ${QUEUE}`);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
