import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { persons, locations, programs, staff, members, batches } from "@/db/schema";
import { sessions, enrolments } from "@/db/schema/scheduling";
import {
  listCoachSchedule,
  listCoachRoster,
} from "@/lib/services/coach-schedule";
import { asTenantId, asStaffId, asUserId, asPersonId, type TenantId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
let locationId = "";
let programId = "";
let coachStaffId = "";
let coachUserId = "";
let otherUserId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Coach Schedule Test', $3)",
    [tenantId, "coach-schedule-" + RUN, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Main", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc!.id;
    const [prog] = await tx
      .insert(programs)
      .values({ tenantId, name: "Schedule Program" })
      .returning({ id: programs.id });
    programId = prog!.id;
  });

  // Create the coach's user row OUTSIDE the withTenant (the
  // users table is RLS-exempt platform territory; admin pool
  // is the right path).
  coachUserId = uuidv7();
  otherUserId = uuidv7();
  await admin.query(
    "insert into users (id, phone) values ($1, $2), ($3, $4)",
    [coachUserId, "+1-" + RUN + "-coach-a", otherUserId, "+1-" + RUN + "-coach-b"],
  );

  await withTenant(tenantId, async (tx) => {
    const [personA] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Coach A", dateOfBirth: "1985-01-01" })
      .returning({ id: persons.id });
    const [staffA] = await tx
      .insert(staff)
      .values({
        tenantId,
        personId: asPersonId(personA!.id),
        staffType: "coach",
        userId: asUserId(coachUserId),
      })
      .returning({ id: staff.id });
    coachStaffId = staffA!.id;

    const [personB] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Coach B", dateOfBirth: "1985-01-01" })
      .returning({ id: persons.id });
    await tx
      .insert(staff)
      .values({
        tenantId,
        personId: asPersonId(personB!.id),
        staffType: "coach",
        userId: asUserId(otherUserId),
      });
  });
});

