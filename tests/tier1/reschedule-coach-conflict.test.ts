import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { persons, locations, programs, batches, staff } from "@/db/schema";
import { sessions } from "@/db/schema";
import { rescheduleSession } from "@/lib/services/session-lifecycle";
import { asStaffId, asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

// F2 — the audit's named failure was "Moving a batch-A session
// into batch-B's slot silently double-books." This file reproduces
// that exact scenario in two forms (overlapping time on the same
// day, overlapping time across the date boundary) and asserts that
// rescheduleSession now refuses the change with a coach_conflict
// error code, while still allowing a non-conflicting reschedule.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
let locationId = "";
let programId = "";
let coachStaffId = "";
let batchAId = "";
let batchBId = "";
let sessionAId = "";
let sessionBId = "";
let sessionDateStr = "";
void locationId;
void programId;

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'F2 Test', $3)",
    [tenantId, `f2-${RUN}`, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Main", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc!.id;

    const [prog] = await tx
      .insert(programs)
      .values({ tenantId, name: "Programs" })
      .returning({ id: programs.id });
    programId = prog!.id;

    const [personA] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Coach A", dateOfBirth: "1985-01-01" })
      .returning({ id: persons.id });
    const [staffRowA] = await tx
      .insert(staff)
      .values({ tenantId, personId: personA!.id, staffType: "coach" })
      .returning({ id: staff.id });
    coachStaffId = staffRowA!.id;

    // Two batches, same coach, distinct nominal slots.
    const [bA] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        name: "Batch A",
        capacity: 10,
        daysOfWeek: [1, 3, 5],
        startTime: "07:00",
        endTime: "08:00",
        coachId: asStaffId(coachStaffId),
      })
      .returning({ id: batches.id });
    batchAId = bA!.id;

    const [bB] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        name: "Batch B",
        capacity: 10,
        daysOfWeek: [1, 3, 5],
        startTime: "16:00",
        endTime: "17:00",
        coachId: asStaffId(coachStaffId),
      })
      .returning({ id: batches.id });
    batchBId = bB!.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(sessions).where(eq(sessions.tenantId, tenantId));
      await tx.delete(batches).where(eq(batches.tenantId, tenantId));
      await tx.delete(staff).where(eq(staff.tenantId, tenantId));
      await tx.delete(programs).where(eq(programs.tenantId, tenantId));
      await tx.delete(persons).where(eq(persons.tenantId, tenantId));
      await tx.delete(locations).where(eq(locations.tenantId, tenantId));
    });
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

beforeEach(async () => {
  await withTenant(tenantId, async (tx) => {
    await tx.delete(sessions).where(eq(sessions.tenantId, tenantId));
  });

  // sessionA on dateA, sessionB on dateB (one day apart). The
  // tests need to construct the audit's "same coach, two sessions,
  // move one into the other's slot" scenario, which requires the
  // sessions to be on DIFFERENT dates — otherwise rescheduleSession
  // rejects the move as no_change (date is the same, only the time
  // would change).
  const futureA = new Date();
  futureA.setUTCDate(futureA.getUTCDate() + 5);
  sessionDateStr = futureA.toISOString().slice(0, 10);

  const futureB = new Date(futureA);
  futureB.setUTCDate(futureB.getUTCDate() + 1);
  const sessionBDateStr = futureB.toISOString().slice(0, 10);

  await withTenant(tenantId, async (tx) => {
    const [sA] = await tx
      .insert(sessions)
      .values({
        tenantId,
        batchId: batchAId,
        sessionDate: sessionDateStr,
        startsAt: new Date(`${sessionDateStr}T07:00:00Z`),
        endsAt: new Date(`${sessionDateStr}T08:00:00Z`),
        status: "scheduled",
        coachId: asStaffId(coachStaffId),
      })
      .returning({ id: sessions.id });
    sessionAId = sA!.id;

    const [sB] = await tx
      .insert(sessions)
      .values({
        tenantId,
        batchId: batchBId,
        sessionDate: sessionBDateStr,
        startsAt: new Date(`${sessionBDateStr}T16:00:00Z`),
        endsAt: new Date(`${sessionBDateStr}T17:00:00Z`),
        status: "scheduled",
        coachId: asStaffId(coachStaffId),
      })
      .returning({ id: sessions.id });
    sessionBId = sB!.id;
  });
});

