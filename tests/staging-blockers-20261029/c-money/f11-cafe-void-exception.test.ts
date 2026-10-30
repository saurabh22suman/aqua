// @vitest-environment node
//
// Staging blocker F11 — the café void authority: the HUMAN'S CHOICE B,
// recorded as a policy pin.
//
// HUMAN DECISION (29 October 2026): keep the cancellation of an
// ALREADY-INVOICED but UNPAID café order available to staff who can record
// payments (the counter role holds `payments.record`). The GENERAL invoice
// void stays strict: it remains owner/admin authority (`settings.manage`).
// This is a deliberate, documented exception — not an oversight, and not a
// second door to the general invoice void.
//
// The code already implements that exception (the café order path writes the
// invoice void itself, behind `payments.record`; `voidInvoice` refuses
// without `settings.manage`). So this file is a POLICY PIN, not a
// regression for a new behaviour: it must stay GREEN. No RED was fabricated
// for a documentation/test-only pin.
//
// The caller is the ACTUAL app role: the tenant's real "receptionist" role,
// seeded by the app's own role catalogue (`seedRoleTemplates`) with its real
// permission set, resolved by the app's own resolver
// (`resolvePermissionContext`). The permissions are not hand-written here.
//
// Fixture setup and cleanup run through the privileged pool
// (tests/db/privileged-fixture.ts); every behaviour runs against the
// application's own services over the app_login connection.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId, type TenantId } from "@/lib/ids";
import { createOrder, finalizeOrder, voidOrder } from "@/lib/services/orders";
import { voidInvoice } from "@/lib/services/invoice-mutations";
import { recordPayment } from "@/lib/services/payments";
import { getInvoice } from "@/lib/services/invoices";
import { roleTemplatePermissionKeys } from "@/lib/services/roles";
import { ACTION_PERMISSION_MAP } from "@/lib/auth/action-permissions";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";

const TZ = "Asia/Kolkata";
const RUN = Date.now().toString(36);
const PHONE_RUN = String(Date.now() % 100_000_000).padStart(8, "0");

const tenantId: TenantId = asTenantId(uuidv7());
const neighbourTenantId: TenantId = asTenantId(uuidv7());
const locationA = uuidv7();
const locationB = uuidv7();
const neighbourLocationA = uuidv7();
const neighbourLocationB = uuidv7();
const personId = uuidv7();
const memberId = uuidv7();
const menuCategoryId = uuidv7();
const menuItemId = uuidv7();
const userId = asUserId(randomUUID());
const neighbourUserId = asUserId(randomUUID());

type Ctx = {
  tenantId: TenantId;
  userId: ReturnType<typeof asUserId>;
  roleKey: string;
  allLocations: boolean;
  locationIds: string[];
  permissions: Set<string>;
  features: Set<string>;
};

let receptionist: Ctx;
let neighbourReceptionist: Ctx;

async function seedTenant(
  tenant: TenantId,
  slug: string,
  siteA: string,
  siteB: string,
): Promise<string> {
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', $4)",
    [tenant, `${slug}-${RUN}`, slug, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $3, 'Site A', true), ($2, $3, 'Site B', false)",
    [siteA, siteB, tenant],
  );
  // The ACTUAL app role: the app's own role catalogue decides the grants
  // (`roleTemplatePermissionKeys`), and the role + its grants are seeded
  // for this tenant. The role rows need the platform-admin insert path,
  // so the fixture pool writes them.
  const roleId = uuidv7();
  await admin.query(
    "insert into roles (id, tenant_id, key, name, home_path, home_ordinal, is_system) values ($1, $2, 'receptionist', 'Receptionist', '/reception', 3, true)",
    [roleId, tenant],
  );
  const template = roleTemplatePermissionKeys("receptionist");
  if (!template) throw new Error("the app role catalogue has no receptionist");
  for (const permissionKey of template) {
    await admin.query(
      "insert into role_permissions (tenant_id, role_id, permission_key) values ($1, $2, $3)",
      [tenant, roleId, permissionKey],
    );
  }
  return roleId;
}

