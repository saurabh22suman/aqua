import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, type TenantId } from "@/lib/ids";
import { listTenants } from "@/db/platform-tenants";
import { withTenant } from "@/db/tenant";
import { locations } from "@/db/schema";
import { createMember } from "@/lib/services/register";

// Phase 1.3 — tenant list with denormalised counts.
//
// The service runs in withPlatform() scope (tenants is not in the
// platform-tables allowlist, but the policy filter is "WHERE
// app.tenant_id = ..." — there is none, the policy is permissive for
// the withPlatform() path; withTenant() cannot reach this service).
// Test fixture rows are inserted with the privileged migration pool,
// not via the app pool.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const TENANT_IDS = {
  alice: asTenantId(uuidv7()),
  bob: asTenantId(uuidv7()),
  carol: asTenantId(uuidv7()),
} satisfies Record<string, TenantId>;

let defaultPlanId: string;
let aliceLocationId = "";

beforeAll(async () => {
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  defaultPlanId = plan.rows[0]?.id ?? "";

  await admin.query(
    `insert into tenants (id, slug, name, plan_id, timezone, status, created_at)
     values ($1, $2, $3, $4, 'Asia/Kolkata', 'trial',    now() - interval '3 seconds'),
            ($5, $6, $7, $4, 'Asia/Kolkata', 'active',   now() - interval '2 seconds'),
            ($8, $9, $10, $4, 'Asia/Kolkata', 'suspended', now() - interval '1 second')`,
    [
      TENANT_IDS.alice,
      `alice-${RUN}`,
      "Alice Academy",
      defaultPlanId,
      TENANT_IDS.bob,
      `bob-${RUN}`,
      "Bob Swim Club",
      TENANT_IDS.carol,
      `carol-${RUN}`,
      "Carol Tennis Center",
    ],
  );

  await withTenant(TENANT_IDS.alice, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId: TENANT_IDS.alice, name: "Main", isPrimary: true })
      .returning({ id: locations.id });
    aliceLocationId = loc!.id;
  });
  await withTenant(TENANT_IDS.bob, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId: TENANT_IDS.bob, name: "Pool" })
      .returning({ id: locations.id });
    void loc;
  });
  await withTenant(TENANT_IDS.carol, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId: TENANT_IDS.carol, name: "Court 1" })
      .returning({ id: locations.id });
    void loc;
  });

  // Alice has 3 members across 1 location; Bob has 0; Carol has 0.
  // createMember opens its own withTenant() internally; nesting would
  // throw, so we call it from a plain async loop.
  for (let i = 0; i < 3; i++) {
    await createMember(
      { tenantId: TENANT_IDS.alice, userId: undefined },
      {
        fullName: `List Test Alice ${RUN} ${i}`,
        dateOfBirth: "1990-01-01",
        locationId: aliceLocationId,
        memberCode: `alice-list-${RUN}-${i}`,
        consents: [
          {
            purpose: "processing",
            policyVersion: "2026.1",
            evidence: { channel: "staff-assisted-in-person" },
          },
        ],
      },
    );
  }
});

afterAll(async () => {
  // Cleanup in FK order. Members first (consents, guardianships,
  // enrolments cascade via their own rows), then persons, then
  // locations, then tenants.
  for (const tid of Object.values(TENANT_IDS)) {
    await admin.query("delete from consents where tenant_id = $1", [tid]);
    await admin.query("delete from guardianships where tenant_id = $1", [tid]);
    await admin.query("delete from members where tenant_id = $1", [tid]);
    await admin.query("delete from persons where tenant_id = $1", [tid]);
    await admin.query("delete from locations where tenant_id = $1", [tid]);
    await admin.query("delete from tenants where id = $1", [tid]);
  }
  await admin.end();
});