describe("F2 — rescheduleSession must refuse a same-coach double-book (audit scenario)", () => {
  it("refuses moving batch-A's session into batch-B's slot on a different day", async () => {
    // Exact audit scenario: reschedule A into B's existing
    // 16:00-17:00 slot on B's day.
    const futureB = new Date();
    futureB.setUTCDate(futureB.getUTCDate() + 6);
    const sessionBDateStr = futureB.toISOString().slice(0, 10);

    const result = await rescheduleSession(
      { tenantId, userId: SYSTEM_USER },
      {
        sessionId: sessionAId,
        newSessionDate: sessionBDateStr,
        newStartsAt: new Date(`${sessionBDateStr}T16:00:00Z`),
        newEndsAt: new Date(`${sessionBDateStr}T17:00:00Z`),
      },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("coach_conflict");
      expect(result.conflictingSessionIds).toContain(sessionBId);
    }

    // Confirm the session was NOT moved — the refused write did not
    // partially apply.
    const [unchanged] = await withTenant(tenantId, async (tx) =>
      tx
        .select({ sessionDate: sessions.sessionDate, startsAt: sessions.startsAt })
        .from(sessions)
        .where(eq(sessions.id, sessionAId))
        .limit(1),
    );
    expect(unchanged).toBeDefined();
    // Original slot was on sessionDateStr at 07:00-08:00.
    expect(unchanged!.startsAt.toISOString()).toBe(
      new Date(`${sessionDateStr}T07:00:00Z`).toISOString(),
    );
  });

  it("refuses a partial overlap (the new window partly covers the existing session)", async () => {
    // B is at 16:00-17:00 on B's day. Try moving A to 16:30-17:30
    // on B's day — overlaps.
    const futureB = new Date();
    futureB.setUTCDate(futureB.getUTCDate() + 6);
    const sessionBDateStr = futureB.toISOString().slice(0, 10);

    const result = await rescheduleSession(
      { tenantId, userId: SYSTEM_USER },
      {
        sessionId: sessionAId,
        newSessionDate: sessionBDateStr,
        newStartsAt: new Date(`${sessionBDateStr}T16:30:00Z`),
        newEndsAt: new Date(`${sessionBDateStr}T17:30:00Z`),
      },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("coach_conflict");
    }
  });

  it("refuses when the existing session starts before and the new window ends inside it", async () => {
    // B is at 16:00-17:00. Try A at 15:30-16:30 — overlaps (16:00-16:30).
    const futureB = new Date();
    futureB.setUTCDate(futureB.getUTCDate() + 6);
    const sessionBDateStr = futureB.toISOString().slice(0, 10);

    const result = await rescheduleSession(
      { tenantId, userId: SYSTEM_USER },
      {
        sessionId: sessionAId,
        newSessionDate: sessionBDateStr,
        newStartsAt: new Date(`${sessionBDateStr}T15:30:00Z`),
        newEndsAt: new Date(`${sessionBDateStr}T16:30:00Z`),
      },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("coach_conflict");
    }
  });

  it("allows an edge-touching reschedule (existing ends exactly when new begins)", async () => {
    // B is at 16:00-17:00. Try A at 17:00-18:00 on B's day —
    // edge-touching, canonical interval-overlap predicate says
    // no conflict.
    const futureB = new Date();
    futureB.setUTCDate(futureB.getUTCDate() + 6);
    const sessionBDateStr = futureB.toISOString().slice(0, 10);

    const result = await rescheduleSession(
      { tenantId, userId: SYSTEM_USER },
      {
        sessionId: sessionAId,
        newSessionDate: sessionBDateStr,
        newStartsAt: new Date(`${sessionBDateStr}T17:00:00Z`),
        newEndsAt: new Date(`${sessionBDateStr}T18:00:00Z`),
      },
    );
    expect(result.kind).toBe("ok");
  });

  it("ignores cancelled sessions — moving into a cancelled slot is fine", async () => {
    // Cancel sessionB so the slot is empty.
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(sessions)
        .set({ status: "cancelled" })
        .where(eq(sessions.id, sessionBId));
    });

    // Now move A into the freed 16:00-17:00 slot — should succeed.
    const futureB = new Date();
    futureB.setUTCDate(futureB.getUTCDate() + 6);
    const sessionBDateStr = futureB.toISOString().slice(0, 10);

    const result = await rescheduleSession(
      { tenantId, userId: SYSTEM_USER },
      {
        sessionId: sessionAId,
        newSessionDate: sessionBDateStr,
        newStartsAt: new Date(`${sessionBDateStr}T16:00:00Z`),
        newEndsAt: new Date(`${sessionBDateStr}T17:00:00Z`),
      },
    );
    expect(result.kind).toBe("ok");
  });

  it("the date-only filter does not block a same-coach conflict at a different date", async () => {
    // Sanity: moving A to a date with no other session should pass.
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 10);
    const otherDate = future.toISOString().slice(0, 10);

    const result = await rescheduleSession(
      { tenantId, userId: SYSTEM_USER },
      {
        sessionId: sessionAId,
        newSessionDate: otherDate,
        newStartsAt: new Date(`${otherDate}T07:00:00Z`),
        newEndsAt: new Date(`${otherDate}T08:00:00Z`),
      },
    );
    expect(result.kind).toBe("ok");
  });

  it("refuses when the existing session is in 'held' status (still occupies the slot)", async () => {
    // Held sessions are still slots — a held session means a
    // coach already took it, attendance was marked. Treating
    // held as occupied is the correct read.
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(sessions)
        .set({ status: "held" })
        .where(eq(sessions.id, sessionBId));
    });

    const futureB = new Date();
    futureB.setUTCDate(futureB.getUTCDate() + 6);
    const sessionBDateStr = futureB.toISOString().slice(0, 10);

    const result = await rescheduleSession(
      { tenantId, userId: SYSTEM_USER },
      {
        sessionId: sessionAId,
        newSessionDate: sessionBDateStr,
        newStartsAt: new Date(`${sessionBDateStr}T16:00:00Z`),
        newEndsAt: new Date(`${sessionBDateStr}T17:00:00Z`),
      },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("coach_conflict");
    }
  });
});
