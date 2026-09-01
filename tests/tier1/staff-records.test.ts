import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { locations, persons } from "@/db/schema";
import { createMember } from "@/lib/services/register";
import { createStaff, listStaff } from "@/lib/services/staff";
import { asTenantId, type TenantId } from "@/lib/ids";

// Non-Tier-1 safety net, same shape as the other lib/services/*.test.ts
// files. C-04's own done-when: "one person can be both a coach and a
// member."

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

let tenantId: TenantId = asTenantId("");
let locationId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Staff Records', $3, $4)",
    [tenantId, `staff-records-${RUN}`, plan.rows[0]?.id ?? null, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Staff Hall", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from batches where tenant_id = $1", [tenantId]);
    await admin.query("delete from staff where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

describe("createStaff", () => {
  it("creates a new person and a staff row for them", async () => {
    const result = await createStaff(
      { tenantId, userId: undefined },
      { fullName: "New Coach", staffType: "coach" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await listStaff({ tenantId, userId: undefined }, { staffType: "coach" });
    expect(rows.some((r) => r.id === result.staffId && r.fullName === "New Coach")).toBe(true);
  });

  it("links an existing person as staff, rejecting an unknown one", async () => {
    const [person] = await withTenant(tenantId, (tx) =>
      tx.insert(persons).values({ tenantId, fullName: "Existing Person" }).returning({ id: persons.id }),
    );

    const ok = await createStaff(
      { tenantId, userId: undefined },
      { existingPersonId: person.id, staffType: "worker" },
    );
    expect(ok.ok).toBe(true);

    const missing = await createStaff(
      { tenantId, userId: undefined },
      { existingPersonId: uuidv7(), staffType: "worker" },
    );
    expect(missing.ok).toBe(false);
  });

  it("refuses a second identical (person, staffType) staff row", async () => {
    const [person] = await withTenant(tenantId, (tx) =>
      tx.insert(persons).values({ tenantId, fullName: "Dup Type Person" }).returning({ id: persons.id }),
    );
    const first = await createStaff(
      { tenantId, userId: undefined },
      { existingPersonId: person.id, staffType: "accountant" },
    );
    expect(first.ok).toBe(true);

    const second = await createStaff(
      { tenantId, userId: undefined },
      { existingPersonId: person.id, staffType: "accountant" },
    );
    expect(second.ok).toBe(false);
  });

  it("one person can be both a coach and a member", async () => {
    const member = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Coach Who Swims",
        dateOfBirth: "1990-01-01",
        locationId,
        memberCode: `STF-${RUN}-dual`,
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
        ],
      },
    );
    if (!member.ok) throw new Error("fixture failed: " + member.error);

    const staffResult = await createStaff(
      { tenantId, userId: undefined },
      { existingPersonId: member.personId, staffType: "coach" },
    );
    expect(staffResult.ok).toBe(true);

    const [personRow] = await withTenant(tenantId, (tx) =>
      tx.select().from(persons).where(eq(persons.id, member.personId)),
    );
    expect(personRow.id).toBe(member.personId); // still one person, one row
  });
});

describe("listStaff", () => {
  it("filters by staffType", async () => {
    await createStaff({ tenantId, userId: undefined }, { fullName: "Filter Worker", staffType: "worker" });
    const workers = await listStaff({ tenantId, userId: undefined }, { staffType: "worker" });
    expect(workers.every((r) => r.staffType === "worker")).toBe(true);
    expect(workers.length).toBeGreaterThan(0);
  });
});
