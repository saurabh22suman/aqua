// Agent-owned RED specification — the worker's ordinary-log sanitisation.
//
// OWNER: a-auth lane (independent reviewer). Agent-owned path; nothing under
// tests/tier1/** and no production file is touched by this file.
//
// STATUS: the REAL REGRESSION for the companion unprotected delta
// (proposals/worker-log-sanitisation.delta.patch.txt). It runs against the
// CURRENT, UNCHANGED worker/index.ts (byte-identical to the combined tree's
// copy) and is EXPECTED TO FAIL today, on all three cases.
//
// WHY: the companion delta is the one change in this packet that root has
// authorised as an unprotected minimal edit, so it must have a regression
// that fails before the edit and passes after it.
//
// WHAT IS BEING SPECIFIED
//   W1  the pg-boss "error" listener must not write the error to the log
//   W2  the heartbeat failure logger must not write the error to the log
//   W3  the startup fatal logger must not write the error to the log
//
// Each is asserted BEHAVIOURALLY: the REAL callback is invoked with an Error
// carrying a synthetic secret, and the captured console output must contain
// NO fragment of it — not the message, not the stack, not the name, not a
// property. A fixed event code is enough.
//
// worker/index.ts is a SCRIPT: importing it runs main(). Every case imports it
// FRESH (vi.resetModules + a dynamic import) with the boss, the heartbeat
// writer and the shutdown handler mocked, so no job runs, no database is
// touched and no real worker is started.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({
  secret: "sk_live_SYNTHETIC_SECRET_must_never_be_logged_4f8c1d",
  errorCallbacks: [] as Array<(err: unknown) => void>,
  heartbeatCalls: 0,
  // The heartbeat write fails from this call onwards. The startup beat is
  // call 1, so a case that wants the interval to fail leaves this at 2.
  heartbeatFailFrom: Number.POSITIVE_INFINITY,
  startError: null as Error | null,
}));

vi.mock("@/db/queue", () => ({
  createAppScopedBoss: () => ({
    on: (event: string, callback: (err: unknown) => void) => {
      if (event === "error") control.errorCallbacks.push(callback);
    },
    start: async () => {
      if (control.startError) throw control.startError;
    },
    work: async () => "worker-id",
    stop: async () => {},
  }),
}));

vi.mock("@/db/worker-heartbeats", () => ({
  recordWorkerHeartbeat: async () => {
    control.heartbeatCalls += 1;
    if (control.heartbeatCalls >= control.heartbeatFailFrom) {
      throw new Error(`heartbeat write failed: ${control.secret}`);
    }
  },
}));

vi.mock("@/lib/jobs/worker-shutdown", () => ({
  createShutdownHandler: () => async () => {},
}));

vi.mock("@/lib/health/worker-heartbeat", () => ({
  WORKER_HEARTBEAT_INTERVAL_MS: 1000,
}));

vi.mock("@/lib/jobs/sessions-generate-job", () => ({ runSessionsGenerateJob: vi.fn() }));
vi.mock("@/lib/jobs/absence-alerts-job", () => ({ runAbsenceAlertsJob: vi.fn() }));
vi.mock("@/lib/jobs/subscriptions-expire-job", () => ({ runSubscriptionsExpireJob: vi.fn() }));
vi.mock("@/lib/jobs/invoices-generate-job", () => ({ runInvoicesGenerateJob: vi.fn() }));
vi.mock("@/lib/jobs/reports-rollup-job", () => ({ runReportsRollupJob: vi.fn() }));
vi.mock("@/lib/jobs/events-rollup-job", () => ({ runEventsRollupJob: vi.fn() }));
vi.mock("@/lib/jobs/activity-export-job", () => ({ runActivityExportJob: vi.fn() }));
vi.mock("@/lib/jobs/audit-checkpoint-job", () => ({ runAuditCheckpointJob: vi.fn() }));
vi.mock("@/lib/jobs/platform-metrics-snapshot-job", () => ({
  runPlatformMetricsSnapshotJob: vi.fn(),
}));
vi.mock("@/lib/jobs/whatsapp-notifications-job", () => ({
  runWhatsAppNotificationsJob: vi.fn(),
}));
vi.mock("@/lib/jobs/activity-ingest-job", () => ({
  ACTIVITY_INGEST_QUEUE: "activity.ingest",
  runActivityIngestJob: vi.fn(),
}));

let captured: unknown[][] = [];

// Renders an argument the way a log sink could show it: for an Error that is
// its name, its message, its stack AND its own properties, so a leak through
// ANY of them is detected.
function rendered(value: unknown): string {
  if (value instanceof Error) {
    const own = Object.getOwnPropertyNames(value)
      .map((key) => `${key}=${String((value as unknown as Record<string, unknown>)[key])}`)
      .join(" ");
    return `${value.name}\n${value.message}\n${value.stack ?? ""}\n${own}`;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function loggedText(): string {
  return captured.map((args) => args.map(rendered).join(" ")).join("\n");
}

async function loadWorker(): Promise<void> {
  vi.resetModules();
  // Only the per-load collections are reset. The injected failures
  // (startError, heartbeatFailFrom) belong to the case and must survive
  // into the import, or the logger under test is never reached.
  control.errorCallbacks.length = 0;
  control.heartbeatCalls = 0;
  await import("@/worker/index");
}

beforeEach(() => {
  captured = [];
  control.startError = null;
  control.heartbeatFailFrom = Number.POSITIVE_INFINITY;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    captured.push(args);
  });
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    captured.push(args);
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("W — the worker's ordinary logs never receive an arbitrary error", () => {
  it("W1 logs a fixed code for a pg-boss error event and never the error itself", async () => {
    vi.useFakeTimers();
    await loadWorker();

    expect(control.errorCallbacks).toHaveLength(1);
    control.errorCallbacks[0]!(new Error(`pg-boss transport failed: ${control.secret}`));

    const text = loggedText();
    expect(text).not.toContain(control.secret);
    expect(text).not.toContain("pg-boss transport failed");
    expect(text).toContain("code=pg_boss_error");
  });

  it("W2 logs a fixed code when a heartbeat write fails and never the error itself", async () => {
    control.heartbeatFailFrom = 2;
    vi.useFakeTimers();
    await loadWorker();

    for (let i = 0; i < 100 && control.heartbeatCalls < 2; i += 1) {
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(0);

    const text = loggedText();
    expect(text).not.toContain(control.secret);
    expect(text).not.toContain("heartbeat write failed");
    expect(text).toContain("code=heartbeat_failed");
  });

  it("W3 logs a fixed code when the worker cannot start, and still exits 1", async () => {
    control.startError = new Error(`pg-boss refused the connection: ${control.secret}`);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    await loadWorker();
    for (let i = 0; i < 20 && exitSpy.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(exitSpy).toHaveBeenCalledWith(1);

    const text = loggedText();
    expect(text).not.toContain(control.secret);
    expect(text).not.toContain("pg-boss refused the connection");
    expect(text).toContain("code=worker_start_failed");
  });
});
