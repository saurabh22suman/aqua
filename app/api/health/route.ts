import { NextResponse } from "next/server";
import { pingDatabase } from "@/db/platform";

// Checks DB connectivity, not just process liveness — a container that
// answers HTTP but can't reach Postgres is not healthy. This is what
// Dokploy/docker-compose point their health check at (D3/D4), and what
// gates whether the web service is considered ready.
export async function GET() {
  try {
    await pingDatabase();
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
