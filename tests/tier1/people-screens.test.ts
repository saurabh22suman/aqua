import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { locations } from "@/db/schema";
import { createMember } from "@/lib/services/register";
import {
  getMemberDetail,
  listMembers,
  nextMemberCode,
  searchPersons,
  updateMember,
} from "@/lib/services/people";
import { asTenantId, type TenantId } from "@/lib/ids";

// Non-Tier-1 safety net, same shape as consent-schema.test.ts and
// member-status-lifecycle.test.ts. C-06's own done-when: "a
// receptionist adds a member with a guardian in under ninety
// seconds" -- this covers the service-layer plumbing that screen
// depends on: search/filter, detail assembly (guardians, consents,
// status history), edit, guardian resolution, and code generation.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

let tenantId: TenantId = asTenantId("");
let locationId = "";
let otherLocationId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'People Screens', $3, $4)",
    [tenantId, `people-screens-${RUN}`, plan.rows[0]?.id ?? null, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Main Hall", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc.id;
    const [loc2] = await tx
      .insert(locations)
      .values({ tenantId, name: "Annex" })
      .returning({ id: locations.id });
    otherLocationId = loc2.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from member_status_transitions where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from guardianships where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

async function newAdultMember(label: string, phone?: string) {
  const created = await createMember(
    { tenantId, userId: undefined },
    {
      fullName: `Screen Subject ${label}`,
      phone,
      dateOfBirth: "1990-01-01",
      locationId,
      memberCode: `PPL-${RUN}-${label}`,
      consents: [
        { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
      ],
    },
  );
  if (!created.ok) throw new Error("fixture setup failed: " + created.error);
  return created;
}

describe("listMembers — search and filters", () => {
  it("finds a member by a phone substring", async () => {
    await newAdultMember("phone-search", "9876500001");
    const rows = await listMembers({ tenantId, userId: undefined }, { search: "765000" });
    expect(rows.some((r) => r.phone === "9876500001")).toBe(true);
  });

  it("finds a member by a name substring, case-insensitively", async () => {
    await newAdultMember("Findable-Name");
    const rows = await listMembers({ tenantId, userId: undefined }, { search: "findable-name" });
    expect(rows.some((r) => r.fullName.includes("Findable-Name"))).toBe(true);
  });

  it("filters by location", async () => {
    const created = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Annex Member",
        dateOfBirth: "1990-01-01",
        locationId: otherLocationId,
        memberCode: `PPL-${RUN}-annex`,
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
        ],
      },
    );
    if (!created.ok) throw new Error("fixture failed");

    const rows = await listMembers({ tenantId, userId: undefined }, { locationId: otherLocationId });
    expect(rows.every((r) => r.locationId === otherLocationId)).toBe(true);
    expect(rows.some((r) => r.memberId === created.memberId)).toBe(true);
  });

  it("filters by status", async () => {
    const active = await newAdultMember("status-filter-active");
    const rows = await listMembers({ tenantId, userId: undefined }, { status: "active" });
    expect(rows.some((r) => r.memberId === active.memberId)).toBe(true);
    expect(rows.every((r) => r.status === "active")).toBe(true);
  });
});

describe("a null date of birth on a legacy row doesn't crash reads", () => {
  // createMemberSchema has always required dateOfBirth, but the column
  // itself is nullable and rows can predate that requirement (found by
  // manually exercising /owner/members against the seeded demo tenant,
  // which crashed with a 500 -- isMinor() deliberately throws on null,
  // correct at registration, wrong on every read path).
  it("listMembers and getMemberDetail treat an unknown DOB as not-a-minor, not a crash", async () => {
    const created = await newAdultMember("null-dob");
    await admin.query("update persons set date_of_birth = null where id = $1", [created.personId]);

    const rows = await listMembers({ tenantId, userId: undefined }, {});
    const row = rows.find((r) => r.memberId === created.memberId);
    expect(row?.isMinor).toBe(false);

    const detail = await getMemberDetail({ tenantId, userId: undefined }, created.memberId);
    expect(detail?.isMinor).toBe(false);
    expect(detail?.dateOfBirth).toBeNull();
  });
});

describe("getMemberDetail", () => {
  it("returns null for a member outside the tenant (or nonexistent)", async () => {
    const detail = await getMemberDetail({ tenantId, userId: undefined }, uuidv7());
    expect(detail).toBeNull();
  });

  it("assembles person, guardian, consents and status history for a minor", async () => {
    const created = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Detail Minor",
        dateOfBirth: "2015-01-01",
        locationId,
        memberCode: `PPL-${RUN}-detail-minor`,
        guardian: { fullName: "Detail Guardian", phone: "9876500002", relationship: "mother" },
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
        ],
      },
    );
    if (!created.ok) throw new Error("fixture failed: " + created.error);

    const detail = await getMemberDetail({ tenantId, userId: undefined }, created.memberId);
    expect(detail).not.toBeNull();
    expect(detail!.isMinor).toBe(true);
    expect(detail!.guardians).toHaveLength(1);
    expect(detail!.guardians[0].fullName).toBe("Detail Guardian");
    expect(detail!.guardians[0].phone).toBe("9876500002");
    expect(detail!.consents.some((c) => c.purpose === "processing")).toBe(true);
    expect(detail!.statusHistory).toEqual([]); // no transitions yet
  });
});

describe("updateMember", () => {
  it("edits person and location fields", async () => {
    const created = await newAdultMember("editable");
    const result = await updateMember({ tenantId, userId: undefined }, created.memberId, {
      fullName: "Renamed Subject",
      phone: "9876500003",
      dateOfBirth: "1991-02-02",
      locationId: otherLocationId,
    });
    expect(result.ok).toBe(true);

    const detail = await getMemberDetail({ tenantId, userId: undefined }, created.memberId);
    expect(detail!.fullName).toBe("Renamed Subject");
    expect(detail!.phone).toBe("9876500003");
    expect(detail!.locationId).toBe(otherLocationId);
  });
});

describe("searchPersons — guardian resolution", () => {
  it("excludes minors from results", async () => {
    const minorCreated = await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Search Excluded Minor Unique",
        dateOfBirth: "2015-01-01",
        locationId,
        memberCode: `PPL-${RUN}-search-minor`,
        guardian: { fullName: "Search Minor Guardian", relationship: "father" },
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
        ],
      },
    );
    if (!minorCreated.ok) throw new Error("fixture failed");

    const results = await searchPersons({ tenantId, userId: undefined }, "Search Excluded Minor Unique");
    expect(results).toHaveLength(0);
  });

  it("finds an existing adult by name for guardian linking", async () => {
    await newAdultMember("Guardian-Findable-Unique");
    const results = await searchPersons({ tenantId, userId: undefined }, "Guardian-Findable-Unique");
    expect(results.some((r) => r.fullName.includes("Guardian-Findable-Unique"))).toBe(true);
  });
});

describe("nextMemberCode", () => {
  it("generates sequential, prefixed codes", async () => {
    const first = await nextMemberCode({ tenantId, userId: undefined }, "SEQ");
    await createMember(
      { tenantId, userId: undefined },
      {
        fullName: "Seq Subject",
        dateOfBirth: "1990-01-01",
        locationId,
        memberCode: first,
        consents: [
          { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
        ],
      },
    );
    const second = await nextMemberCode({ tenantId, userId: undefined }, "SEQ");
    expect(second).not.toBe(first);
  });
});
