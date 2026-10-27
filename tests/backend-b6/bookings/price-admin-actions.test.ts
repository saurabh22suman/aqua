import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

// Batch 6 — the authorization boundary of the booking price actions.
//
// The rule under test: pricing administration is MANAGEMENT authority.
// The receptionist role carries `settings.read` but not
// `settings.manage`, so a receptionist must not be able to read the
// catalogue, change a rule, or activate one. The booking screen's
// "is anything priced?" read is different on purpose — it rides
// `bookings.read` (the grant the booking flow itself uses) and
// returns counts only.
//
// `requireDefaultCtx` is mocked so the action's permission gate runs
// against a synthetic role context; `requirePermission` is the REAL
// implementation, so the denial below is the production rule, not a
// stub.

const mocks = vi.hoisted(() => ({
  ctx: {
    tenantId: "" as string,
    userId: "" as string,
    permissions: new Set<string>(),
    features: new Set<string>(),
    requestId: "b6a179b8-b7bd-7509-a682-7ee432342e56",
  },
}));

vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: async () => mocks.ctx,
}));

const RUN = Date.now().toString(36);

const tenant = asTenantId(uuidv7());
const loc = uuidv7();
const facilityId = uuidv7();
const actor = asUserId(uuidv7());

let actions: typeof import("@/lib/actions/booking-price-admin");

beforeAll(async () => {
  actions = await import("@/lib/actions/booking-price-admin");

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Action Test', 'active', 'Asia/Kolkata')",
    [tenant, `b6-action-${RUN}`],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Action Site', true)",
    [loc, tenant],
  );
  await admin.query(
    "insert into facilities (id, tenant_id, location_id, name, kind, capacity) values ($1, $2, $3, 'Action Court', 'court', 2)",
    [facilityId, tenant, loc],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9195${String(Date.now()).slice(-8)}`,
  ]);
}, 60_000);

afterAll(async () => {
  await admin.query("delete from booking_price_rules where tenant_id = $1", [
    tenant,
  ]);
  await admin.query("delete from facilities where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

function asRole(permissions: string[], features: string[] = ["pool.booking"]) {
  mocks.ctx.tenantId = tenant;
  mocks.ctx.userId = actor;
  mocks.ctx.permissions = new Set(permissions);
  mocks.ctx.features = new Set(features);
}

describe("B6 booking price actions — authorization", () => {
  it("a receptionist cannot list, save or activate a price rule", async () => {
    // The receptionist role: settings.read, NOT settings.manage.
    asRole(["settings.read", "bookings.read", "bookings.write"]);

    await expect(actions.listBookingPriceRulesAction()).rejects.toThrow(
      /forbidden/,
    );
    await expect(
      actions.saveBookingPriceRuleAction({
        label: "Desk rate",
        priceRupees: "100",
      }),
    ).rejects.toThrow(/forbidden/);
    await expect(
      actions.setBookingPriceRuleActiveAction({
        id: uuidv7(),
        isActive: false,
      }),
    ).rejects.toThrow(/forbidden/);
  });

  it("refuses invalid input before it reaches the service", async () => {
    // A caller with no permission at all still gets the parse refusal
    // first — the standing preamble is parse, then permission.
    asRole([]);
    const result = await actions.saveBookingPriceRuleAction({
      label: "",
      priceRupees: "100",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name/i);
  });

  it("an owner can save and read a price rule", async () => {
    asRole(["settings.manage", "bookings.read"]);
    const saved = await actions.saveBookingPriceRuleAction({
      label: "Owner rate",
      facilityId,
      priceRupees: "333",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // The rupees the owner typed became exact integer paise.
    expect(saved.rule.pricePaise).toBe(33_300);

    const rules = await actions.listBookingPriceRulesAction();
    expect(rules.map((rule) => rule.label)).toContain("Owner rate");

    const status = await actions.getBookingPriceStatusAction();
    expect(status.active).toBeGreaterThanOrEqual(1);
  });

  it("refuses an amount that is not a plain rupee amount", async () => {
    asRole(["settings.manage", "bookings.read"]);
    const bad = await actions.saveBookingPriceRuleAction({
      label: "Odd amount",
      priceRupees: "12.345",
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toMatch(/plain amount/i);
  });

  it("the booking screen's price read is denied without bookings.read", async () => {
    asRole(["settings.manage"]);
    await expect(actions.getBookingPriceStatusAction()).rejects.toThrow(
      /forbidden/,
    );
  });

  it("the booking screen's price read is denied when the bookings feature is off", async () => {
    asRole(["settings.manage", "bookings.read"], []);
    await expect(actions.getBookingPriceStatusAction()).rejects.toThrow(
      /feature_disabled/,
    );
  });
});
