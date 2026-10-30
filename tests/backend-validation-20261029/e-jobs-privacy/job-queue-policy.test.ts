// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F3 — EVIDENCE ONLY. The RETRY POLICY the deployed pg-boss queues
// actually carry, read from the queue metadata in the disposable
// database — not from the library's defaults, and not from a source
// comment.
//
// The gap: docs/architecture.md:1408 says "Retries use exponential
// backoff, three attempts, then dead-letter with an alert", and
// :1785 lists "job dead-letter" as a paging alert. The application
// configures no retry option anywhere: db/queue.ts's
// createAppScopedBoss() passes only the drizzle adapter, and
// worker/index.ts's boss.work() calls pass no per-queue options
// either. db/deploy.ts creates every queue with boss.createQueue(name)
// — no options.
//
// So the deployed policy is whatever pg-boss v12's schema default is.
// This file reads that policy from pgboss.queue so the claim is
// evidence, not an inference.
//
// NOTE: this file pins the CURRENT deployed values on purpose. When
// the retry/dead-letter policy is implemented, this file is updated in
// the same change (and the architecture rule becomes true).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privilegedFixturePool } from "../../db/privileged-fixture";

type QueueRow = {
  name: string;
  policy: string;
  retry_limit: number;
  retry_delay: number;
  retry_backoff: boolean;
  retry_delay_max: number | null;
  expire_seconds: number;
  dead_letter: string | null;
};

/** Every queue this application schedules. */
const APP_QUEUES = [
  "sessions.generate",
  "alerts.absence",
  "subscriptions.expire",
  "invoices.generate",
  "reports.rollup",
  "events.rollup",
  "activity.export",
  "audit.checkpoint",
  "platform.metrics-snapshot",
  "activity.ingest",
  "whatsapp.notifications",
];

let rows: QueueRow[] = [];

beforeAll(async () => {
  const result = await privilegedFixturePool.query<QueueRow>(
    `select name, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, dead_letter
       from pgboss.queue
      order by name`,
  );
  rows = result.rows;
});

afterAll(async () => {
  await privilegedFixturePool.end();
});

describe("F3 — the deployed pg-boss retry policy", () => {
  it("every queue the application schedules exists", () => {
    const present = new Set(rows.map((r) => r.name));
    for (const queue of APP_QUEUES) {
      expect(present.has(queue), `queue ${queue} is missing`).toBe(true);
    }
  });

  it("carries the library default: two retries, no delay, no backoff, no dead-letter", () => {
    // The deployed values, read from the queue metadata. pg-boss v12's
    // schema default (node_modules/pg-boss/dist/plans.js) is
    // retry_limit 2, retry_delay 0, retry_backoff false, no dead
    // letter — because the application configures none of them.
    //
    // Against docs/architecture.md:1408 ("exponential backoff, three
    // attempts, then dead-letter with an alert"):
    //   * three attempts        -> OK (one try + two retries);
    //   * exponential backoff   -> MISSING (retry_delay 0,
    //                              retry_backoff false);
    //   * dead-letter + alert   -> MISSING (dead_letter is null and
    //                              no dead-letter queue exists).
    for (const row of rows) {
      expect(row.retry_limit).toBe(2);
      expect(row.retry_delay).toBe(0);
      expect(row.retry_backoff).toBe(false);
      expect(row.retry_delay_max).toBeNull();
      expect(row.dead_letter).toBeNull();
    }
  });

  it("has no dead-letter queue to dead-letter into", () => {
    const deadLetterQueues = rows.filter((r) => r.name.endsWith(".dlq"));
    expect(deadLetterQueues).toEqual([]);
  });

  it("the application configures no retry option anywhere", async () => {
    // The mechanical half: the policy above comes from the library
    // default because nothing in the application sets one.
    const { readFileSync } = await import("node:fs");
    for (const file of ["db/queue.ts", "worker/index.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/retryLimit|retryDelay|retryBackoff|deadLetter/);
    }
  });
});
