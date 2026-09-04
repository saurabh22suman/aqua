import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { persons, locations, programs, staff, members, batches } from "@/db/schema";
import { sessions, enrolments } from "@/db/schema/scheduling";
import { substituteCoach } from "@/lib/services/coach-substitution";
import { asTenantId, asUserId, asStaffId, asPersonId, type TenantId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
let locationId: string = ""; // eslint-disable-line @typescript-eslint/no-unused-vars
let programId = "";
let coachAStaffId = "";
let coachBStaffId = "";
let coachAUserId = "";
let coachBUserId = "";
let sessionId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Substitution Test', $3)",
    [tenantId, "substitution-" + RUN, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Main", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc!.id;
    const [prog] = await tx
      .insert(programs)
      .values({ tenantId, name: "Substitution Program" })
      .returning({ id: programs.id });
    programId = prog!.id;
  });

  coachAUserId = uuidv7();
  coachBUserId = uuidv7();
  await admin.query(
    "insert into users (id, phone) values ($1, $2), ($3, $4)",
    [coachAUserId, "+1-" + RUN + "-coach-a", coachBUserId, "+1-" + RUN + "-coach-b"],
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
        userId: asUserId(coachAUserId),
      })
      .returning({ id: staff.id });
    coachAStaffId = staffA!.id;

    const [personB] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Coach B", dateOfBirth: "1985-01-01" })
      .returning({ id: persons.id });
    const [staffB] = await tx
      .insert(staff)
      .values({
        tenantId,
        personId: asPersonId(personB!.id),
        staffType: "coach",
        userId: asUserId(coachBUserId),
      })
      .returning({ id: staff.id });
    coachBStaffId = staffB!.id;
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
      [coachAUserId, coachBUserId],
    );
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

beforeEach(async () => {
  await withTenant(tenantId, async (tx) => {
    await tx.delete(sessions).where(eq(sessions.tenantId, tenantId));
  });
  // Use a future date 5 days out — generated sessions need to be
  // dated such that the test stays stable.
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 5);
  const dateStr = future.toISOString().slice(0, 10);

  await withTenant(tenantId, async (tx) => {
    const [b] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        name: "Substitution Batch",
        capacity: 10,
        daysOfWeek: [1, 3, 5],
        startTime: "07:00",
        endTime: "08:00",
        coachId: asStaffId(coachAStaffId),
      })
      .returning({ id: batches.id });
    const [s] = await tx
      .insert(sessions)
      .values({
        tenantId,
        batchId: b!.id,
        sessionDate: dateStr,
        startsAt: new Date(dateStr + "T07:00:00Z"),
        endsAt: new Date(dateStr + "T08:00:00Z"),
        status: "scheduled",
        coachId: asStaffId(coachAStaffId),
      })
      .returning({ id: sessions.id });
    sessionId = s!.id;
  });
});

describe("substituteCoach (Phase R.1)", () => {
  it("swaps the recorded coach to the substitute", async () => {
    const result = await substituteCoach(
      { tenantId, userId: SYSTEM_USER },
      { sessionId, newCoachId: coachBStaffId },
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.newCoachId).toBe(coachBStaffId);
      expect(result.previousCoachId).toBe(coachAStaffId);
    }

    // The actual row reflects the swap.
    const rows = await withTenant(tenantId, async (tx) =>
      tx
        .select({ coachId: sessions.coachId })
        .from(sessions)
        .where(eq(sessions.id, sessionId)),
    );
    expect(rows[0]!.coachId).toBe(coachBStaffId);
  });

  it("is idempotent when called with the same coach already assigned", async () => {
    const first = await substituteCoach(
      { tenantId, userId: SYSTEM_USER },
      { sessionId, newCoachId: coachBStaffId },
    );
    expect(first.kind).toBe("ok");
    const second = await substituteCoach(
      { tenantId, userId: SYSTEM_USER },
      { sessionId, newCoachId: coachBStaffId },
    );
    expect(second.kind).toBe("ok");
  });

  it("rejects a substitute that isn't a coach in this tenant", async () => {
    // Make a non-coach staff row
    const fakeUserId = uuidv7();
    await admin.query(
      "insert into users (id, phone) values ($1, $2)",
      [fakeUserId, "+1-" + RUN + "-receptionist"],
    );
    const fakeStaffId = await withTenant(tenantId, async (tx) => {
      const [p] = await tx
        .insert(persons)
        .values({ tenantId, fullName: "Receptionist", dateOfBirth: "1990-01-01" })
        .returning({ id: persons.id });
      const [s] = await tx
        .insert(staff)
        .values({
          tenantId,
          personId: asPersonId(p!.id),
          staffType: "receptionist",
          userId: asUserId(fakeUserId),
        })
        .returning({ id: staff.id });
      return s!.id;
    });
    const result = await substituteCoach(
      { tenantId, userId: SYSTEM_USER },
      { sessionId, newCoachId: fakeStaffId },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("coach_not_found");
    }
  });

  it("rejects a substitute id that doesn't exist at all", async () => {
    const result = await substituteCoach(
      { tenantId, userId: SYSTEM_USER },
      { sessionId, newCoachId: uuidv7() },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("coach_not_found");
    }
  });

  it("rejects a session that doesn't belong to this tenant", async () => {
    const result = await substituteCoach(
      { tenantId, userId: SYSTEM_USER },
      { sessionId: uuidv7(), newCoachId: coachBStaffId },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("session_not_found");
    }
  });
});