async function makeReceptionist(
  tenant: TenantId,
  roleId: string,
  actor: ReturnType<typeof asUserId>,
  phone: string,
): Promise<Ctx> {
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    phone,
  ]);
  await admin.query(
    "insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status) values ($1, $2, $3, $4, true, 'active')",
    [uuidv7(), tenant, actor, roleId],
  );
  // The caller's permissions are READ BACK from the seeded role, not
  // written by hand here.
  const granted = await admin.query(
    "select permission_key from role_permissions where tenant_id = $1 and role_id = $2",
    [tenant, roleId],
  );
  return {
    tenantId: tenant,
    userId: actor,
    roleKey: "receptionist",
    allLocations: true,
    locationIds: [],
    permissions: new Set(
      (granted.rows as { permission_key: string }[]).map((row) => row.permission_key),
    ),
    features: new Set(),
  };
}

beforeAll(async () => {
  const roleId = await seedTenant(tenantId, "f11-idem", locationA, locationB);
  const neighbourRoleId = await seedTenant(
    neighbourTenantId,
    "f11-neighbour",
    neighbourLocationA,
    neighbourLocationB,
  );
  receptionist = await makeReceptionist(
    tenantId,
    roleId,
    userId,
    `+9198${PHONE_RUN}7001`,
  );
  neighbourReceptionist = await makeReceptionist(
    neighbourTenantId,
    neighbourRoleId,
    neighbourUserId,
    `+9198${PHONE_RUN}7002`,
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name, phone, date_of_birth) values ($1, $2, 'Café Member', $3, '1990-01-01')",
    [personId, tenantId, `+9198${PHONE_RUN}7101`],
  );
  await admin.query(
    "insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on) values ($1, $2, $3, $4, $5, 'active', current_date - 200)",
    [memberId, tenantId, personId, locationA, `F11-${RUN}`],
  );
  await admin.query(
    "insert into menu_categories (id, tenant_id, location_id, name) values ($1, $2, $3, 'Cafe')",
    [menuCategoryId, tenantId, locationA],
  );
  await admin.query(
    `insert into menu_items (id, tenant_id, location_id, category_id, name, price_paise, tax_rate_bp, sac_code, is_active)
     values ($1, $2, $3, $4, 'Cafe item', 5000, 0, '9999', true)`,
    [menuItemId, tenantId, locationA, menuCategoryId],
  );
}, 120_000);

afterAll(async () => {
  for (const tenant of [tenantId, neighbourTenantId]) {
    await deleteAuditRowsForTenant(admin, tenant);
    await admin.query(
      "delete from whatsapp_notification_outbox where tenant_id = $1",
      [tenant],
    );
    await admin.query("delete from payment_reversals where tenant_id = $1", [
      tenant,
    ]);
    await admin.query("delete from payments where tenant_id = $1", [tenant]);
    await admin.query("delete from order_lines where tenant_id = $1", [tenant]);
    await admin.query("delete from orders where tenant_id = $1", [tenant]);
    await admin.query("delete from menu_items where tenant_id = $1", [tenant]);
    await admin.query("delete from menu_categories where tenant_id = $1", [tenant]);
    await admin.query("delete from invoices where tenant_id = $1", [tenant]);
    await admin.query("delete from members where tenant_id = $1", [tenant]);
    await admin.query("delete from persons where tenant_id = $1", [tenant]);
    await admin.query("delete from locations where tenant_id = $1", [tenant]);
    await admin.query("delete from tenant_memberships where tenant_id = $1", [
      tenant,
    ]);
    await admin.query("delete from role_permissions where tenant_id = $1", [
      tenant,
    ]);
    await admin.query("delete from roles where tenant_id = $1", [tenant]);
    await admin.query("delete from tenants where id = $1", [tenant]);
  }
  await admin.query("delete from users where phone like $1", [
    `+9198${PHONE_RUN}%`,
  ]);
  await admin.end();
}, 120_000);

async function billedOrder(): Promise<{ orderId: string; invoiceId: string }> {
  const order = await createOrder(receptionist, {
    locationId: locationA,
    memberId,
    lines: [{ itemId: menuItemId, qty: 1 }],
  });
  expect(order.ok).toBe(true);
  if (!order.ok) throw new Error("the café order was not created");
  const billed = await finalizeOrder(receptionist, order.orderId);
  expect(billed.ok).toBe(true);
  if (!billed.ok) throw new Error("the café bill was not issued");
  return { orderId: order.orderId, invoiceId: billed.invoiceId };
}

