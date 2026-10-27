import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
//
// The privileged pool is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only — seeding the tenants/locations/facilities/members the
// tables under FORCE RLS hide from the application pool. Every
// assertion in this file still runs against the application's own
// services, which connect as `app_login` under tenant RLS. The
// credential is named in exactly one place; this file never names it.
import { asTenantId, asUserId } from "@/lib/ids";

// Batch 6 (hardening) — the price-rule WRITE scope.
//
// The coordinator found a real hole in `saveBookingPriceRule`: the
// rule being edited was loaded by (tenant_id, id) and then only the
// DESTINATION facility was checked against the caller's locations. A
// location-restricted caller who learned another location's rule id
// could therefore RELOCATE that rule into its own location — the
// original rule was never authorised — or CLAIM a tenant-wide rule by
// pointing it at its own facility.
//
// The policy this file pins is the one `setBookingPriceRuleActive`
// already follows:
//
//   * the rule being written must itself be within the caller's reach
//     (its facility visible, or the caller unrestricted for a
//     tenant-wide rule);
//   * the destination must also be within the caller's reach;
//   * a rejection must leave the record AND the audit trail untouched.
//
// Legitimate edits must keep working: a restricted caller may edit a
// rule at its own location, and an owner (all locations) may move a
// rule between sites.

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const facilityA = uuidv7();
const facilityB = uuidv7();
const actor = asUserId(uuidv7());

const restrictedCtx = {
  tenantId: tenant,
  userId: actor,
  requestId: uuidv7(),
  allLocations: false,
  locationIds: [locA],
};

const ownerCtx = {
  tenantId: tenant,
  userId: actor,
  requestId: uuidv7(),
  allLocations: true,
  locationIds: [] as string[],
};

let priceAdmin: typeof import("@/lib/services/booking-price-admin");

type RuleRow = {
  facility_id: string | null;
  label: string;
  price_paise: string;
  is_active: boolean;
  updated_at: Date;
  updated_by: string | null;
};

async function ruleRow(id: string): Promise<RuleRow | undefined> {
  const { rows } = await admin.query<RuleRow>(
    "select facility_id, label, price_paise, is_active, updated_at, updated_by from booking_price_rules where id = $1",
    [id],
  );
  return rows[0];
}

async function auditCount(ruleId: string): Promise<number> {
  const { rows } = await admin.query<{ n: string }>(
    "select count(*)::text as n from audit_log where tenant_id = $1 and entity_type = 'booking_price_rule' and entity_id = $2",
    [tenant, ruleId],
  );
  return Number(rows[0]?.n);
}

beforeAll(async () => {
  priceAdmin = await import("@/lib/services/booking-price-admin");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Price Scope', 'active', $3)",
    [tenant, `b6-scope-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Site A', true), ($3, $2, 'Site B', false)",
    [locA, tenant, locB],
  );
  await admin.query(
    "insert into facilities (id, tenant_id, location_id, name, kind, capacity) values ($1, $2, $3, 'Court A', 'court', 2), ($4, $2, $5, 'Court B', 'court', 2)",
    [facilityA, tenant, locA, facilityB, locB],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9198${String(Date.now()).slice(-8)}`,
  ]);
  // Location scoping ON: the restricted context may only reach Site A.
  await admin.query(
    `insert into config_values (key, scope_type, scope_id, tenant_id, value)
     values ('access.location_scoped_staff', 'tenant', $1, $2, 'true'::jsonb)
     on conflict do nothing`,
    [tenant, tenant],
  );
}, 60_000);

