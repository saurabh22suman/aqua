import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { evaluateWorkerHeartbeat } from "@/lib/health/worker-heartbeat";
import {
  getWorkerHealth,
  recordWorkerHeartbeat,
} from "@/db/worker-heartbeats";

// PR1-C8 — a worker that has stopped must be visible before a deploy
// is declared green. The heartbeat row is the signal; the health
// route turns a stale/absent row into 503 (absent only in
// production — a dev checkout without a worker is normal).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const workerId = `test-worker-${Date.now().toString(36)}-${uuidv7().slice(0, 8)}`;

afterAll(async () => {
  await admin.query("delete from worker_heartbeats where worker_id = $1", [
    workerId,
  ]);
  await admin.end();
});

describe("evaluateWorkerHeartbeat", () => {
  const now = new Date("2026-09-21T12:00:00Z");

  it("is healthy inside the grace window", () => {
    expect(
      evaluateWorkerHeartbeat(new Date("2026-09-21T11:59:30Z"), now),
    ).toBe("healthy");
  });

  it("is stale beyond the grace window", () => {
    expect(
      evaluateWorkerHeartbeat(new Date("2026-09-21T11:58:00Z"), now),
    ).toBe("stale");
  });

  it("is absent when no worker ever beat", () => {
    expect(evaluateWorkerHeartbeat(null, now)).toBe("absent");
  });
});

describe("worker heartbeat storage", () => {
  it("records a beat and reports healthy", async () => {
    const now = new Date();
    await recordWorkerHeartbeat(workerId, now);
    const health = await getWorkerHealth(now);
    expect(health.state).toBe("healthy");
    expect(health.lastSeenAt?.getTime()).toBe(now.getTime());
  });

  it("reports stale for an old beat", async () => {
    const old = new Date(Date.now() - 5 * 60 * 1000);
    await recordWorkerHeartbeat(workerId, old);
    const health = await getWorkerHealth(new Date());
    expect(health.state).toBe("stale");
  });
});
