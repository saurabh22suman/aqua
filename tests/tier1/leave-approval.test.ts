import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asStaffId, asTenantId, asUserId } from "@/lib/ids";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// V-27 — leave approval. Written before the approval service exists:
// the first run is deliberately red.
//
// Pinned: approving surfaces the uncovered sessions BEFORE the day
// arrives (the list read), records who decided and why, and moves the
// rostered shifts in the range to 'leave' in the same transaction.
// Rejecting leaves the roster untouched. Removing the shift update (or
// the uncovered-session read) turns this file red.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenant = asTenantId(uuidv7());
const loc = uuidv7();
const coachUser = asUserId(uuidv7());
const coachPerson = uuidv7();
const coachStaff = asStaffId(uuidv7());
const ownerUser = asUserId(uuidv7());
const ownerPerson = uuidv7();
const ownerStaff = asStaffId(uuidv7());
const coachCtx = { tenantId: tenant, userId: coachUser, requestId: uuidv7() };
const ownerCtx = { tenantId: tenant, userId: ownerUser, requestId: uuidv7() };

const YEAR = new Date().getUTCFullYear();
const FROM = `${YEAR}-05-04`;
const TO = `${YEAR}-05-06`;
const OUTSIDE = `${YEAR}-05-20`;

let leave: typeof import("@/lib/services/leave");
let approval: typeof import("@/lib/services/leave-approval");
let shifts: typeof import("@/lib/services/shifts");

