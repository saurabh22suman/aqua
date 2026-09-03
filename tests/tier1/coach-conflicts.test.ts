import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq, sql } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { persons, locations, programs, staff, batches } from "@/db/schema";
import { detectCoachConflicts } from "@/lib/services/coach-conflicts";
import {
  asTenantId,
  asStaffId,
  asUserId,
  type TenantId,
  type UserId,
} from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");

let programId = "";
let coachStaffId = "";
let otherCoachStaffId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Coach Conflict Test', $3)",
    [tenantId, `coach-conflict-${RUN}`, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Main", isPrimary: true })
      .returning({ id: locations.id });
    // location is required by the schema location_id FK on
    // persons/members; the conflict detection service itself
    // doesn't touch it, but every setup row needs one.
    void loc;
    const [prog] = await tx
      .insert(programs)
      .values({ tenantId, name: "Reports Program" })
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

    const [personB] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Coach B", dateOfBirth: "1985-01-01" })
      .returning({ id: persons.id });
    const [staffRowB] = await tx
      .insert(staff)
      .values({ tenantId, personId: personB!.id, staffType: "coach" })
      .returning({ id: staff.id });
    otherCoachStaffId = staffRowB!.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
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
  // Each case fabricates its own batches against the shared
  // fixture; wipe the table between cases so earlier cases
  // don't pollute later overlap assertions.
  await withTenant(tenantId, async (tx) => {
    await tx.delete(batches).where(eq(batches.tenantId, tenantId));
  });
});

async function makeBatch(
  name: string,
  days: number[],
  startTime: string,
  endTime: string,
  coachId: string,
): Promise<string> {
  let id = "";
  await withTenant(tenantId, async (tx) => {
    const [b] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        name,
        capacity: 10,
        daysOfWeek: days,
        startTime,
        endTime,
        coachId: asStaffId(coachId),
      })
      .returning({ id: batches.id });
    id = b!.id;
  });
  return id;
}

describe("detectCoachConflicts (Phase R.2)", () => {
  it("returns no conflicts when no other batch uses this coach on these days", async () => {
    await makeBatch("Other coach batch", [1, 2], "07:00", "08:00", otherCoachStaffId);

    const result = await detectCoachConflicts(
      { tenantId, userId: SYSTEM_USER },
      {
        coachId: coachStaffId,
        daysOfWeek: [1, 3],
        startTime: "07:00",
        endTime: "08:00",
      },
    );
    expect(result.conflicts).toEqual([]);
  });

  it("flags a same-coach batch with overlapping days AND overlapping time", async () => {
    const conflict = await makeBatch("Conflict A", [1, 3], "07:30", "08:30", coachStaffId);

    const result = await detectCoachConflicts(
      { tenantId, userId: SYSTEM_USER },
      {
        coachId: coachStaffId,
        daysOfWeek: [1, 3],
        startTime: "07:00",
        endTime: "08:00",
      },
    );
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].batchId).toBe(conflict);
    expect(result.conflicts[0].daysOverlap.sort()).toEqual([1, 3]);
  });

  it("returns no conflict for a coach on different days, even at the same time", async () => {
    await makeBatch("Different day", [2, 4], "07:00", "08:00", coachStaffId);

    const result = await detectCoachConflicts(
      { tenantId, userId: SYSTEM_USER },
      {
        coachId: coachStaffId,
        daysOfWeek: [1, 3],
        startTime: "07:00",
        endTime: "08:00",
      },
    );
    expect(result.conflicts).toEqual([]);
  });

  it("returns no conflict for same days but edge-touching time (07:00-08:00 vs 08:00-09:00)", async () => {
    await makeBatch("Edge touching", [1, 3], "08:00", "09:00", coachStaffId);

    const result = await detectCoachConflicts(
      { tenantId, userId: SYSTEM_USER },
      {
        coachId: coachStaffId,
        daysOfWeek: [1, 3],
        startTime: "07:00",
        endTime: "08:00",
      },
    );
    expect(result.conflicts).toEqual([]);
  });

  it("flags two same-coach batches when they both overlap the candidate", async () => {
    const a = await makeBatch("Twin A", [2], "07:00", "08:00", coachStaffId);
    const b = await makeBatch("Twin B", [2, 4], "07:30", "08:30", coachStaffId);

    const result = await detectCoachConflicts(
      { tenantId, userId: SYSTEM_USER },
      {
        coachId: coachStaffId,
        daysOfWeek: [2],
        startTime: "07:15",
        endTime: "07:45",
      },
    );
    const ids = result.conflicts.map((c) => c.batchId).sort();
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(result.conflicts).toHaveLength(2);
  });

  it("excludeBatchId drops the batch itself from results", async () => {
    const editingId = await makeBatch("Editing this batch", [1, 3], "07:30", "08:30", coachStaffId);

    const result = await detectCoachConflicts(
      { tenantId, userId: SYSTEM_USER },
      {
        coachId: coachStaffId,
        daysOfWeek: [1, 3],
        startTime: "07:00",
        endTime: "08:00",
        excludeBatchId: editingId,
      },
    );
    expect(result.conflicts.find((c) => c.batchId === editingId)).toBeUndefined();
  });

  it("returns empty result when no coachId is supplied (the form needs this branch)", async () => {
    const result = await detectCoachConflicts(
      { tenantId, userId: SYSTEM_USER },
      {
        coachId: "",
        daysOfWeek: [1, 3],
        startTime: "07:00",
        endTime: "08:00",
      },
    );
    expect(result.conflicts).toEqual([]);
  });
});

// Pin a few patterns we don't want to lose:
//   - sql imports here are intentional (for the test's own
//     teardown path; the service uses imports differently).
//   - afterAll uses eq() to keep the deletes in tenant scope
//     rather than a global TRUNCATE.
void eq;
void sql;