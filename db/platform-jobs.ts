import { createAppScopedBoss } from "./queue";

// F09 (composed, rev 8) — the platform READ behind the Ops console's
// dead-letter panel.
//
// THIS MODULE IS READ-ONLY. The manual dead-letter replay mutation is NOT
// part of this approval packet: it is deferred for a separate review of a
// safe, idempotent design. The rev 7 send-first draft (preserved at
// proposals/superseded/…rev7-complete-send-first-replay.patch.txt) showed
// why: for arbitrary, potentially non-idempotent source queues it
// deliberately discarded singleton metadata and left an un-reconciled
// crash/unknown window, and a checkbox is not a sufficient release gate for
// that. This packet therefore exports NO replay function, NO replay action,
// NO replay operation name and NO replay result type. The read-only action
// returns a truthful "manual replay unavailable" object instead of a button.
//
// The read NEVER returns a job payload, a job's error text or its output:
// only the job id, the source queue, a uuid-validated tenant id, the retry
// count and the creation time (the `activity.ingest` payload — member
// events — is dropped).
//
// LIMIT (stated in §11.10): pg-boss 12.28.0's findJobs() has no limit option,
// so the queued rows are loaded and sliced in memory (200 max for this read).
// A very large dead-letter queue is a memory/latency risk, not a payload-loss
// risk.

export type OpsDeadLetterRow = {
  id: string;
  sourceQueue: string | null;
  tenantId: string | null;
  attempts: number | null;
  createdAt: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tenantIdFromData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as { tenantId?: unknown }).tenantId;
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

const DEAD_LETTER_QUEUE = "dead.letter";

export async function listDeadLetterJobs(
  limit = 50,
): Promise<OpsDeadLetterRow[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  const boss = createAppScopedBoss();
  await boss.start();
  try {
    const jobs = await boss.findJobs<unknown>(DEAD_LETTER_QUEUE, { queued: true });
    return jobs.slice(0, safeLimit).map((job) => ({
      id: job.id,
      sourceQueue: job.sourceName ?? null,
      tenantId: tenantIdFromData(job.data),
      attempts: job.sourceRetryCount ?? null,
      createdAt: (job.sourceCreatedOn ?? job.createdOn).toISOString(),
    }));
  } finally {
    await boss.stop({ graceful: false, timeout: 5000 });
  }
}
