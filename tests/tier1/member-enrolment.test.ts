import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { batches, locations, programs } from "@/db/schema";
import { createMember, enrolMember } from "@/lib/services/register";
import { listMemberEnrolments } from "@/lib/services/enrolment";
import { asTenantId, type TenantId, type UserId } from "@/lib/ids";

// B3 — a member created via reception's add-member form, or produced by
// converting an enquiry with no prior trial booking, had no batch and
// no way in the UI to get one: enrolMember() (lib/services/register.ts)
// had exactly one reachable caller (bookTrial). listMemberEnrolments is
// the read side the member detail page uses to decide between an
// "enrol" empty state and a list of current batches.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);

let tenantId: TenantId = asTenantId("");
let batchId = "";
let programName = "";
let mainLocationId = "";
let memberId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id) values ($1, $2, 'Enrolment Read', $3)",
    [tenantId, `enrol-read-${RUN}`, plan.rows[0]?.id ?? null],
  );

  programName = `Read Program ${RUN}`;
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Read Hall", isPrimary: true })
      .returning({ id: locations.id });
    mainLocationId = loc.id;
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, name: programName })
      .returning({ id: programs.id });
    const [b] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId: p.id,
        name: "Read Batch",
        capacity: 10,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "07:00",
        endTime: "08:00",
      })
      .returning({ id: batches.id });
    batchId = b.id;
  });

  const created = await createMember(
    { tenantId, userId: undefined as unknown as UserId },
    {
      fullName: "Enrolment Read Member",
      dateOfBirth: "1990-01-01",
      locationId: mainLocationId,
      memberCode: `ENR-${RUN}`,
      consents: [
        { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test-fixture" } },
      ],
    },
  );
  if (!created.ok) throw new Error(`fixture setup: createMember failed — ${created.error}`);
  memberId = created.memberId;
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from enrolments where tenant_id = $1", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from guardianships where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("listMemberEnrolments", () => {
  it("returns an empty array for a member enrolled in nothing", async () => {
    const rows = await listMemberEnrolments({ tenantId }, memberId);
    expect(rows).toEqual([]);
  });

  it("returns the batch and program name after enrolling", async () => {
    const result = await enrolMember({ tenantId }, { memberId, batchId });
    expect(result.ok).toBe(true);

    const rows = await listMemberEnrolments({ tenantId }, memberId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      batchId,
      batchName: "Read Batch",
      programName,
    });
  });
});