describe("listTenants", () => {
  it("returns tenant rows ordered by status (live first) then created_at desc", async () => {
    const result = await listTenants({});
    expect(result.total).toBeGreaterThanOrEqual(3);
    const seenFixtures = result.rows.filter((r) =>
      Object.values(TENANT_IDS).some((id) => id === r.id),
    );
    expect(seenFixtures).toHaveLength(3);
    // H2: status leads — active (bob) before trial (alice) before
    // suspended (carol). Within a status group newer tenants come
    // first; one fixture tenant per status, so created_at only breaks
    // ties here, it doesn't decide the fixture order.
    expect(seenFixtures[0]?.id).toBe(TENANT_IDS.bob);
    expect(seenFixtures[1]?.id).toBe(TENANT_IDS.alice);
    expect(seenFixtures[2]?.id).toBe(TENANT_IDS.carol);
  });

  it("within the same status group, newer tenants come first — the secondary sort property (H2, regression-proof)", async () => {
    // J6 — the audit caught this: the original fixture had one
    // tenant per status, so created_at only broke ties — it
    // never decided the order. A regression that DROPPED the
    // secondary sort would still pass the existing test. This
    // test inserts two tenants with the SAME status and
    // DIFFERENT created_at and pins the descending order — so
    // dropping the `created_at desc` clause would put the
    // older tenant first and fail here.
    const tenantOldId = asTenantId(uuidv7());
    const tenantNewId = asTenantId(uuidv7());
    await admin.query(
      `insert into tenants (id, slug, name, plan_id, timezone, status, created_at)
       values ($1, $2, 'H2 Tie Older',  $3, 'Asia/Kolkata', 'active', now() - interval '10 seconds'),
              ($4, $5, 'H2 Tie Newer',  $3, 'Asia/Kolkata', 'active', now() - interval '2 seconds')`,
      [tenantOldId, `h2-older-${RUN}`, defaultPlanId, tenantNewId, `h2-newer-${RUN}`],
    );

    try {
      // Filter by status='active' so the test is hermetic — only
      // the active-status fixtures + the new ties are returned.
      const result = await listTenants({ status: "active" });
      const seenTies = result.rows.filter(
        (r) => r.id === tenantOldId || r.id === tenantNewId,
      );
      expect(seenTies).toHaveLength(2);
      // H2 secondary sort: created_at desc — the newer tie
      // (tenantNewId) must come first. If the SQL drops the
      // secondary sort, the order flips and this fails.
      expect(seenTies[0]?.id).toBe(tenantNewId);
      expect(seenTies[1]?.id).toBe(tenantOldId);
    } finally {
      await admin.query("delete from tenants where id = any($1)", [
        [tenantOldId, tenantNewId],
      ]);
    }
  });

  it("denormalises member_count and location_count per tenant", async () => {
    const result = await listTenants({});
    const alice = result.rows.find((r) => r.id === TENANT_IDS.alice);
    const bob = result.rows.find((r) => r.id === TENANT_IDS.bob);
    const carol = result.rows.find((r) => r.id === TENANT_IDS.carol);
    expect(alice?.memberCount).toBe(3);
    expect(alice?.locationCount).toBe(1);
    expect(bob?.memberCount).toBe(0);
    expect(bob?.locationCount).toBe(1);
    expect(carol?.memberCount).toBe(0);
    expect(carol?.locationCount).toBe(1);
  });

  it("denormalises the plan name via the plans LEFT JOIN", async () => {
    const result = await listTenants({});
    const alice = result.rows.find((r) => r.id === TENANT_IDS.alice);
    expect(alice?.planName).toBeTruthy();
    expect(alice?.planName).not.toBeNull();
  });

  it("filters by status when supplied", async () => {
    const result = await listTenants({ status: "suspended" });
    const seenFixtures = result.rows.filter((r) =>
      Object.values(TENANT_IDS).some((id) => id === r.id),
    );
    expect(seenFixtures).toHaveLength(1);
    expect(seenFixtures[0]?.id).toBe(TENANT_IDS.carol);
  });

  it("matches slug and name via case-insensitive ILIKE search", async () => {
    const upper = await listTenants({ search: "ALICE" });
    const lower = await listTenants({ search: "alice" });
    const substr = await listTenants({ search: "swim" });
    expect(upper.rows.find((r) => r.id === TENANT_IDS.alice)).toBeDefined();
    expect(lower.rows.find((r) => r.id === TENANT_IDS.alice)).toBeDefined();
    expect(substr.rows.find((r) => r.id === TENANT_IDS.bob)).toBeDefined();
  });

  it("zod-rejects an invalid status before touching the database", async () => {
    await expect(
      listTenants({ status: "activebutnotreally" as never }),
    ).rejects.toThrow();
  });

  it("paginates with limit and offset", async () => {
    const first = await listTenants({ limit: 1, offset: 0 });
    const next = await listTenants({ limit: 1, offset: 1 });
    expect(first.rows).toHaveLength(1);
    expect(next.rows).toHaveLength(1);
    expect(first.rows[0]?.id).not.toBe(next.rows[0]?.id);
    expect(first.total).toBeGreaterThanOrEqual(2);
    expect(next.total).toBe(first.total);
  });
});
