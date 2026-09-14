import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// C-29 — membership plans: preset templates become priced plans.
// amount_paise is NOT NULL > 0, so "a preset-seeded plan cannot
// activate until a price is entered" is enforced twice (Zod + DB).

type PlansModule = typeof import("@/lib/services/membership-plans");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let plans: PlansModule;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const ownerId = asUserId(uuidv7());
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

describe("C-29 membership plans", () => {
  it("shows the preset template unpriced and not yet activated", async () => {
    const templates = await plans.listPlanTemplates(ctx);
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      shapeId: shapeMonthly,
      name: "Monthly",
      kind: "duration",
      durationDays: 30,
      activatedPlanId: null,
      activatedAmountPaise: null,
    });
  });

  it("refuses to activate a template without a price", async () => {
    const zero = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      amountPaise: 0,
    });
    expect(zero.ok).toBe(false);

    const negative = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      amountPaise: -100,
    });
    expect(negative.ok).toBe(false);

    const stillEmpty = await plans.listPlans(ctx);
    expect(stillEmpty).toHaveLength(0);
  });

  it("activates a template by pricing it, and refuses a second activation", async () => {
    const result = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      amountPaise: 250000,
    });
    expect(result.ok).toBe(true);

    const list = await plans.listPlans(ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      name: "Monthly",
      kind: "duration",
      durationDays: 30,
      amountPaise: 250000,
      taxRateBp: 1800,
      isActive: true,
      sourceShapeId: shapeMonthly,
    });

    const templates = await plans.listPlanTemplates(ctx);
    expect(templates[0].activatedPlanId).toBe(list[0].id);
    expect(templates[0].activatedAmountPaise).toBe(250000);

    const again = await plans.activatePlanFromShape(ctx, {
      shapeId: shapeMonthly,
      amountPaise: 300000,
    });
    expect(again.ok).toBe(false);
  });

  it("creates custom plans and enforces the kind payload", async () => {
    const oneTime = await plans.createPlan(ctx, {
      name: "Registration fee",
      kind: "one_time",
      amountPaise: 100000,
    });
    expect(oneTime.ok).toBe(true);

    const badOneTime = await plans.createPlan(ctx, {
      name: "Bad one-time",
      kind: "one_time",
      durationDays: 30,
      amountPaise: 100000,
    });
    expect(badOneTime.ok).toBe(false);

    const noDuration = await plans.createPlan(ctx, {
      name: "No days",
      kind: "duration",
      amountPaise: 100000,
    });
    expect(noDuration.ok).toBe(false);

    const pack = await plans.createPlan(ctx, {
      name: "10-class pack",
      kind: "sessions",
      sessions: 10,
      amountPaise: 400000,
    });
    expect(pack.ok).toBe(true);

    const list = await plans.listPlans(ctx);
    expect(list.map((p) => p.name)).toContain("10-class pack");
  });

  it("updates price and name, then archives", async () => {
    const list = await plans.listPlans(ctx);
    const monthly = list.find((p) => p.name === "Monthly")!;
    const updated = await plans.updatePlan(ctx, {
      id: monthly.id,
      name: "Monthly (new)",
      amountPaise: 260000,
    });
    expect(updated.ok).toBe(true);

    const renamed = (await plans.listPlans(ctx)).find(
      (p) => p.id === monthly.id,
    );
    expect(renamed?.name).toBe("Monthly (new)");
    expect(renamed?.amountPaise).toBe(260000);

    const archived = await plans.archivePlan(ctx, monthly.id);
    expect(archived.ok).toBe(true);
    expect(
      (await plans.listPlans(ctx)).find((p) => p.id === monthly.id),
    ).toBeUndefined();
    const withInactive = await plans.listPlans(ctx, { includeInactive: true });
    expect(
      withInactive.find((p) => p.id === monthly.id)?.isActive,
    ).toBe(false);
  });

  it("keeps plans tenant-isolated", async () => {
    const otherCtx = { tenantId: tenantB, userId: ownerId };
    expect(await plans.listPlans(otherCtx)).toHaveLength(0);
    expect(await plans.listPlanTemplates(otherCtx)).toHaveLength(0);
    const foreignActivation = await plans.activatePlanFromShape(otherCtx, {
      shapeId: shapeMonthly,
      amountPaise: 1000,
    });
    expect(foreignActivation.ok).toBe(false);
  });

  it("audits every plan mutation", async () => {
    const audit = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1",
      [tenantA],
    );
    const actions = audit.rows.map((r) => r.action);
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
