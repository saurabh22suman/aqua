import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { IsolatedDb } from "./helpers/isolated-db";
import { startIsolatedDb } from "./helpers/isolated-db";

// PR4 (ops console improvements) — plan/preset/trial filter in SQL,
// health filter via JS post-classification + JS pagination (the one
// path that skips the SQL LIMIT/OFFSET — see db/platform-tenants.ts).
// Testcontainers only, per the standing instruction for this PR series.

let isolated: IsolatedDb;
let listTenants: typeof import("@/db/platform-tenants").listTenants;
let appPool: typeof import("@/db/client").pool;

beforeAll(async () => {
  isolated = await startIsolatedDb();
  process.env.DATABASE_URL = isolated.appUri;
  process.env.MIGRATION_DATABASE_URL = isolated.adminUri;
  process.env.APP_LOGIN_PASSWORD = decodeURIComponent(
    new URL(isolated.appUri).password,
  );
  vi.resetModules();
  ({ listTenants } = await import("@/db/platform-tenants"));
  appPool = (await import("@/db/client")).pool;
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await isolated?.stop();
});

async function insertTenant(
  admin: IsolatedDb["admin"],
  args: {
    id: string;
    slug: string;
    status?: string;
    planId?: string | null;
    presetKey?: string | null;
    trialExpiresAt?: Date | null;
  },
): Promise<void> {
  const presetVersion = args.presetKey ? 1 : null;
  await admin.query(
    `insert into tenants (id, slug, name, status, plan_id, preset_key, preset_version, trial_expires_at, timezone, currency, created_at)
     values ($1, $2, $3, $4, $5, $6, $8, $7, 'Asia/Kolkata', 'INR', now())`,
    [
      args.id,
      args.slug,
      `Tenant ${args.slug}`,
      args.status ?? "active",
      args.planId ?? null,
      args.presetKey ?? null,
      args.trialExpiresAt ?? null,
      presetVersion,
    ],
  );
}

describe("listTenants — plan/preset/trial filters (SQL-side)", () => {
  it("filters by planId", async () => {
    const admin = isolated.admin;
    const RUN = uuidv7().slice(-8);
    const planId = (
      await admin.query<{ id: string }>(
        `insert into plans (id, key, name) values (gen_random_uuid(), $1, $2) returning id`,
        [`plan-${RUN}`, `Plan ${RUN}`],
      )
    ).rows[0]!.id;
    const onPlan = uuidv7();
    const notOnPlan = uuidv7();
    await insertTenant(admin, { id: onPlan, slug: `plan-on-${RUN}`, planId });
    await insertTenant(admin, { id: notOnPlan, slug: `plan-off-${RUN}` });

    const result = await listTenants({ planId, search: RUN });
    expect(result.rows.map((r) => r.id)).toEqual([onPlan]);
  });

  it("filters by presetKey", async () => {
    const admin = isolated.admin;
    const RUN = uuidv7().slice(-8);
    // preset_key has an FK pair to presets(key, version) — seed one.
    await admin.query(
      `insert into presets (key, version, name, description, definition, status)
       values ($1, 1, $2, 'test preset', '{}'::jsonb, 'active')`,
      [`preset-${RUN}`, `Preset ${RUN}`],
    );
    const onPreset = uuidv7();
    const offPreset = uuidv7();
    await insertTenant(admin, {
      id: onPreset,
      slug: `preset-on-${RUN}`,
      presetKey: `preset-${RUN}`,
    });
    await insertTenant(admin, { id: offPreset, slug: `preset-off-${RUN}` });

    const result = await listTenants({ presetKey: `preset-${RUN}`, search: RUN });
    expect(result.rows.map((r) => r.id)).toEqual([onPreset]);
  });

  it("filters trial=expiring_soon and trial=expired", async () => {
    const admin = isolated.admin;
    const RUN = uuidv7().slice(-8);
    const soon = uuidv7();
    const expired = uuidv7();
    const farOut = uuidv7();
    await insertTenant(admin, {
      id: soon,
      slug: `trial-soon-${RUN}`,
      status: "trial",
      trialExpiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
    await insertTenant(admin, {
      id: expired,
      slug: `trial-expired-${RUN}`,
      status: "trial",
      trialExpiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });
    await insertTenant(admin, {
      id: farOut,
      slug: `trial-farout-${RUN}`,
      status: "trial",
      trialExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const expiringSoon = await listTenants({ trial: "expiring_soon", search: RUN });
    expect(expiringSoon.rows.map((r) => r.id)).toEqual([soon]);

    const expiredResult = await listTenants({ trial: "expired", search: RUN });
    expect(expiredResult.rows.map((r) => r.id)).toEqual([expired]);
  });
});

describe("listTenants — health filter (JS-side, paginates after classifying)", () => {
  it("filters to only at_risk tenants and paginates correctly", async () => {
    const admin = isolated.admin;
    const RUN = uuidv7().slice(-8);
    const atRisk1 = uuidv7();
    const atRisk2 = uuidv7();
    const healthy = uuidv7();

    // Zero members = at_risk for all three unless given a member.
    await insertTenant(admin, { id: atRisk1, slug: `health-atrisk1-${RUN}` });
    await insertTenant(admin, { id: atRisk2, slug: `health-atrisk2-${RUN}` });
    await insertTenant(admin, { id: healthy, slug: `health-healthy-${RUN}` });
    const locationId = (
      await admin.query<{ id: string }>(
        `insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true) returning id`,
        [uuidv7(), healthy],
      )
    ).rows[0]!.id;
    const personId = (
      await admin.query<{ id: string }>(
        `insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'Fixture', '2000-01-01') returning id`,
        [uuidv7(), healthy],
      )
    ).rows[0]!.id;
    await admin.query(
      `insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')`,
      [uuidv7(), healthy, personId, locationId, `health-${healthy}`],
    );

    const atRiskResult = await listTenants({ health: "at_risk", search: RUN });
    expect(atRiskResult.total).toBe(2);
    expect(new Set(atRiskResult.rows.map((r) => r.id))).toEqual(new Set([atRisk1, atRisk2]));

    const healthyResult = await listTenants({ health: "healthy", search: RUN });
    expect(healthyResult.rows.map((r) => r.id)).toEqual([healthy]);

    // Page 1 of size 1 within the at_risk-filtered set.
    const page1 = await listTenants({ health: "at_risk", search: RUN, limit: 1, offset: 0 });
    expect(page1.rows).toHaveLength(1);
    expect(page1.total).toBe(2);
    const page2 = await listTenants({ health: "at_risk", search: RUN, limit: 1, offset: 1 });
    expect(page2.rows).toHaveLength(1);
    expect(page2.rows[0]?.id).not.toBe(page1.rows[0]?.id);
  });
});
