import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { locations } from "@/db/schema/locations";
import { asTenantId, asUserId } from "@/lib/ids";

// U-07 — locations editor and business hours. Fixtures go through the
// privileged migration pool (locations is FORCE RLS); the service
// exercises withTenant(), the config registry and the audit trail.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const actor = asUserId(uuidv7());
const locA = uuidv7();

const ctxA = { tenantId: tenantA, userId: actor, requestId: uuidv7() };
const ctxB = { tenantId: tenantB, userId: actor };

let svc: typeof import("@/lib/services/locations");

beforeAll(async () => {
  svc = await import("@/lib/services/locations");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Locations A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Locations B', 'active', 'Asia/Kolkata')`,
    [tenantA, `u07-a-${RUN}`, tenantB, `u07-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, kind, is_primary) values
       ($1, $2, 'Worli', 'club', true),
       ($3, $4, 'Bandra', 'club', true)`,
    [locA, tenantA, uuidv7(), tenantB],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9193${String(Date.now()).slice(-8)}`,
  ]);
}, 60_000);

afterAll(async () => {
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("U-07 locations and business hours", () => {
  let createdId = "";

  it("lists only this tenant's live locations", async () => {
    const rows = await svc.listAdminLocations(ctxA);
    expect(rows.map((r) => r.name)).toEqual(["Worli"]);
    expect((await svc.listAdminLocations(ctxB)).map((r) => r.name)).toEqual([
      "Bandra",
    ]);
  });

  it("creates a second location with its address and audits the write", async () => {
    const created = await svc.createLocation(ctxA, {
      name: "Andheri West",
      kind: "mixed",
      address: { line1: "1 Link Road", city: "Mumbai", state: "MH", pincode: "400053" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdId = created.id;

    const rows = await svc.listAdminLocations(ctxA);
    const added = rows.find((r) => r.id === createdId);
    expect(added?.name).toBe("Andheri West");
    expect(added?.kind).toBe("mixed");
    expect(added?.address?.city).toBe("Mumbai");
    expect(added?.isPrimary).toBe(false);

    const { rows: audit } = await admin.query<{ request_id: string }>(
      `select request_id from audit_log
        where tenant_id = $1 and action = 'location.create' and entity_id = $2`,
      [tenantA, createdId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.request_id).toBe(ctxA.requestId);
  });

  it("updates name and kind, preserving the primary flag", async () => {
    const updated = await svc.updateLocation(ctxA, {
      locationId: createdId,
      name: "Andheri (West)",
      kind: "cafe",
    });
    expect(updated.ok).toBe(true);

    const rows = await svc.listAdminLocations(ctxA);
    const row = rows.find((r) => r.id === createdId);
    expect(row?.name).toBe("Andheri (West)");
    expect(row?.kind).toBe("cafe");
    expect(row?.isPrimary).toBe(false);

    const { rows: audit } = await admin.query<{ before: Record<string, unknown> }>(
      `select before from audit_log
        where tenant_id = $1 and action = 'location.update' and entity_id = $2`,
      [tenantA, createdId],
    );
    expect(audit[0]?.before).toMatchObject({ name: "Andheri West", kind: "mixed" });
  });

  it("refuses to update another tenant's location", async () => {
    const denied = await svc.updateLocation(ctxB, {
      locationId: createdId,
      name: "Hijack",
    });
    expect(denied.ok).toBe(false);
  });

  it("stores business hours in the config registry at location scope", async () => {
    const days = [
      { day: "monday", closed: false, open: "06:00", close: "21:00" },
      { day: "tuesday", closed: true, open: "06:00", close: "21:00" },
      { day: "wednesday", closed: false, open: "06:00", close: "21:00" },
      { day: "thursday", closed: false, open: "06:00", close: "21:00" },
      { day: "friday", closed: false, open: "06:00", close: "21:00" },
      { day: "saturday", closed: false, open: "07:00", close: "19:00" },
      { day: "sunday", closed: true, open: "07:00", close: "19:00" },
    ];
    const saved = await svc.setBusinessHours(ctxA, { locationId: locA, hours: { days } });
    expect(saved.ok).toBe(true);

    const read = await svc.getBusinessHours(ctxA, locA);
    expect(read.days).toHaveLength(7);
    expect(read.days.find((d) => d.day === "saturday")).toMatchObject({
      open: "07:00",
      close: "19:00",
    });
    expect(read.days.find((d) => d.day === "sunday")?.closed).toBe(true);

    const { rows } = await admin.query<{ scope_type: string; scope_id: string }>(
      `select scope_type, scope_id from config_values
        where tenant_id = $1 and key = 'operations.business_hours' and superseded_at is null`,
      [tenantA],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.scope_type).toBe("location");
    expect(rows[0]?.scope_id).toBe(locA);

    const { rows: audit } = await admin.query<{ count: string }>(
      `select count(*)::text as count from audit_log
        where tenant_id = $1 and action = 'config.set'`,
      [tenantA],
    );
    expect(Number(audit[0]?.count ?? "0")).toBe(1);
  });

  it("starts unconfigured and rejects close-before-open", async () => {
    const fresh = await svc.getBusinessHours(ctxA, createdId);
    expect(fresh.days).toEqual([]);

    const bad = await svc.setBusinessHours(ctxA, {
      locationId: locA,
      hours: {
        days: [{ day: "monday", closed: false, open: "20:00", close: "06:00" }],
      },
    });
    expect(bad.ok).toBe(false);
  });

  it("RLS: a cross-tenant read of locations returns zero rows", async () => {
    const direct = await withTenant(tenantB, async (tx) =>
      tx.select({ id: locations.id }).from(locations),
    );
    expect(direct).toHaveLength(1);
    expect(direct.map((r) => r.id)).not.toContain(createdId);
  });
});