async function invoiceVoidAudits(invoiceId: string): Promise<string[]> {
  const result = await admin.query(
    "select id from audit_log where tenant_id = $1 and action = 'invoice.void' and entity_id = $2",
    [tenantId, invoiceId],
  );
  return (result.rows as { id: string }[]).map((row) => row.id);
}

describe("F11 — the human's Choice B: the café counter void exception", () => {
  it("pins the authority wiring of the two doors", async () => {
    // The app's own action→permission map: the café counter void is the
    // counter role's authority, the general invoice void is not.
    expect(ACTION_PERMISSION_MAP.voidOrderAction).toBe("payments.record");
    expect(ACTION_PERMISSION_MAP.voidInvoiceAction).toBe("settings.manage");
    // And the actual app role carries the first and not the second.
    expect(receptionist.permissions.has("payments.record")).toBe(true);
    expect(receptionist.permissions.has("settings.manage")).toBe(false);
  });

  it("lets the actual reception role cancel an already-invoiced but UNPAID café order", async () => {
    const { orderId, invoiceId } = await billedOrder();

    const voided = await voidOrder(receptionist, orderId, "Wrong order");
    expect(voided.ok).toBe(true);

    const invoice = await getInvoice(receptionist, invoiceId);
    expect(invoice!.status).toBe("void");
    // One audit row, written by the café path with its own source.
    expect(await invoiceVoidAudits(invoiceId)).toHaveLength(1);
  }, 60_000);

  it("keeps the general invoice void refused for the same role", async () => {
    const { invoiceId } = await billedOrder();

    const refused = await voidInvoice(receptionist, invoiceId, "Duplicate raise");
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/owner or admin/i);
    // No audit row: the general void wrote nothing.
    expect(await invoiceVoidAudits(invoiceId)).toHaveLength(0);
    const invoice = await getInvoice(receptionist, invoiceId);
    expect(invoice!.status).not.toBe("void");
  }, 60_000);

  it("refuses the café void once a payment is captured against the bill", async () => {
    const { orderId, invoiceId } = await billedOrder();
    const payment = await recordPayment(receptionist, {
      invoiceId,
      amountPaise: 5000,
      method: "cash",
    });
    expect(payment.ok).toBe(true);

    const refused = await voidOrder(receptionist, orderId, "Wrong order");
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/payment is recorded/i);
    expect(await invoiceVoidAudits(invoiceId)).toHaveLength(0);
    const invoice = await getInvoice(receptionist, invoiceId);
    expect(invoice!.status).not.toBe("void");
  }, 60_000);

  it("refuses the café void for a caller who cannot see the order's location", async () => {
    const { orderId, invoiceId } = await billedOrder();
    const elsewhere: Ctx = {
      ...receptionist,
      allLocations: false,
      locationIds: [locationB],
    };
    // Location scoping ON, so the restricted caller really is outside.
    await admin.query(
      "insert into config_values (id, key, scope_type, scope_id, tenant_id, value) values ($1, 'access.location_scoped_staff', 'tenant', $2::text, $2::uuid, 'true')",
      [randomUUID(), tenantId],
    );

    const refused = await voidOrder(elsewhere, orderId, "Wrong order");
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/order not found/i);
    expect(await invoiceVoidAudits(invoiceId)).toHaveLength(0);
    const invoice = await getInvoice(receptionist, invoiceId);
    expect(invoice!.status).not.toBe("void");
  }, 60_000);

  it("refuses the café void across the tenant boundary", async () => {
    const { orderId, invoiceId } = await billedOrder();

    const refused = await voidOrder(
      neighbourReceptionist,
      orderId,
      "Wrong order",
    );
    expect(refused.ok).toBe(false);
    expect(await invoiceVoidAudits(invoiceId)).toHaveLength(0);
    const invoice = await getInvoice(receptionist, invoiceId);
    expect(invoice!.status).not.toBe("void");
  }, 60_000);
});
