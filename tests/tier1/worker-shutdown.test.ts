import { describe, expect, it, vi } from "vitest";
import { createShutdownHandler } from "@/lib/jobs/worker-shutdown";

// PR1-C8 — SIGTERM must drain in-flight pg-boss jobs, clear the
// heartbeat and exit 0 exactly once; a second signal is ignored (the
// orchestrator's kill escalation handles a hung drain).

describe("createShutdownHandler", () => {
  it("stops once, clears the heartbeat and exits 0", async () => {
    const stop = vi.fn(async () => {});
    const clearHeartbeat = vi.fn();
    const exit = vi.fn();
    const log = vi.fn();
    const shutdown = createShutdownHandler({ stop, clearHeartbeat, exit, log });

    await shutdown("SIGTERM");

    expect(stop).toHaveBeenCalledTimes(1);
    expect(clearHeartbeat).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(log).toHaveBeenCalled();
  });

  it("ignores a second signal while draining", async () => {
    const gate: { release?: () => void } = {};
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          gate.release = resolve;
        }),
    );
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      stop,
      clearHeartbeat: () => {},
      exit,
    });

    const first = shutdown("SIGTERM");
    await shutdown("SIGINT");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    gate.release?.();
    await first;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("still exits 0 when the drain fails, after logging", async () => {
    const stop = vi.fn(async () => {
      throw new Error("boss stop failed");
    });
    const exit = vi.fn();
    const log = vi.fn();
    const shutdown = createShutdownHandler({
      stop,
      clearHeartbeat: () => {},
      exit,
      log,
    });

    await shutdown("SIGTERM");

    expect(exit).toHaveBeenCalledWith(0);
    expect(log.mock.calls.some((c) => String(c[0]).includes("boss stop failed"))).toBe(
      true,
    );
  });
});
