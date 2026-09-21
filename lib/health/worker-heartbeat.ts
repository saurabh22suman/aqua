// PR1-C8 — pure worker-liveness evaluation. The heartbeat row is
// written by worker/index.ts every WORKER_HEARTBEAT_INTERVAL_MS; a
// beat older than the grace window means the worker is dead and the
// deploy gate must fail. Kept pure so the boundary is unit-testable
// without a database.

export const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;
export const WORKER_STALE_MS = 45_000;

export type WorkerHealthState = "healthy" | "stale" | "absent";

export function evaluateWorkerHeartbeat(
  lastSeenAt: Date | null,
  now: Date,
  staleMs: number = WORKER_STALE_MS,
): WorkerHealthState {
  if (!lastSeenAt) return "absent";
  return now.getTime() - lastSeenAt.getTime() > staleMs ? "stale" : "healthy";
}
