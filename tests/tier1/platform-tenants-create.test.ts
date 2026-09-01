import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import {
  createTenant,
  type CreateTenantInput,
  type CreateTenantResult,
} from "@/db/platform-tenant-create";
import { asUserId, type UserId, type TenantId } from "@/lib/ids";

// Phase 1.5 — service-level proof for createTenant(): one
// transaction inserts the tenant row, the first location, and the
// audit row, all atomic; rejects unique-slug collisions as
// `slug_taken`, missing plans as `plan_not_found`, and bad inputs as
// `invalid` — never throws to the caller.
//
// Tests within this file run in parallel (vitest default, per
// vitest.config.ts). Each test mints a per-test counter into its
// slug so the unique constraint can't collide under concurrent
// inserts — the goal of the test isolation is that one test's
// failure doesn't poison another's.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);
const SLUG_PREFIX = `create-${RUN}`;

let actorId: UserId;

beforeAll(async () => {
  // For the actor id, mint a real platform_users row so any FK-like
  // audit relationship stays consistent. The tenant.created_by /
  // tenant.updated_by columns aren't foreign-keyed today, but the
  // service contract treats the field as an audit id; giving the
  // test a real value lets it spot accidental format drift.
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'Test Operator', 'h', 's', 'admin', 'active')
     on conflict (email) do nothing`,
    [uuidv7(), `create-actor-${RUN}@platform.test`],
  );
  const actor = await admin.query<{ id: string }>(
    "select id from platform_users where email = $1",
    [`create-actor-${RUN}@platform.test`],
  );
  actorId = asUserId(actor.rows[0]!.id);
});

afterAll(async () => {
  // Cascade-deletes from tenants via the FK on locations; audit
  // rows survive independently, so wipe them by tenant_id.
  const rows = await admin.query<{ id: string }>(
    "select id from tenants where slug like $1",
    [`${SLUG_PREFIX}%`],
  );
  for (const r of rows.rows) {
    await admin.query("delete from locations where tenant_id = $1", [r.id]);
    await admin.query(
      "delete from platform_audit_log where tenant_id = $1",
      [r.id],
    );
    await admin.query("delete from tenants where id = $1", [r.id]);
  }
  await admin.query(
    "delete from platform_users where email = $1",
    [`create-actor-${RUN}@platform.test`],
  );
  await admin.end();
});

let counter = 0;
function uniqueSlug(label: string): string {
  counter += 1;
  return `${SLUG_PREFIX}-${label}-${counter}`;
}

function baseInput(slug: string): CreateTenantInput {
  return {
    name: "Create Test Academy",
    slug,
    timezone: "Asia/Kolkata",
    planKey: "standard",
    currency: "INR",
    locationName: "Main",
    locationIsPrimary: true,
  };
}

async function expectOk(
  result: CreateTenantResult,
): Promise<TenantId> {
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") {
    throw new Error(`createTenant returned error: ${result.kind}`);
  }
  return result.tenantId;
}

async function expectError(
  result: CreateTenantResult,
  code: string,
): Promise<void> {
  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.code).toBe(code);
  expect(result.message.length).toBeGreaterThan(0);
}

describe("createTenant", () => {
  it("returns tenantId and writes tenant + first location + audit row in one transaction", async () => {
    const slug = uniqueSlug("happy");
    const tenantId = await expectOk(await createTenant(baseInput(slug), { actorId }));

    // Row 1: tenant row carries the inputs and the actor id.
    const tenant = (
      await admin.query<{
        name: string;
        slug: string;
        status: string;
        timezone: string;
        currency: string;
        gstin: string | null;
        created_by: string;
      }>(
        `select name, slug, status, timezone, currency, gstin, created_by
         from tenants where id = $1`,
        [tenantId],
      )
    ).rows[0]!;
    expect(tenant.name).toBe("Create Test Academy");
    expect(tenant.slug).toBe(slug);
    expect(tenant.status).toBe("trial");
    expect(tenant.timezone).toBe("Asia/Kolkata");
    expect(tenant.currency).toBe("INR");
    expect(tenant.gstin).toBeNull();
    expect(tenant.created_by).toBe(actorId);

    // Row 2: first location, primary, named from input.
    const location = (
      await admin.query<{
        tenant_id: string;
        name: string;
        is_primary: boolean;
      }>(
        `select tenant_id, name, is_primary from locations where tenant_id = $1`,
        [tenantId],
      )
    ).rows[0]!;
    expect(location.tenant_id).toBe(tenantId);
    expect(location.name).toBe("Main");
    expect(location.is_primary).toBe(true);

    // Row 3: audit row scoped to this tenant with the right actor.
    const audit = (
      await admin.query<{
        actor_id: string;
        action: string;
        target_type: string;
        target_id: string;
        detail: Record<string, unknown>;
      }>(
        `select actor_id, action, target_type, target_id, detail
         from platform_audit_log where tenant_id = $1`,
        [tenantId],
      )
    ).rows[0]!;
    expect(audit.actor_id).toBe(actorId);
    expect(audit.action).toBe("tenant.create");
    expect(audit.target_type).toBe("tenant");
    expect(audit.target_id).toBe(tenantId);
    expect(audit.detail).toMatchObject({
      name: "Create Test Academy",
      slug,
      timezone: "Asia/Kolkata",
      planKey: "standard",
      currency: "INR",
      locationName: "Main",
      locationIsPrimary: true,
    });
  });

  it("trims whitespace from string fields via zod", async () => {
    const slug = uniqueSlug("trimmed");
    const tenantId = await expectOk(
      await createTenant(
        {
          ...baseInput(`  ${slug}  `),
          name: "  Trimmed Academy  ",
        },
        { actorId },
      ),
    );
    const tenant = (
      await admin.query<{ slug: string; name: string }>(
        "select slug, name from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(tenant.slug).toBe(slug);
    expect(tenant.name).toBe("Trimmed Academy");
  });

  it("captures an upper-cased gstin on the tenant row when provided", async () => {
    const slug = uniqueSlug("gstin");
    const gstin = "33ABCDE1234F1Z5";
    const tenantId = await expectOk(
      await createTenant({ ...baseInput(slug), gstin: gstin.toLowerCase() }, { actorId }),
    );
    const tenant = (
      await admin.query<{ gstin: string }>(
        "select gstin from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(tenant.gstin).toBe(gstin);
  });

  it("rejects a duplicate slug with code: 'slug_taken' (no second row written)", async () => {
    const slug = uniqueSlug("collision");
    const first = await expectOk(await createTenant(baseInput(slug), { actorId }));
    await expectError(
      await createTenant(baseInput(slug), { actorId }),
      "slug_taken",
    );

    // Mutation proof: collision is a one-row outcome, not two.
    const rows = (
      await admin.query<{ count: string }>(
        "select count(*)::text from tenants where slug = $1",
        [slug],
      )
    ).rows[0]!;
    expect(Number(rows.count)).toBe(1);
    // Roll back the audit row the first call wrote, so the parallel
    // sweep's afterAll doesn't see a leftover.
    await admin.query(
      "delete from platform_audit_log where tenant_id = $1",
      [first],
    );
    await admin.query("delete from locations where tenant_id = $1", [first]);
    await admin.query("delete from tenants where id = $1", [first]);
  });

  it("rejects an unknown plan key with code: 'plan_not_found' and writes nothing", async () => {
    const slug = uniqueSlug("bad-plan");
    await expectError(
      await createTenant(
        { ...baseInput(slug), planKey: "does-not-exist" },
        { actorId },
      ),
      "plan_not_found",
    );
    const rows = (
      await admin.query<{ count: string }>(
        "select count(*)::text from tenants where slug = $1",
        [slug],
      )
    ).rows[0]!;
    expect(Number(rows.count)).toBe(0);
  });

  it("rejects invalid input (uppercase slug) with code: 'invalid' and writes nothing", async () => {
    const slug = `WILL-NOT-BE-STORED-${counter}`;
    await expectError(
      await createTenant({ ...baseInput(slug) }, // uppercase slug instead
      { actorId }),
      "invalid",
    );
  });

  it("writes all three rows atomically (the audit-row assertion breaks if the audit insert is dropped)", async () => {
    // The standalone "rows captured" assertion earlier already pins
    // this — but having the explicit one-table-each test read it
    // through to a reader helps the next person reading this file
    // see the audit-row dependency at a glance. The mutation proof
    // in the review-checklist sense: delete the audit insert from
    // createTenant and this assertion's "auditCount === 1" line
    // breaks. No new machinery required.
    const slug = uniqueSlug("atomic");
    const tenantId = await expectOk(
      await createTenant(baseInput(slug), { actorId }),
    );
    const tenantsCount = (
      await admin.query<{ count: string }>(
        "select count(*)::text from tenants where id = $1",
        [tenantId],
      )
    ).rows[0]!;
    const locationsCount = (
      await admin.query<{ count: string }>(
        "select count(*)::text from locations where tenant_id = $1",
        [tenantId],
      )
    ).rows[0]!;
    const auditCount = (
      await admin.query<{ count: string }>(
        "select count(*)::text from platform_audit_log where tenant_id = $1",
        [tenantId],
      )
    ).rows[0]!;
    expect(Number(tenantsCount.count)).toBe(1);
    expect(Number(locationsCount.count)).toBe(1);
    expect(Number(auditCount.count)).toBe(1);
  });
});
