import { NextRequest } from "next/server";
import { attendanceReportCsvAction } from "@/lib/actions/owner-reports";
import { reportPeriodSchema } from "@/lib/services/owner-reports";

// Phase 4.3 — CSV download for the attendance report. URL shape:
// /owner/reports/attendance.csv?from=YYYY-MM-DD&to=YYYY-MM-DD
// (&locationId=<uuid> when the reports page is scoped to one
// facility). Date- and scope-validated at the boundary by the same
// Zod schema the report action uses; the action itself enforces the
// parse-then-permission preamble and the service enforces the
// caller's location predicate, so the route does not open a new
// permission gate or widen scope.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const raw = {
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
    ...(url.searchParams.get("locationId")
      ? { locationId: url.searchParams.get("locationId") }
      : {}),
  };
  let envelope;
  try {
    envelope = await attendanceReportCsvAction(raw);
  } catch (err) {
    return new Response(`Bad period: ${(err as Error).message}`, {
      status: 400,
    });
  }
  return new Response(envelope.body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${envelope.filename}"`,
    },
  });
}

// Static guard against rebuild churn — the schema lives in
// the service module and the action re-validates the same
// shape; this avoids duplicating it here.
void reportPeriodSchema;
