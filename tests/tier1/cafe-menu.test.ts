import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { like } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { auditLog } from "@/db/schema/audit";
import { menuCategories, menuItems } from "@/db/schema/menu";
import { asTenantId, asUserId, type TenantId, type UserId } from "@/lib/ids";

// K-01 — menu catalog. Written before db/migrations/
// 20260918100000_k01_menu.sql and lib/services/menu.ts exist: the
// first run is deliberately red (`relation "menu_categories" does not
// exist` / module not found). Fixture rows for tenants/locations
// (FORCE RLS) go through the privileged migration pool; every app
// operation goes through withTenant()/the service, so the RLS and
// audit assertions exercise the real access path.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const actor = asUserId(uuidv7());

const ctxA = { tenantId: tenantA, userId: actor, requestId: uuidv7() };
const ctxB = { tenantId: tenantB, userId: actor };

let menu: typeof import("@/lib/services/menu");

async function auditCount(tenantId: TenantId, action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenantId, action],
  );
  return Number(rows[0]?.count ?? "0");
}

beforeAll(async () => {
  menu = await import("@/lib/services/menu");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone, gstin) values
       ($1, $2, 'Cafe Menu A', 'active', 'Asia/Kolkata', '27ABCDE1234F1Z5'),
       ($3, $4, 'Cafe Menu B', 'active', 'Asia/Kolkata', null)`,
    [tenantA, `k01-a-${RUN}`, tenantB, `k01-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Cafe A', true), ($2, $4, 'Cafe B', true)`,
    [locA, locB, tenantA, tenantB],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9190${String(Date.now()).slice(-8)}`,
  ]);
}, 60_000);

afterAll(async () => {
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("K-01 menu catalog", () => {
  let categoryId = "";
  let itemId = "";

  it("creates a category and lists it for its location", async () => {
    const created = await menu.createMenuCategory(ctxA, {
      locationId: locA,
      name: "Beverages",
      sortOrder: 1,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    categoryId = created.id;

    const categories = await menu.listMenuCategories(ctxA, { locationId: locA });
    expect(categories.map((c) => c.name)).toContain("Beverages");
  });

  it("creates an item with price/tax/SAC/veg snapshots and lists it", async () => {
    const created = await menu.createMenuItem(ctxA, {
      categoryId,
      name: "Masala Chai",
      pricePaise: 50_000,
      taxRateBp: 500,
      sacCode: "996331",
      isVeg: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    itemId = created.id;

    const items = await menu.listMenuItems(ctxA, { locationId: locA });
    const item = items.find((i) => i.id === itemId);
    expect(item).toMatchObject({
      name: "Masala Chai",
      pricePaise: 50_000,
      taxRateBp: 500,
      sacCode: "996331",
      isVeg: true,
      isActive: true,
    });
  });

  it("audits category and item mutations with the request id", async () => {
    expect(await auditCount(tenantA, "menu_category.create")).toBe(1);
    expect(await auditCount(tenantA, "menu_item.create")).toBe(1);

    const { rows } = await admin.query<{ request_id: string; entity_id: string }>(
      `select request_id, entity_id from audit_log
        where tenant_id = $1 and action = 'menu_item.create' limit 1`,
      [tenantA],
    );
    expect(rows[0]?.request_id).toBe(ctxA.requestId);
    expect(rows[0]?.entity_id).toBe(itemId);
  });

  it("refuses a case-insensitive duplicate item name in the same location", async () => {
    const dupe = await menu.createMenuItem(ctxA, {
      categoryId,
      name: "masala chai",
      pricePaise: 50_000,
      taxRateBp: 500,
      sacCode: "996331",
    });
    expect(dupe.ok).toBe(false);
    if (!dupe.ok) expect(dupe.error).toMatch(/already/i);
  });

  it("rejects an invalid price, tax rate and SAC code", async () => {
    const badPrice = await menu.createMenuItem(ctxA, {
      categoryId,
      name: "Free Water",
      pricePaise: 0,
      taxRateBp: 500,
      sacCode: "996331",
    });
    expect(badPrice.ok).toBe(false);

    const badRate = await menu.createMenuItem(ctxA, {
      categoryId,
      name: "Bad Rate",
      pricePaise: 1000,
      taxRateBp: 10_001,
      sacCode: "996331",
    });
    expect(badRate.ok).toBe(false);

    const badSac = await menu.createMenuItem(ctxA, {
      categoryId,
      name: "Bad SAC",
      pricePaise: 1000,
      taxRateBp: 500,
      sacCode: "12",
    });
    expect(badSac.ok).toBe(false);
  });

  it("updates an item, then archives it — soft-deleted, unlisted, name reusable", async () => {
    const updated = await menu.updateMenuItem(ctxA, {
      itemId,
      pricePaise: 60_000,
      taxRateBp: 1200,
    });
    expect(updated.ok).toBe(true);

    const archived = await menu.archiveMenuItem(ctxA, { itemId });
    expect(archived.ok).toBe(true);
    expect(await auditCount(tenantA, "menu_item.update")).toBe(1);
    expect(await auditCount(tenantA, "menu_item.archive")).toBe(1);

    const { rows } = await admin.query<{ deleted_at: Date | null }>(
      "select deleted_at from menu_items where id = $1",
      [itemId],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();

    const items = await menu.listMenuItems(ctxA, { locationId: locA });
    expect(items.some((i) => i.id === itemId)).toBe(false);

    const reuse = await menu.createMenuItem(ctxA, {
      categoryId,
      name: "MASALA CHAI",
      pricePaise: 60_000,
      taxRateBp: 1200,
      sacCode: "996331",
    });
    expect(reuse.ok).toBe(true);
  });

  it("keeps the item's location and category in the same tenant", async () => {
    const mismatched = await menu.createMenuItem(ctxB, {
      categoryId,
      name: "Cross Tenant Chai",
      pricePaise: 1000,
      taxRateBp: 0,
      sacCode: "996331",
    });
    expect(mismatched.ok).toBe(false);
  });

  it("RLS: another tenant sees zero rows, including on a direct withTenant query", async () => {
    const listed = await menu.listMenuItems(ctxB, { locationId: locB });
    expect(listed).toEqual([]);

    const direct = await withTenant(tenantB, async (tx) =>
      tx.select({ id: menuItems.id }).from(menuItems),
    );
    expect(direct).toEqual([]);

    const directCategories = await withTenant(tenantB, async (tx) =>
      tx.select({ id: menuCategories.id }).from(menuCategories),
    );
    expect(directCategories).toEqual([]);
  });

  it("archives a category and audits the mutation", async () => {
    const archived = await menu.archiveMenuCategory(ctxA, { categoryId });
    expect(archived.ok).toBe(true);
    expect(await auditCount(tenantA, "menu_category.archive")).toBe(1);
  });

  it("writes every mutation's audit row to audit_log in the tenant scope", async () => {
    const rows = await withTenant(tenantA, async (tx) =>
      tx
        .select({ action: auditLog.action, actorId: auditLog.actorId })
        .from(auditLog)
        .where(like(auditLog.action, "menu\\_%")),
    );
    expect(rows.length).toBeGreaterThanOrEqual(4);
    for (const row of rows) expect(row.actorId).toBe(actor as UserId);
  });
});
