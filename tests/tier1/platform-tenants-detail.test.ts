import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { asTenantId } from "@/lib/ids";
import { getTenantDetail } from "@/db/platform-tenants";
import { withTenant } from "@/db/tenant";
import {
  batches,
  locations,
  programs,
  sessions as sessionsTable,
} from "@/db/schema";
import { createMember } from "@/lib/services/register";

// Phase 1.4 — read-only tenant detail. The service crosses two
// scopes: withPlatformAdmin() for the cross-tenant header row and
// audit log, and withTenant() for per-tenant locations and feature
// keys. Both must compose without one leaking into the other.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const TENANT_ID = asTenantId(uuidv7());

let defaultPlanId: string;
let aliceLocationId = "";
let primaryBatchId = "";

beforeAll(async () => {
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  defaultPlanId = plan.rows[0]?.id ?? "";

  await admin.query(
    `insert into tenants (id, slug, name, plan_id, timezone, currency, status, offline_sync_enabled)
     values ($1, $2, $3, $4, 'Asia/Kolkata', 'INR', 'active', true)`,
    [TENANT_ID, `detail-${RUN}`, "Detail Test Academy", defaultPlanId],
  );

  await withTenant(TENANT_ID, async (tx) => {
    const [primary] = await tx
      .insert(locations)
      .values({ tenantId: TENANT_ID, name: "Main Hall", isPrimary: true })
      .returning({ id: locations.id });
    aliceLocationId = primary!.id;

    const [annex] = await tx
      .insert(locations)
      .values({ tenantId: TENANT_ID, name: "Annex" })
      .returning({ id: locations.id });
    // annex is inserted only so the live-locations count is 2 (Annex
    // + Main); its id is not used elsewhere — the soft-deleted
    // "Closed Wing" row below covers the deleted-row count assertion.
    void annex;

    const [soft] = await tx
      .insert(locations)
      .values({ tenantId: TENANT_ID, name: "Closed Wing" })
      .returning({ id: locations.id });
    await tx
      .update(locations)
      .set({ deletedAt: new Date() })
      .where(eq(locations.id, soft!.id));

    // One program + batch so we can insert a session row to verify
    // sessionsThisMonth > 0.
    const [prog] = await tx
      .insert(programs)
      .values({
        tenantId: TENANT_ID,
        name: `Detail Program ${RUN}`,
      })
      .returning({ id: programs.id });

    const [b] = await tx
      .insert(batches)
      .values({
        tenantId: TENANT_ID,
        programId: prog!.id,
        name: `Detail Batch ${RUN}`,
        daysOfWeek: [1, 3, 5],
        startTime: "07:00",
        endTime: "08:00",
        capacity: 12,
      })
      .returning({ id: batches.id });
    primaryBatchId = b!.id;

    const today = new Date().toISOString().slice(0, 10);
    await tx.insert(sessionsTable).values({
      tenantId: TENANT_ID,
      batchId: primaryBatchId,
      sessionDate: today,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  for (let i = 0; i < 2; i++) {
    await createMember(
      { tenantId: TENANT_ID, userId: undefined },
      {
        fullName: `Detail Test ${RUN} ${i}`,
        dateOfBirth: "1990-01-01",
        locationId: aliceLocationId,
        memberCode: `detail-${RUN}-${i}`,
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
  if (TENANT_ID) {
    await admin.query("delete from consents where tenant_id = $1", [TENANT_ID]);
    await admin.query("delete from guardianships where tenant_id = $1", [TENANT_ID]);
    await admin.query("delete from attendance where tenant_id = $1", [TENANT_ID]);
    await admin.query("delete from sessions where tenant_id = $1", [TENANT_ID]);
    await admin.query("delete from batches where tenant_id = $1", [TENANT_ID]);
    await admin.query("delete from programs where tenant_id = $1", [TENANT_ID]);
    await admin.query("delete from members where tenant_id = $1", [TENANT_ID]);
    await admin.query("delete from persons where tenant_id = $1", [TENANT_ID]);
    await admin.query("delete from locations where tenant_id = $1", [TENANT_ID]);
    await admin.query("delete from tenants where id = $1", [TENANT_ID]);
  }
  await admin.end();
});

describe("getTenantDetail", () => {
  it("returns null for an unknown tenant id", async () => {
    const result = await getTenantDetail(
      asTenantId("00000000-0000-0000-0000-000000000000"),
    );
    expect(result).toBeNull();
  });

  it("returns the populated detail for the fixture tenant", async () => {
    const detail = await getTenantDetail(TENANT_ID);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(detail.id).toBe(TENANT_ID);
    expect(detail.name).toBe("Detail Test Academy");
    expect(detail.status).toBe("active");
    expect(detail.timezone).toBe("Asia/Kolkata");
    expect(detail.currency).toBe("INR");
    expect(detail.offlineSyncEnabled).toBe(true);
    expect(detail.gstin).toBeNull();
  });

  it("denormalises member, location, and sessionsThisMonth counts", async () => {
    const detail = await getTenantDetail(TENANT_ID);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(detail.memberCount).toBeGreaterThanOrEqual(2);
    // Soft-deleted locations are excluded — we created 2 live + 1 deleted.
    expect(detail.locationCount).toBe(2);
    expect(detail.sessionsThisMonth).toBeGreaterThanOrEqual(1);
  });

  it("lists the active locations ordered primary first, then by name", async () => {
    const detail = await getTenantDetail(TENANT_ID);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(detail.locations).toHaveLength(2);
    expect(detail.locations[0]?.isPrimary).toBe(true);
    expect(detail.locations[0]?.name).toBe("Main Hall");
    expect(detail.locations[1]?.name).toBe("Annex");
  });

  it("does not return soft-deleted locations", async () => {
    const detail = await getTenantDetail(TENANT_ID);
    expect(detail).not.toBeNull();
    if (!detail) return;
    const names = detail.locations.map((l) => l.name);
    expect(names).not.toContain("Closed Wing");
  });

  it("resolves the feature set via the plan", async () => {
    const detail = await getTenantDetail(TENANT_ID);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(Array.isArray(detail.featureKeys)).toBe(true);
    expect(detail.featureKeys.length).toBeGreaterThan(0);
  });

  it("includes presetKey and planName when present", async () => {
    const detail = await getTenantDetail(TENANT_ID);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(detail.presetKey).toBeNull();
    expect(detail.presetVersion).toBeNull();
    // The seed inserts the "standard" plan with name "Standard" — a
    // bug that swallowed the JOIN and returned `null` or an empty
    // string would slip past `not.toBeNull()`. Match the actual
    // value so the test fails on the real regression.
    expect(detail.planName).toBe("Standard");
  });

  it("returns an empty activity array when there are no audit rows", async () => {
    const detail = await getTenantDetail(TENANT_ID);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(Array.isArray(detail.recentActivity)).toBe(true);
    expect(detail.recentActivity).toHaveLength(0);
  });
});
