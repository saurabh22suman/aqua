import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { persons, staff } from "@/db/schema";
import {
  createBatch,
  createProgram,
  deleteBatch,
  deleteProgram,
  listBatches,
  listCoaches,
  listPrograms,
} from "@/lib/services/programs";
import { enrolMember, createMember } from "@/lib/services/register";
import { locations } from "@/db/schema/locations";
import { asTenantId, type TenantId } from "@/lib/ids";

// C-16/C-17 completion: coach picker, soft delete, list-refresh data
// shape. Non-Tier-1 safety net, same pattern as programs-batches-
// crud.test.ts.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
let tenantId: TenantId = asTenantId("");
let locationId = "";
let coachStaffId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id) values ($1, $2, 'Programs Completion', $3)",
    [tenantId, `programs-completion-${RUN}`, plan.rows[0]?.id ?? null],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Completion Hall", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc.id;

    const [person] = await tx
      .insert(persons)
      .values({ tenantId, fullName: "Assignable Coach" })
      .returning({ id: persons.id });
    const [staffRow] = await tx
      .insert(staff)
      .values({ tenantId, personId: person.id, staffType: "coach" })
      .returning({ id: staff.id });
    coachStaffId = staffRow.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from enrolments where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from staff where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("coach assignment", () => {
  it("listCoaches returns the seeded coach", async () => {
    const coaches = await listCoaches({ tenantId });
    expect(coaches.some((c) => c.staffId === coachStaffId && c.fullName === "Assignable Coach")).toBe(true);
  });

  it("createBatch accepts a coachId and listBatches reports the coach's name", async () => {
    const program = await createProgram({ tenantId }, { name: "Coached Program" });
    const batch = await createBatch(
      { tenantId },
      {
        programId: program.id,
        name: "Coached Batch",
        capacity: 10,
        daysOfWeek: [1, 3],
        startTime: "07:00",
        endTime: "08:00",
        coachId: coachStaffId,
      },
    );
    expect(batch.coachName).toBe("Assignable Coach");

    const rows = await listBatches({ tenantId });
    const found = rows.find((b) => b.id === batch.id);
    expect(found?.coachName).toBe("Assignable Coach");
  });

  it("a batch with no coach reports a null coachName, not an error", async () => {
    const program = await createProgram({ tenantId }, { name: "Uncoached Program" });
    const batch = await createBatch(
      { tenantId },
      {
        programId: program.id,
        name: "Uncoached Batch",
        capacity: 10,
        daysOfWeek: [1],
        startTime: "07:00",
        endTime: "08:00",
      },
    );
    expect(batch.coachName).toBeNull();
  });
});

describe("soft delete", () => {
  it("deleteProgram refuses while a live batch still references it", async () => {
    const program = await createProgram({ tenantId }, { name: "Program With Batch" });
    await createBatch(
      { tenantId },
      { programId: program.id, name: "Blocking Batch", capacity: 5, daysOfWeek: [1], startTime: "07:00", endTime: "08:00" },
    );

    const result = await deleteProgram({ tenantId }, program.id);
    expect(result.ok).toBe(false);

    const listed = await listPrograms({ tenantId });
    expect(listed.map((p) => p.id)).toContain(program.id);
  });

  it("deleteBatch removes it from listBatches; the program can then be deleted", async () => {
    const program = await createProgram({ tenantId }, { name: "Deletable Chain Program" });
    const batch = await createBatch(
      { tenantId },
      { programId: program.id, name: "Deletable Batch", capacity: 5, daysOfWeek: [1], startTime: "07:00", endTime: "08:00" },
    );

    const batchDelete = await deleteBatch({ tenantId }, batch.id);
    expect(batchDelete.ok).toBe(true);
    expect((await listBatches({ tenantId })).map((b) => b.id)).not.toContain(batch.id);

    const programDelete = await deleteProgram({ tenantId }, program.id);
    expect(programDelete.ok).toBe(true);
    expect((await listPrograms({ tenantId })).map((p) => p.id)).not.toContain(program.id);
  });

  it("a deleted batch refuses new enrolments, same as a nonexistent one", async () => {
    const program = await createProgram({ tenantId }, { name: "Enrol Refusal Program" });
    const batch = await createBatch(
      { tenantId },
      { programId: program.id, name: "Enrol Refusal Batch", capacity: 5, daysOfWeek: [1], startTime: "07:00", endTime: "08:00" },
    );
    await deleteBatch({ tenantId }, batch.id);

    const member = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Refused Enrolment Subject",
        dateOfBirth: "1990-01-01",
        locationId,
        memberCode: `PBC-${RUN}-refused`,
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
        ],
      },
    );
    if (!member.ok) throw new Error("fixture failed");

    const result = await enrolMember({ tenantId }, { memberId: member.memberId, batchId: batch.id });
    expect(result.ok).toBe(false);
  });
});
