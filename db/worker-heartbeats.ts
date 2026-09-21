import { desc } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import { workerHeartbeats } from "./schema/worker-heartbeats";
import {
  evaluateWorkerHeartbeat,
  type WorkerHealthState,
} from "@/lib/health/worker-heartbeat";

// PR1-C8 — worker heartbeat storage. The worker process upserts its
// row on start and on every interval; the health route reads the most
// recent beat. Platform scope: the table is allowlisted infrastructure
// (db/allowlist.ts), same class as platform_audit_log.

export async function recordWorkerHeartbeat(
  workerId: string,
  now: Date = new Date(),
): Promise<void> {
  await withPlatform(async () => {
    await db
      .insert(workerHeartbeats)
      .values({ workerId, startedAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: { lastSeenAt: now },
      });
  });
}

export type WorkerHealth = {
  state: WorkerHealthState;
  lastSeenAt: Date | null;
};

export async function getWorkerHealth(
  now: Date = new Date(),
): Promise<WorkerHealth> {
  const rows = await withPlatform(async () =>
    db
      .select({ lastSeenAt: workerHeartbeats.lastSeenAt })
      .from(workerHeartbeats)
      .orderBy(desc(workerHeartbeats.lastSeenAt))
      .limit(1),
  );
  const lastSeenAt = rows[0]?.lastSeenAt ?? null;
  return { state: evaluateWorkerHeartbeat(lastSeenAt, now), lastSeenAt };
}