afterAll(async () => {
  await admin.query("delete from booking_price_rules where tenant_id = $1", [
    tenant,
  ]);
  await admin.query("delete from config_values where tenant_id = $1", [tenant]);
  await admin.query("delete from facilities where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("B6 price-rule write scope — the rule being written must be reachable", () => {
  it("refuses to relocate another location's rule into the caller's own location", async () => {
    const created = await priceAdmin.saveBookingPriceRule(ownerCtx, {
      label: "Site B rate",
      facilityId: facilityB,
      pricePaise: 30_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const before = await ruleRow(created.rule.id);
    const auditsBefore = await auditCount(created.rule.id);

    const attempt = await priceAdmin.saveBookingPriceRule(restrictedCtx, {
      id: created.rule.id,
      label: "Stolen",
      facilityId: facilityA,
      pricePaise: 1,
    });
    expect(attempt.ok).toBe(false);

    // The record is untouched — still Site B's rule, with its price.
    const after = await ruleRow(created.rule.id);
    expect(after?.facility_id).toBe(facilityB);
    expect(after?.label).toBe("Site B rate");
    expect(after?.price_paise).toBe("30000");
    expect(after?.updated_at.getTime()).toBe(before?.updated_at.getTime());
    expect(after?.updated_by).toBe(before?.updated_by);

    // And nothing was audited: a refusal is not a change.
    expect(await auditCount(created.rule.id)).toBe(auditsBefore);
  });

  it("refuses to claim a tenant-wide rule", async () => {
    const created = await priceAdmin.saveBookingPriceRule(ownerCtx, {
      label: "Everyone rate",
      pricePaise: 25_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.rule.facilityId).toBeNull();
    const before = await ruleRow(created.rule.id);
    const auditsBefore = await auditCount(created.rule.id);

    const attempt = await priceAdmin.saveBookingPriceRule(restrictedCtx, {
      id: created.rule.id,
      label: "Mine now",
      facilityId: facilityA,
      pricePaise: 1,
    });
    expect(attempt.ok).toBe(false);

    const after = await ruleRow(created.rule.id);
    expect(after?.facility_id).toBeNull();
    expect(after?.label).toBe("Everyone rate");
    expect(after?.price_paise).toBe("25000");
    expect(after?.updated_at.getTime()).toBe(before?.updated_at.getTime());
    expect(await auditCount(created.rule.id)).toBe(auditsBefore);
  });

  it("refuses to edit another location's rule in place", async () => {
    const created = await priceAdmin.saveBookingPriceRule(ownerCtx, {
      label: "Site B peak",
      facilityId: facilityB,
      pricePaise: 35_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const attempt = await priceAdmin.saveBookingPriceRule(restrictedCtx, {
      id: created.rule.id,
      label: "Mine now",
      pricePaise: 1,
    });
    expect(attempt.ok).toBe(false);

    const after = await ruleRow(created.rule.id);
    expect(after?.label).toBe("Site B peak");
    expect(after?.price_paise).toBe("35000");
  });

  it("refuses to create a tenant-wide rule", async () => {
    const before = await admin.query<{ n: string }>(
      "select count(*)::text as n from booking_price_rules where tenant_id = $1 and facility_id is null",
      [tenant],
    );

    const attempt = await priceAdmin.saveBookingPriceRule(restrictedCtx, {
      label: "Everyone rate",
      pricePaise: 12_000,
    });
    expect(attempt.ok).toBe(false);

    // No tenant-wide rule was added.
    const after = await admin.query<{ n: string }>(
      "select count(*)::text as n from booking_price_rules where tenant_id = $1 and facility_id is null",
      [tenant],
    );
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n));
  });

  it("refuses to deactivate another location's rule", async () => {
    const created = await priceAdmin.saveBookingPriceRule(ownerCtx, {
      label: "Site B late",
      facilityId: facilityB,
      pricePaise: 28_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const attempt = await priceAdmin.setBookingPriceRuleActive(
      restrictedCtx,
      { id: created.rule.id, isActive: false },
    );
    expect(attempt.ok).toBe(false);

    const after = await ruleRow(created.rule.id);
    expect(after?.is_active).toBe(true);
  });
});

describe("B6 price-rule write scope — legitimate edits still work", () => {
  it("lets a restricted caller edit a rule at its own location", async () => {
    const created = await priceAdmin.saveBookingPriceRule(restrictedCtx, {
      label: "Site A rate",
      facilityId: facilityA,
      pricePaise: 15_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited = await priceAdmin.saveBookingPriceRule(restrictedCtx, {
      id: created.rule.id,
      label: "Site A peak",
      facilityId: facilityA,
      pricePaise: 18_000,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.rule.pricePaise).toBe(18_000);

    const after = await ruleRow(created.rule.id);
    expect(after?.label).toBe("Site A peak");
    expect(after?.price_paise).toBe("18000");
    expect(await auditCount(created.rule.id)).toBe(2); // create + update
  });

  it("lets a restricted caller edit a rule without naming a facility", async () => {
    // The form omits the facility when it is unchanged; the rule keeps
    // the one it had.
    const created = await priceAdmin.saveBookingPriceRule(restrictedCtx, {
      label: "Site A all day",
      facilityId: facilityA,
      pricePaise: 16_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited = await priceAdmin.saveBookingPriceRule(restrictedCtx, {
      id: created.rule.id,
      label: "Site A all day",
      pricePaise: 17_000,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.rule.facilityId).toBe(facilityA);
  });

  it("lets an owner move a rule between its own locations", async () => {
    const created = await priceAdmin.saveBookingPriceRule(ownerCtx, {
      label: "Movable",
      facilityId: facilityA,
      pricePaise: 20_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const moved = await priceAdmin.saveBookingPriceRule(ownerCtx, {
      id: created.rule.id,
      label: "Movable",
      facilityId: facilityB,
      pricePaise: 20_000,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.rule.facilityId).toBe(facilityB);

    const after = await ruleRow(created.rule.id);
    expect(after?.facility_id).toBe(facilityB);
  });

  it("lets an owner edit a tenant-wide rule", async () => {
    const created = await priceAdmin.saveBookingPriceRule(ownerCtx, {
      label: "Everyone rate",
      pricePaise: 22_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited = await priceAdmin.saveBookingPriceRule(ownerCtx, {
      id: created.rule.id,
      label: "Everyone rate",
      pricePaise: 24_000,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.rule.facilityId).toBeNull();
    expect(edited.rule.pricePaise).toBe(24_000);
  });
});
