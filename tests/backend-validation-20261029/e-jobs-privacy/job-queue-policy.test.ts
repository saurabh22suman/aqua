// Backend validation 2026-10-29 — lane E (jobs, integrations and privacy).
//
// F3 — the RETRY POLICY the deployed pg-boss queues actually carry, read
// from the queue metadata in the disposable database — not from the
// library's defaults, and not from a source comment.
//
// The gap this file measured: docs/architecture.md:1408 says "Retries use
// exponential backoff, three attempts, then dead-letter with an alert", and
// :1785 lists "job dead-letter" as a paging alert, but the application
// configured no retry option anywhere: db/queue.ts's
// createAppScopedBoss() passed only the drizzle adapter, worker/index.ts's
// boss.work() calls passed no per-queue options either, and db/deploy.ts
// created every queue with boss.createQueue(name) — no options. The
// deployed policy was therefore pg-boss v12's schema default (retry_limit
// 2, retry_delay 0, retry_backoff false, retry_delay_max null,
// expire_seconds 900, dead_letter null): three attempts, NO delay between
// them, and no dead-letter queue anywhere.
//
// The approved jobs change implements the rule in ONE place —
// db/deploy.ts's QUEUE_POLICY — and applies it with createQueue AND
// updateQueue, because createQueue() is ON CONFLICT DO NOTHING inside
// pg-boss's create_queue() function, so an EXISTING queue keeps the
// schema default without the update.
//
// NOTE: this file pinned the CURRENT (library-default) values on purpose.
// The retry/dead-letter policy is now implemented, so the assertions
// below pin the APPROVED deployed values and the architecture rule
// becomes true.

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

/** The ONE dead-letter queue every terminally failed job routes into. */
const DEAD_LETTER_QUEUE = "dead.letter";

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

  it("carries the APPROVED policy: three attempts, exponential backoff from 60s, capped at an hour", () => {
    // The deployed values, read from the queue metadata — the evidence,
    // not an inference from the library's defaults. Against
    // docs/architecture.md:1408 ("Retries use exponential backoff, three
    // attempts, then dead-letter with an alert"):
    //   * three attempts        -> retry_limit 2 (one try + two retries);
    //   * exponential backoff   -> retry_delay 60 and retry_backoff true
    //                              (60s, doubling);
    //   * a capped backoff      -> retry_delay_max 3600 (an hour);
    //   * a job timeout         -> expire_seconds 900 (15 minutes);
    //   * dead-letter           -> dead_letter names the ONE queue.
    for (const queue of APP_QUEUES) {
      const row = rows.find((r) => r.name === queue);
      expect(row, `queue ${queue} is missing`).toBeDefined();
      expect(row!.retry_limit, `${queue} retry_limit`).toBe(2);
      expect(row!.retry_delay, `${queue} retry_delay`).toBe(60);
      expect(row!.retry_backoff, `${queue} retry_backoff`).toBe(true);
      expect(row!.retry_delay_max, `${queue} retry_delay_max`).toBe(3600);
      expect(row!.expire_seconds, `${queue} expire_seconds`).toBe(900);
      expect(row!.dead_letter, `${queue} dead_letter`).toBe(DEAD_LETTER_QUEUE);
    }
  });

  it("routes every terminally failed job into ONE dead-letter queue", () => {
    // There is exactly one dead-letter queue, and it is the one every
    // application queue names. No other ".dlq"-style queue exists.
    const dlqRows = rows.filter((r) => r.name.endsWith(".dlq"));
    expect(dlqRows).toEqual([]);
    const deadLetterQueues = rows.filter((r) => r.dead_letter !== null);
    const targets = new Set(deadLetterQueues.map((r) => r.dead_letter));
    expect([...targets]).toEqual([DEAD_LETTER_QUEUE]);

    const dlq = rows.find((r) => r.name === DEAD_LETTER_QUEUE);
    expect(dlq, "the dead-letter queue itself must exist").toBeDefined();
    // The dead-letter queue carries the SAME retry policy and does NOT
    // dead-letter itself: pg-boss refuses a queue that names itself
    // ("deadLetter cannot be itself"), and a dead-lettered job must not
    // be dead-lettered a second time.
    expect(dlq!.retry_limit).toBe(2);
    expect(dlq!.retry_delay).toBe(60);
    expect(dlq!.retry_backoff).toBe(true);
    expect(dlq!.retry_delay_max).toBe(3600);
    expect(dlq!.expire_seconds).toBe(900);
    expect(dlq!.dead_letter).toBeNull();
  });

  it("the application configures the policy in exactly one place, and applies it", async () => {
    // The mechanical half: the policy above comes from db/deploy.ts, not
    // from the library default. It is applied with updateQueue as well as
    // createQueue — without the update the whole change is a silent
    // no-op on every database whose queues already exist.
    const { readFileSync } = await import("node:fs");
    const deploy = readFileSync("db/deploy.ts", "utf8");
    expect(deploy).toMatch(/retryLimit:\s*2\b/);
    expect(deploy).toMatch(/retryDelay:\s*60\b/);
    expect(deploy).toMatch(/retryBackoff:\s*true\b/);
    expect(deploy).toMatch(/retryDelayMax:\s*3600\b/);
    expect(deploy).toMatch(/expireInSeconds:\s*900\b/);
    expect(deploy).toMatch(/deadLetter:\s*DEAD_LETTER_QUEUE\b/);
    expect(deploy).toMatch(/updateQueue\(queue,\s*QUEUE_POLICY\)/);
  });
});
