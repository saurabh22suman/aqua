import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { createTenant, type CreateTenantInput } from "@/db/platform-tenant-create";
import { inviteOwner } from "@/db/tenant-invite";
import { activateInvitedMemberships } from "@/db/membership-activation";
import { createProgram, createBatch } from "@/lib/services/programs";
import { generateSessions } from "@/lib/jobs/session-generator";
import { seedRoleTemplates } from "@/lib/services/roles";
import { asTenantId, asUserId, type UserId, type TenantId } from "@/lib/ids";

// D3 — "the seed doing something the production path does not" has
// shown up four times now (enrolMember, seedRoleTemplates, membership
// activation, session scheduling). This test is the permanent fix the
// individual patches (C1-C3, D1, D2) are not: it drives a tenant
// through the real production surfaces only — createTenant,
// inviteOwner, activateInvitedMemberships (what OTP verification
// calls), createProgram, createBatch — and drives an equivalent
// tenant through the same raw-SQL shape scripts/seed.ts and
// scripts/seed-demo.ts use (direct inserts, direct seedRoleTemplates,
// direct generateSessions, membership pre-set to 'active'). If the
// production path stops producing what the seed path assumes is
// automatic, this fails without anyone needing to notice a coach
// looking at an empty register or an owner locked out after invite.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";
const DAYS_OF_WEEK = [1, 3, 5];

let actorId: UserId;
const tenantIdsToClean: TenantId[] = [];
const userIdsToClean: string[] = [];

