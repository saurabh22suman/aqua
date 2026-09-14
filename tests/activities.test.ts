import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// Activity catalog (decision 2026-09-14): activities are the schema's
// `facilities` — pool, court, table, café counter — under a location
// (the site). CRUD, sub-units, soft delete, validation, RLS, audit.

type ActivitiesModule = typeof import("@/lib/services/activities");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let activities: ActivitiesModule;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const ownerId = asUserId(uuidv7());
const locA1 = uuidv7();
const locA2 = uuidv7();
const locB = uuidv7();
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
  activities = await import("@/lib/services/activities");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'Act A', 'active'), ($3, $4, 'Act B', 'active')",
    [tenantA, `act-a-${RUN}`, tenantB, `act-b-${RUN}`],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    ownerId,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Splashh', true),
       ($2, $3, 'Annex', false)`,
    [locA1, locA2, tenantA],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Other Site', true)",
    [locB, tenantB],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("activity catalog", () => {
  it("creates an activity with sub-units and lists it under its facility", async () => {
    const result = await activities.createActivity(ctx, {
      locationId: locA1,
      name: "Swimming pool",
      kind: "pool",
      capacity: 24,
      subUnits: ["Lane 1", "Lane 2", "Lane 3"],
    });
    expect(result.ok).toBe(true);

    const list = await activities.listActivities(ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      locationId: locA1,
      locationName: "Splashh",
      name: "Swimming pool",
      kind: "pool",
      capacity: 24,
    });
    expect(list[0].subUnits.map((unit) => unit.name).sort()).toEqual([
      "Lane 1",
      "Lane 2",
      "Lane 3",
    ]);
  });

  it("accepts the 'table' kind and keeps names unique per facility", async () => {
    const table = await activities.createActivity(ctx, {
      locationId: locA1,
      name: "Billiards table",
      kind: "table",
      capacity: 4,
      subUnits: ["Table 1"],
    });
    expect(table.ok).toBe(true);

    // Same name, different facility: allowed.
    const otherSite = await activities.createActivity(ctx, {
      locationId: locA2,
      name: "Swimming pool",
      kind: "pool",
      capacity: 10,
    });
    expect(otherSite.ok).toBe(true);

    // Same name, same facility (case-insensitive): refused.
    const duplicate = await activities.createActivity(ctx, {
      locationId: locA1,
      name: "swimming POOL",
      kind: "pool",
      capacity: 10,
    });
    expect(duplicate.ok).toBe(false);
  });

  it("validates location, kind and capacity", async () => {
    const badLocation = await activities.createActivity(ctx, {
      locationId: uuidv7(),
      name: "Ghost",
      kind: "pool",
      capacity: 1,
    });
    expect(badLocation.ok).toBe(false);

    const badKind = await activities.createActivity(ctx, {
      locationId: locA1,
      name: "Bad kind",
      kind: "arena",
      capacity: 1,
    });
    expect(badKind.ok).toBe(false);

    const badCapacity = await activities.createActivity(ctx, {
      locationId: locA1,
      name: "Tiny",
      kind: "studio",
      capacity: 0,
    });
    expect(badCapacity.ok).toBe(false);
  });

  it("updates name, kind and capacity", async () => {
    const pool = (await activities.listActivities(ctx)).find(
      (a) => a.name === "Swimming pool" && a.locationId === locA1,
    )!;
    const updated = await activities.updateActivity(ctx, {
      id: pool.id,
      name: "Main pool",
      kind: "court",
      capacity: 30,
    });
    expect(updated.ok).toBe(true);

    const after = (await activities.listActivities(ctx)).find(
      (a) => a.id === pool.id,
    );
    expect(after).toMatchObject({
      name: "Main pool",
      kind: "court",
      capacity: 30,
    });
  });

  it("adds and removes sub-units, freeing a removed name", async () => {
    const table = (await activities.listActivities(ctx)).find(
      (a) => a.name === "Billiards table",
    )!;
    const added = await activities.addSubUnit(ctx, {
      activityId: table.id,
      name: "Table 2",
    });
    expect(added.ok).toBe(true);

    const duplicate = await activities.addSubUnit(ctx, {
      activityId: table.id,
      name: "table 2",
    });
    expect(duplicate.ok).toBe(false);

    const removed = await activities.removeSubUnit(ctx, { id: added.ok ? added.id : "" });
    expect(removed.ok).toBe(true);

    const afterRemove = (await activities.listActivities(ctx)).find(
      (a) => a.id === table.id,
    );
    expect(afterRemove?.subUnits.map((unit) => unit.name)).toEqual(["Table 1"]);

    // A removed name can come back.
    const readd = await activities.addSubUnit(ctx, {
      activityId: table.id,
      name: "Table 2",
    });
    expect(readd.ok).toBe(true);
  });

  it("soft-deletes an activity and its sub-units", async () => {
    const table = (await activities.listActivities(ctx)).find(
      (a) => a.name === "Billiards table",
    )!;
    const deleted = await activities.deleteActivity(ctx, table.id);
    expect(deleted.ok).toBe(true);

    const list = await activities.listActivities(ctx);
    expect(list.find((a) => a.id === table.id)).toBeUndefined();

    const row = await admin.query<{ deleted_at: Date | null }>(
      "select deleted_at from facilities where id = $1",
      [table.id],
    );
    expect(row.rows[0].deleted_at).not.toBeNull();

    const units = await admin.query<{ n: string }>(
      "select count(*)::text as n from facility_sub_units where facility_id = $1 and deleted_at is not null",
      [table.id],
    );
    expect(Number(units.rows[0].n)).toBeGreaterThan(0);
  });

  it("keeps activities tenant-isolated", async () => {
    const otherCtx = { tenantId: tenantB, userId: ownerId };
    expect(await activities.listActivities(otherCtx)).toHaveLength(0);

    const foreign = await activities.createActivity(otherCtx, {
      locationId: locA1,
      name: "Not mine",
      kind: "pool",
      capacity: 1,
    });
    expect(foreign.ok).toBe(false);

    expect(await activities.listActivities(ctx, { locationId: locA1 })).not.toHaveLength(0);
    expect(await activities.listActivities(ctx, { locationId: locB })).toHaveLength(0);
  });

  it("audits every catalog mutation", async () => {
    const audit = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1",
      [tenantA],
    );
    const actions = audit.rows.map((r) => r.action);
    for (const expected of [
      "activity.create",
      "activity.update",
      "activity.delete",
      "activity.subunit.add",
      "activity.subunit.remove",
    ]) {
      expect(actions).toContain(expected);
    }
  });
});
