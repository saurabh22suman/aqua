// @vitest-environment node
//
// Owner release · café entitlement guard (4 November 2026).
//
// RELEASE-SCOPE REGRESSION for the create-only café entitlement guard.
//
// What changed: `createOrderAction` (lib/actions/orders.ts) now refuses to
// create a NEW counter order when the tenant's `cafe.pos` entitlement is
// off, in addition to its existing `payments.record` permission check.
//
// What did NOT change (and is pinned here):
//   - `finalizeOrderAction`, `voidOrderAction`, `listOpenCafeOrdersAction`
//     and `requestCafeBillAction` keep riding `payments.record` alone, so
//     an order that already exists stays billable, voidable and collectable
//     after the entitlement is switched off (human policy: "disabled
//     Café/Bookings blocks NEW module work but authorised historical
//     billing stays available").
//   - no grant, role, schema, auth or money-calculation change.
//
// Fixture notes:
//   - roles and role_permissions are created per tenant by the real
//     production seeder `seedRoleTemplates` (lib/services/roles.ts), because
//     `roles` is tenant-scoped (db/schema/roles.ts).
//   - the caller's permission and feature sets are resolved from the
//     database via `resolvePermissionContext` — never hand-written — so the
//     entitlement state under test is the real one.
//   - only the session resolution (`requireDefaultCtx`) is substituted; the
//     actions, the permission resolver, the services, the database writes
//     and the audit rows are all real.
//
// Existing coverage deliberately NOT duplicated here (reuse by name):
//   - location filtering of the open list:
//     tests/tier1/cafe-billing-flow.test.ts
//     "scopes the open list by location"
//   - another tenant sees none of it:
//     tests/tier1/cafe-reconciliation.test.ts
//     "reports zero café figures for another tenant"
//   - a billed order with a captured payment cannot be voided:
//     tests/tier1/cafe-orders.test.ts
//     "refuses to void a billed order with a captured payment"
//   - requestCafeBill is idempotent and issues exactly one invoice:
//     tests/tier1/cafe-billing-flow.test.ts
//     "requesting the bill twice returns the same invoice, not a second one"
//     and tests/tier1/cafe-orders.test.ts
//     "finalizes into exactly one café invoice and links it"
//   - the café menu actions refuse a role without settings.read/manage:
//     tests/mobile/cafe-surface-guard.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";

const mocks = vi.hoisted(() => ({ ctx: undefined as unknown }));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => mocks.ctx,
  NotFoundError: class NotFoundError extends Error {},
}));

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const actorId = asUserId(uuidv7());

let menu: typeof import("@/lib/services/menu");
let orders: typeof import("@/lib/actions/orders");
let payments: typeof import("@/lib/actions/payments");
let permission: typeof import("@/lib/auth/permission");
let roleTemplates: typeof import("@/lib/services/roles");

type TenantFixture = {
  label: string;
  tenantId: ReturnType<typeof asTenantId>;
  locationId: string;
  memberId: ReturnType<typeof asMemberId>;
  itemId: string;
};

function fixture(label: string): TenantFixture {
  return {
    label,
    tenantId: asTenantId(uuidv7()),
    locationId: uuidv7(),
    memberId: asMemberId(uuidv7()),
    itemId: "",
  };
}

const OFF = fixture("off");
const ON = fixture("on");
const SCOPED = fixture("scoped");
const HISTORY = fixture("history");
const COLLECT = fixture("collect");

async function orderCount(tenantId: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from orders where tenant_id = $1",
    [tenantId],
  );
  return Number(rows[0]?.count ?? "0");
}

async function auditCount(tenantId: string, action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenantId, action],
  );
  return Number(rows[0]?.count ?? "0");
}

async function setCafeEntitlement(tenantId: string, enabled: boolean): Promise<void> {
  await admin.query(
    `insert into tenant_features (tenant_id, feature_key, enabled)
     values ($1, 'cafe.pos', $2)
     on conflict (tenant_id, feature_key) do update set enabled = $2`,
    [tenantId, enabled],
  );
}

async function buildCtx(
  tenantId: string,
  options: {
    permissions?: Set<string>;
    allLocations?: boolean;
    locationIds?: string[];
  } = {},
) {
  const roleRows = await admin.query<{ id: string }>(
    "select id from roles where tenant_id = $1 and key = 'receptionist'",
    [tenantId],
  );
  const roleId = roleRows.rows[0]!.id;
  const resolved = await permission.resolvePermissionContext(
    tenantId as never,
    roleId as never,
  );
  const ctx = {
    tenantId,
    userId: actorId,
    membershipId: uuidv7(),
    roleKey: "receptionist",
    roleId,
    slug: `cafe-release-${RUN}`,
    allLocations: options.allLocations ?? true,
    locationIds: options.locationIds ?? [],
    permissions: options.permissions ?? resolved.permissions,
    features: resolved.features,
    requestId: uuidv7(),
  };
  mocks.ctx = ctx;
  return ctx;
}