async function actor(): Promise<UserId> {
  if (actorId) return actorId;
  const id = uuidv7();
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'Parity Test Operator', 'h', 's', 'admin', 'active')`,
    [id, `parity-${RUN}@platform.test`],
  );
  actorId = asUserId(id);
  return actorId;
}

afterAll(async () => {
  for (const id of tenantIdsToClean) {
    await admin.query("delete from sessions where tenant_id = $1", [id]);
    await admin.query("delete from batches where tenant_id = $1", [id]);
    await admin.query("delete from programs where tenant_id = $1", [id]);
    await admin.query("delete from tenant_memberships where tenant_id = $1", [id]);
    await admin.query("delete from role_permissions where tenant_id = $1", [id]);
    await admin.query("delete from roles where tenant_id = $1", [id]);
    await admin.query("delete from locations where tenant_id = $1", [id]);
    await admin.query("delete from platform_audit_log where tenant_id = $1", [id]);
    await admin.query(
      "delete from pgboss.schedule where name = 'sessions.generate' and key = $1",
      [id],
    );
    await admin.query("delete from tenants where id = $1", [id]);
  }
  for (const id of userIdsToClean) {
    await admin.query("delete from users where id = $1::uuid", [id]);
  }
  if (actorId) {
    await admin.query("delete from platform_users where id = $1::uuid", [actorId]);
  }
  await admin.end();
});

async function roleKeys(tenantId: TenantId): Promise<string[]> {
  const rows = await admin.query<{ key: string }>(
    "select key from roles where tenant_id = $1 order by key",
    [tenantId],
  );
  return rows.rows.map((r) => r.key);
}

async function membershipStatus(tenantId: TenantId, userId: string): Promise<string | undefined> {
  const rows = await admin.query<{ status: string }>(
    "select status from tenant_memberships where tenant_id = $1 and user_id = $2",
    [tenantId, userId],
  );
  return rows.rows[0]?.status;
}

async function sessionDates(tenantId: TenantId, batchId: string): Promise<string[]> {
  const rows = await admin.query<{ session_date: string }>(
    "select session_date from sessions where tenant_id = $1 and batch_id = $2 order by session_date",
    [tenantId, batchId],
  );
  return rows.rows.map((r) => r.session_date);
}

describe("tenant creation: production path vs seed path", () => {
  it("produces the same roles, the same membership activation outcome, and the same session schedule", async () => {
    // --- production path: createTenant, inviteOwner, the same
    // activation OTP verification triggers, createProgram, createBatch ---
    const prodInput: CreateTenantInput = {
      name: "Parity Prod Academy",
      slug: `parity-prod-${RUN}`,
      timezone: TZ,
      planKey: "standard",
      currency: "INR",
      locationName: "Main",
      locationIsPrimary: true,
    };
    const prodResult = await createTenant(prodInput, { actorId: await actor() });
    expect(prodResult.kind).toBe("ok");
    if (prodResult.kind !== "ok") return;
    const prodTenantId = prodResult.tenantId;
    tenantIdsToClean.push(prodTenantId);

    const phone = `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`;
    const invited = await inviteOwner(prodTenantId, { phone, actorId: await actor() });
    expect(invited.kind).toBe("ok");
    if (invited.kind !== "ok") return;
    userIdsToClean.push(invited.userId);

    // The production trigger for invited -> active is OTP verification
    // (lib/auth/server.ts's callbackOnVerification); calling the same
    // function it calls is the right boundary for a service-level test
    // — same as invite-owner-action.test.ts calling inviteOwner
    // directly instead of driving the real HTTP invite wizard.
    await activateInvitedMemberships(asUserId(invited.userId));

    const prodCtx = { tenantId: prodTenantId, userId: asUserId(invited.userId) };
    const prodProgram = await createProgram(prodCtx, { name: "Parity Swimming" });
    const prodBatch = await createBatch(prodCtx, {
      programId: prodProgram.id,
      name: "Parity Batch",
      capacity: 10,
      daysOfWeek: DAYS_OF_WEEK,
      startTime: "07:00",
      endTime: "08:00",
    });

    // --- seed path: mirrors scripts/seed.ts / scripts/seed-demo.ts —
    // raw tenant insert, seedRoleTemplates called directly, an
    // already-active membership (no invite/activate round trip),
    // generateSessions called directly on a hand-inserted batch ---
    const seedTenantId = asTenantId(uuidv7());
    tenantIdsToClean.push(seedTenantId);
    const plan = await admin.query<{ id: string }>("select id from plans where is_default = true");
    await admin.query(
      `insert into tenants (id, slug, name, status, plan_id, timezone, currency)
       values ($1, $2, 'Parity Seed Academy', 'trial', $3, $4, 'INR')`,
      [seedTenantId, `parity-seed-${RUN}`, plan.rows[0]?.id ?? null, TZ],
    );
    await seedRoleTemplates(seedTenantId);

    const seedUserId = uuidv7();
    userIdsToClean.push(seedUserId);
    await admin.query(`insert into users (id, phone) values ($1, $2)`, [
      seedUserId,
      `+91${Math.floor(9000000000 + Math.random() * 1000000000)}`,
    ]);
    const ownerRole = await admin.query<{ id: string }>(
      "select id from roles where tenant_id = $1 and key = 'owner'",
      [seedTenantId],
    );
    await admin.query(
      `insert into tenant_memberships (id, tenant_id, user_id, role_id, status)
       values (gen_random_uuid(), $1, $2, $3, 'active')`,
      [seedTenantId, seedUserId, ownerRole.rows[0]!.id],
    );

    const seedProgramId = uuidv7();
    await admin.query(
      `insert into programs (id, tenant_id, name) values ($1, $2, 'Parity Swimming')`,
      [seedProgramId, seedTenantId],
    );
    const seedBatchId = uuidv7();
    await admin.query(
      `insert into batches
         (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time)
       values ($1, $2, $3, 'Parity Batch', 10, $4::int[], '07:00', '08:00')`,
      [seedBatchId, seedTenantId, seedProgramId, `{${DAYS_OF_WEEK.join(",")}}`],
    );
    await withTenant(seedTenantId, (tx) => generateSessions(tx, seedTenantId, TZ));

    // --- parity assertions ---
    expect(await roleKeys(prodTenantId)).toEqual(await roleKeys(seedTenantId));

    // D1: production's invite + OTP-verification-triggered activation
    // must land the membership in the same state the seed path
    // reaches by inserting 'active' directly.
    expect(await membershipStatus(prodTenantId, invited.userId)).toBe("active");
    expect(await membershipStatus(seedTenantId, seedUserId)).toBe("active");

    // D2: production's createBatch must materialise the same session
    // set generateSessions produces when called directly against an
    // identically-shaped batch.
    const prodDates = await sessionDates(prodTenantId, prodBatch.id);
    const seedDates = await sessionDates(seedTenantId, seedBatchId);
    expect(prodDates.length).toBeGreaterThan(0);
    expect(prodDates).toEqual(seedDates);
  });
});
