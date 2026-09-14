import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// C-29/C-29c — plans price a preset template at a facility, optionally
// for one activity (all-access when none). Prices are GST-exclusive;
// the GST rate is configuration (C-29b).

type PlansModule = typeof import("@/lib/services/membership-plans");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let plans: PlansModule;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const ownerId = asUserId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const actPool = uuidv7();
const actCafe = uuidv7();
const shapeMonthly = uuidv7();
const RUN = Date.now().toString(36);

const ctx = { tenantId: tenantA, userId: ownerId };

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);
  plans = await import("@/lib/services/membership-plans");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'Plans A', 'active'), ($3, $4, 'Plans B', 'active')",
    [tenantA, `plans-a-${RUN}`, tenantB, `plans-b-${RUN}`],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    ownerId,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Splashh', true),
       ($2, $3, 'Annex', false)`,
    [locA, locB, tenantA],
  );
  await admin.query(
    `insert into facilities (id, tenant_id, location_id, name, kind, capacity) values
       ($1, $3, $4, 'Swimming pool', 'pool', 24),
       ($2, $3, $4, 'Café counter', 'counter', 1)`,
    [actPool, actCafe, tenantA, locA],
  );
  await admin.query(
    `insert into plan_shapes (id, tenant_id, name, kind, duration_days, sessions, amount_paise, currency, is_sample)
     values ($1, $2, 'Monthly', 'duration', 30, null, null, 'INR', true)`,
    [shapeMonthly, tenantA],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("C-29c membership plans per facility and activity", () => {
  it("lists the preset template without activation state", async () => {
    const templates = await plans.listPlanTemplates(ctx);
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      shapeId: shapeMonthly,
      name: "Monthly",
      kind: "duration",
      durationDays: 30,
    });
    expect("activatedPlanId" in templates[0]).toBe(false);
  });

  it("requires a facility and refuses a template without a price", async () => {
    const noLocation = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      amountPaise: 250000,
    });
    expect(noLocation.ok).toBe(false);

    const noPrice = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      locationId: locA,
      amountPaise: 0,
    });
    expect(noPrice.ok).toBe(false);

    expect(await plans.listPlans(ctx)).toHaveLength(0);
  });

  it("refuses an unknown facility and an activity from another facility", async () => {
    const ghost = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      locationId: uuidv7(),
      amountPaise: 250000,
    });
    expect(ghost.ok).toBe(false);

    // actPool belongs to locA, not locB.
    const mismatched = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      locationId: locB,
      activityId: actPool,
      amountPaise: 250000,
    });
    expect(mismatched.ok).toBe(false);
  });

  it("activates per facility/activity, all-access distinct from activity-scoped", async () => {
    const allAccess = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      locationId: locA,
      amountPaise: 250000,
    });
    expect(allAccess.ok).toBe(true);

    const forPool = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      locationId: locA,
      activityId: actPool,
      amountPaise: 300000,
    });
    expect(forPool.ok).toBe(true);

    // Same template at the other facility is its own plan.
    const otherFacility = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      locationId: locB,
      amountPaise: 200000,
    });
    expect(otherFacility.ok).toBe(true);

    // And the exact same (facility, activity) is refused.
    const duplicate = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      locationId: locA,
      activityId: actPool,
      amountPaise: 999,
    });
    expect(duplicate.ok).toBe(false);

    const list = await plans.listPlans(ctx);
    expect(list).toHaveLength(3);
    const poolPlan = list.find((plan) => plan.activityId === actPool)!;
    expect(poolPlan).toMatchObject({
      locationId: locA,
      locationName: "Splashh",
      activityName: "Swimming pool",
      amountPaise: 300000,
      sourceShapeId: shapeMonthly,
    });
    const allAccessPlan = list.find(
      (plan) => plan.locationId === locA && plan.activityId === null,
    )!;
    expect(allAccessPlan.activityName).toBeNull();
    expect("taxRateBp" in poolPlan).toBe(false);

    const forFacilityA = await plans.listPlans(ctx, {
      locationId: locA,
      activityId: actPool,
    });
    // The activity filter also surfaces all-access plans.
    expect(forFacilityA.map((plan) => plan.id).sort()).toEqual(
      [poolPlan.id, allAccessPlan.id].sort(),
    );
  });

  it("creates custom plans with location/activity and validates the payload", async () => {
    const oneTime = await plans.createPlan(ctx, {
      locationId: locA,
      name: "Registration fee",
      kind: "one_time",
      amountPaise: 100000,
    });
    expect(oneTime.ok).toBe(true);

    const badOneTime = await plans.createPlan(ctx, {
      locationId: locA,
      name: "Bad one-time",
      kind: "one_time",
      durationDays: 30,
      amountPaise: 100000,
    });
    expect(badOneTime.ok).toBe(false);

    const pack = await plans.createPlan(ctx, {
      locationId: locA,
      activityId: actCafe,
      name: "10-class pack",
      kind: "sessions",
      sessions: 10,
      amountPaise: 400000,
    });
    expect(pack.ok).toBe(true);

    const cafePlan = (await plans.listPlans(ctx)).find(
      (plan) => plan.name === "10-class pack",
    );
    expect(cafePlan).toMatchObject({
      activityId: actCafe,
      activityName: "Café counter",
      sessions: 10,
    });
  });

  it("updates price and name, then archives", async () => {
    const list = await plans.listPlans(ctx);
    const monthly = list.find((plan) => plan.activityId === actPool)!;
    const updated = await plans.updatePlan(ctx, {
      id: monthly.id,
      name: "Monthly (pool)",
      amountPaise: 320000,
    });
    expect(updated.ok).toBe(true);

    const renamed = (await plans.listPlans(ctx)).find(
      (plan) => plan.id === monthly.id,
    );
    expect(renamed?.name).toBe("Monthly (pool)");
    expect(renamed?.amountPaise).toBe(320000);

    const archived = await plans.archivePlan(ctx, monthly.id);
    expect(archived.ok).toBe(true);
    expect(
      (await plans.listPlans(ctx)).find((plan) => plan.id === monthly.id),
    ).toBeUndefined();
    const withInactive = await plans.listPlans(ctx, { includeInactive: true });
    expect(
      withInactive.find((plan) => plan.id === monthly.id)?.isActive,
    ).toBe(false);
  });

  it("keeps plans tenant-isolated", async () => {
    const otherCtx = { tenantId: tenantB, userId: ownerId };
    expect(await plans.listPlans(otherCtx)).toHaveLength(0);
    expect(await plans.listPlanTemplates(otherCtx)).toHaveLength(0);
    const foreignActivation = await plans.activatePlanFromShape(otherCtx, {
      shapeId: shapeMonthly,
      locationId: locA,
      amountPaise: 1000,
    });
    expect(foreignActivation.ok).toBe(false);
  });

  it("audits every plan mutation with its scope", async () => {
    const audit = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1",
      [tenantA],
    );
    const actions = audit.rows.map((row) => row.action);
    for (const expected of [
      "membership_plan.activate",
      "membership_plan.create",
      "membership_plan.update",
      "membership_plan.archive",
    ]) {
      expect(actions).toContain(expected);
    }
  });
});
