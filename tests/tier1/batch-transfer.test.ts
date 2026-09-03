import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { persons, locations, programs, batches, members } from "@/db/schema";
import { enrolments } from "@/db/schema/scheduling";
import { transferMemberToBatch } from "@/lib/services/transfer";
import { asTenantId, asUserId, asMemberId, type TenantId, type UserId } from "@/lib/ids";

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const SYSTEM_USER: UserId = asUserId("00000000-0000-0000-0000-000000000000");

let tenantId: TenantId = asTenantId("");
let locationId = "";
let programId = "";
let memberId = "";
let fromBatchId = "";
let toBatchId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  await admin.query(
    "insert into tenants (id, slug, name, timezone) values ($1, $2, 'Transfer Test', $3)",
    [tenantId, `transfer-${RUN}`, TZ],
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
  });
});

afterAll(async () => {
  if (tenantId) {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(enrolments).where(eq(enrolments.tenantId, tenantId));
      await tx.delete(members).where(eq(members.tenantId, tenantId));
      await tx.delete(batches).where(eq(batches.tenantId, tenantId));
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
    await tx.delete(enrolments).where(eq(enrolments.tenantId, tenantId));
    await tx.delete(members).where(eq(members.tenantId, tenantId));
    await tx.delete(batches).where(eq(batches.tenantId, tenantId));
  });

  await withTenant(tenantId, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Movee", dateOfBirth: "1990-01-01" })
      .returning({ id: persons.id });
    const [m] = await tx
      .insert(members)
      .values({
        tenantId,
        personId: person!.id,
        locationId,
        memberCode: `TR-${RUN}-${person!.id.slice(0, 4)}`,
        status: "active",
        createdBy: SYSTEM_USER,
        updatedBy: SYSTEM_USER,
      })
      .returning({ id: members.id });
    memberId = m!.id;

    const [from] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        name: "From Batch",
        capacity: 10,
        daysOfWeek: [1, 3, 5],
        startTime: "07:00",
        endTime: "08:00",
      })
      .returning({ id: batches.id });
    fromBatchId = from!.id;

    const [to] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        name: "To Batch",
        capacity: 10,
        daysOfWeek: [2, 4, 6],
        startTime: "17:00",
        endTime: "18:00",
      })
      .returning({ id: batches.id });
    toBatchId = to!.id;

    await tx.insert(enrolments).values({
      tenantId,
      memberId: asMemberId(memberId),
      batchId: fromBatchId,
      enrolledOn: new Date().toISOString().slice(0, 10),
      createdBy: SYSTEM_USER,
      updatedBy: SYSTEM_USER,
    });
  });
});

async function readAllEnrolments() {
  return withTenant(tenantId, async (tx) =>
    tx
      .select({
        id: enrolments.id,
        batchId: enrolments.batchId,
      })
      .from(enrolments)
      .where(eq(enrolments.tenantId, tenantId)),
  );
}

describe("transferMemberToBatch (Phase R.6)", () => {
  it("moves a member from one batch to another", async () => {
    const result = await transferMemberToBatch(
      { tenantId, userId: SYSTEM_USER },
      { memberId, fromBatchId, toBatchId },
    );
    expect(result.kind).toBe("ok");

    const rows = await readAllEnrolments();
    // After transfer: only the target enrolment row remains
    // (the source is hard-deleted, the target is inserted).
    expect(rows).toHaveLength(1);
    const target = rows.find((r) => r.batchId === toBatchId);
    expect(target).toBeDefined();
    expect(rows.find((r) => r.batchId === fromBatchId)).toBeUndefined();
  });

  it("rejects same-batch transfer (from == to)", async () => {
    const result = await transferMemberToBatch(
      { tenantId, userId: SYSTEM_USER },
      { memberId, fromBatchId, toBatchId: fromBatchId },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("invalid");
    }
  });

  it("rejects a transfer when the member is not enrolled in the source batch", async () => {
    // Use a fresh person that isn't enrolled anywhere.
    let otherMemberId = "";
    await withTenant(tenantId, async (tx) => {
      const [p] = await tx
        .insert(persons)
        .values({ tenantId, fullName: "Other", dateOfBirth: "1990-01-01" })
        .returning({ id: persons.id });
      const [m] = await tx
        .insert(members)
        .values({
          tenantId,
          personId: p!.id,
          locationId,
          memberCode: `TR-OTHER-${RUN}-${p!.id.slice(0, 4)}`,
          status: "active",
          createdBy: SYSTEM_USER,
          updatedBy: SYSTEM_USER,
        })
        .returning({ id: members.id });
      otherMemberId = m!.id;
    });

    const result = await transferMemberToBatch(
      { tenantId, userId: SYSTEM_USER },
      { memberId: otherMemberId, fromBatchId, toBatchId },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("not_enrolled_in_source");
    }
  });

  it("rejects a transfer when the destination is at full capacity (1/1)", async () => {
    // batches_capacity_check is capacity > 0; we use 1 here and
    // pre-fill to occupancy 1 by enrolling a separate person.
    await withTenant(tenantId, async (tx) => {
      await tx.update(batches).set({ capacity: 1 }).where(eq(batches.id, toBatchId));
      const [p] = await tx
        .insert(persons)
        .values({ tenantId, fullName: "Filler", dateOfBirth: "1990-01-01" })
        .returning({ id: persons.id });
      const [m] = await tx
        .insert(members)
        .values({
          tenantId,
          personId: p!.id,
          locationId,
          memberCode: `TR-FILL-${RUN}-${p!.id.slice(0, 4).replace(/-/g, "")}`,
          status: "active",
          createdBy: SYSTEM_USER,
          updatedBy: SYSTEM_USER,
        })
        .returning({ id: members.id });
      await tx.insert(enrolments).values({
        tenantId,
        memberId: m!.id,
        batchId: toBatchId,
        enrolledOn: new Date().toISOString().slice(0, 10),
        createdBy: SYSTEM_USER,
        updatedBy: SYSTEM_USER,
      });
    });
    const result = await transferMemberToBatch(
      { tenantId, userId: SYSTEM_USER },
      { memberId, fromBatchId, toBatchId },
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("target_full");
    }
  });

  it("succeeds when target has spare capacity — capacity is checked on the live row only", async () => {
    const result = await transferMemberToBatch(
      { tenantId, userId: SYSTEM_USER },
      { memberId, fromBatchId, toBatchId },
    );
    expect(result.kind).toBe("ok");
  });
});
