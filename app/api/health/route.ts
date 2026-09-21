import { NextResponse } from "next/server";
import { pingDatabase } from "@/db/platform";
import { getWorkerHealth } from "@/db/worker-heartbeats";
import { env } from "@/lib/env";

// Checks DB connectivity, not just process liveness — a container that
// answers HTTP but can't reach Postgres is not healthy. This is what
// Dokploy/docker-compose point their health check at (D3/D4), and what
// gates whether the web service is considered ready.
//
// PR1-C8 — the worker heartbeat is part of the gate. A worker that
// died (stale beat) fails health in every environment; a worker that
// never started only fails in production, where both containers are
// expected (a dev checkout without a worker is normal).
export async function GET() {
  try {
    await pingDatabase();
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }

  const worker = await getWorkerHealth();
  const workerOk =
    worker.state === "healthy" ||
    (worker.state === "absent" && env.NODE_ENV !== "production");
  if (!workerOk) {
    return NextResponse.json(
      {
        status: "error",
        worker: worker.state,
        message:
          worker.state === "absent"
            ? "No worker heartbeat recorded; the worker is not running."
            : "The worker heartbeat is stale; the worker is not running.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: "ok", worker: worker.state }, { status: 200 });
}