async function provision(
  fx: TenantFixture,
  options: { cafeEntitled: boolean; locationScopedStaff?: boolean },
) {
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone, gstin, plan_id)
     values ($1, $2, $3, 'active', 'Asia/Kolkata', '27ABCDE1234F1Z5',
             (select id from plans where key = 'standard'))`,
    [fx.tenantId, `cafe-rel-${RUN}-${fx.label}`, "Cafe Release"],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Counter', true)",
    [fx.locationId, fx.tenantId],
  );
  const personId = uuidv7();
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Counter Member')",
    [personId, fx.tenantId],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
    [fx.memberId, fx.tenantId, personId, fx.locationId, `CAFER-${RUN}`],
  );
  await roleTemplates.seedRoleTemplates(fx.tenantId);
  if (options.cafeEntitled) await setCafeEntitlement(fx.tenantId, true);

  const category = await menu.createMenuCategory(
    { tenantId: fx.tenantId, userId: actorId, requestId: uuidv7() },
    { locationId: fx.locationId, name: "Snacks", sortOrder: 1 },
  );
  const categoryError = category.ok ? "" : category.error;
  expect(category.ok, `category for ${fx.label}: ${categoryError}`).toBe(true);
  if (category.ok) {
    const item = await menu.createMenuItem(
      { tenantId: fx.tenantId, userId: actorId, requestId: uuidv7() },
      {
        categoryId: category.id,
        name: "Veg Sandwich",
        pricePaise: 100_000,
        taxRateBp: 500,
        sacCode: "996331",
      },
    );
    const itemError = item.ok ? "" : item.error;
    expect(item.ok, `item for ${fx.label}: ${itemError}`).toBe(true);
    if (item.ok) fx.itemId = item.id;
  }

  // Location scoping is switched on LAST: it also scopes the seeding calls
  // above, and this actor holds no membership with a location list.
  if (options.locationScopedStaff) {
    await admin.query(
      "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
      [uuidv7(), fx.tenantId],
    );
  }
}

function orderInput(fx: TenantFixture) {
  return {
    locationId: fx.locationId,
    memberId: fx.memberId,
    lines: [{ itemId: fx.itemId, qty: 1 }],
  };
}

beforeAll(async () => {
  menu = await import("@/lib/services/menu");
  orders = await import("@/lib/actions/orders");
  payments = await import("@/lib/actions/payments");
  permission = await import("@/lib/auth/permission");
  roleTemplates = await import("@/lib/services/roles");

  // `users` is global (not tenant-scoped): one actor serves every tenant.
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actorId,
    `+9199${String(Date.now()).slice(-8)}`,
  ]);

  await provision(OFF, { cafeEntitled: false });
  await provision(ON, { cafeEntitled: true });
  await provision(SCOPED, { cafeEntitled: true, locationScopedStaff: true });
  await provision(HISTORY, { cafeEntitled: true });
  await provision(COLLECT, { cafeEntitled: true });
}, 90_000);

afterAll(async () => {
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("café entitlement — create-only guard", () => {
  it("resolves the real entitlement state: payments.record granted, cafe.pos off", async () => {
    const ctx = await buildCtx(OFF.tenantId);
    expect(ctx.permissions.has("payments.record")).toBe(true);
    expect(ctx.features.has("billing")).toBe(true);
    // The catalogue marks cafe.pos 'internal', so the standard plan does
    // not carry it: the café module is OFF for a standard-plan tenant.
    expect(ctx.features.has("cafe.pos")).toBe(false);
  });

  it("refuses a NEW café order while the cafe.pos entitlement is off", async () => {
    await buildCtx(OFF.tenantId);
    const before = await orderCount(OFF.tenantId);
    const auditsBefore = await auditCount(OFF.tenantId, "order.create");

    const outcome = await orders.createOrderAction(orderInput(OFF));

    expect(outcome.ok).toBe(false);
    // A denied create must not leave an order behind.
    expect(await orderCount(OFF.tenantId)).toBe(before);
    // ...nor an audit row: the denial happens before the service writes.
    expect(await auditCount(OFF.tenantId, "order.create")).toBe(auditsBefore);
    // The refusal must not leak identifiers.
    const message = (outcome as { error: string }).error;
    expect(message).not.toContain(OFF.tenantId);
    expect(message).not.toContain(OFF.itemId);
    expect(message).not.toContain(OFF.memberId);
  });

  it("creates exactly one café order and one order.create audit when cafe.pos is on (control)", async () => {
    await buildCtx(ON.tenantId);
    const before = await orderCount(ON.tenantId);
    const auditsBefore = await auditCount(ON.tenantId, "order.create");

    const outcome = await orders.createOrderAction(orderInput(ON));

    expect(outcome.ok).toBe(true);
    expect(await orderCount(ON.tenantId)).toBe(before + 1);
    expect(await auditCount(ON.tenantId, "order.create")).toBe(auditsBefore + 1);
  });

  it("still refuses a NEW café order for a caller without payments.record", async () => {
    await buildCtx(OFF.tenantId, { permissions: new Set(["members.read"]) });
    const before = await orderCount(OFF.tenantId);
    const auditsBefore = await auditCount(OFF.tenantId, "order.create");

    // The permission check still runs first and still throws.
    await expect(orders.createOrderAction(orderInput(OFF))).rejects.toThrow(
      /forbidden/i,
    );
    expect(await orderCount(OFF.tenantId)).toBe(before);
    expect(await auditCount(OFF.tenantId, "order.create")).toBe(auditsBefore);
  });

  it("still refuses a NEW café order for a location outside the caller's scope", async () => {
    // cafe.pos is ON here: the location guard, not the entitlement, must
    // be what refuses the write.
    await buildCtx(SCOPED.tenantId, {
      allLocations: false,
      locationIds: [uuidv7()],
    });
    const before = await orderCount(SCOPED.tenantId);
    const auditsBefore = await auditCount(SCOPED.tenantId, "order.create");

    const outcome = await orders.createOrderAction(orderInput(SCOPED));

    expect(outcome.ok).toBe(false);
    expect((outcome as { error: string }).error).toMatch(/location/i);
    expect(await orderCount(SCOPED.tenantId)).toBe(before);
    expect(await auditCount(SCOPED.tenantId, "order.create")).toBe(auditsBefore);
  });

  it("keeps an already-placed order billable and voidable after cafe.pos is switched off", async () => {
    // Place and bill while the entitlement is on.
    await buildCtx(HISTORY.tenantId);
    const created = await orders.createOrderAction(orderInput(HISTORY));
    expect(created.ok).toBe(true);
    const orderId = (created as { orderId: string }).orderId;
    const billed = await orders.requestCafeBillAction({ orderId });
    expect(billed.ok).toBe(true);

    // The operator disables the café module.
    await setCafeEntitlement(HISTORY.tenantId, false);
    const ctx = await buildCtx(HISTORY.tenantId);
    expect(ctx.features.has("cafe.pos")).toBe(false);

    // Historical billing stays available under the existing permission.
    const stillOpen = await orders.listOpenCafeOrdersAction({});
    const row = stillOpen.find((o) => o.orderId === orderId);
    expect(row, "the existing order must still be listed").toBeTruthy();
    expect(row!.amountDuePaise).toBeGreaterThan(0);

    const billedAgain = await orders.requestCafeBillAction({ orderId });
    expect(billedAgain.ok).toBe(true);

    const voided = await orders.voidOrderAction({
      orderId,
      reason: "release regression",
    });
    expect(voided.ok).toBe(true);
    expect(await auditCount(HISTORY.tenantId, "order.void")).toBe(1);
  });

  it("keeps an already-billed invoice collectable after cafe.pos is switched off", async () => {
    await buildCtx(COLLECT.tenantId);
    // A second order, billed while the entitlement is on.
    const created = await orders.createOrderAction(orderInput(COLLECT));
    expect(created.ok).toBe(true);
    const orderId = (created as { orderId: string }).orderId;
    const billed = await orders.requestCafeBillAction({ orderId });
    expect(billed.ok).toBe(true);
    const invoiceId = (billed as { bill: { invoiceId: string } }).bill.invoiceId;

    await setCafeEntitlement(COLLECT.tenantId, false);
    await buildCtx(COLLECT.tenantId);

    const { rows } = await admin.query<{
      total_paise: string;
      paid_paise: string;
    }>("select total_paise, paid_paise from invoices where id = $1", [invoiceId]);
    const totalPaise = Number(rows[0]!.total_paise);

    // The existing invoice is still collectable under the existing permission.
    const paid = await payments.recordPaymentAction({
      invoiceId,
      amountPaise: totalPaise,
      method: "cash",
      idempotencyKey: uuidv7(),
      observedIntentId: null,
    });
    expect(paid.ok).toBe(true);

    const after = await admin.query<{
      total_paise: string;
      paid_paise: string;
    }>("select total_paise, paid_paise from invoices where id = $1", [invoiceId]);
    expect(Number(after.rows[0]!.paid_paise)).toBe(totalPaise);
  });
});
