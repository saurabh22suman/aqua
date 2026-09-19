import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asStaffId, asTenantId, asUserId } from "@/lib/ids";
import { signPremisesQrToken } from "@/lib/services/premises-qr";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// V-25 — the premises check-in resolver. The QR is public, so the
// load-bearing guard is the tenant match: a poster from academy A
// must not check anyone in at academy B, even when the caller has a
// session at B. Removing `claims.tenantId !== ctx.tenantId` turns the
// first test red.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const userB = asUserId(uuidv7());
const personB = uuidv7();
const staffB = asStaffId(uuidv7());
const userNoStaff = asUserId(uuidv7());
const ctxB = { tenantId: tenantB, userId: userB, requestId: uuidv7() };
const ctxNoStaff = { tenantId: tenantB, userId: userNoStaff, requestId: uuidv7() };

let checkInService: typeof import("@/lib/services/premises-check-in");
let attendance: typeof import("@/lib/services/staff-attendance");

beforeAll(async () => {
  checkInService = await import("@/lib/services/premises-check-in");
  attendance = await import("@/lib/services/staff-attendance");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Academy A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Academy B', 'active', 'Asia/Kolkata')`,
    [tenantA, `v25-a-${RUN}`, tenantB, `v25-b-${RUN}`],
  );
  await admin.query(
    "insert into users (id, phone) values ($1, $2), ($3, $4)",
    [
      userB,
      `+9195${String(Date.now()).slice(-8)}`,
      userNoStaff,
      `+9194${String(Date.now()).slice(-8)}`,
    ],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Premises Staff')",
    [personB, tenantB],
  );
  await admin.query(
    `insert into staff (id, tenant_id, person_id, user_id, staff_type)
     values ($1, $2, $3, $4, 'coach')`,
    [staffB, tenantB, personB, userB],
  );
}, 60_000);

afterAll(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await admin.query("delete from staff_attendance where tenant_id = $1", [tenant]);
    await admin.query("delete from staff where tenant_id = $1", [tenant]);
    await admin.query("delete from persons where tenant_id = $1", [tenant]);
    await admin.query("delete from tenants where id = $1", [tenant]);
    await deleteAuditRowsForTenant(admin, tenant);
  }
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("premises check-in resolver (V-25)", () => {
  it("refuses a poster minted for another tenant", async () => {
    const { token } = signPremisesQrToken({ tenantId: tenantA });
    const view = await checkInService.resolvePremisesCheckIn(ctxB, token);
    expect(view).toBeNull();
  });

  it("accepts its own tenant's poster and reports the day's state", async () => {
    const { token } = signPremisesQrToken({ tenantId: tenantB });
    const before = await checkInService.resolvePremisesCheckIn(ctxB, token);
    expect(before?.tenantName).toBe("Academy B");
    expect(before?.hasStaffRecord).toBe(true);
    expect(before?.today).toBeNull();

    const checkedIn = await attendance.checkIn(ctxB, { method: "self_qr" });
    expect(checkedIn.ok).toBe(true);

    const after = await checkInService.resolvePremisesCheckIn(ctxB, token);
    expect(after?.today?.method).toBe("self_qr");
    expect(after?.today?.checkedInAt).not.toBeNull();
  });

  it("reports no staff record without checking in", async () => {
    const { token } = signPremisesQrToken({ tenantId: tenantB });
    const view = await checkInService.resolvePremisesCheckIn(ctxNoStaff, token);
    expect(view?.hasStaffRecord).toBe(false);
    expect(view?.today).toBeNull();
  });

  it("rejects a malformed token", async () => {
    const view = await checkInService.resolvePremisesCheckIn(ctxB, "nonsense");
    expect(view).toBeNull();
  });
});
