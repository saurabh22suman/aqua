import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asStaffId, asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";
import { deleteAuditRowsForTenant } from "../helpers/audit-log-cleanup";

// V-23 — shifts and the weekly roster. Written before
// lib/services/shifts.ts exists: the first run is deliberately red.
//
// The publish gate is the safety property pinned here: a rostered
// shift is invisible to its staff member until the week is published.
// Removing the `published_at is not null` filter from the staff-facing
// read (or the stamp in publishRosterWeek) turns this file red — that
// is the mutation proof.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const loc = uuidv7();
const owner = asUserId(uuidv7());
const coachUser = asUserId(uuidv7());
const coachPerson = uuidv7();
const coachStaff = asStaffId(uuidv7());
const ctx = { tenantId: tenant, userId: owner, requestId: uuidv7() };
const coachCtx = { tenantId: tenant, userId: coachUser, requestId: uuidv7() };

const TOMORROW = addDays(todayInZone(TZ), 1);
const WEEK_START = addDays(TOMORROW, -(((new Date(`${TOMORROW}T00:00:00Z`).getUTCDay() + 6) % 7)));

let shifts: typeof import("@/lib/services/shifts");

beforeAll(async () => {
  shifts = await import("@/lib/services/shifts");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Roster Flow', 'active', $3)",
    [tenant, `v23-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main Site', true)",
    [loc, tenant],
  );
  await admin.query("insert into users (id, phone) values ($1, $2), ($3, $4)", [
    owner,
    `+9198${String(Date.now()).slice(-8)}`,
    coachUser,
    `+9199${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Coach Flow')",
    [coachPerson, tenant],
  );
  await admin.query(
    `insert into staff (id, tenant_id, person_id, user_id, staff_type)
     values ($1, $2, $3, $4, 'coach')`,
    [coachStaff, tenant, coachPerson, coachUser],
  );
}, 60_000);

afterAll(async () => {
  await admin.query("delete from shifts where tenant_id = $1", [tenant]);
  await admin.query("delete from shift_templates where tenant_id = $1", [tenant]);
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

describe("V-23 shifts and roster", () => {
  it("creates a shift template and lists it", async () => {
    const created = await shifts.createShiftTemplate(ctx, {
      locationId: loc,
      name: "Morning shift",
      startTime: "06:00",
      endTime: "10:00",
      daysOfWeek: [1, 2, 3, 4, 5, 6],
    });
    expect(created.ok).toBe(true);

    const list = await shifts.listShiftTemplates(ctx, { locationId: loc });
    expect(list.map((t) => t.name)).toContain("Morning shift");
    expect(await auditCount("shift_template.create")).toBe(1);
  });

  it("refuses a template whose end is not after its start", async () => {
    const created = await shifts.createShiftTemplate(ctx, {
      locationId: loc,
      name: "Backwards",
      startTime: "10:00",
      endTime: "09:00",
      daysOfWeek: [1],
    });
    expect(created.ok).toBe(false);
  });

  it("rosters a shift as a draft — invisible to the staff member", async () => {
    const created = await shifts.createShift(ctx, {
      staffId: coachStaff,
      locationId: loc,
      shiftDate: TOMORROW,
      startTime: "06:00",
      endTime: "10:00",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const week = await shifts.listRosterWeek(ctx, {
      locationId: loc,
      fromDate: WEEK_START,
      toDate: addDays(WEEK_START, 6),
    });
    expect(week.map((s) => s.id)).toContain(created.shiftId);

    const { rows } = await admin.query<{ published_at: string | null }>(
      "select published_at from shifts where id = $1",
      [created.shiftId],
    );
    expect(rows[0]!.published_at).toBeNull();

    // The publish gate: drafts are invisible to staff.
    const mine = await shifts.listMyPublishedShifts(coachCtx, {
      fromDate: WEEK_START,
      toDate: addDays(WEEK_START, 6),
    });
    expect(mine).toEqual([]);
    expect(await auditCount("shift.create")).toBe(1);
  });

  it("publishes the week — the shift becomes visible to its staff member", async () => {
    const published = await shifts.publishRosterWeek(ctx, {
      locationId: loc,
      weekStart: WEEK_START,
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.count).toBe(1);

    const mine = await shifts.listMyPublishedShifts(coachCtx, {
      fromDate: WEEK_START,
      toDate: addDays(WEEK_START, 6),
    });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.staffId).toBe(coachStaff);
    expect(await auditCount("shift.publish")).toBe(1);
  });

  it("refuses a shift whose end is not after its start", async () => {
    const created = await shifts.createShift(ctx, {
      staffId: coachStaff,
      locationId: loc,
      shiftDate: addDays(TOMORROW, 1),
      startTime: "10:00",
      endTime: "09:00",
    });
    expect(created.ok).toBe(false);
  });

  it("deletes a shift with an audit row", async () => {
    const created = await shifts.createShift(ctx, {
      staffId: coachStaff,
      locationId: loc,
      shiftDate: addDays(TOMORROW, 2),
      startTime: "06:00",
      endTime: "10:00",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deleted = await shifts.deleteShift(ctx, created.shiftId);
    expect(deleted.ok).toBe(true);

    const { rows } = await admin.query(
      "select id from shifts where id = $1",
      [created.shiftId],
    );
    expect(rows).toHaveLength(0);
    expect(await auditCount("shift.delete")).toBe(1);
  });
});