afterAll(async () => {
  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(enrolments).where(eq(enrolments.tenantId, tenantId));
      await tx.delete(sessions).where(eq(sessions.tenantId, tenantId));
      await tx.delete(members).where(eq(members.tenantId, tenantId));
      await tx.delete(batches).where(eq(batches.tenantId, tenantId));
      await tx.delete(staff).where(eq(staff.tenantId, tenantId));
      await tx.delete(programs).where(eq(programs.tenantId, tenantId));
      await tx.delete(persons).where(eq(persons.tenantId, tenantId));
      await tx.delete(locations).where(eq(locations.tenantId, tenantId));
    });
    await admin.query(
      "delete from users where id in ($1::uuid, $2::uuid)",
      [coachUserId, otherUserId],
    );
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("listCoachSchedule / listCoachRoster (Phase R.34 — test sweep)", () => {
  it("listCoachSchedule returns empty for a coach with no batches", async () => {
    const rows = await listCoachSchedule(
      { tenantId, userId: asUserId(coachUserId), roleKey: "coach" },
      "2027-01-01",
      "2027-12-31",
    );
    expect(rows).toEqual([]);
  });

  it("listCoachSchedule picks up sessions across the coach's batches within the date range", async () => {
    await withTenant(tenantId, async (tx) => {
      const [b] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          name: "Schedule Batch",
          capacity: 10,
          daysOfWeek: [1, 3, 5],
          startTime: "07:00",
          endTime: "08:00",
          coachId: asStaffId(coachStaffId),
        })
        .returning({ id: batches.id });

      const coachIdForSessions = asStaffId(coachStaffId);
      await tx.insert(sessions).values([
        {
          tenantId,
          batchId: b!.id,
          sessionDate: "2027-03-10",
          startsAt: new Date("2027-03-10T07:00:00Z"),
          endsAt: new Date("2027-03-10T08:00:00Z"),
          coachId: coachIdForSessions,
        },
        {
          tenantId,
          batchId: b!.id,
          sessionDate: "2027-03-12",
          startsAt: new Date("2027-03-12T07:00:00Z"),
          endsAt: new Date("2027-03-12T08:00:00Z"),
          coachId: coachIdForSessions,
        },
        {
          tenantId,
          batchId: b!.id,
          sessionDate: "2027-04-01",
          startsAt: new Date("2027-04-01T07:00:00Z"),
          endsAt: new Date("2027-04-01T08:00:00Z"),
          coachId: coachIdForSessions,
        },
      ]);
    });

    const rows = await listCoachSchedule(
      { tenantId, userId: asUserId(coachUserId), roleKey: "coach" },
      "2027-03-01",
      "2027-03-31",
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.sessionDate).sort()).toEqual(["2027-03-10", "2027-03-12"]);
  });

  it("listCoachSchedule excludes another coach's batch", async () => {
    await withTenant(tenantId, async (tx) => {
      const otherStaff = await tx
        .select({ id: staff.id })
        .from(staff)
        .where(eq(staff.userId, asUserId(otherUserId)))
        .limit(1);
      const [b] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          name: "Other Coach's Batch",
          capacity: 10,
          daysOfWeek: [2, 4, 6],
          startTime: "07:00",
          endTime: "08:00",
          coachId: asStaffId(otherStaff[0]!.id),
        })
        .returning({ id: batches.id });
      await tx.insert(sessions).values({
        tenantId,
        batchId: b!.id,
        sessionDate: "2027-03-15",
        startsAt: new Date("2027-03-15T07:00:00Z"),
        endsAt: new Date("2027-03-15T08:00:00Z"),
        coachId: asStaffId(otherStaff[0]!.id),
      });
    });

    const rows = await listCoachSchedule(
      { tenantId, userId: asUserId(coachUserId), roleKey: "coach" },
      "2027-03-01",
      "2027-03-31",
    );
    for (const r of rows) {
      expect(r.batchName).not.toBe("Other Coach's Batch");
    }
  });

  it("listCoachRoster dedupes a member across two batches the coach owns", async () => {
    let memberAId = "";
    await withTenant(tenantId, async (tx) => {
      const [p] = await tx
        .insert(persons)
        .values({ tenantId, fullName: "Dual-Batch", dateOfBirth: "1995-01-01" })
        .returning({ id: persons.id });
      const [m] = await tx
        .insert(members)
        .values({
          tenantId,
          personId: p!.id,
          locationId,
          memberCode: "RB-" + RUN + "-" + p!.id.slice(0, 4).replace(/-/g, ""),
          status: "active",
          createdBy: SYSTEM_USER,
          updatedBy: SYSTEM_USER,
        })
        .returning({ id: members.id });
      memberAId = m!.id;

      const [b1] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          name: "Roster Batch A",
          capacity: 10,
          daysOfWeek: [1, 3, 5],
          startTime: "07:00",
          endTime: "08:00",
          coachId: asStaffId(coachStaffId),
        })
        .returning({ id: batches.id });
      const [b2] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId,
          name: "Roster Batch B",
          capacity: 10,
          daysOfWeek: [2, 4, 6],
          startTime: "17:00",
          endTime: "18:00",
          coachId: asStaffId(coachStaffId),
        })
        .returning({ id: batches.id });
      await tx.insert(enrolments).values([
        {
          tenantId,
          memberId: m!.id,
          batchId: b1!.id,
          enrolledOn: new Date().toISOString().slice(0, 10),
          createdBy: SYSTEM_USER,
          updatedBy: SYSTEM_USER,
        },
        {
          tenantId,
          memberId: m!.id,
          batchId: b2!.id,
          enrolledOn: new Date().toISOString().slice(0, 10),
          createdBy: SYSTEM_USER,
          updatedBy: SYSTEM_USER,
        },
      ]);
    });

    const rows = await listCoachRoster({
      tenantId,
      userId: asUserId(coachUserId),
      roleKey: "coach",
    });
    const me = rows.find((r) => r.memberId === memberAId);
    expect(me).toBeDefined();
    expect(me!.batches.sort()).toEqual(["Roster Batch A", "Roster Batch B"]);
  });
});
