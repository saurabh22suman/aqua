import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { batches, enrolments, locations, programs } from "@/db/schema";
import { createMember, enrolMember } from "@/lib/services/register";
import { asTenantId, type TenantId, type UserId } from "@/lib/ids";

// tenants has FORCE row level security, so fixture rows must be created
// through the privileged migration pool, never the app pool.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const CAPACITY = 2;

let tenantId: TenantId = asTenantId("");
let batchId = "";
let mainLocationId = "";
const memberIds: string[] = [];

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id) values ($1, $2, 'Enrolment Capacity', $3)",
    [tenantId, `enrol-cap-${RUN}`, plan.rows[0]?.id ?? null],
  );

  let programId = "";
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Capacity Hall", isPrimary: true })
      .returning({ id: locations.id });
    mainLocationId = loc.id;
    const [p] = await tx
      .insert(programs)
      .values({ tenantId, name: "Capacity Program" })
      .returning({ id: programs.id });
    programId = p.id;
    const [b] = await tx
      .insert(batches)
      .values({
        tenantId,
        programId,
        name: "Tiny Batch",
        capacity: CAPACITY,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        startTime: "07:00",
        endTime: "08:00",
      })
      .returning({ id: batches.id });
    batchId = b.id;
  });

  for (let i = 0; i < 3; i++) {
    const created = await createMember(
      { tenantId, userId: undefined as unknown as UserId },
      {
        fullName: `Capacity Member ${i}`,
        dateOfBirth: "1990-01-01",
        locationId: mainLocationId,
        memberCode: `CAP-${RUN}-${i}`,
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test-fixture" } },
        ],
      },
    );
    if (!created.ok) throw new Error(`fixture setup: createMember failed — ${created.error}`);
    memberIds.push(created.memberId);
  }
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

// C-18's own stated done-when, previously unmet: enrolMember
// (lib/services/register.ts) did a raw insert with no capacity check
// at all -- a batch at capacity would silently oversell.
describe("enrolMember refuses to oversell a batch's capacity", () => {
  it("fills a 2-capacity batch with exactly 2 members", async () => {
    const a = await enrolMember({ tenantId }, { memberId: memberIds[0], batchId });
    const b = await enrolMember({ tenantId }, { memberId: memberIds[1], batchId });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(enrolments).where(eqBatch(batchId)),
    );
    expect(rows).toHaveLength(2);
  });

  it("refuses the enrolment that would exceed capacity, with a clear message", async () => {
    const result = await enrolMember({ tenantId }, { memberId: memberIds[2], batchId });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/full|capacity/i);

    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(enrolments).where(eqBatch(batchId)),
    );
    expect(rows).toHaveLength(2);
  });

  it("re-enrolling an already-enrolled member on a new date is not blocked by capacity", async () => {
    const result = await enrolMember(
      { tenantId },
      { memberId: memberIds[0], batchId, enrolledOn: "2030-01-01" },
    );
    expect(result.ok).toBe(true);
  });
});

// The three tests above are sequential — they prove the check works,
// not that it's race-free. Count-then-insert across two round trips is
// a classic TOCTOU: concurrent callers can all read the same
// under-capacity count before any of them commits their insert.
// testing-strategy.md §4.3's own pattern (fifty parallel invoices) is
// exactly this shape of test, for exactly this reason.
describe("enrolMember under real concurrency", () => {
  it("ten concurrent enrolments into a five-capacity batch never exceed five", async () => {
    const capacity = 5;
    const contenders = 10;

    let raceBatchId = "";
    await withTenant(tenantId, async (tx) => {
      const [p] = await tx
        .select({ id: programs.id })
        .from(programs)
        .where(eq(programs.tenantId, tenantId))
        .limit(1);
      const [b] = await tx
        .insert(batches)
        .values({
          tenantId,
          programId: p.id,
          name: "Race Batch",
          capacity,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          startTime: "07:00",
          endTime: "08:00",
        })
        .returning({ id: batches.id });
      raceBatchId = b.id;
    });

    const raceMemberIds: string[] = [];
    for (let i = 0; i < contenders; i++) {
      const created = await createMember(
        { tenantId, userId: undefined as unknown as UserId },
        {
          fullName: `Race Member ${i}`,
          dateOfBirth: "1990-01-01",
          locationId: mainLocationId,
          memberCode: `RACE-${RUN}-${i}`,
          consents: [
            { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "test-fixture" } },
          ],
        },
      );
      if (!created.ok) throw new Error(`fixture setup: createMember failed — ${created.error}`);
      raceMemberIds.push(created.memberId);
    }

    const results = await Promise.all(
      raceMemberIds.map((memberId) =>
        enrolMember({ tenantId }, { memberId, batchId: raceBatchId }),
      ),
    );

    const succeeded = results.filter((r) => r.ok).length;
    expect(succeeded).toBe(capacity);

    const rows = await withTenant(tenantId, (tx) =>
      tx.select().from(enrolments).where(eqBatch(raceBatchId)),
    );
    expect(rows).toHaveLength(capacity);
  });
});

function eqBatch(id: string) {
  return eq(enrolments.batchId, id);
}