beforeAll(async () => {
  leave = await import("@/lib/services/leave");
  approval = await import("@/lib/services/leave-approval");
  shifts = await import("@/lib/services/shifts");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Approval Flow', 'active', 'Asia/Kolkata')",
    [tenant, `v27-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main Site', true)",
    [loc, tenant],
  );
  await admin.query(
    "insert into users (id, phone) values ($1, $2), ($3, $4)",
    [
      coachUser,
      `+9191${String(Date.now()).slice(-8)}`,
      ownerUser,
      `+9190${String(Date.now()).slice(-8)}`,
    ],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $2, 'Coach Approval'), ($3, $2, 'Owner Approval')`,
    [coachPerson, tenant, ownerPerson],
  );
  await admin.query(
    `insert into staff (id, tenant_id, person_id, user_id, staff_type) values
       ($1, $2, $3, $4, 'coach'), ($5, $2, $6, $7, 'coach')`,
    [coachStaff, tenant, coachPerson, coachUser, ownerStaff, ownerPerson, ownerUser],
  );

  const programId = uuidv7();
  const batchId = uuidv7();
  await admin.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Squad')",
    [programId, tenant],
  );
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, coach_id, location_id)
     values ($1, $2, $3, 'Squad A', 12, '{1}', '06:00', '07:00', $4, $5)`,
    [batchId, tenant, programId, coachStaff, loc],
  );
  await admin.query(
    `insert into sessions (id, tenant_id, batch_id, location_id, session_date, starts_at, ends_at, status, coach_id)
     values
       ($1, $2, $3, $4, $5, $5::date + time '06:00', $5::date + time '07:00', 'scheduled', $6),
       ($7, $2, $3, $4, $8, $8::date + time '06:00', $8::date + time '07:00', 'scheduled', $6)`,
    [uuidv7(), tenant, batchId, loc, FROM, coachStaff, uuidv7(), OUTSIDE],
  );

  await shifts.createShift(coachCtx, {
    staffId: coachStaff,
    locationId: loc,
    shiftDate: FROM,
    startTime: "05:30",
    endTime: "07:30",
  });
}, 60_000);

afterAll(async () => {
  await admin.query("delete from sessions where tenant_id = $1", [tenant]);
  await admin.query("delete from batches where tenant_id = $1", [tenant]);
  await admin.query("delete from programs where tenant_id = $1", [tenant]);
  await admin.query("delete from leave_requests where tenant_id = $1", [tenant]);
  await admin.query("delete from leave_types where tenant_id = $1", [tenant]);
  await admin.query("delete from shifts where tenant_id = $1", [tenant]);
  await admin.query("delete from staff where tenant_id = $1", [tenant]);
  await admin.query("delete from persons where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await deleteAuditRowsForTenant(admin, tenant);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

async function auditCount(action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenant, action],
  );
  return Number(rows[0]!.count);
}

async function createRequest(): Promise<string> {
  await leave.seedDefaultLeaveTypes(tenant);
  const types = await leave.listLeaveTypes(coachCtx);
  const casual = types.find((t) => t.name === "Casual")!;
  const requested = await leave.requestLeave(coachCtx, {
    leaveTypeId: casual.id,
    fromDate: FROM,
    toDate: TO,
    reason: "Wedding",
  });
  expect(requested.ok).toBe(true);
  if (!requested.ok) throw new Error("fixture request failed");
  return requested.requestId;
}

describe("V-27 leave approval", () => {
  it("surfaces the uncovered sessions before the day arrives", async () => {
    const requestId = await createRequest();
    const uncovered = await approval.listUncoveredSessions(ownerCtx, {
      requestId,
    });
    expect(uncovered).toHaveLength(1);
    expect(uncovered[0]!.sessionDate).toBe(FROM);
    expect(uncovered[0]!.batchName).toBe("Squad A");

    // The request stays pending — the owner is looking before deciding.
    const pending = await approval.listLeaveRequests(ownerCtx, {
      status: "pending",
    });
    expect(pending.map((r) => r.id)).toContain(requestId);
  });

  it("approves: records who and why, and marks the rostered shifts leave", async () => {
    const pending = await approval.listLeaveRequests(ownerCtx, {
      status: "pending",
    });
    const requestId = pending[0]!.id;

    const approved = await approval.approveLeaveRequest(ownerCtx, {
      requestId,
      note: "Approved — cover arranged",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.shiftsMarked).toBe(1);

    const { rows } = await admin.query<{
      status: string;
      decided_by: string;
      decided_at: string | null;
      decision_note: string;
    }>(
      "select status, decided_by, decided_at, decision_note from leave_requests where id = $1",
      [requestId],
    );
    expect(rows[0]!.status).toBe("approved");
    expect(rows[0]!.decided_by).toBe(ownerStaff);
    expect(rows[0]!.decided_at).not.toBeNull();
    expect(rows[0]!.decision_note).toBe("Approved — cover arranged");

    const shift = await admin.query<{ status: string }>(
      "select status from shifts where tenant_id = $1 and staff_id = $2",
      [tenant, coachStaff],
    );
    expect(shift.rows[0]!.status).toBe("leave");

    expect(await auditCount("leave.approve")).toBe(1);

    const again = await approval.approveLeaveRequest(ownerCtx, { requestId });
    expect(again.ok).toBe(false);
  });

  it("rejects without touching the roster", async () => {
    await leave.seedDefaultLeaveTypes(tenant);
    const types = await leave.listLeaveTypes(coachCtx);
    const sick = types.find((t) => t.name === "Sick")!;
    const requested = await leave.requestLeave(coachCtx, {
      leaveTypeId: sick.id,
      fromDate: `${YEAR}-07-01`,
      toDate: `${YEAR}-07-02`,
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;

    const rejected = await approval.rejectLeaveRequest(ownerCtx, {
      requestId: requested.requestId,
      note: "Peak week",
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(rejected.shiftsMarked).toBe(0);

    const { rows } = await admin.query<{ status: string; decision_note: string }>(
      "select status, decision_note from leave_requests where id = $1",
      [requested.requestId],
    );
    expect(rows[0]!.status).toBe("rejected");
    expect(rows[0]!.decision_note).toBe("Peak week");
    expect(await auditCount("leave.reject")).toBe(1);
  });
});
