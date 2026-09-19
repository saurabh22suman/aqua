import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asStaffId, asTenantId, asUserId } from "@/lib/ids";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// V-26 — leave types and balances. Written before
// lib/services/leave.ts exists: the first run is deliberately red.
//
// Pinned: the seeded defaults exist and are idempotent; a request
// consumes available balance as pending; cancelling releases it;
// over-quota is refused; unpaid leave is distinguished by is_paid.
// Removing the balance check (or the cancel release) turns this red.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenant = asTenantId(uuidv7());
const coachUser = asUserId(uuidv7());
const coachPerson = uuidv7();
const coachStaff = asStaffId(uuidv7());
const ownerUser = asUserId(uuidv7());
const ownerPerson = uuidv7();
const ownerStaff = asStaffId(uuidv7());
const coachCtx = { tenantId: tenant, userId: coachUser, requestId: uuidv7() };
const ownerCtx = { tenantId: tenant, userId: ownerUser, requestId: uuidv7() };

const YEAR = new Date().getUTCFullYear();
const FROM = `${YEAR}-03-10`;
const TO = `${YEAR}-03-12`;

let leave: typeof import("@/lib/services/leave");

beforeAll(async () => {
  leave = await import("@/lib/services/leave");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Leave Flow', 'active', 'Asia/Kolkata')",
    [tenant, `v26-${RUN}`],
  );
  await admin.query(
    "insert into users (id, phone) values ($1, $2), ($3, $4)",
    [
      coachUser,
      `+9193${String(Date.now()).slice(-8)}`,
      ownerUser,
      `+9192${String(Date.now()).slice(-8)}`,
    ],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $2, 'Coach Leave'), ($3, $2, 'Owner Leave')`,
    [coachPerson, tenant, ownerPerson],
  );
  await admin.query(
    `insert into staff (id, tenant_id, person_id, user_id, staff_type) values
       ($1, $2, $3, $4, 'coach'), ($5, $2, $6, $7, 'coach')`,
    [coachStaff, tenant, coachPerson, coachUser, ownerStaff, ownerPerson, ownerUser],
  );
}, 60_000);

afterAll(async () => {
  await admin.query("delete from leave_requests where tenant_id = $1", [tenant]);
  await admin.query("delete from leave_types where tenant_id = $1", [tenant]);
  await admin.query("delete from staff where tenant_id = $1", [tenant]);
  await admin.query("delete from persons where tenant_id = $1", [tenant]);
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

describe("V-26 leave", () => {
  it("seeds the default types idempotently", async () => {
    await leave.seedDefaultLeaveTypes(tenant);
    await leave.seedDefaultLeaveTypes(tenant);

    const types = await leave.listLeaveTypes(coachCtx);
    const names = types.map((t) => t.name).sort();
    expect(names).toEqual(["Casual", "Sick", "Unpaid"]);
    const unpaid = types.find((t) => t.name === "Unpaid");
    expect(unpaid?.isPaid).toBe(false);
    const casual = types.find((t) => t.name === "Casual");
    expect(casual?.annualQuota).toBe(12);
  });

  it("lets the owner add a custom type", async () => {
    const created = await leave.createLeaveType(ownerCtx, {
      name: "Comp off",
      annualQuota: 4,
      isPaid: true,
    });
    expect(created.ok).toBe(true);
    const types = await leave.listLeaveTypes(ownerCtx);
    expect(types.map((t) => t.name)).toContain("Comp off");
    expect(await auditCount("leave_type.create")).toBe(1);
  });

  it("requests leave and consumes available balance as pending", async () => {
    const types = await leave.listLeaveTypes(coachCtx);
    const casual = types.find((t) => t.name === "Casual")!;

    const requested = await leave.requestLeave(coachCtx, {
      leaveTypeId: casual.id,
      fromDate: FROM,
      toDate: TO,
      reason: "Family function",
    });
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(requested.days).toBe(3);

    const mine = await leave.listMyLeave(coachCtx, { year: YEAR });
    const balance = mine.balances.find((b) => b.leaveTypeId === casual.id)!;
    expect(balance.pendingDays).toBe(3);
    expect(balance.usedDays).toBe(0);
    expect(balance.availableDays).toBe(9);
    expect(mine.requests).toHaveLength(1);
    expect(await auditCount("leave.request")).toBe(1);
  });

  it("refuses a request beyond the remaining quota", async () => {
    const types = await leave.listLeaveTypes(coachCtx);
    const casual = types.find((t) => t.name === "Casual")!;
    const requested = await leave.requestLeave(coachCtx, {
      leaveTypeId: casual.id,
      fromDate: `${YEAR}-06-01`,
      toDate: `${YEAR}-06-20`,
    });
    expect(requested.ok).toBe(false);
  });

  it("cancels a pending request and releases the balance", async () => {
    const mine = await leave.listMyLeave(coachCtx, { year: YEAR });
    const request = mine.requests[0]!;

    const cancelled = await leave.cancelLeaveRequest(coachCtx, request.id);
    expect(cancelled.ok).toBe(true);

    const after = await leave.listMyLeave(coachCtx, { year: YEAR });
    const casual = after.balances.find((b) => b.leaveTypeId === request.leaveTypeId)!;
    expect(casual.pendingDays).toBe(0);
    expect(casual.availableDays).toBe(12);
    expect(after.requests[0]!.status).toBe("cancelled");
    expect(await auditCount("leave.cancel")).toBe(1);
  });

  it("lists pending requests for the owner", async () => {
    const types = await leave.listLeaveTypes(ownerCtx);
    const sick = types.find((t) => t.name === "Sick")!;
    const requested = await leave.requestLeave(coachCtx, {
      leaveTypeId: sick.id,
      fromDate: `${YEAR}-04-01`,
      toDate: `${YEAR}-04-02`,
    });
    expect(requested.ok).toBe(true);

    const pending = await leave.listLeaveRequests(ownerCtx, {
      status: "pending",
    });
    expect(pending.map((r) => r.id)).toContain(requested.ok ? requested.requestId : "");
    expect(pending[0]!.staffName).toBe("Coach Leave");
  });
});
