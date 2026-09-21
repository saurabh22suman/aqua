import { beforeEach, describe, expect, it, vi } from "vitest";

// PR1-C8 — the health route is the deploy gate. A dead worker must
// fail it; a dev checkout with no worker must not.

const pingDatabase = vi.fn();
vi.mock("@/db/platform", () => ({
  pingDatabase: (...args: unknown[]) => pingDatabase(...args),
}));

const getWorkerHealth = vi.fn();
vi.mock("@/db/worker-heartbeats", () => ({
  getWorkerHealth: (...args: unknown[]) => getWorkerHealth(...args),
}));

import { GET } from "@/app/api/health/route";

beforeEach(() => {
  vi.clearAllMocks();
  pingDatabase.mockResolvedValue(undefined);
});

describe("GET /api/health (PR1-C8)", () => {
  it("is 200 with a fresh worker heartbeat", async () => {
    getWorkerHealth.mockResolvedValue({
      state: "healthy",
      lastSeenAt: new Date(),
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", worker: "healthy" });
  });

  it("is 503 when the worker heartbeat is stale", async () => {
    getWorkerHealth.mockResolvedValue({
      state: "stale",
      lastSeenAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ status: "error", worker: "stale" });
  });

  it("is 200 in a non-production checkout with no worker at all", async () => {
    getWorkerHealth.mockResolvedValue({ state: "absent", lastSeenAt: null });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", worker: "absent" });
  });

  it("is 503 when the database is unreachable", async () => {
    pingDatabase.mockRejectedValue(new Error("connection refused"));
    getWorkerHealth.mockResolvedValue({
      state: "healthy",
      lastSeenAt: new Date(),
    });
    const res = await GET();
    expect(res.status).toBe(503);
  });
});
