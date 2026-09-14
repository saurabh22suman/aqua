import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import { addDays, todayInZone } from "@/lib/time/tz";

// C-30 — subscriptions: start/end, pause/resume (pause extends the end
// date by the elapsed paused days), cancel. Independent of member
// status.

type SubsModule = typeof import("@/lib/services/subscriptions");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let subs: SubsModule;

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const ownerId = asUserId(uuidv7());
const locationId = uuidv7();
const personId = uuidv7();
const memberId = asMemberId(uuidv7());
const durationPlanId = uuidv7();
const sessionsPlanId = uuidv7();
const oneTimePlanId = uuidv7();
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

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
  subs = await import("@/lib/services/subscriptions");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Subs A', 'active', $5),
       ($3, $4, 'Subs B', 'active', $5)`,
    [tenantA, `subs-a-${RUN}`, tenantB, `subs-b-${RUN}`, TZ],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    ownerId,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [locationId, tenantA],
  );
  await admin.query(
    "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Subs Member')",
    [personId, tenantA],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code)
     values ($1, $2, $3, $4, 'active', $5)`,
    [memberId, tenantA, personId, locationId, `SUB-${RUN}`],
  );
  await admin.query(
    `insert into membership_plans (id, tenant_id, name, kind, duration_days, sessions, amount_paise)
     values
       ($1, $3, 'Monthly', 'duration', 30, null, 250000),
       ($2, $3, '10-class pack', 'sessions', null, 10, 400000),
       ($4, $3, 'Registration', 'one_time', null, null, 100000)`,
    [durationPlanId, sessionsPlanId, tenantA, oneTimePlanId],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("C-30 subscriptions", () => {
  it("creates a duration subscription with an inclusive end date", async () => {
    const today = todayInZone(TZ);
    const result = await subs.createSubscription(ctx, {
      memberId,
      planId: durationPlanId,
    });
    expect(result.ok).toBe(true);

    const list = await subs.listMemberSubscriptions(ctx, memberId);
    const created = list.find((s) => s.planId === durationPlanId);
    expect(created?.startsOn).toBe(today);
    expect(created?.endsOn).toBe(addDays(today, 29));
    expect(created?.status).toBe("active");
    expect(created).toMatchObject({
      planName: "Monthly",
      planKind: "duration",
      amountPaise: 250000,
    });
  });

  it("defaults a session pack to the 90-day validity window", async () => {
    const today = todayInZone(TZ);
    const result = await subs.createSubscription(ctx, {
      memberId,
      planId: sessionsPlanId,
      startsOn: today,
    });
    expect(result.ok).toBe(true);

    const created = (
      await subs.listMemberSubscriptions(ctx, memberId)
    ).find((s) => s.planId === sessionsPlanId);
    expect(created?.endsOn).toBe(addDays(today, 89));
  });

  it("refuses one-time plans and inverted date ranges", async () => {
    const oneTime = await subs.createSubscription(ctx, {
      memberId,
      planId: oneTimePlanId,
    });
    expect(oneTime.ok).toBe(false);

    const inverted = await subs.createSubscription(ctx, {
      memberId,
      planId: durationPlanId,
      startsOn: "2026-09-20",
      endsOn: "2026-09-19",
    });
    expect(inverted.ok).toBe(false);
  });

  it("moves the end date by exactly seven days across a seven-day pause", async () => {
    const today = todayInZone(TZ);
    const created = await subs.createSubscription(ctx, {
      memberId,
      planId: durationPlanId,
      startsOn: today,
      endsOn: addDays(today, 29),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const originalEnd = addDays(today, 29);

    const paused = await subs.pauseSubscription(ctx, { id: created.id });
    expect(paused.ok).toBe(true);

    // Simulate the pause having started seven days ago (the service
    // uses the real tenant-local date; the fixture moves the record).
    await admin.query(
      "update subscriptions set paused_from = $2::date where id = $1",
      [created.id, addDays(today, -7)],
    );

    const resumed = await subs.resumeSubscription(ctx, { id: created.id });
    expect(resumed.ok).toBe(true);

    const after = (
      await subs.listMemberSubscriptions(ctx, memberId)
    ).find((s) => s.id === created.id);
    expect(after?.status).toBe("active");
    expect(after?.endsOn).toBe(addDays(originalEnd, 7));
    expect(after?.pausedFrom).toBeNull();
    expect(after?.pausedUntil).toBeNull();
  });

  it("guards pause, resume and cancel transitions", async () => {
    const created = await subs.createSubscription(ctx, {
      memberId,
      planId: durationPlanId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Resume something active.
    expect((await subs.resumeSubscription(ctx, { id: created.id })).ok).toBe(false);

    // Pause twice.
    expect((await subs.pauseSubscription(ctx, { id: created.id })).ok).toBe(true);
    expect((await subs.pauseSubscription(ctx, { id: created.id })).ok).toBe(false);

    // Cancel from paused, then nothing more.
    expect((await subs.cancelSubscription(ctx, { id: created.id })).ok).toBe(true);
    expect((await subs.resumeSubscription(ctx, { id: created.id })).ok).toBe(false);
    expect((await subs.cancelSubscription(ctx, { id: created.id })).ok).toBe(false);

    const after = (
      await subs.listMemberSubscriptions(ctx, memberId)
    ).find((s) => s.id === created.id);
    expect(after?.status).toBe("cancelled");
  });

  it("keeps subscriptions tenant-isolated", async () => {
    const otherCtx = { tenantId: tenantB, userId: ownerId };
    expect(await subs.listMemberSubscriptions(otherCtx, memberId)).toHaveLength(0);

    const foreignCreate = await subs.createSubscription(otherCtx, {
      memberId,
      planId: durationPlanId,
    });
    expect(foreignCreate.ok).toBe(false);
  });

  it("audits create, pause, resume and cancel", async () => {
    const audit = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1",
      [tenantA],
    );
    const actions = audit.rows.map((r) => r.action);
    for (const expected of [
      "subscription.create",
      "subscription.pause",
      "subscription.resume",
      "subscription.cancel",
    ]) {
      expect(actions).toContain(expected);
    }
  });
});
