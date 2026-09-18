import { createAppScopedBoss } from "@/db/queue";
import {
  ACTIVITY_INGEST_QUEUE,
  type ActivityIngestJobData,
} from "@/lib/jobs/activity-ingest-job";
import { activityEventSchema, type ActivityEventInput } from "./registry";
import type { TenantId } from "@/lib/ids";

// E-05 — the producer side of the activity_events stream.
//
// `emitActivityEvents` is deliberately callable AFTER a business
// transaction has committed (never inside one): the event records
// that something happened, it is not part of the thing happening.
// Given that contract it must also be harmless to the caller's
// mutation path, so it NEVER throws — validation failures, a missing
// pg-boss schema, a downed queue: all are logged and dropped. Events
// are analytics (architecture.md §8.11: "safe to lose").
//
// Each emit starts a short-lived pg-boss instance, same pattern as
// db/queue.ts's tenant-creation schedule registration. The job is
// persisted before stop() returns, so the worker picks it up
// independently of this process. LISTEN/NOTIFY is not available
// through the drizzle adapter (db/queue.ts) — the worker polls.
export async function emitActivityEvents(
  tenantId: TenantId,
  events: ActivityEventInput[],
): Promise<void> {
  if (events.length === 0) return;

  try {
    const parsed = events.map((event) => activityEventSchema.parse(event));
    const data: ActivityIngestJobData = { tenantId, events: parsed };

    const boss = createAppScopedBoss();
    await boss.start();
    try {
      await boss.send(ACTIVITY_INGEST_QUEUE, data);
    } finally {
      await boss.stop({ graceful: false, timeout: 5000 });
    }
  } catch (err) {
    // Swallowed on purpose: the caller already committed its
    // mutation. A dropped analytics event is the correct failure
    // mode; a thrown error here would 500 a successful mark.
    console.error("[activity-events] emit failed — event dropped:", err);
  }
}
